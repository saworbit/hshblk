//! docs/hld.md §6: the resource channel. A document may show images that sit beside it,
//! inside its repository, and nothing else.
//!
//! The page asks for `doc-asset://localhost/<handle>%2F<file>`. The handle names the document,
//! and a window is served only its own, as each command reads only its own. The file is what the
//! image's destination names, which the page has percent-decoded once. No path comes from the
//! webview.

use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use percent_encoding::percent_decode_str;
use tauri::http::{header, Request, Response, StatusCode};

use crate::documents::{read_capped, Document, Documents};
use crate::windows;

pub const SCHEME: &str = "doc-asset";

/// Larger images are refused, so a document cannot point the page at an endless read.
pub const MAX_ASSET_BYTES: u64 = 20 * 1024 * 1024;

/// How much of a file `refusal` reads first: every type's first bytes, and an SVG's start unless
/// it is long, when it reads twice as much again each time until the root element shows.
const HEAD_BYTES: u64 = 4096;

#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    UnknownDocument,
    NotRelative,
    OutsideScope,
    Missing,
    NotAFile,
    TooLarge,
    NotAnImage,
}

impl Refusal {
    /// What an image's chip says of it, since a failed load tells the page nothing (#231).
    pub fn reason(&self) -> &'static str {
        match self {
            Self::UnknownDocument | Self::Missing => "Not found",
            Self::NotRelative => "Not a file in the repository",
            Self::OutsideScope => "Outside the repository",
            Self::NotAFile => "Not a file",
            Self::TooLarge => "Larger than 20 MB",
            Self::NotAnImage => "Not an image this app shows",
        }
    }
}

/// Answers a request from the window labelled `window`.
pub fn respond(
    documents: &Documents,
    window: &str,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    match serve(documents, window, request.uri().path()) {
        Ok((bytes, kind)) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, kind)
            .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
            .body(bytes),
        Err(refusal) => Response::builder()
            .status(match refusal {
                Refusal::UnknownDocument | Refusal::Missing => StatusCode::NOT_FOUND,
                _ => StatusCode::FORBIDDEN,
            })
            .body(Vec::new()),
    }
    .expect("a response from a status, a header, and bytes")
}

/// The variable naming the file a debug build records each request in.
#[cfg(debug_assertions)]
pub const LOG_VARIABLE: &str = "HSHBLK_ASSET_LOG";

/// Debug builds only: each request the channel answers, served or refused, as a line in the file
/// `HSHBLK_ASSET_LOG` names. WebKitGTK's resource timing does not see the app's own schemes, so
/// the §8 item 2 test counts what the channel was asked for here.
#[cfg(debug_assertions)]
pub fn record(webview: &str, request: &Request<Vec<u8>>, response: &Response<Vec<u8>>) {
    if let Some(log) = std::env::var_os(LOG_VARIABLE) {
        if let Err(error) = append(Path::new(&log), webview, request, response) {
            eprintln!("{LOG_VARIABLE}: {error}");
        }
    }
}

/// One line: the window that asked, the status, and the path as asked.
#[cfg(debug_assertions)]
fn append(
    log: &Path,
    webview: &str,
    request: &Request<Vec<u8>>,
    response: &Response<Vec<u8>>,
) -> std::io::Result<()> {
    use std::io::Write;
    let status = response.status().as_u16();
    let line = format!("{webview} {status} {}\n", request.uri().path());
    fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log)?
        .write_all(line.as_bytes())
}

fn serve(
    documents: &Documents,
    window: &str,
    path: &str,
) -> Result<(Vec<u8>, &'static str), Refusal> {
    let request = percent_decode_str(path.trim_start_matches('/')).decode_utf8_lossy();
    let (handle, reference) = request.split_once('/').ok_or(Refusal::UnknownDocument)?;
    // Another window's handle is refused as if it named nothing, so a leaked one reads nothing.
    if windows::handle_of(window) != Some(handle) {
        return Err(Refusal::UnknownDocument);
    }
    let document = documents.get(handle).ok_or(Refusal::UnknownDocument)?;
    load(&document, reference)
}

/// The bytes and type of the image a reference names, or why it is refused.
pub fn load(document: &Document, reference: &str) -> Result<(Vec<u8>, &'static str), Refusal> {
    let file = resolve(document, reference)?;
    // One handle, its own size checked, and no more than the cap read from it (#262).
    let handle = fs::File::open(&file).map_err(|_| Refusal::Missing)?;
    let metadata = handle.metadata().map_err(|_| Refusal::Missing)?;
    if !metadata.is_file() {
        return Err(Refusal::NotAFile);
    }
    let bytes = read_capped(handle, MAX_ASSET_BYTES)
        .map_err(|_| Refusal::Missing)?
        .ok_or(Refusal::TooLarge)?;
    let kind = image_type(&bytes).ok_or(Refusal::NotAnImage)?;
    Ok((bytes, kind))
}

/// Why the channel would refuse the image a reference names, or none when it would serve it, as
/// `load` decides, from no more of the file than its type takes to tell (#331). An image that
/// would not decode is read only as far as its first bytes.
pub fn refusal(document: &Document, reference: &str) -> Option<Refusal> {
    sniff(document, reference).err()
}

/// The type of the image a reference names, as `load` finds it, without reading it whole.
fn sniff(document: &Document, reference: &str) -> Result<&'static str, Refusal> {
    let file = resolve(document, reference)?;
    let handle = fs::File::open(&file).map_err(|_| Refusal::Missing)?;
    let metadata = handle.metadata().map_err(|_| Refusal::Missing)?;
    if !metadata.is_file() {
        return Err(Refusal::NotAFile);
    }
    if metadata.len() > MAX_ASSET_BYTES {
        return Err(Refusal::TooLarge);
    }
    head_type(handle)
}

/// The image type a file begins with, read a head at a time until the head can tell.
fn head_type(mut file: impl Read) -> Result<&'static str, Refusal> {
    let mut head = Vec::new();
    loop {
        let wanted = (head.len() as u64).max(HEAD_BYTES);
        let read = (&mut file)
            .take(wanted)
            .read_to_end(&mut head)
            .map_err(|_| Refusal::Missing)?;
        if let Some(kind) = image_type(&head) {
            return Ok(kind);
        }
        // The whole file, or a head that is plainly no SVG, is not an image.
        if (read as u64) < wanted || is_svg(&head).is_some() {
            return Err(Refusal::NotAnImage);
        }
        // A file that grew past the cap while it was read, as `load` would find it.
        if head.len() as u64 > MAX_ASSET_BYTES {
            return Err(Refusal::TooLarge);
        }
    }
}

/// The file a reference names, if a document may show it. The page has already dropped the
/// destination's query and fragment, so a `#` or `?` here is part of the file's name.
pub fn resolve(document: &Document, reference: &str) -> Result<PathBuf, Refusal> {
    let file = locate(document, reference)?;
    let metadata = fs::metadata(&file).map_err(|_| Refusal::Missing)?;
    if !metadata.is_file() {
        return Err(Refusal::NotAFile);
    }
    if metadata.len() > MAX_ASSET_BYTES {
        return Err(Refusal::TooLarge);
    }
    Ok(file)
}

/// Where a reference leads, with symlinks resolved, if it stays inside the document's scope: an
/// image's file, or a linked document's (#156).
///
/// A reference is relative to the document, or, after one leading slash, to the scope's root, as
/// GitHub reads it in a repository. It never names the filesystem's root.
pub fn locate(document: &Document, reference: &str) -> Result<PathBuf, Refusal> {
    let (base, rest) = match reference.strip_prefix('/') {
        Some(rest) => (document.scope.as_path(), rest),
        None => (document.path.parent().ok_or(Refusal::Missing)?, reference),
    };
    let relative = Path::new(rest);
    let plain = relative.components().all(|part| {
        matches!(
            part,
            Component::Normal(_) | Component::CurDir | Component::ParentDir
        )
    });
    if rest.is_empty() || !plain || rest.contains(':') {
        return Err(Refusal::NotRelative);
    }
    // Symlinks and junctions resolve before the scope is checked, so neither can leave it.
    let file = fs::canonicalize(base.join(relative)).map_err(|_| Refusal::Missing)?;
    // A flat scope holds only the files directly in it, beside the document.
    let inside = if document.flat {
        file.parent() == Some(document.scope.as_path())
    } else {
        file.starts_with(&document.scope)
    };
    if !inside {
        return Err(Refusal::OutsideScope);
    }
    Ok(file)
}

/// The image type the bytes begin with. A file named `.png` that is not one is not shown.
pub fn image_type(bytes: &[u8]) -> Option<&'static str> {
    let starts = |magic: &[u8]| bytes.starts_with(magic);
    if starts(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if starts(b"\xFF\xD8\xFF") {
        Some("image/jpeg")
    } else if starts(b"GIF87a") || starts(b"GIF89a") {
        Some("image/gif")
    } else if starts(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else if matches!(bytes.get(4..12), Some(b"ftypavif" | b"ftypavis")) {
        // `avis` is an animated AVIF's brand (#230).
        Some("image/avif")
    } else if starts(b"BM") && bytes.get(6..10) == Some(b"\0\0\0\0") {
        // A bitmap's two reserved fields are zero, which text that starts with BM is not.
        Some("image/bmp")
    } else if starts(b"\0\0\x01\0") && bytes.get(4..6).is_some_and(|count| count != b"\0\0") {
        // An icon file names how many images it holds, at least one.
        Some("image/x-icon")
    } else if is_svg(bytes) == Some(true) {
        Some("image/svg+xml")
    } else {
        None
    }
}

/// SVG is text, so it is known by its root element, after what XML lets come before it: a byte
/// order mark, white space, the XML declaration, comments, processing instructions, and a
/// doctype with its internal subset. In an image, its scripts never run. None when the bytes end
/// before the root element shows, so a file's head can say it needs more (#331).
fn is_svg(bytes: &[u8]) -> Option<bool> {
    let mut rest = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    loop {
        rest = rest.trim_ascii_start();
        rest = if rest.starts_with(b"<?") {
            after(rest, 2, b"?>")?
        } else if rest.starts_with(b"<!--") {
            after(rest, 4, b"-->")?
        } else if rest.starts_with(b"<!DOCTYPE") {
            after_doctype(rest)?
        } else if rest.starts_with(b"<svg") {
            return Some(true);
        } else if [&b"<svg"[..], b"<!--", b"<!DOCTYPE"]
            .iter()
            .any(|start| start.starts_with(rest))
        {
            return None;
        } else {
            return Some(false);
        };
    }
}

/// What follows the first `end` at or past `from`, or none when there is none.
fn after<'a>(bytes: &'a [u8], from: usize, end: &[u8]) -> Option<&'a [u8]> {
    let tail = bytes.get(from..)?;
    let at = tail.windows(end.len()).position(|window| window == end)?;
    Some(&bytes[from + at + end.len()..])
}

/// What follows a doctype, or none when it does not end. Its internal subset may hold `>` in
/// quotes, comments, and processing instructions, so the doctype ends at the first `>` outside
/// all of them.
fn after_doctype(bytes: &[u8]) -> Option<&[u8]> {
    let mut depth = 0usize;
    let mut rest = &bytes[b"<!DOCTYPE".len()..];
    while let Some(&byte) = rest.first() {
        rest = match byte {
            b'"' | b'\'' => after(rest, 1, &[byte])?,
            b'<' if rest.starts_with(b"<!--") => after(rest, 4, b"-->")?,
            b'<' if rest.starts_with(b"<?") => after(rest, 2, b"?>")?,
            b'>' if depth == 0 => return Some(&rest[1..]),
            _ => {
                match byte {
                    b'[' => depth += 1,
                    b']' => depth = depth.saturating_sub(1),
                    _ => {}
                }
                &rest[1..]
            }
        };
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::documents::{Facts, Stamp};
    use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";

    struct Fixture {
        _root: tempfile::TempDir,
        documents: Documents,
        handle: String,
        /// The label of the document's window.
        window: String,
        outside: PathBuf,
    }

    /// repo/.git, repo/docs/notes.md beside near.png and names with a space, an accent, or a
    /// `#`, repo/images/far.png, and a file outside.
    fn fixture() -> Fixture {
        let root = tempfile::tempdir().unwrap();
        let repo = root.path().join("repo");
        for dir in [".git", "docs", "images"] {
            fs::create_dir_all(repo.join(dir)).unwrap();
        }
        fs::write(repo.join("docs/notes.md"), "# Notes\n").unwrap();
        fs::write(repo.join("docs/near.png"), PNG).unwrap();
        fs::write(repo.join("docs/screen shot.png"), PNG).unwrap();
        fs::write(repo.join("docs/café.png"), PNG).unwrap();
        fs::write(repo.join("docs/c#.png"), PNG).unwrap();
        fs::write(repo.join("docs/fake.png"), "not an image").unwrap();
        fs::write(repo.join("images/far.png"), PNG).unwrap();
        let outside = root.path().join("secret.png");
        fs::write(&outside, PNG).unwrap();
        let documents = Documents::default();
        let (handle, _) = documents.open(&repo.join("docs/notes.md")).unwrap();
        Fixture {
            handle: handle.to_string(),
            window: format!("doc-{handle}"),
            _root: root,
            documents,
            outside,
        }
    }

    /// Asks as the page does: `convertFileSrc` encodes the handle and the file path as one component.
    fn ask(fixture: &Fixture, file: &str) -> Result<&'static str, Refusal> {
        ask_as(fixture, &fixture.window, &fixture.handle, file)
    }

    /// Asks from the window labelled `window`, for a file of the document `handle` names.
    fn ask_as(
        fixture: &Fixture,
        window: &str,
        handle: &str,
        file: &str,
    ) -> Result<&'static str, Refusal> {
        let request = format!("{handle}/{file}");
        let path = format!("/{}", utf8_percent_encode(&request, NON_ALPHANUMERIC));
        serve(&fixture.documents, window, &path).map(|(_, kind)| kind)
    }

    #[test]
    fn serves_a_sibling_image_and_one_up_inside_the_repository() {
        let fixture = fixture();
        assert_eq!(ask(&fixture, "near.png"), Ok("image/png"));
        assert_eq!(ask(&fixture, "./near.png"), Ok("image/png"));
        assert_eq!(ask(&fixture, "../images/far.png"), Ok("image/png"));
    }

    #[test]
    fn serves_a_file_whose_name_holds_a_hash_or_a_question_mark() {
        let fixture = fixture();
        assert_eq!(ask(&fixture, "c#.png"), Ok("image/png"));
        // Windows takes no `?` in a file name.
        #[cfg(unix)]
        {
            let document = fixture.documents.get(&fixture.handle).unwrap();
            fs::write(document.path.parent().unwrap().join("why?.png"), PNG).unwrap();
            assert_eq!(ask(&fixture, "why?.png"), Ok("image/png"));
        }
        // The page drops a query and a fragment before it asks, so here they name a file.
        assert_eq!(ask(&fixture, "./near.png?v=2"), Err(Refusal::Missing));
    }

    #[test]
    fn serves_the_file_the_page_decoded_and_decodes_no_further() {
        let fixture = fixture();
        assert_eq!(ask(&fixture, "screen shot.png"), Ok("image/png"));
        assert_eq!(ask(&fixture, "café.png"), Ok("image/png"));
        // The page decodes the reference, so a name still escaped here is a name with a `%` in it.
        assert_eq!(ask(&fixture, "screen%20shot.png"), Err(Refusal::Missing));
    }

    #[test]
    fn serves_an_image_from_the_repository_root_after_one_leading_slash() {
        let fixture = fixture();
        assert_eq!(ask(&fixture, "/images/far.png"), Ok("image/png"));
        assert_eq!(ask(&fixture, "/docs/near.png"), Ok("image/png"));
        assert_eq!(ask(&fixture, "//images/far.png"), Err(Refusal::NotRelative));
        assert_eq!(ask(&fixture, "/"), Err(Refusal::NotRelative));
    }

    #[test]
    fn refuses_what_leaves_the_repository() {
        let fixture = fixture();
        assert_eq!(
            ask(&fixture, "../../secret.png"),
            Err(Refusal::OutsideScope)
        );
        assert_eq!(ask(&fixture, "/../secret.png"), Err(Refusal::OutsideScope));
        // A leading slash is the repository's root, so an absolute path names a file inside it.
        // A Windows path's drive has a colon, which is refused first.
        let refusal = if cfg!(windows) {
            Refusal::NotRelative
        } else {
            Refusal::Missing
        };
        assert_eq!(
            ask(&fixture, fixture.outside.to_str().unwrap()),
            Err(refusal)
        );
        assert_eq!(ask(&fixture, "file:secret.png"), Err(Refusal::NotRelative));
    }

    #[test]
    fn serves_only_the_images_beside_a_document_whose_scope_is_flat() {
        // home/x.md beside a.png, with Pictures/b.png below, as a file saved straight into ~.
        let root = tempfile::tempdir().unwrap();
        let home = fs::canonicalize(root.path()).unwrap();
        fs::create_dir_all(home.join("Pictures")).unwrap();
        fs::write(home.join("a.png"), PNG).unwrap();
        fs::write(home.join("Pictures/b.png"), PNG).unwrap();
        let (facts, text) = Facts::read(b"x");
        let flat = Document {
            path: home.join("x.md"),
            scope: home.clone(),
            flat: true,
            name: "x.md".into(),
            modified: None,
            stamp: Stamp {
                len: 1,
                modified: None,
            },
            text,
            facts,
        };
        for beside in ["a.png", "/a.png", "Pictures/../a.png"] {
            assert_eq!(resolve(&flat, beside), Ok(home.join("a.png")), "{beside}");
        }
        for below in ["Pictures/b.png", "/Pictures/b.png"] {
            assert_eq!(resolve(&flat, below), Err(Refusal::OutsideScope), "{below}");
        }
        // A scope that is not flat holds its folders too.
        let deep = Document {
            flat: false,
            ..flat
        };
        assert_eq!(
            resolve(&deep, "Pictures/b.png"),
            Ok(home.join("Pictures").join("b.png"))
        );
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlink_that_leaves_the_repository() {
        let fixture = fixture();
        let document = fixture.documents.get(&fixture.handle).unwrap();
        let link = document.path.parent().unwrap().join("link.png");
        std::os::unix::fs::symlink(&fixture.outside, link).unwrap();
        assert_eq!(ask(&fixture, "link.png"), Err(Refusal::OutsideScope));
    }

    #[test]
    fn serves_a_window_only_its_own_documents_images() {
        let fixture = fixture();
        let document = fixture.documents.get(&fixture.handle).unwrap();
        let (other, _) = fixture.documents.open(&document.path).unwrap();
        let other_window = format!("doc-{other}");
        let mine = fixture.handle.as_str();
        assert_eq!(
            ask_as(&fixture, &other_window, &other.to_string(), "near.png"),
            Ok("image/png")
        );
        // Both documents may show near.png, but neither window may ask through the other's handle.
        assert_eq!(
            ask_as(&fixture, &other_window, mine, "near.png"),
            Err(Refusal::UnknownDocument)
        );
        assert_eq!(
            ask_as(&fixture, &fixture.window, &other.to_string(), "near.png"),
            Err(Refusal::UnknownDocument)
        );
        // A window that shows no document is served nothing.
        assert_eq!(
            ask_as(&fixture, "empty-0", mine, "near.png"),
            Err(Refusal::UnknownDocument)
        );
    }

    #[test]
    fn locates_a_linked_document_inside_the_repository_and_nothing_outside_it() {
        // #156: a link to another file has the scope an image has, whatever the file holds.
        let fixture = fixture();
        let document = fixture.documents.get(&fixture.handle).unwrap();
        let repo = document.scope.clone();
        fs::write(repo.join("README.md"), "# Readme\n").unwrap();
        assert_eq!(
            locate(&document, "../README.md"),
            Ok(repo.join("README.md"))
        );
        assert_eq!(locate(&document, "/README.md"), Ok(repo.join("README.md")));
        assert_eq!(locate(&document, "notes.md"), Ok(document.path.clone()));
        assert_eq!(
            locate(&document, "../../secret.png"),
            Err(Refusal::OutsideScope)
        );
        assert_eq!(locate(&document, "gone.md"), Err(Refusal::Missing));
        assert_eq!(
            locate(&document, "https://example.com/x.md"),
            Err(Refusal::NotRelative)
        );
    }

    #[test]
    fn says_why_it_refused_an_image_in_the_words_of_its_chip() {
        // #231: every refusal read "Image not shown", whatever the channel knew.
        let fixture = fixture();
        let document = fixture.documents.get(&fixture.handle).unwrap();
        let big = document.path.parent().unwrap().join("big.png");
        fs::File::create(&big)
            .unwrap()
            .set_len(MAX_ASSET_BYTES + 1)
            .unwrap();
        let why = |reference: &str| load(&document, reference).err().map(|r| r.reason());
        assert_eq!(why("near.png"), None);
        assert_eq!(why("gone.png"), Some("Not found"));
        assert_eq!(why("../../secret.png"), Some("Outside the repository"));
        assert_eq!(why("big.png"), Some("Larger than 20 MB"));
        assert_eq!(why("fake.png"), Some("Not an image this app shows"));
        assert_eq!(why("."), Some("Not a file"));
        // #331: `refusal` says what `load` says, from each file's head: a large PNG that would
        // not decode, and a large file that is no image, among them.
        let folder = document.path.parent().unwrap();
        fs::write(folder.join("broken.png"), PNG).unwrap();
        for (name, len) in [("broken.png", 15 << 20), ("zeros.png", 15 << 20)] {
            let file = fs::OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(false)
                .open(folder.join(name))
                .unwrap();
            file.set_len(len).unwrap();
        }
        for reference in [
            "near.png",
            "gone.png",
            "../../secret.png",
            "big.png",
            "fake.png",
            ".",
            "broken.png",
            "zeros.png",
        ] {
            let channel = load(&document, reference).err();
            assert_eq!(refusal(&document, reference), channel, "{reference}");
        }
        assert_eq!(refusal(&document, "broken.png"), None);
        assert_eq!(refusal(&document, "zeros.png"), Some(Refusal::NotAnImage));
    }

    #[test]
    fn reads_no_more_of_a_file_than_its_type_takes_to_tell() {
        // #331: an image that did not show was read whole, up to 20 MB, to say why.
        let large = 15 << 20;
        let read = |bytes: Vec<u8>| {
            let mut file = std::io::Cursor::new(bytes);
            let kind = head_type(&mut file);
            (kind, file.position())
        };
        let mut truncated = PNG.to_vec();
        truncated.resize(large, 0);
        assert_eq!(read(truncated), (Ok("image/png"), HEAD_BYTES));
        let text = b"not an image\n".repeat(large / 13);
        assert_eq!(read(text), (Err(Refusal::NotAnImage), HEAD_BYTES));
        // An SVG whose start is long is read until its root element shows, and no further.
        let mut svg = format!("<!--{}-->\n<svg/>", "x".repeat(10_000)).into_bytes();
        svg.resize(large, b' ');
        assert_eq!(read(svg), (Ok("image/svg+xml"), 4 * HEAD_BYTES));
        // A file shorter than a head is read whole, and judged as `load` judges it.
        assert_eq!(
            read(b"<!-- never closed".to_vec()),
            (Err(Refusal::NotAnImage), 17)
        );
        assert_eq!(read(b"<svg/>".to_vec()), (Ok("image/svg+xml"), 6));
    }

    #[test]
    fn knows_when_a_head_ends_before_an_svg_could_start() {
        // #331: the head of a file can end inside an SVG's start, which more bytes would finish.
        for head in [
            "",
            "  ",
            "<",
            "<sv",
            "<!-",
            "<!DOC",
            "<?xml",
            "<!-- open",
            "<!DOCTYPE svg [",
        ] {
            assert_eq!(is_svg(head.as_bytes()), None, "{head:?}");
        }
        assert_eq!(is_svg(b"<?xml?><svg"), Some(true));
        assert_eq!(is_svg(b"<html>"), Some(false));
        assert_eq!(is_svg(b"<!-- done --> text"), Some(false));
    }

    #[test]
    fn refuses_unknown_documents_folders_and_files_that_are_not_images() {
        let fixture = fixture();
        assert_eq!(
            serve(&fixture.documents, "doc-0000", "/0000%2Fnear.png").map(|_| ()),
            Err(Refusal::UnknownDocument)
        );
        assert_eq!(ask(&fixture, "."), Err(Refusal::NotAFile));
        assert_eq!(ask(&fixture, "gone.png"), Err(Refusal::Missing));
        assert_eq!(ask(&fixture, "fake.png"), Err(Refusal::NotAnImage));
    }

    #[test]
    fn knows_images_by_their_first_bytes() {
        assert_eq!(image_type(PNG), Some("image/png"));
        assert_eq!(image_type(b"\xFF\xD8\xFF\xE0"), Some("image/jpeg"));
        assert_eq!(image_type(b"GIF89a"), Some("image/gif"));
        assert_eq!(image_type(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(image_type(b"\0\0\0\x1cftypavif"), Some("image/avif"));
        assert_eq!(
            image_type(b"  <svg xmlns=\"http://www.w3.org/2000/svg\"/>"),
            Some("image/svg+xml")
        );
        assert_eq!(
            image_type(b"<?xml version=\"1.0\"?>\n<svg/>"),
            Some("image/svg+xml")
        );
        assert_eq!(image_type(b"<html><script>"), None);
    }

    #[test]
    fn knows_an_animated_avif_a_bmp_and_an_icon() {
        // #230: each was refused with 403, though the webview draws all three.
        assert_eq!(image_type(b"\0\0\0\x20ftypavis"), Some("image/avif"));
        let bmp = b"BM\x46\0\0\0\0\0\0\0\x36\0\0\0";
        assert_eq!(image_type(bmp), Some("image/bmp"));
        assert_eq!(
            image_type(b"\0\0\x01\0\x01\0\x10\x10"),
            Some("image/x-icon")
        );
        // Text that starts with BM is not a bitmap, and an icon names at least one image.
        assert_eq!(image_type(b"BMW owners' notes\n"), None);
        assert_eq!(image_type(b"\0\0\x01\0\0\0"), None);
    }

    #[test]
    fn knows_an_svg_after_its_comments_doctype_and_declaration() {
        let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"120\" height=\"60\"></svg>";
        let doctype = "<!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1//EN\" \
                       \"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd\">";
        let subset = "<!DOCTYPE svg [\n<!ENTITY a \"]>\">\n<!-- don't > -->\n<?pi ]> ?>\n]>";
        let long = format!(
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<!--{}-->",
            "x".repeat(1100)
        );
        for head in [
            "<!-- Generator: Some Tool 1.0 -->",
            doctype,
            subset,
            &long,
            "\u{FEFF}<?xml version=\"1.0\"?>\n<!-- one -->\n<?pi?>\n",
        ] {
            let file = format!("{head}\n{svg}");
            assert_eq!(image_type(file.as_bytes()), Some("image/svg+xml"), "{head}");
        }
        for file in [
            "<!-- a comment --><html><script>",
            "<!DOCTYPE html><html><script>",
            "<?xml version=\"1.0\"?><html/>",
            "<!-- never closed <svg>",
            "<!DOCTYPE svg [ <svg>",
            "plain text that mentions <svg>",
            "",
        ] {
            assert_eq!(image_type(file.as_bytes()), None, "{file}");
        }
    }

    #[test]
    fn records_each_request_served_or_refused_as_a_line() {
        let fixture = fixture();
        let folder = tempfile::tempdir().unwrap();
        let log = folder.path().join("assets.log");
        let near = format!("/{}%2Fnear.png", fixture.handle);
        for path in [near.as_str(), "/near.png"] {
            let request = Request::builder()
                .uri(format!("doc-asset://localhost{path}"))
                .body(Vec::new())
                .unwrap();
            let response = respond(&fixture.documents, &fixture.window, &request);
            append(&log, &fixture.window, &request, &response).unwrap();
        }
        let window = &fixture.window;
        assert_eq!(
            fs::read_to_string(&log).unwrap(),
            format!("{window} 200 {near}\n{window} 404 /near.png\n")
        );
    }
}

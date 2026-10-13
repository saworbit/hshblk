//! docs/hld.md §6: the resource channel. A document may show images that sit beside it,
//! inside its repository, and nothing else.
//!
//! The page asks for `doc-asset://localhost/<handle>%2F<file>`. The handle names the document,
//! and a window is served only its own, as each command reads only its own. The file is what the
//! image's destination names, which the page has percent-decoded once. No path comes from the
//! webview.

use std::fs;
use std::path::{Component, Path, PathBuf};

use percent_encoding::percent_decode_str;
use tauri::http::{header, Request, Response, StatusCode};

use crate::documents::{Document, Documents};
use crate::windows;

pub const SCHEME: &str = "doc-asset";

/// Larger images are refused, so a document cannot point the page at an endless read.
pub const MAX_ASSET_BYTES: u64 = 20 * 1024 * 1024;

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
    let file = resolve(&document, reference)?;
    let bytes = fs::read(&file).map_err(|_| Refusal::Missing)?;
    let kind = image_type(&bytes).ok_or(Refusal::NotAnImage)?;
    Ok((bytes, kind))
}

/// The file a reference names, if a document may show it. The page has already dropped the
/// destination's query and fragment, so a `#` or `?` here is part of the file's name.
///
/// A reference is relative to the document, or, after one leading slash, to the scope's root, as
/// GitHub reads it in a repository. It never names the filesystem's root.
pub fn resolve(document: &Document, reference: &str) -> Result<PathBuf, Refusal> {
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
    let metadata = fs::metadata(&file).map_err(|_| Refusal::Missing)?;
    if !metadata.is_file() {
        return Err(Refusal::NotAFile);
    }
    if metadata.len() > MAX_ASSET_BYTES {
        return Err(Refusal::TooLarge);
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
    } else if bytes.get(4..12) == Some(b"ftypavif") {
        Some("image/avif")
    } else if is_svg(bytes) {
        Some("image/svg+xml")
    } else {
        None
    }
}

/// SVG is text, so it is known by its root element, after what XML lets come before it: a byte
/// order mark, white space, the XML declaration, comments, processing instructions, and a
/// doctype with its internal subset. In an image, its scripts never run.
fn is_svg(bytes: &[u8]) -> bool {
    let mut rest = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    loop {
        rest = rest.trim_ascii_start();
        rest = if rest.starts_with(b"<?") {
            after(rest, 2, b"?>")
        } else if rest.starts_with(b"<!--") {
            after(rest, 4, b"-->")
        } else if rest.starts_with(b"<!DOCTYPE") {
            after_doctype(rest)
        } else {
            return rest.starts_with(b"<svg");
        };
    }
}

/// What follows the first `end` at or past `from`, or nothing when there is none.
fn after<'a>(bytes: &'a [u8], from: usize, end: &[u8]) -> &'a [u8] {
    bytes
        .get(from..)
        .and_then(|tail| tail.windows(end.len()).position(|window| window == end))
        .map_or(&[], |at| &bytes[from + at + end.len()..])
}

/// What follows a doctype. Its internal subset may hold `>` in quotes, comments, and
/// processing instructions, so the doctype ends at the first `>` outside all of them.
fn after_doctype(bytes: &[u8]) -> &[u8] {
    let mut depth = 0usize;
    let mut rest = &bytes[b"<!DOCTYPE".len()..];
    while let Some(&byte) = rest.first() {
        rest = match byte {
            b'"' | b'\'' => after(rest, 1, &[byte]),
            b'<' if rest.starts_with(b"<!--") => after(rest, 4, b"-->"),
            b'<' if rest.starts_with(b"<?") => after(rest, 2, b"?>"),
            b'>' if depth == 0 => return &rest[1..],
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
    &[]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::documents::Facts;
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

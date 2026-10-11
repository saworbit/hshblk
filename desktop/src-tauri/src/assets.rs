//! docs/hld.md §6: the resource channel. A document may show images that sit beside it,
//! inside its repository, and nothing else.
//!
//! The page asks for `doc-asset://localhost/<handle>%2F<file>`. The handle names the document.
//! The file is what the image's destination names, which the page has percent-decoded once.
//! No path comes from the webview.

use std::fs;
use std::path::{Component, Path, PathBuf};

use percent_encoding::percent_decode_str;
use tauri::http::{header, Request, Response, StatusCode};

use crate::documents::{Document, Documents};

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

pub fn respond(documents: &Documents, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    match serve(documents, request.uri().path()) {
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

fn serve(documents: &Documents, path: &str) -> Result<(Vec<u8>, &'static str), Refusal> {
    let request = percent_decode_str(path.trim_start_matches('/')).decode_utf8_lossy();
    let (handle, reference) = request.split_once('/').ok_or(Refusal::UnknownDocument)?;
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
    if !file.starts_with(&document.scope) {
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
    use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";

    struct Fixture {
        _root: tempfile::TempDir,
        documents: Documents,
        handle: String,
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
            _root: root,
            documents,
            outside,
        }
    }

    /// Asks as the page does: `convertFileSrc` encodes the handle and the file path as one component.
    fn ask(fixture: &Fixture, file: &str) -> Result<&'static str, Refusal> {
        let request = format!("{}/{}", fixture.handle, file);
        let path = format!("/{}", utf8_percent_encode(&request, NON_ALPHANUMERIC));
        serve(&fixture.documents, &path).map(|(_, kind)| kind)
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
    fn refuses_unknown_documents_folders_and_files_that_are_not_images() {
        let fixture = fixture();
        assert_eq!(
            serve(&fixture.documents, "/0000%2Fnear.png").map(|_| ()),
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
}

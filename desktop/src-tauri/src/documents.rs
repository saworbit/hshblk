//! Documents the app has opened, each behind an opaque handle.
//!
//! docs/hld.md §4: the webview never receives a path. Rust resolves the path, reads the
//! bytes, records what it learned about them, and gives the page a handle instead.

use std::collections::HashMap;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

/// Larger files are refused rather than read whole into memory.
pub const MAX_DOCUMENT_BYTES: u64 = 64 * 1024 * 1024;

/// An opaque name for an open document: 128 random bits, as hex.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Handle(String);

impl Handle {
    fn new() -> Self {
        let mut bytes = [0u8; 16];
        getrandom::fill(&mut bytes).expect("the operating system provides random bytes");
        Self(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
    }
}

impl fmt::Display for Handle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// What was read, and from where.
#[derive(Debug)]
pub struct Document {
    /// The file, with every symlink resolved.
    pub path: PathBuf,
    /// The repository the file is in, or its own folder when it is in none. Assets stay inside it.
    pub scope: PathBuf,
    /// The file's own name, which is all of its path the page is told.
    pub name: String,
    /// When the file was last modified, as it was read, in milliseconds since 1970.
    pub modified: Option<u64>,
    pub text: String,
    pub facts: Facts,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoding {
    Utf8,
    Utf16Le,
    Utf16Be,
    InvalidUtf8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineEndings {
    None,
    Lf,
    Crlf,
    Mixed,
}

/// docs/hld.md §5: facts about the bytes, which the string does not carry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Facts {
    pub encoding: Encoding,
    pub bom: bool,
    pub line_endings: LineEndings,
    pub nul: bool,
}

impl Facts {
    /// Reads the facts, and the text to show. Text that is not valid UTF-8 is shown as best it can be.
    pub fn read(bytes: &[u8]) -> (Self, String) {
        let (encoding, bom, text) = decode(bytes);
        let facts = Self {
            encoding,
            bom,
            line_endings: line_endings(&text),
            nul: text.contains('\0'),
        };
        (facts, text)
    }

    /// Why the editor, once it exists, will open this file read-only. None means it may edit.
    pub fn read_only_reason(&self) -> Option<&'static str> {
        match self {
            Self {
                encoding: Encoding::InvalidUtf8,
                ..
            } => Some("The file is not valid UTF-8."),
            Self {
                encoding: Encoding::Utf16Le | Encoding::Utf16Be,
                ..
            } => Some("The file is UTF-16."),
            Self { nul: true, .. } => Some("The file holds NUL bytes."),
            Self {
                line_endings: LineEndings::Mixed,
                ..
            } => Some("The file mixes line endings."),
            _ => None,
        }
    }
}

fn decode(bytes: &[u8]) -> (Encoding, bool, String) {
    if let Some(rest) = bytes.strip_prefix(b"\xEF\xBB\xBF") {
        return match std::str::from_utf8(rest) {
            Ok(text) => (Encoding::Utf8, true, text.to_owned()),
            Err(_) => (
                Encoding::InvalidUtf8,
                true,
                String::from_utf8_lossy(rest).into_owned(),
            ),
        };
    }
    if let Some(rest) = bytes.strip_prefix(b"\xFF\xFE") {
        return (Encoding::Utf16Le, true, utf16(rest, u16::from_le_bytes));
    }
    if let Some(rest) = bytes.strip_prefix(b"\xFE\xFF") {
        return (Encoding::Utf16Be, true, utf16(rest, u16::from_be_bytes));
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => (Encoding::Utf8, false, text.to_owned()),
        Err(_) => (
            Encoding::InvalidUtf8,
            false,
            String::from_utf8_lossy(bytes).into_owned(),
        ),
    }
}

fn utf16(bytes: &[u8], unit: fn([u8; 2]) -> u16) -> String {
    let units = bytes.chunks_exact(2).map(|pair| unit([pair[0], pair[1]]));
    char::decode_utf16(units)
        .map(|c| c.unwrap_or(char::REPLACEMENT_CHARACTER))
        .collect()
}

/// A lone CR counts as mixed: CodeMirror would split on it, and nothing else in the file does.
fn line_endings(text: &str) -> LineEndings {
    let crlf = text.matches("\r\n").count();
    let cr = text.matches('\r').count() - crlf;
    let lf = text.matches('\n').count() - crlf;
    match (lf, crlf, cr) {
        (0, 0, 0) => LineEndings::None,
        (_, 0, 0) => LineEndings::Lf,
        (0, _, 0) => LineEndings::Crlf,
        _ => LineEndings::Mixed,
    }
}

#[derive(Debug)]
pub enum OpenError {
    Unreadable(std::io::Error),
    NotAFile,
    TooLarge,
}

impl fmt::Display for OpenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unreadable(error) => write!(f, "The file could not be read: {error}."),
            Self::NotAFile => f.write_str("That is not a file."),
            Self::TooLarge => f.write_str("The file is larger than 64 MB."),
        }
    }
}

/// Every open document, by handle. One process holds them all.
#[derive(Default)]
pub struct Documents(Mutex<HashMap<Handle, Arc<Document>>>);

impl Documents {
    /// Resolves and reads a file the user chose, and names it with a new handle.
    pub fn open(&self, path: &Path) -> Result<(Handle, Arc<Document>), OpenError> {
        let document = Arc::new(read(path)?);
        let handle = Handle::new();
        self.0
            .lock()
            .expect("documents lock")
            .insert(handle.clone(), Arc::clone(&document));
        Ok((handle, document))
    }

    pub fn get(&self, handle: &str) -> Option<Arc<Document>> {
        self.0
            .lock()
            .expect("documents lock")
            .get(&Handle(handle.to_owned()))
            .cloned()
    }

    pub fn close(&self, handle: &str) {
        self.0
            .lock()
            .expect("documents lock")
            .remove(&Handle(handle.to_owned()));
    }
}

fn read(path: &Path) -> Result<Document, OpenError> {
    let path = fs::canonicalize(path).map_err(OpenError::Unreadable)?;
    let metadata = fs::metadata(&path).map_err(OpenError::Unreadable)?;
    if !metadata.is_file() {
        return Err(OpenError::NotAFile);
    }
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(OpenError::TooLarge);
    }
    let bytes = fs::read(&path).map_err(OpenError::Unreadable)?;
    let (facts, text) = Facts::read(&bytes);
    let folder = path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| path.clone());
    Ok(Document {
        scope: repository(&folder, home().as_deref()).unwrap_or_else(|| folder.clone()),
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        modified: metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .and_then(|since| u64::try_from(since.as_millis()).ok()),
        text,
        facts,
        path,
    })
}

/// docs/hld.md §6: the enclosing git repository, found by walking up to a `.git` entry. One at
/// the home directory or above it does not count. Dotfiles kept in `~/.git` would make the whole
/// home the scope of every loose file in it, a README unzipped into Downloads included.
fn repository(folder: &Path, home: Option<&Path>) -> Option<PathBuf> {
    folder
        .ancestors()
        .find(|dir| dir.join(".git").exists())
        .filter(|root| home.is_none_or(|home| !home.starts_with(root)))
        .map(Path::to_path_buf)
}

/// The user's home directory, with symlinks resolved as a document's path is.
fn home() -> Option<PathBuf> {
    std::env::home_dir().and_then(|home| fs::canonicalize(home).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_utf8_with_and_without_a_bom() {
        assert_eq!(Facts::read(b"# a\n").0.encoding, Encoding::Utf8);
        let (facts, text) = Facts::read(b"\xEF\xBB\xBF# a\n");
        assert!(facts.bom);
        assert_eq!(text, "# a\n");
        assert_eq!(facts.read_only_reason(), None);
    }

    #[test]
    fn shows_utf16_and_says_it_will_not_edit_it() {
        let (facts, text) = Facts::read(b"\xFF\xFE#\0 \0a\0");
        assert_eq!((facts.encoding, text.as_str()), (Encoding::Utf16Le, "# a"));
        assert_eq!(facts.read_only_reason(), Some("The file is UTF-16."));
    }

    #[test]
    fn shows_invalid_utf8_lossily() {
        let (facts, text) = Facts::read(b"caf\xE9");
        assert_eq!(
            (facts.encoding, text.as_str()),
            (Encoding::InvalidUtf8, "caf\u{FFFD}")
        );
    }

    #[test]
    fn notices_nul_bytes_in_text_that_passes_as_utf8() {
        // UTF-16 without a BOM: valid UTF-8, with a NUL after every ASCII character.
        let (facts, _) = Facts::read(b"#\0 \0a\0");
        assert!(facts.nul);
        assert_eq!(facts.read_only_reason(), Some("The file holds NUL bytes."));
    }

    #[test]
    fn records_line_endings() {
        let endings = |bytes: &[u8]| Facts::read(bytes).0.line_endings;
        assert_eq!(endings(b"a"), LineEndings::None);
        assert_eq!(endings(b"a\nb\n"), LineEndings::Lf);
        assert_eq!(endings(b"a\r\nb\r\n"), LineEndings::Crlf);
        assert_eq!(endings(b"a\r\nb\n"), LineEndings::Mixed);
        assert_eq!(endings(b"a\rb\n"), LineEndings::Mixed);
    }

    #[test]
    fn opens_a_file_behind_a_new_handle_scoped_to_its_repository() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join(".git")).unwrap();
        fs::create_dir_all(root.path().join("docs")).unwrap();
        fs::write(root.path().join("docs/notes.md"), "# Notes\n").unwrap();

        let documents = Documents::default();
        let (handle, document) = documents
            .open(&root.path().join("docs/../docs/notes.md"))
            .unwrap();
        assert_eq!(handle.to_string().len(), 32);
        assert_eq!(document.name, "notes.md");
        assert_eq!(document.text, "# Notes\n");
        assert_eq!(document.scope, fs::canonicalize(root.path()).unwrap());
        assert_eq!(
            documents.get(&handle.to_string()).unwrap().path,
            document.path
        );

        let (again, _) = documents.open(&document.path).unwrap();
        assert_ne!(again, handle);
    }

    #[test]
    fn records_when_the_file_was_last_modified() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("dated.md");
        fs::write(&path, "x").unwrap();
        let when = UNIX_EPOCH + std::time::Duration::from_millis(1_577_966_400_000);
        fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(when)
            .unwrap();
        let (_, document) = Documents::default().open(&path).unwrap();
        assert_eq!(document.modified, Some(1_577_966_400_000));
    }

    #[test]
    fn scopes_a_file_outside_any_repository_to_its_folder() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("loose.md"), "x").unwrap();
        let (_, document) = Documents::default()
            .open(&root.path().join("loose.md"))
            .unwrap();
        // A tempdir can sit inside a repository on a developer's machine, so check both cases.
        let folder = fs::canonicalize(root.path()).unwrap();
        assert!(document.scope == folder || folder.starts_with(&document.scope));
    }

    #[test]
    fn counts_no_repository_at_the_home_directory_or_above_it() {
        // tmp/.git and tmp/home/.git, as dotfiles kept in a repository. tmp/home/code/.git is
        // a project, and tmp/work/.git one outside the home.
        let root = tempfile::tempdir().unwrap();
        let tmp = fs::canonicalize(root.path()).unwrap();
        for dir in [
            ".git",
            "home/.git",
            "home/Downloads",
            "home/code/.git",
            "home/code/docs",
        ] {
            fs::create_dir_all(tmp.join(dir)).unwrap();
        }
        fs::create_dir_all(tmp.join("work/.git")).unwrap();
        fs::create_dir_all(tmp.join("elsewhere")).unwrap();
        let home = tmp.join("home");
        let scope = |folder: &str| repository(&tmp.join(folder), Some(&home));
        assert_eq!(scope("home/Downloads"), None);
        assert_eq!(scope("home"), None);
        assert_eq!(scope("home/code/docs"), Some(tmp.join("home/code")));
        assert_eq!(scope("work"), Some(tmp.join("work")));
        // tmp holds the home, so it is no repository for a file outside the home either.
        assert_eq!(scope("elsewhere"), None);
        // With no home known, the walk takes the first `.git`, as it always did.
        assert_eq!(
            repository(&home.join("Downloads"), None),
            Some(home.clone())
        );
    }

    #[test]
    fn refuses_folders_and_missing_files() {
        let root = tempfile::tempdir().unwrap();
        let documents = Documents::default();
        assert!(matches!(
            documents.open(root.path()),
            Err(OpenError::NotAFile)
        ));
        assert!(matches!(
            documents.open(&root.path().join("gone.md")),
            Err(OpenError::Unreadable(_))
        ));
    }
}

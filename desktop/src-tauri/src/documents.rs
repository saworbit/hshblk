//! Documents the app has opened, each behind an opaque handle.
//!
//! docs/hld.md §4: the webview never receives a path. Rust resolves the path, reads the
//! bytes, records what it learned about them, and gives the page a handle instead.

use std::collections::HashMap;
use std::fmt;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

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
    /// Whether only the files directly in the scope count, not its folders. A loose file's scope
    /// is flat at the home folder or above it, so it cannot show all of the home.
    pub flat: bool,
    /// The file's own name, which is all of its path the page is told.
    pub name: String,
    /// When the file was last modified, as it was read, in milliseconds since 1970.
    pub modified: Option<u64>,
    /// The file's size and time as it was read, to tell when it changes (#199).
    pub stamp: Stamp,
    pub text: String,
    pub facts: Facts,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoding {
    Utf8,
    Utf16Le,
    Utf16Be,
    InvalidUtf8,
    /// Not UTF-8, with no letter past ASCII that is: shown as Windows-1252 (#207).
    Windows1252,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineEndings {
    None,
    Lf,
    Crlf,
    /// A lone CR ends every line, as in an old Mac file.
    Cr,
    Mixed,
}

/// A file's size and when it was last modified, which change when it is saved, read without
/// reading the file (#199).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stamp {
    pub len: u64,
    pub modified: Option<SystemTime>,
}

impl Stamp {
    fn from(metadata: &fs::Metadata) -> Self {
        Self {
            len: metadata.len(),
            modified: metadata.modified().ok(),
        }
    }

    /// The file's stamp now, or none when it is not there.
    pub fn of(path: &Path) -> Option<Self> {
        fs::metadata(path)
            .ok()
            .map(|metadata| Self::from(&metadata))
    }
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
            Self {
                encoding: Encoding::Windows1252,
                ..
            } => Some("Shown as Windows-1252. The file is not UTF-8."),
            Self { nul: true, .. } => Some("The file holds NUL bytes."),
            Self {
                line_endings: LineEndings::Mixed,
                ..
            } => Some("The file mixes line endings."),
            Self {
                line_endings: LineEndings::Cr,
                ..
            } => Some("The file ends its lines with CR alone."),
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
        Err(_) if !has_utf8_letters(bytes) => (Encoding::Windows1252, false, windows_1252(bytes)),
        Err(_) => (
            Encoding::InvalidUtf8,
            false,
            String::from_utf8_lossy(bytes).into_owned(),
        ),
    }
}

/// Whether a valid stretch of the bytes holds a letter past ASCII. UTF-8 with a bad byte in it
/// does, and reading it all as Windows-1252 would garble those letters. Windows-1252 text almost
/// never forms one, so a file with none is read as that, as Notepad saved notes until 2019.
fn has_utf8_letters(bytes: &[u8]) -> bool {
    bytes.utf8_chunks().any(|chunk| !chunk.valid().is_ascii())
}

/// Windows-1252 as the WHATWG encoding standard maps it: Latin-1, but for 0x80 to 0x9F.
fn windows_1252(bytes: &[u8]) -> String {
    const HIGH: [char; 32] = [
        '\u{20AC}', '\u{81}', '\u{201A}', '\u{192}', '\u{201E}', '\u{2026}', '\u{2020}',
        '\u{2021}', '\u{2C6}', '\u{2030}', '\u{160}', '\u{2039}', '\u{152}', '\u{8D}', '\u{17D}',
        '\u{8F}', '\u{90}', '\u{2018}', '\u{2019}', '\u{201C}', '\u{201D}', '\u{2022}', '\u{2013}',
        '\u{2014}', '\u{2DC}', '\u{2122}', '\u{161}', '\u{203A}', '\u{153}', '\u{9D}', '\u{17E}',
        '\u{178}',
    ];
    bytes
        .iter()
        .map(|&byte| match byte {
            0x80..=0x9F => HIGH[usize::from(byte - 0x80)],
            _ => char::from(byte),
        })
        .collect()
}

fn utf16(bytes: &[u8], unit: fn([u8; 2]) -> u16) -> String {
    let units = bytes.chunks_exact(2).map(|pair| unit([pair[0], pair[1]]));
    char::decode_utf16(units)
        .map(|c| c.unwrap_or(char::REPLACEMENT_CHARACTER))
        .collect()
}

/// A lone CR beside another ending counts as mixed: CodeMirror would split on it, and nothing
/// else in the file does. A file that ends every line so is said to, not to mix them (#172).
fn line_endings(text: &str) -> LineEndings {
    let crlf = text.matches("\r\n").count();
    let cr = text.matches('\r').count() - crlf;
    let lf = text.matches('\n').count() - crlf;
    match (lf, crlf, cr) {
        (0, 0, 0) => LineEndings::None,
        (_, 0, 0) => LineEndings::Lf,
        (0, _, 0) => LineEndings::Crlf,
        (0, 0, _) => LineEndings::Cr,
        _ => LineEndings::Mixed,
    }
}

#[derive(Debug)]
pub enum OpenError {
    Unreadable(std::io::Error),
    NotAFile,
    TooLarge,
    NotText,
}

impl OpenError {
    /// What the user is told. It names the file, since one launch may name several (#160).
    pub fn message(&self, name: &str) -> String {
        match self {
            Self::Unreadable(error) if error.kind() == std::io::ErrorKind::NotFound => {
                format!("{name} was not found.")
            }
            Self::Unreadable(error) => format!("{name} could not be read: {}.", reason(error)),
            Self::NotAFile => format!("{name} is not a file."),
            Self::TooLarge => format!("{name} is larger than 64 MB."),
            Self::NotText => format!("{name} is not a text file."),
        }
    }
}

/// The system's words for an error, without Rust's "(os error 5)" or a full stop of their own.
fn reason(error: &std::io::Error) -> String {
    let text = error.to_string();
    let text = match text.rfind(" (os error ") {
        Some(at) if text.ends_with(')') => &text[..at],
        _ => &text,
    };
    let text = text.trim_end_matches('.');
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_lowercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// #206: bytes that are plainly not text. An image the resource channel knows by its bytes, or
/// NUL bytes in what is not UTF-8 or marked UTF-16, as in an archive or a PDF. A text file with
/// an odd extension still opens, and so does UTF-16 with no mark, which passes as UTF-8.
fn is_binary(bytes: &[u8]) -> bool {
    let image = crate::assets::image_type(bytes).is_some_and(|kind| kind != "image/svg+xml");
    let utf16 = bytes.starts_with(b"\xFF\xFE") || bytes.starts_with(b"\xFE\xFF");
    let utf8 = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    image || (bytes.contains(&0) && !utf16 && std::str::from_utf8(utf8).is_err())
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

    /// The handle of the open document at `path`, so a file opened again goes to its window (#174).
    pub fn find(&self, path: &Path) -> Option<String> {
        let path = fs::canonicalize(path).ok()?;
        self.0
            .lock()
            .expect("documents lock")
            .iter()
            .find(|(_, document)| document.path == path)
            .map(|(handle, _)| handle.to_string())
    }

    pub fn get(&self, handle: &str) -> Option<Arc<Document>> {
        self.0
            .lock()
            .expect("documents lock")
            .get(&Handle(handle.to_owned()))
            .cloned()
    }

    /// Reads a document's file again, as it is now, behind the same handle, so its window takes
    /// the new text (#199). None when the document is closed.
    pub fn reload(&self, handle: &str) -> Option<Result<Arc<Document>, OpenError>> {
        let path = self.get(handle)?.path.clone();
        let document = match read(&path) {
            Ok(document) => Arc::new(document),
            Err(error) => return Some(Err(error)),
        };
        let mut documents = self.0.lock().expect("documents lock");
        let slot = documents.get_mut(&Handle(handle.to_owned()))?;
        *slot = Arc::clone(&document);
        Some(Ok(document))
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
    let file = fs::File::open(&path).map_err(OpenError::Unreadable)?;
    let bytes = read_capped(file, MAX_DOCUMENT_BYTES)
        .map_err(OpenError::Unreadable)?
        .ok_or(OpenError::TooLarge)?;
    if is_binary(&bytes) {
        return Err(OpenError::NotText);
    }
    let (facts, text) = Facts::read(&bytes);
    let folder = path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| path.clone());
    let (scope, flat) = scope_of(&folder, home().as_deref());
    Ok(Document {
        stamp: Stamp::from(&metadata),
        scope,
        flat,
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

/// Reads at most `cap` bytes, or none when there are more. The cap is on what is read, not on a
/// size taken before, which a file still being written outgrows (#262).
pub fn read_capped(reader: impl Read, cap: u64) -> io::Result<Option<Vec<u8>>> {
    let mut bytes = Vec::new();
    reader.take(cap + 1).read_to_end(&mut bytes)?;
    Ok((bytes.len() as u64 <= cap).then_some(bytes))
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

/// docs/hld.md §6: a document's scope, and whether it is flat. A loose file's scope is its own
/// folder. When that folder is the home directory or above it, only the files beside the
/// document count, so a file saved straight into `~` cannot show all of the home.
fn scope_of(folder: &Path, home: Option<&Path>) -> (PathBuf, bool) {
    match repository(folder, home) {
        Some(root) => (root, false),
        None => (
            folder.to_path_buf(),
            home.is_some_and(|home| home.starts_with(folder)),
        ),
    }
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
    fn shows_windows_1252_as_it_reads_and_says_so() {
        // #207: an old Windows note showed a replacement character for each accented letter.
        let (facts, text) =
            Facts::read(b"# Caf\xE9 notes: na\xEFve r\xE9sum\xE9, \x93quoted\x94, \x80 5");
        assert_eq!(facts.encoding, Encoding::Windows1252);
        assert_eq!(
            text,
            "# Café notes: naïve résumé, \u{201C}quoted\u{201D}, € 5"
        );
        assert_eq!(
            facts.read_only_reason(),
            Some("Shown as Windows-1252. The file is not UTF-8.")
        );
    }

    #[test]
    fn shows_utf8_with_a_bad_byte_lossily_not_as_windows_1252() {
        // Its letters are UTF-8, so reading it all as Windows-1252 would garble them.
        let mut bytes = "café \u{2014} ".as_bytes().to_vec();
        bytes.push(0xFF);
        let (facts, text) = Facts::read(&bytes);
        assert_eq!(
            (facts.encoding, text.as_str()),
            (Encoding::InvalidUtf8, "café \u{2014} \u{FFFD}")
        );
        assert_eq!(
            facts.read_only_reason(),
            Some("The file is not valid UTF-8.")
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
        assert_eq!(endings(b"a\rb\r\n"), LineEndings::Mixed);
    }

    #[test]
    fn says_a_file_ends_its_lines_with_cr_alone_not_that_it_mixes_them() {
        // #172: an old Mac file. It stays read-only, since CodeMirror would join it with LF.
        let (facts, _) = Facts::read(b"# a\rb\r");
        assert_eq!(facts.line_endings, LineEndings::Cr);
        assert_eq!(
            facts.read_only_reason(),
            Some("The file ends its lines with CR alone.")
        );
    }

    #[test]
    fn names_the_file_in_each_refusal_without_the_os_error_code() {
        // #160: one launch may name several files, so each message says which.
        let missing = std::io::Error::from(std::io::ErrorKind::NotFound);
        assert_eq!(
            OpenError::Unreadable(missing).message("gone.md"),
            "gone.md was not found."
        );
        let denied = std::io::Error::from_raw_os_error(if cfg!(windows) { 5 } else { 13 });
        let message = OpenError::Unreadable(denied).message("locked.md");
        assert!(
            message.starts_with("locked.md could not be read: "),
            "{message}"
        );
        assert!(
            !message.contains("os error") && !message.ends_with(".."),
            "{message}"
        );
        assert_eq!(OpenError::NotAFile.message("docs"), "docs is not a file.");
        assert_eq!(
            OpenError::TooLarge.message("huge.md"),
            "huge.md is larger than 64 MB."
        );
        assert_eq!(
            OpenError::NotText.message("icon.png"),
            "icon.png is not a text file."
        );
    }

    #[test]
    fn refuses_bytes_that_are_plainly_not_text() {
        // #206: an image, an archive, or a PDF opened a page of replacement characters.
        assert!(is_binary(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR"));
        assert!(is_binary(b"GIF89a"));
        assert!(is_binary(b"PK\x03\x04\x14\0\0\0\x08\0\xb7\xac"));
        assert!(is_binary(b"%PDF-1.7\n\xe2\xe3\xcf\xd3\n1 0 obj\0"));
        // Text in any encoding the page shows still opens: SVG, Windows-1252, and UTF-16.
        assert!(!is_binary(b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>"));
        assert!(!is_binary(b"caf\xe9 au lait"));
        assert!(!is_binary(b"\xFF\xFE#\0 \0a\0"));
        assert!(!is_binary(b"#\0 \0a\0"));
        assert!(!is_binary(b"\xEF\xBB\xBF# a\n"));
        assert!(!is_binary(b""));

        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("icon.md"), b"\x89PNG\r\n\x1a\n\0\0").unwrap();
        assert!(matches!(
            Documents::default().open(&root.path().join("icon.md")),
            Err(OpenError::NotText)
        ));
    }

    #[test]
    fn reads_a_file_again_behind_the_same_handle() {
        // #199: a window kept the text its file had when it opened.
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("notes.md");
        fs::write(&file, "# Old\n").unwrap();
        let documents = Documents::default();
        let (handle, old) = documents.open(&file).unwrap();
        assert_eq!(Stamp::of(&file), Some(old.stamp));
        fs::write(&file, "# New, and longer\n").unwrap();
        let new = documents.reload(&handle.to_string()).unwrap().unwrap();
        assert_eq!(new.text, "# New, and longer\n");
        assert_ne!(new.stamp, old.stamp);
        assert_eq!(documents.get(&handle.to_string()).unwrap().text, new.text);
        // A file that no longer opens leaves the old text where it was.
        fs::remove_file(&file).unwrap();
        assert!(matches!(
            documents.reload(&handle.to_string()),
            Some(Err(OpenError::Unreadable(_)))
        ));
        assert_eq!(documents.get(&handle.to_string()).unwrap().text, new.text);
        // A closed document is read no more.
        documents.close(&handle.to_string());
        assert!(documents.reload(&handle.to_string()).is_none());
        assert_eq!(Stamp::of(&file), None);
    }

    #[test]
    fn finds_an_open_document_by_its_path_however_it_is_written() {
        // #174: a file opened again goes to the window it has.
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("docs")).unwrap();
        fs::write(root.path().join("docs/notes.md"), "# Notes\n").unwrap();
        fs::write(root.path().join("other.md"), "x").unwrap();
        let documents = Documents::default();
        let (handle, _) = documents.open(&root.path().join("docs/notes.md")).unwrap();
        let again = root.path().join("docs/../docs/notes.md");
        assert_eq!(documents.find(&again), Some(handle.to_string()));
        assert_eq!(documents.find(&root.path().join("other.md")), None);
        assert_eq!(documents.find(&root.path().join("gone.md")), None);
        documents.close(&handle.to_string());
        assert_eq!(documents.find(&again), None);
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
    fn flattens_a_loose_files_scope_at_the_home_directory_or_above_it() {
        // A file saved straight into the home, or above it, shows only what is beside it.
        let root = tempfile::tempdir().unwrap();
        let tmp = fs::canonicalize(root.path()).unwrap();
        fs::create_dir_all(tmp.join("home/Downloads")).unwrap();
        fs::create_dir_all(tmp.join("home/code/.git")).unwrap();
        let home = tmp.join("home");
        let scope = |folder: &Path| scope_of(folder, Some(&home));
        assert_eq!(scope(&home), (home.clone(), true));
        assert_eq!(scope(&tmp), (tmp.clone(), true));
        let downloads = home.join("Downloads");
        assert_eq!(scope(&downloads), (downloads.clone(), false));
        assert_eq!(scope(&home.join("code")), (home.join("code"), false));
    }

    #[test]
    fn reads_no_more_than_its_cap_whatever_the_size_was_before() {
        // #262: a file still being written passed the check at its old size and was read whole.
        let growing = std::io::Read::chain(&b"0123456789"[..], std::io::repeat(b'x'));
        assert!(read_capped(growing, 64).unwrap().is_none());
        assert_eq!(
            read_capped(&b"0123456789"[..], 10).unwrap().as_deref(),
            Some(&b"0123456789"[..])
        );
        assert!(read_capped(&b"0123456789"[..], 9).unwrap().is_none());
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

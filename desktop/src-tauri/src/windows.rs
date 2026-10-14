//! One window per document. Files arrive four ways, docs/hld.md §6: the command line, a
//! double-click, the open dialog, and a drop. Each becomes a handle here, in Rust.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use tauri::{
    AppHandle, DragDropEvent, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    Window, WindowEvent,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::documents::Documents;
use crate::MenuChannels;

/// What the open dialog offers. A dropped or double-clicked file of any kind is still tried, but
/// one whose bytes are plainly not text is refused (#206).
pub const EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "txt"];

const EMPTY: &str = "empty-";
const DOCUMENT: &str = "doc-";

/// The handle a document window shows. The page reads it from its own label.
pub fn handle_of(label: &str) -> Option<&str> {
    label.strip_prefix(DOCUMENT)
}

/// The folder of the document a window shows, where its Open dialog starts, so the file beside
/// the one being read is a click away (#168). The path stays in Rust.
pub fn folder_of(documents: &Documents, label: &str) -> Option<PathBuf> {
    let document = documents.get(handle_of(label)?)?;
    document.path.parent().map(Path::to_path_buf)
}

/// Where a command line came from: the app's own launch, or a second one that handed it over.
#[derive(Clone, Copy, PartialEq)]
pub enum Launch {
    First,
    Again,
}

/// Opens each file named on a command line, and an empty window when the launch shows nothing.
/// What did not open is said after every window the launch opens, so none covers it (#160).
pub fn open_arguments(app: &AppHandle, argv: &[String], cwd: &Path, launch: Launch) {
    let files = files_in(argv, cwd);
    let refused: Vec<String> = files
        .iter()
        .filter_map(|file| show(app, file).err())
        .collect();
    if wants_empty(launch, files.len(), app.webview_windows().len()) {
        empty(app);
    }
    if !refused.is_empty() {
        refuse(app, &refused.join("\n"));
    }
}

/// Whether a launch needs the empty window. The app quits when its last window closes, so with
/// none open it would run on unseen. A second launch with no file asks for a window. The first
/// may have one open already: on macOS the file that starts the app comes as an open-file event,
/// which AppKit sends before Tauri runs setup (#186).
fn wants_empty(launch: Launch, files: usize, windows: usize) -> bool {
    windows == 0 || (files == 0 && launch == Launch::Again)
}

fn files_in(argv: &[String], cwd: &Path) -> Vec<PathBuf> {
    // The first argument is the program. The app takes no flags, but macOS may add -psn_ to a
    // launch from the Finder, so that one is passed over. After a `--`, every argument is a file.
    let args = argv.get(1..).unwrap_or_default();
    let (before, after) = match args.iter().position(|arg| arg == "--") {
        Some(end) => (&args[..end], &args[end + 1..]),
        None => (args, &[][..]),
    };
    before
        .iter()
        .filter(|arg| !arg.starts_with("-psn_"))
        .chain(after)
        .map(|arg| cwd.join(arg))
        .collect()
}

/// Opens a file in a new window, or says why it cannot.
pub fn open(app: &AppHandle, path: &Path) {
    if let Err(message) = show(app, path) {
        refuse(app, &message);
    }
}

/// Shows a file: in the window it has, if it is open, or else in a new one. An empty window, if
/// there is one, gives way to it.
fn show(app: &AppHandle, path: &Path) -> Result<(), String> {
    let documents = app.state::<Documents>();
    // #174: a second window on one file is two copies of the page, easy to mix up.
    let open = documents
        .find(path)
        .and_then(|handle| app.get_webview_window(&format!("{DOCUMENT}{handle}")));
    if let Some(window) = open {
        let _ = window.unminimize();
        if let Err(error) = window.set_focus() {
            eprintln!("A window could not take the focus: {error}");
        }
        return Ok(());
    }
    let (handle, document) = documents.open(path).map_err(|error| {
        let name = path.file_name().unwrap_or(path.as_os_str());
        error.message(&name.to_string_lossy())
    })?;
    let waiting = app
        .webview_windows()
        .into_values()
        .find(|window| window.label().starts_with(EMPTY));
    // A file that replaces the welcome window takes its place.
    let place = match &waiting {
        Some(window) if cfg!(target_os = "macos") => place_of(window),
        _ => next_place(app),
    };
    build(app, &format!("{DOCUMENT}{handle}"), &document.name, place);
    if let Some(window) = waiting {
        let _ = window.close();
    }
    Ok(())
}

fn empty(app: &AppHandle) {
    static COUNT: AtomicU32 = AtomicU32::new(0);
    build(
        app,
        &format!("{EMPTY}{}", COUNT.fetch_add(1, Ordering::Relaxed)),
        "Hash Block",
        next_place(app),
    );
}

/// A window's size, in points.
const SIZE: (f64, f64) = (880.0, 760.0);

/// How far each new window steps down and right of the one before, in points.
const CASCADE: f64 = 24.0;

/// The label of the window opened last, which a new one cascades from when none is in front.
static LAST: Mutex<Option<String>> = Mutex::new(None);

/// A window's top left corner, in points.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Place {
    x: f64,
    y: f64,
}

/// A screen's work area, the part the menu bar and the Dock leave, in points.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Area {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// One step down and right of `from`, or the work area's top left when a window would not fit.
fn cascade(from: Place, area: Area) -> Place {
    let next = Place {
        x: from.x + CASCADE,
        y: from.y + CASCADE,
    };
    if next.x + SIZE.0 <= area.x + area.width && next.y + SIZE.1 <= area.y + area.height {
        next
    } else {
        Place {
            x: area.x + CASCADE,
            y: area.y + CASCADE,
        }
    }
}

/// Where a new window goes. On macOS, AppKit cascades a document window from the one in front,
/// but not a window made in code, so every window opened on top of the last (#181). Windows and
/// Linux's window managers place a new window themselves.
fn next_place(app: &AppHandle) -> Option<Place> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let windows = app.webview_windows();
    let from = windows
        .values()
        .find(|window| window.is_focused().unwrap_or(false))
        .or_else(|| {
            let last = LAST.lock().expect("last window lock");
            last.as_ref().and_then(|label| windows.get(label))
        })?;
    let monitor = from.current_monitor().ok()??;
    let scale = monitor.scale_factor();
    let origin = monitor.work_area().position.to_logical::<f64>(scale);
    let size = monitor.work_area().size.to_logical::<f64>(scale);
    let area = Area {
        x: origin.x,
        y: origin.y,
        width: size.width,
        height: size.height,
    };
    Some(cascade(place_of(from)?, area))
}

fn place_of(window: &WebviewWindow) -> Option<Place> {
    let scale = window.scale_factor().ok()?;
    let at = window.outer_position().ok()?.to_logical::<f64>(scale);
    Some(Place { x: at.x, y: at.y })
}

fn build(app: &AppHandle, label: &str, title: &str, place: Option<Place>) {
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(SIZE.0, SIZE.1)
        .min_inner_size(420.0, 320.0)
        // A link in a document never takes the window anywhere. open_url sends it to the browser.
        .on_navigation(is_the_app);
    if let Some(place) = place {
        builder = builder.position(place.x, place.y);
    }
    match builder.build() {
        // Shown is not in front. On Windows a file handed over by a second launch opened behind
        // File Explorer. The single-instance plugin passes its right to the foreground for this.
        Ok(window) => {
            *LAST.lock().expect("last window lock") = Some(label.to_owned());
            if let Err(error) = window.set_focus() {
                eprintln!("A window could not take the focus: {error}");
            }
        }
        Err(error) => refuse(app, &format!("A window could not open: {error}.")),
    }
}

fn is_the_app(url: &Url) -> bool {
    url.as_str() == "about:srcdoc"
        || url.scheme() == "tauri"
        || url.host_str() == Some("tauri.localhost")
        || (cfg!(debug_assertions) && url.host_str() == Some("localhost"))
}

/// Drops open their files, and a closed window lets its document go.
pub fn on_event(window: &Window, event: &WindowEvent) {
    match event {
        WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => {
            for path in paths {
                open(window.app_handle(), path);
            }
        }
        WindowEvent::Destroyed => {
            if let Some(handle) = handle_of(window.label()) {
                window.state::<Documents>().close(handle);
            }
            window.state::<MenuChannels>().forget(window.label());
        }
        _ => {}
    }
}

/// Says what did not open, over the window opened last, so it shows in front of it (#160).
fn refuse(app: &AppHandle, message: &str) {
    let mut dialog = app
        .dialog()
        .message(message)
        .title("Hash Block")
        .kind(MessageDialogKind::Error);
    let last = LAST.lock().expect("last window lock").clone();
    if let Some(window) = last.and_then(|label| app.get_webview_window(&label)) {
        dialog = dialog.parent(&window);
    }
    dialog.show(|_| {});
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_files_from_the_command_line_but_not_the_program_or_flags() {
        let argv = ["hshblk", "-psn_0_12345", "notes.md", "/abs/other.md"].map(String::from);
        assert_eq!(
            files_in(&argv, Path::new("/work")),
            [
                PathBuf::from("/work/notes.md"),
                PathBuf::from("/abs/other.md")
            ]
        );
    }

    #[test]
    fn takes_a_file_whose_name_starts_with_a_dash() {
        let argv = ["hshblk", "-notes.md", "--", "-psn_1.md", "--"].map(String::from);
        assert_eq!(
            files_in(&argv, Path::new("/work")),
            [
                PathBuf::from("/work/-notes.md"),
                PathBuf::from("/work/-psn_1.md"),
                PathBuf::from("/work/--")
            ]
        );
        assert!(files_in(&["hshblk".into(), "--".into()], Path::new("/work")).is_empty());
        assert!(files_in(&[], Path::new("/work")).is_empty());
    }

    #[test]
    fn cascades_a_new_window_down_and_right_until_it_would_leave_the_work_area() {
        // A 1920 by 1080 screen with the menu bar and the Dock taken off.
        let area = Area {
            x: 0.0,
            y: 25.0,
            width: 1920.0,
            height: 980.0,
        };
        let next = cascade(Place { x: 520.0, y: 80.0 }, area);
        assert_eq!(
            next,
            Place {
                x: 520.0 + CASCADE,
                y: 80.0 + CASCADE
            }
        );
        // Its foot would pass the Dock, so it starts again at the top left of the area.
        let low = Place {
            x: 520.0,
            y: 1005.0 - SIZE.1 - CASCADE + 1.0,
        };
        assert_eq!(
            cascade(low, area),
            Place {
                x: CASCADE,
                y: 25.0 + CASCADE
            }
        );
        // And when its right edge would pass the screen's.
        let right = Place {
            x: 1920.0 - SIZE.0 - CASCADE + 1.0,
            y: 80.0,
        };
        assert_eq!(
            cascade(right, area),
            Place {
                x: CASCADE,
                y: 25.0 + CASCADE
            }
        );
        // On a second screen to the left, the area starts below zero.
        let left = Area {
            x: -1440.0,
            y: 0.0,
            width: 1440.0,
            height: 900.0,
        };
        assert_eq!(
            cascade(
                Place {
                    x: -1400.0,
                    y: 10.0
                },
                left
            ),
            Place {
                x: -1376.0,
                y: 34.0
            }
        );
    }

    #[test]
    fn opens_an_empty_window_only_when_a_launch_shows_nothing() {
        // With no window open the app would run on unseen, whichever launch it is.
        assert!(wants_empty(Launch::First, 0, 0));
        assert!(wants_empty(Launch::Again, 2, 0));
        // A second launch with no file asks for a window.
        assert!(wants_empty(Launch::Again, 0, 3));
        assert!(!wants_empty(Launch::Again, 1, 3));
        // #186: on macOS the file that started the app is open before setup reads argv.
        assert!(!wants_empty(Launch::First, 0, 1));
        assert!(!wants_empty(Launch::First, 1, 1));
    }

    #[test]
    fn starts_the_open_dialog_in_the_folder_of_the_windows_document() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("docs")).unwrap();
        std::fs::write(root.path().join("docs/notes.md"), "x").unwrap();
        let documents = Documents::default();
        let (handle, _) = documents.open(&root.path().join("docs/notes.md")).unwrap();
        assert_eq!(
            folder_of(&documents, &format!("{DOCUMENT}{handle}")),
            Some(std::fs::canonicalize(root.path().join("docs")).unwrap())
        );
        // The welcome window shows no document, so the dialog starts where the system says.
        assert_eq!(folder_of(&documents, "empty-0"), None);
    }

    #[test]
    fn reads_a_handle_only_from_a_document_window() {
        assert_eq!(handle_of("doc-0a1b"), Some("0a1b"));
        assert_eq!(handle_of("empty-0"), None);
    }

    #[test]
    fn navigates_only_within_the_app_and_its_html_frames() {
        let url = |text: &str| Url::parse(text).unwrap();
        assert!(is_the_app(&url("tauri://localhost/index.html")));
        assert!(is_the_app(&url("http://tauri.localhost/index.html")));
        assert!(is_the_app(&url("about:srcdoc")));
        assert!(!is_the_app(&url("about:blank")));
        assert!(!is_the_app(&url("https://example.com/")));
        assert!(!is_the_app(&url("file:///etc/hostname")));
    }
}

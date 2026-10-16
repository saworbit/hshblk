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
use crate::memory::{Geometry, Memory};
use crate::watch::Watchers;
use crate::{Fragments, MenuChannels, RecentMenu};

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
    let refused = show_all(app, &files);
    if wants_empty(launch, files.len(), app.webview_windows().len()) {
        empty(app);
    }
    if !refused.is_empty() {
        refuse(app, &refused.join("\n"));
    }
}

/// Opens each file, as the Open dialog's several do, and says once what did not open.
pub fn open_all(app: &AppHandle, files: &[PathBuf]) {
    let refused = show_all(app, files);
    if !refused.is_empty() {
        refuse(app, &refused.join("\n"));
    }
}

/// Shows each file, and says why each that did not open did not.
fn show_all(app: &AppHandle, files: &[PathBuf]) -> Vec<String> {
    files
        .iter()
        .filter_map(|file| show(app, file, None).err())
        .collect()
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

/// Shows a file: in the window it has, if it is open, or else in a new one. An empty window, if
/// there is one, gives way to it. A link's fragment sends the page to the place it names (#285).
pub fn show(app: &AppHandle, path: &Path, fragment: Option<String>) -> Result<(), String> {
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
        if let Some(document) = handle_of(window.label()).and_then(|handle| documents.get(handle)) {
            opened(app, &document.path);
        }
        if let Some(fragment) = fragment {
            app.state::<Fragments>().send(window.label(), fragment);
        }
        return Ok(());
    }
    let (handle, document) = documents.open(path).map_err(|error| {
        let name = path.file_name().unwrap_or(path.as_os_str());
        error.message(&name.to_string_lossy())
    })?;
    opened(app, &document.path);
    let waiting = app
        .webview_windows()
        .into_values()
        .find(|window| window.label().starts_with(EMPTY));
    // A file that replaces the welcome window takes its place.
    let size = size_of_next(app);
    let place = match &waiting {
        Some(window) if !cfg!(target_os = "linux") => place_of(window),
        _ => next_place(app, size),
    };
    let label = format!("{DOCUMENT}{handle}");
    build(app, &label, &document.name, size, place);
    // The page takes it once it watches for one, whether that is before this or after.
    if let (Some(fragment), Some(_)) = (fragment, app.get_webview_window(&label)) {
        app.state::<Fragments>().send(&label, fragment);
    }
    retitle(app);
    if let Some(window) = waiting {
        let _ = window.close();
    }
    Ok(())
}

/// Puts a file at the top of the recent files, which the welcome window lists (#242), and macOS's
/// File > Open Recent, and on Windows the shell's, which the app's jump list shows (#288).
fn opened(app: &AppHandle, path: &Path) {
    if let Some(memory) = app.try_state::<Memory>() {
        memory.opened(path);
    }
    RecentMenu::refresh(app);
    #[cfg(windows)]
    note_in_shell(path);
}

/// #288: a file opened goes into the shell's recent documents, which the app's jump list shows,
/// since the installer registers the app for `.md`. A debug build leaves the shell's list be, as
/// it keeps a data folder of its own (#287), so a test's files stay out of it.
#[cfg(windows)]
fn note_in_shell(path: &Path) {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::{SHAddToRecentDocs, SHARD_PATHW};
    if cfg!(debug_assertions) {
        return;
    }
    let wide: Vec<u16> = shell_path(path)
        .as_os_str()
        .encode_wide()
        .chain([0])
        .collect();
    // SAFETY: SHARD_PATHW takes a null-terminated UTF-16 path, which `wide` is, and the shell
    // reads it before it returns.
    unsafe { SHAddToRecentDocs(SHARD_PATHW as u32, wide.as_ptr().cast()) };
}

/// A path as the shell takes one: without the `\\?\` a canonical path on Windows starts with.
#[cfg(any(windows, test))]
fn shell_path(path: &Path) -> PathBuf {
    let Some(text) = path.to_str() else {
        return path.to_path_buf();
    };
    if let Some(shared) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{shared}"));
    }
    PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(text))
}

fn empty(app: &AppHandle) {
    static COUNT: AtomicU32 = AtomicU32::new(0);
    let size = size_of_next(app);
    build(
        app,
        &format!("{EMPTY}{}", COUNT.fetch_add(1, Ordering::Relaxed)),
        "Hash Block",
        size,
        next_place(app, size),
    );
}

/// A window's size, in points, until the reader resizes one.
const SIZE: (f64, f64) = (880.0, 760.0);

/// The smallest a window may be, in points.
const MIN: (f64, f64) = (420.0, 320.0);

/// A new window's size: the one the reader last moved or resized, as far as the main screen
/// holds it, or the app's own (#240).
fn size_of_next(app: &AppHandle) -> (f64, f64) {
    let Some(kept) = app.try_state::<Memory>().and_then(|memory| memory.window()) else {
        return SIZE;
    };
    let most = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| area_of(&monitor))
        .map_or((f64::INFINITY, f64::INFINITY), |area| {
            (area.width, area.height)
        });
    (
        kept.width.clamp(MIN.0, most.0.max(MIN.0)),
        kept.height.clamp(MIN.1, most.1.max(MIN.1)),
    )
}

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

/// Whether a window of `size` at `place` fits in `area`.
fn fits(place: Place, size: (f64, f64), area: Area) -> bool {
    place.x >= area.x
        && place.y >= area.y
        && place.x + size.0 <= area.x + area.width
        && place.y + size.1 <= area.y + area.height
}

/// One step down and right of `from`, or the work area's top left when a window would not fit.
fn cascade(from: Place, area: Area, size: (f64, f64)) -> Place {
    let next = Place {
        x: from.x + CASCADE,
        y: from.y + CASCADE,
    };
    if fits(next, size, area) {
        next
    } else {
        Place {
            x: area.x + CASCADE,
            y: area.y + CASCADE,
        }
    }
}

/// Where a new window of `size` goes. On macOS, AppKit cascades a document window from the one in
/// front, but not a window made in code, so every window opened on top of the last (#181).
/// Windows puts each new one on its main screen, wherever the reader works. So on both, a new
/// window steps down and right of the one in front, or of the last one opened, on its screen,
/// and the first of a launch goes where the reader left the last (#240). Linux's window managers
/// place a new window themselves, and Wayland lets no app place one.
fn next_place(app: &AppHandle, size: (f64, f64)) -> Option<Place> {
    if cfg!(target_os = "linux") {
        return None;
    }
    let windows = app.webview_windows();
    let from = windows
        .values()
        .find(|window| window.is_focused().unwrap_or(false))
        .or_else(|| {
            let last = LAST.lock().expect("last window lock");
            last.as_ref().and_then(|label| windows.get(label))
        });
    let Some(from) = from else {
        return kept_place(app, size);
    };
    let area = area_of(&from.current_monitor().ok()??);
    Some(cascade(place_of(from)?, area, size))
}

/// Where the reader left the last window, when it fits on a screen that is there now.
fn kept_place(app: &AppHandle, size: (f64, f64)) -> Option<Place> {
    let kept = app.try_state::<Memory>()?.window()?;
    let place = Place {
        x: kept.x,
        y: kept.y,
    };
    let monitors = app.available_monitors().ok()?;
    monitors
        .iter()
        .any(|monitor| fits(place, size, area_of(monitor)))
        .then_some(place)
}

/// A screen's work area, in points.
fn area_of(monitor: &tauri::Monitor) -> Area {
    let scale = monitor.scale_factor();
    let origin = monitor.work_area().position.to_logical::<f64>(scale);
    let size = monitor.work_area().size.to_logical::<f64>(scale);
    Area {
        x: origin.x,
        y: origin.y,
        width: size.width,
        height: size.height,
    }
}

/// A window's size and place, as the reader left it, or none while it is minimized, maximized,
/// or full screen, which a new window does not take.
fn geometry_of(window: &Window) -> Option<Geometry> {
    let set_aside = window.is_minimized().unwrap_or(true)
        || window.is_maximized().unwrap_or(true)
        || window.is_fullscreen().unwrap_or(true);
    if set_aside {
        return None;
    }
    let scale = window.scale_factor().ok()?;
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    let at = window.outer_position().ok()?.to_logical::<f64>(scale);
    (size.width >= MIN.0 && size.height >= MIN.1).then_some(Geometry {
        width: size.width,
        height: size.height,
        x: at.x,
        y: at.y,
    })
}

fn place_of(window: &WebviewWindow) -> Option<Place> {
    let scale = window.scale_factor().ok()?;
    let at = window.outer_position().ok()?.to_logical::<f64>(scale);
    Some(Place { x: at.x, y: at.y })
}

fn build(app: &AppHandle, label: &str, title: &str, size: (f64, f64), place: Option<Place>) {
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(size.0, size.1)
        .min_inner_size(MIN.0, MIN.1)
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

/// A document window's title: its file's name, and, when another window shows a file of the same
/// name, as many of its folders as tell them apart, so the taskbar can (#167). Rust holds the
/// paths, so the page still never sees one.
pub fn titles(files: &[(String, PathBuf)]) -> Vec<String> {
    let folders = |path: &Path| -> Vec<String> {
        let parent = path.parent().unwrap_or(path);
        let parts = parent
            .components()
            .map(|part| part.as_os_str().to_string_lossy().into_owned());
        parts.collect::<Vec<_>>().into_iter().rev().collect()
    };
    files
        .iter()
        .map(|(name, path)| {
            let others: Vec<Vec<String>> = files
                .iter()
                .filter(|(other, at)| other == name && at != path)
                .map(|(_, at)| folders(at))
                .collect();
            if others.is_empty() {
                return name.clone();
            }
            let mine = folders(path);
            let depth = (1..=mine.len())
                .find(|&depth| {
                    others
                        .iter()
                        .all(|other| other.get(..depth) != mine.get(..depth))
                })
                .unwrap_or(mine.len());
            let shown: Vec<&str> = mine[..depth].iter().rev().map(String::as_str).collect();
            format!("{name} · {}", shown.join(std::path::MAIN_SEPARATOR_STR))
        })
        .collect()
}

/// Gives each document window its title again, after one opens or closes.
fn retitle(app: &AppHandle) {
    let documents = app.state::<Documents>();
    let shown: Vec<(WebviewWindow, String, PathBuf)> = app
        .webview_windows()
        .into_values()
        .filter_map(|window| {
            let document = documents.get(handle_of(window.label())?)?;
            Some((window, document.name.clone(), document.path.clone()))
        })
        .collect();
    let files: Vec<(String, PathBuf)> = shown
        .iter()
        .map(|(_, name, path)| (name.clone(), path.clone()))
        .collect();
    for ((window, _, _), title) in shown.iter().zip(titles(&files)) {
        if let Err(error) = window.set_title(&title) {
            eprintln!("A window's title could not change: {error}");
        }
    }
}

fn is_the_app(url: &Url) -> bool {
    url.as_str() == "about:srcdoc"
        || url.scheme() == "tauri"
        || url.host_str() == Some("tauri.localhost")
        || (cfg!(debug_assertions) && url.host_str() == Some("localhost"))
}

/// Drops open their files, a window moved or resized is kept for the next, and a closed window
/// lets its document go and writes what the app keeps.
pub fn on_event(window: &Window, event: &WindowEvent) {
    let paths = dropped(event);
    if !paths.is_empty() {
        open_all(window.app_handle(), paths);
    }
    if matches!(event, WindowEvent::Resized(_) | WindowEvent::Moved(_)) {
        if let (Some(memory), Some(geometry)) = (window.try_state::<Memory>(), geometry_of(window))
        {
            memory.moved(geometry);
        }
    }
    if let WindowEvent::Destroyed = event {
        if let Some(handle) = handle_of(window.label()) {
            window.state::<Documents>().close(handle);
            retitle(window.app_handle());
        }
        window.state::<MenuChannels>().forget(window.label());
        window.state::<Fragments>().forget(window.label());
        window.state::<Watchers>().forget(window.label());
        if let Some(memory) = window.try_state::<Memory>() {
            memory.save();
        }
    }
}

/// The files a drop names, together, so one message says which did not open (#260).
fn dropped(event: &WindowEvent) -> &[PathBuf] {
    match event {
        WindowEvent::DragDrop(DragDropEvent::Drop { paths, .. }) => paths,
        _ => &[],
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
    fn hands_the_shell_a_path_without_the_long_path_prefix() {
        // #288: the shell's recent documents take no `\\?\` path, which canonical ones carry.
        let shell = |path: &str| shell_path(Path::new(path));
        assert_eq!(shell(r"\\?\C:\notes\a.md"), PathBuf::from(r"C:\notes\a.md"));
        assert_eq!(
            shell(r"\\?\UNC\server\share\a.md"),
            PathBuf::from(r"\\server\share\a.md")
        );
        assert_eq!(shell(r"C:\notes\a.md"), PathBuf::from(r"C:\notes\a.md"));
    }

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
        let next = cascade(Place { x: 520.0, y: 80.0 }, area, SIZE);
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
            cascade(low, area, SIZE),
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
            cascade(right, area, SIZE),
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
                left,
                SIZE
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
    fn names_the_folder_when_two_windows_show_files_of_one_name() {
        // #167: three windows of README.md showed three README.md on the taskbar.
        let sep = std::path::MAIN_SEPARATOR_STR;
        let file = |name: &str, path: &str| (name.to_owned(), PathBuf::from(path));
        assert_eq!(
            titles(&[
                file("README.md", "/a/hshblk/README.md"),
                file("README.md", "/b/other/README.md"),
                file("notes.md", "/a/hshblk/notes.md"),
            ]),
            ["README.md · hshblk", "README.md · other", "notes.md"]
        );
        // As many folders as tell them apart.
        assert_eq!(
            titles(&[
                file("README.md", "/x/one/docs/README.md"),
                file("README.md", "/x/two/docs/README.md"),
            ]),
            [
                format!("README.md · one{sep}docs"),
                format!("README.md · two{sep}docs")
            ]
        );
    }

    #[test]
    fn takes_every_file_a_drop_names_at_once() {
        // #260: each file of a drop was opened alone, with a message of its own for each refusal.
        let paths = vec![PathBuf::from("/a/one.md"), PathBuf::from("/a/two.png")];
        let drop = WindowEvent::DragDrop(DragDropEvent::Drop {
            paths: paths.clone(),
            position: tauri::PhysicalPosition::new(0.0, 0.0),
        });
        assert_eq!(dropped(&drop), paths);
        assert!(dropped(&WindowEvent::Focused(true)).is_empty());
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

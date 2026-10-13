//! One window per document. Files arrive four ways, docs/hld.md §6: the command line, a
//! double-click, the open dialog, and a drop. Each becomes a handle here, in Rust.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use tauri::{
    AppHandle, DragDropEvent, Manager, Url, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::documents::Documents;

/// What the open dialog offers. A dropped or double-clicked file of any kind is still tried.
pub const EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "txt"];

const EMPTY: &str = "empty-";
const DOCUMENT: &str = "doc-";

/// The handle a document window shows. The page reads it from its own label.
pub fn handle_of(label: &str) -> Option<&str> {
    label.strip_prefix(DOCUMENT)
}

/// Opens each file named on a command line, or an empty window when none opens.
pub fn open_arguments(app: &AppHandle, argv: &[String], cwd: &Path) {
    let files = files_in(argv, cwd);
    for file in &files {
        open(app, file);
    }
    // The app quits when its last window closes, so with none open it would run on unseen.
    if files.is_empty() || app.webview_windows().is_empty() {
        empty(app);
    }
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

/// Opens a file in a new window. An empty window, if there is one, gives way to it.
pub fn open(app: &AppHandle, path: &Path) {
    let (handle, document) = match app.state::<Documents>().open(path) {
        Ok(opened) => opened,
        Err(error) => return refuse(app, &error.to_string()),
    };
    let waiting = app
        .webview_windows()
        .into_values()
        .find(|window| window.label().starts_with(EMPTY));
    build(app, &format!("{DOCUMENT}{handle}"), &document.name);
    if let Some(window) = waiting {
        let _ = window.close();
    }
}

fn empty(app: &AppHandle) {
    static COUNT: AtomicU32 = AtomicU32::new(0);
    build(
        app,
        &format!("{EMPTY}{}", COUNT.fetch_add(1, Ordering::Relaxed)),
        "Hash Block",
    );
}

fn build(app: &AppHandle, label: &str, title: &str) {
    let built = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(880.0, 760.0)
        .min_inner_size(420.0, 320.0)
        // A link in a document never takes the window anywhere. open_url sends it to the browser.
        .on_navigation(is_the_app)
        .build();
    match built {
        // Shown is not in front. On Windows a file handed over by a second launch opened behind
        // File Explorer. The single-instance plugin passes its right to the foreground for this.
        Ok(window) => {
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
        }
        _ => {}
    }
}

fn refuse(app: &AppHandle, message: &str) {
    app.dialog()
        .message(message)
        .title("Hash Block")
        .kind(MessageDialogKind::Error)
        .show(|_| {});
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

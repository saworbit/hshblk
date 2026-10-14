//! Hash Block: a page for a markdown file. docs/hld.md, milestone one.

mod assets;
mod documents;
mod windows;

use std::path::Path;

use serde::Serialize;
use tauri::ipc::Response;
use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, RunEvent, State, WebviewWindow, Wry};
use tauri_plugin_dialog::DialogExt;

use std::sync::Arc;

use documents::{Document, Documents};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Opened {
    name: String,
    /// When the file was last modified, in milliseconds since 1970. A time, not a path.
    modified: Option<u64>,
    read_only_reason: Option<&'static str>,
}

/// The window's own document. A window can read no other.
fn own_document(window: &WebviewWindow, documents: &Documents) -> Result<Arc<Document>, String> {
    let handle = windows::handle_of(window.label()).ok_or("This window shows no document.")?;
    Ok(documents.get(handle).ok_or("That document is closed.")?)
}

/// What the window's document is called, when it was last modified, and why it is read only.
#[tauri::command]
fn open_document(window: WebviewWindow, documents: State<'_, Documents>) -> Result<Opened, String> {
    let document = own_document(&window, &documents)?;
    Ok(Opened {
        name: document.name.clone(),
        modified: document.modified,
        read_only_reason: document.facts.read_only_reason(),
    })
}

/// The window's document as UTF-8 bytes. A long text crosses faster as bytes than as JSON.
#[tauri::command]
fn document_text(
    window: WebviewWindow,
    documents: State<'_, Documents>,
) -> Result<Response, String> {
    let document = own_document(&window, &documents)?;
    Ok(Response::new(document.text.as_bytes().to_vec()))
}

/// Rust runs the dialog, so the path it returns never reaches the page.
#[tauri::command]
fn pick_document(window: WebviewWindow) {
    pick(window.app_handle(), Some(&window));
}

/// The Open dialog, over `parent` when there is one. A picked file opens in a window of its own.
fn pick(app: &AppHandle, parent: Option<&WebviewWindow>) {
    let mut dialog = app
        .dialog()
        .file()
        .add_filter("Markdown", windows::EXTENSIONS);
    if let Some(parent) = parent {
        dialog = dialog.set_parent(parent);
    }
    let app = app.clone();
    dialog.pick_file(move |picked| {
        if let Some(path) = picked.and_then(|file| file.into_path().ok()) {
            windows::open(&app, &path);
        }
    });
}

/// The File menu's Open item.
const OPEN: &str = "open";

/// macOS's menu bar: Tauri's own, which holds Edit's Copy and Select All, with Open at the top of
/// File. Its ⌘O is the menu's there, so the page stands down for it. Linux and Windows get no
/// menu bar, which would sit above the page in every window. They keep Ctrl+O and the welcome
/// window's button.
fn file_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::default(app)?;
    let open = MenuItem::with_id(app, OPEN, "Open…", true, Some("CmdOrCtrl+O"))?;
    let separator = PredefinedMenuItem::separator(app)?;
    for item in menu.items()? {
        if let MenuItemKind::Submenu(file) = item {
            if file.text()? == "File" {
                file.insert_items(&[&open, &separator], 0)?;
                return Ok(menu);
            }
        }
    }
    // Tauri's menu has a File menu on macOS. Should it lose it, Open still has one, after the app's.
    menu.insert(&Submenu::with_items(app, "File", true, &[&open])?, 1)?;
    Ok(menu)
}

/// File > Open, over the window in front, if there is one.
fn on_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    if event.id() == OPEN {
        let front = app
            .webview_windows()
            .into_values()
            .find(|window| window.is_focused().unwrap_or(false));
        pick(app, front.as_ref());
    }
}

/// A link goes to the system browser, after a click. The page itself never navigates.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !opens(&url) {
        return Err("Only web and mail links open.".into());
    }
    open::that_detached(&url).map_err(|error| format!("The link could not open: {error}."))
}

/// Prints the window as the page has laid it out for print. On macOS WKWebView ignores
/// `window.print()` (#191), so the page asks for this there, and WebKit's own print panel opens as
/// a sheet. The page puts itself back on `afterprint`, when the panel closes.
#[tauri::command]
async fn print_page(window: WebviewWindow) -> Result<(), String> {
    window
        .print()
        .map_err(|error| format!("The page could not print: {error}."))
}

/// Web and mail addresses. A scheme is case-insensitive, RFC 3986 §3.1, as the page's check is.
fn opens(url: &str) -> bool {
    ["http://", "https://", "mailto:"].iter().any(|scheme| {
        url.get(..scheme.len())
            .is_some_and(|head| head.eq_ignore_ascii_case(scheme))
    })
}

/// The variable that turns WebKitGTK's DMA-BUF renderer off.
const DMABUF: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";

/// #143: where the GPU has no working driver, as in a VM, WebKitGTK's DMA-BUF renderer gives the
/// page no animation frames, and the page stops after its first paint. Its older path still uses
/// the GPU. So it is off unless the user set the variable, which `0` turns back on.
fn dmabuf_off(set: Option<std::ffi::OsString>) -> bool {
    set.is_none()
}

pub fn run() {
    // Before WebKitGTK starts, and before the app starts any thread.
    if cfg!(target_os = "linux") && dmabuf_off(std::env::var_os(DMABUF)) {
        std::env::set_var(DMABUF, "1");
    }
    tauri::Builder::default()
        // First, so a second launch hands its files to this process before anything else starts.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            windows::open_arguments(app, &argv, Path::new(&cwd), windows::Launch::Again);
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(Documents::default())
        .register_uri_scheme_protocol(assets::SCHEME, |ctx, request| {
            let window = ctx.webview_label();
            let documents = ctx.app_handle().state::<Documents>();
            let response = assets::respond(&documents, window, &request);
            #[cfg(debug_assertions)]
            assets::record(window, &request, &response);
            response
        })
        .invoke_handler(tauri::generate_handler![
            open_document,
            document_text,
            pick_document,
            open_url,
            print_page
        ])
        .on_window_event(windows::on_event)
        .on_menu_event(on_menu_event)
        .setup(|app| {
            if cfg!(target_os = "macos") {
                // Without it, Tauri's menu stays, and the welcome window's button still opens a file.
                if let Err(error) = file_menu(app.handle()).and_then(|menu| app.set_menu(menu)) {
                    eprintln!("The File menu could not be made: {error}");
                }
            }
            let argv: Vec<String> = std::env::args().collect();
            windows::open_arguments(
                app.handle(),
                &argv,
                &std::env::current_dir()?,
                windows::Launch::First,
            );
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Hash Block starts")
        .run(on_run_event);
}

/// macOS does not put a double-clicked file on the command line. It sends an open-file event.
#[cfg(target_os = "macos")]
fn on_run_event(app: &tauri::AppHandle, event: RunEvent) {
    if let RunEvent::Opened { urls } = event {
        for path in urls.iter().filter_map(|url| url.to_file_path().ok()) {
            windows::open(app, &path);
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn on_run_event(_app: &tauri::AppHandle, _event: RunEvent) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turns_the_dmabuf_renderer_off_unless_the_user_set_it() {
        assert!(dmabuf_off(None));
        // Set either way, the user's word stands: `0` keeps the renderer on.
        assert!(!dmabuf_off(Some("0".into())));
        assert!(!dmabuf_off(Some("1".into())));
    }

    #[test]
    fn opens_web_and_mail_addresses_in_any_case() {
        for url in [
            "https://example.com",
            "http://example.com",
            "mailto:me@example.com",
            "HTTPS://EXAMPLE.COM/UP",
            "Mailto:me@example.com",
            "MAILTO:me@example.com",
        ] {
            assert!(opens(url), "{url}");
        }
        for url in [
            "javascript:alert(1)",
            "JAVASCRIPT:alert(1)",
            "file:///etc/hostname",
            "notes.md",
            "//example.com",
            "https:/example.com",
            "",
            "é",
        ] {
            assert!(!opens(url), "{url}");
        }
    }
}

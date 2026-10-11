//! Hash Block: a page for a markdown file. docs/hld.md, milestone one.

mod assets;
mod documents;
mod windows;

use std::path::Path;

use serde::Serialize;
use tauri::ipc::Response;
use tauri::{Manager, RunEvent, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use std::sync::Arc;

use documents::{Document, Documents};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Opened {
    name: String,
    read_only_reason: Option<&'static str>,
}

/// The window's own document. A window can read no other.
fn own_document(window: &WebviewWindow, documents: &Documents) -> Result<Arc<Document>, String> {
    let handle = windows::handle_of(window.label()).ok_or("This window shows no document.")?;
    Ok(documents.get(handle).ok_or("That document is closed.")?)
}

/// What the window's document is called, and why it is read only, if it is.
#[tauri::command]
fn open_document(window: WebviewWindow, documents: State<'_, Documents>) -> Result<Opened, String> {
    let document = own_document(&window, &documents)?;
    Ok(Opened {
        name: document.name.clone(),
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
    let app = window.app_handle().clone();
    window
        .dialog()
        .file()
        .set_parent(&window)
        .add_filter("Markdown", windows::EXTENSIONS)
        .pick_file(move |picked| {
            if let Some(path) = picked.and_then(|file| file.into_path().ok()) {
                windows::open(&app, &path);
            }
        });
}

/// A link goes to the system browser, after a click. The page itself never navigates.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !opens(&url) {
        return Err("Only web and mail links open.".into());
    }
    open::that_detached(&url).map_err(|error| format!("The link could not open: {error}."))
}

/// Web and mail addresses. A scheme is case-insensitive, RFC 3986 §3.1, as the page's check is.
fn opens(url: &str) -> bool {
    ["http://", "https://", "mailto:"].iter().any(|scheme| {
        url.get(..scheme.len())
            .is_some_and(|head| head.eq_ignore_ascii_case(scheme))
    })
}

pub fn run() {
    tauri::Builder::default()
        // First, so a second launch hands its files to this process before anything else starts.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            windows::open_arguments(app, &argv, Path::new(&cwd));
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(Documents::default())
        .register_uri_scheme_protocol(assets::SCHEME, |ctx, request| {
            let response = assets::respond(&ctx.app_handle().state::<Documents>(), &request);
            #[cfg(debug_assertions)]
            assets::record(ctx.webview_label(), &request, &response);
            response
        })
        .invoke_handler(tauri::generate_handler![
            open_document,
            document_text,
            pick_document,
            open_url
        ])
        .on_window_event(windows::on_event)
        .setup(|app| {
            let argv: Vec<String> = std::env::args().collect();
            windows::open_arguments(app.handle(), &argv, &std::env::current_dir()?);
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

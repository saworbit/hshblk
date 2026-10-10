//! Hash Block: a page for a markdown file. docs/hld.md, milestone one.

mod assets;
mod documents;
mod windows;

use std::path::Path;

use serde::Serialize;
use tauri::{Manager, RunEvent, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use documents::Documents;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Opened {
    text: String,
    name: String,
    read_only_reason: Option<&'static str>,
}

/// The text of the window's own document. A window can read no other.
#[tauri::command]
fn open_document(window: WebviewWindow, documents: State<'_, Documents>) -> Result<Opened, String> {
    let handle = windows::handle_of(window.label()).ok_or("This window shows no document.")?;
    let document = documents.get(handle).ok_or("That document is closed.")?;
    Ok(Opened {
        text: document.text.clone(),
        name: document.name.clone(),
        read_only_reason: document.facts.read_only_reason(),
    })
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
    if !["http://", "https://", "mailto:"]
        .iter()
        .any(|scheme| url.starts_with(scheme))
    {
        return Err("Only web and mail links open.".into());
    }
    open::that_detached(&url).map_err(|error| error.to_string())
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
            assets::respond(&ctx.app_handle().state::<Documents>(), &request)
        })
        .invoke_handler(tauri::generate_handler![
            open_document,
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

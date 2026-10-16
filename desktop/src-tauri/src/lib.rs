//! Hash Block: a page for a markdown file. docs/hld.md, milestone one.

mod assets;
mod documents;
mod memory;
mod watch;
mod windows;

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::ipc::Response;
use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, RunEvent, State, WebviewWindow, Wry};
use tauri_plugin_dialog::DialogExt;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::ipc::Channel;

use documents::{Document, Documents};
use memory::Memory;

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

/// The Open dialog's filters: markdown, then every file, as a drop or the command line takes any
/// (#241). On macOS the dialog folds its filters into one list, with no choice between them, so
/// there it stays markdown.
fn filters() -> Vec<(&'static str, &'static [&'static str])> {
    let mut filters = vec![("Markdown", windows::EXTENSIONS)];
    if !cfg!(target_os = "macos") {
        filters.push(("All files", &["*"]));
    }
    filters
}

/// The Open dialog, over `parent` when there is one. Each picked file opens in a window of its own.
fn pick(app: &AppHandle, parent: Option<&WebviewWindow>) {
    let mut dialog = app.dialog().file();
    for (name, extensions) in filters() {
        dialog = dialog.add_filter(name, extensions);
    }
    if let Some(parent) = parent {
        dialog = dialog.set_parent(parent);
        if let Some(folder) = windows::folder_of(&app.state::<Documents>(), parent.label()) {
            dialog = dialog.set_directory(folder);
        }
    }
    let app = app.clone();
    // Several at once, as a drop of several opens each (#241).
    dialog.pick_files(move |picked| {
        let paths: Vec<_> = picked
            .into_iter()
            .flatten()
            .filter_map(|file| file.into_path().ok())
            .collect();
        windows::open_all(&app, &paths);
    });
}

/// The menu bar's own items: File's Open and Print, and Edit's Find.
const OPEN: &str = "open";
const PRINT: &str = "print";
const FIND: &str = "find";

/// What a recent file's item in File > Open Recent is named by, before its place in the list.
const RECENT_ITEM: &str = "recent-";

/// macOS's menu bar: Tauri's own, which holds Edit's Copy and Select All, with Open at the top of
/// File, then Open Recent (#288), Print at its foot, and Find at the foot of Edit (#182). Their
/// keys are the menu's there, so the page stands down for them. Linux and Windows get no menu
/// bar, which would sit above the page in every window. They keep the keys and the welcome
/// window's button.
fn file_menu(app: &AppHandle) -> tauri::Result<(Menu<Wry>, Submenu<Wry>)> {
    let menu = Menu::default(app)?;
    let open = MenuItem::with_id(app, OPEN, "Open…", true, Some("CmdOrCtrl+O"))?;
    let recent = Submenu::new(app, "Open Recent", false)?;
    let print = MenuItem::with_id(app, PRINT, "Print…", true, Some("CmdOrCtrl+P"))?;
    let find = MenuItem::with_id(app, FIND, "Find…", true, Some("CmdOrCtrl+F"))?;
    let mut has_file = false;
    for item in menu.items()? {
        if let MenuItemKind::Submenu(submenu) = item {
            match submenu.text()?.as_str() {
                "File" => {
                    let separator = PredefinedMenuItem::separator(app)?;
                    submenu.insert_items(&[&open, &recent, &separator], 0)?;
                    submenu.append_items(&[&PredefinedMenuItem::separator(app)?, &print])?;
                    has_file = true;
                }
                "Edit" => submenu.append_items(&[&PredefinedMenuItem::separator(app)?, &find])?,
                _ => {}
            }
        }
    }
    // Tauri's menu has a File menu on macOS. Should it lose it, Open still has one, after the app's.
    if !has_file {
        menu.insert(
            &Submenu::with_items(app, "File", true, &[&open, &recent, &print])?,
            1,
        )?;
    }
    Ok((menu, recent))
}

/// #288: File > Open Recent on macOS: the files the welcome window lists, and the paths its items
/// stand for, which stay in Rust.
pub struct RecentMenu {
    submenu: Submenu<Wry>,
    files: Mutex<Vec<PathBuf>>,
}

impl RecentMenu {
    /// Lists the recent files again, on the main thread, which the menu bar is AppKit's on.
    pub fn refresh(app: &AppHandle) {
        if app.try_state::<RecentMenu>().is_none() {
            return;
        }
        let handle = app.clone();
        let refreshed = app.run_on_main_thread(move || {
            let menu = handle.state::<RecentMenu>();
            if let Err(error) = menu.list(&handle) {
                eprintln!("File > Open Recent could not be made: {error}");
            }
        });
        if let Err(error) = refreshed {
            eprintln!("File > Open Recent could not be made: {error}");
        }
    }

    fn list(&self, app: &AppHandle) -> tauri::Result<()> {
        let files = app.state::<Memory>().files();
        while self.submenu.remove_at(0)?.is_some() {}
        for (id, name) in recent_items(&files) {
            let item = MenuItem::with_id(app, id, name, true, None::<&str>)?;
            self.submenu.append(&item)?;
        }
        self.submenu.set_enabled(!files.is_empty())?;
        *self.files.lock().expect("recent menu lock") = files;
        Ok(())
    }

    /// The file an item names, in the list the menu was last made from.
    fn file(&self, id: &str) -> Option<PathBuf> {
        recent_file(&self.files.lock().expect("recent menu lock"), id)
    }
}

/// Each recent file's item: its id, by its place in the list, and its name, as the welcome window
/// names it.
fn recent_items(files: &[PathBuf]) -> Vec<(String, String)> {
    let names = recent_names(files);
    let ids = (0..files.len()).map(|n| format!("{RECENT_ITEM}{n}"));
    ids.zip(names).collect()
}

/// The file a recent file's item names, by its place in `files`.
fn recent_file(files: &[PathBuf], id: &str) -> Option<PathBuf> {
    let place: usize = id.strip_prefix(RECENT_ITEM)?.parse().ok()?;
    files.get(place).cloned()
}

/// The recent files' names, each as a window's title names its file: as many of its folders as
/// tell it from another of the same name (#167).
fn recent_names(files: &[PathBuf]) -> Vec<String> {
    let named: Vec<(String, PathBuf)> = files
        .iter()
        .map(|path| {
            let name = path.file_name().unwrap_or_default();
            (name.to_string_lossy().into_owned(), path.clone())
        })
        .collect();
    windows::titles(&named)
}

/// The menu bar's items, for the window in front, if there is one. Find and Print are the page's
/// to do, so they go down the channel it gave `watch_menu`. The welcome window gave none.
fn on_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let front = app
        .webview_windows()
        .into_values()
        .find(|window| window.is_focused().unwrap_or(false));
    match event.id().as_ref() {
        OPEN => pick(app, front.as_ref()),
        action @ (FIND | PRINT) => {
            if let Some(window) = front {
                app.state::<MenuChannels>().send(window.label(), action);
            }
        }
        id => {
            let file = app.try_state::<RecentMenu>().and_then(|menu| menu.file(id));
            if let Some(file) = file {
                windows::open_all(app, &[file]);
            }
        }
    }
}

/// Each document window's line from the menu bar. The page takes no events, so it hands Rust a
/// channel for the items that are its to do.
#[derive(Default)]
pub struct MenuChannels(Mutex<HashMap<String, Channel<String>>>);

impl MenuChannels {
    fn send(&self, label: &str, action: &str) {
        let channels = self.0.lock().expect("menu channels lock");
        if let Some(channel) = channels.get(label) {
            if let Err(error) = channel.send(action.to_owned()) {
                eprintln!("The menu could not reach its window: {error}");
            }
        }
    }

    /// A closed window's channel goes with it.
    pub fn forget(&self, label: &str) {
        self.0.lock().expect("menu channels lock").remove(label);
    }
}

/// #285: where a link in another window sends each window: the heading or the anchor its
/// fragment names. A new window's page has no channel until it asks, so the fragment waits.
#[derive(Default)]
pub struct Fragments(Mutex<HashMap<String, Fragment>>);

enum Fragment {
    Waiting(String),
    Watched(Channel<String>),
}

impl Fragments {
    /// Sends the window's page to `fragment`, now if it watches for one, or else once it does.
    pub fn send(&self, label: &str, fragment: String) {
        let mut windows = self.0.lock().expect("fragments lock");
        if let Some(Fragment::Watched(channel)) = windows.get(label) {
            if let Err(error) = channel.send(fragment) {
                eprintln!("A link could not reach its window: {error}");
            }
            return;
        }
        windows.insert(label.to_owned(), Fragment::Waiting(fragment));
    }

    fn watch(&self, label: &str, channel: Channel<String>) {
        let mut windows = self.0.lock().expect("fragments lock");
        if let Some(Fragment::Waiting(fragment)) = windows.remove(label) {
            if let Err(error) = channel.send(fragment) {
                eprintln!("A link could not reach its window: {error}");
            }
        }
        windows.insert(label.to_owned(), Fragment::Watched(channel));
    }

    /// A closed window's line goes with it.
    pub fn forget(&self, label: &str) {
        self.0.lock().expect("fragments lock").remove(label);
    }
}

/// The page's line from Rust for a link in another window that names a place in its file (#285).
#[tauri::command]
fn watch_fragments(
    window: WebviewWindow,
    channel: Channel<String>,
    fragments: State<'_, Fragments>,
) {
    fragments.watch(window.label(), channel);
}

/// The page's line from the menu bar, for Find and Print on macOS.
#[tauri::command]
fn watch_menu(window: WebviewWindow, channel: Channel<String>, menus: State<'_, MenuChannels>) {
    menus
        .0
        .lock()
        .expect("menu channels lock")
        .insert(window.label().to_owned(), channel);
}

/// The page's line from Rust for its file's new text (#199). Rust looks at the file twice a second
/// and says when it changed, or why it cannot show the new text. The page asks for it again.
#[tauri::command]
fn watch_document(
    window: WebviewWindow,
    documents: State<'_, Documents>,
    watchers: State<'_, watch::Watchers>,
    channel: Channel<String>,
) -> Result<(), String> {
    let document = own_document(&window, &documents)?;
    watchers.watch(window.label(), channel, document.stamp);
    Ok(())
}

/// A recent file, as the welcome window lists it: its name, with as many folders as tell it from
/// another of the same name, and a token that names it for `open_recent`. Never its path.
#[derive(Serialize)]
struct Recent {
    name: String,
    token: String,
}

/// The files opened last, for the welcome window (#242). Rust keeps their paths.
#[tauri::command]
fn recent_files(memory: State<'_, Memory>) -> Vec<Recent> {
    let listed = memory.recent(token);
    let files: Vec<PathBuf> = listed.iter().map(|(_, path)| path.clone()).collect();
    listed
        .into_iter()
        .zip(recent_names(&files))
        .map(|((token, _), name)| Recent { name, token })
        .collect()
}

/// Opens the recent file a token names, as the Open dialog opens one (#242). Async, since a
/// window made from a synchronous command deadlocks on Windows.
#[tauri::command]
async fn open_recent(
    app: AppHandle,
    memory: State<'_, Memory>,
    token: String,
) -> Result<(), String> {
    let file = memory
        .take(&token)
        .ok_or("That file is no longer in the list.")?;
    windows::open_all(&app, &[file]);
    Ok(())
}

/// A token for the page to name a recent file by: 64 random bits, as hex.
fn token() -> String {
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).expect("the operating system provides random bytes");
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// A link goes to the system browser, after a click. The page itself never navigates.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !opens(&url) {
        return Err("Only web and mail links open.".into());
    }
    open::that_detached(&url).map_err(|error| format!("The link could not open: {error}."))
}

/// A link to a file in the repository opens it in a window of its own, or brings the window it
/// has to the front (#156). The reference is the link's, decoded, and is found from this window's
/// document under the scope an image has, so the page names no path. Async, since a window made
/// from a synchronous command deadlocks on Windows.
#[tauri::command]
async fn open_link(
    window: WebviewWindow,
    documents: State<'_, Documents>,
    reference: String,
    fragment: Option<String>,
) -> Result<(), String> {
    let document = own_document(&window, &documents)?;
    let file = assets::locate(&document, &reference)
        .map_err(|refusal| link_refusal(&refusal, &reference))?;
    windows::show(window.app_handle(), &file, fragment)
}

/// Why the resource channel refused an image the page could not show, in its chip's words, or
/// none when the channel serves it, as when its bytes would not decode (#231). The reference is
/// the one the page asked the channel for, so it checks what the channel checked.
#[tauri::command]
fn image_refusal(
    window: WebviewWindow,
    documents: State<'_, Documents>,
    reference: String,
) -> Result<Option<&'static str>, String> {
    let document = own_document(&window, &documents)?;
    Ok(assets::load(&document, &reference)
        .err()
        .map(|refusal| refusal.reason()))
}

/// Why a link to a file does not open, naming it as the link does.
fn link_refusal(refusal: &assets::Refusal, reference: &str) -> String {
    match refusal {
        assets::Refusal::OutsideScope => format!("{reference} is outside the repository."),
        assets::Refusal::Missing => format!("{reference} was not found."),
        _ => "Only web and mail links open, and links to files in the repository.".into(),
    }
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

/// Closes the window, for Ctrl+W on Linux and Windows (#166). macOS's menu bar has Close Window.
/// The page has no permission of Tauri's own, so it asks for this one by name.
#[tauri::command]
fn close_window(window: WebviewWindow) -> Result<(), String> {
    window
        .close()
        .map_err(|error| format!("The window could not close: {error}."))
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

/// #287: the identifier the app runs as. A debug build, which the tests and `tauri dev` run, is
/// never the reader someone installed. Its own identifier gives it its own data folder, WebView2
/// profile, and single-instance key, so its files stay out of the reader's recent files, and it
/// runs while Hash Block is open, rather than handing its file over.
fn identifier(written: &str, debug: bool) -> String {
    if debug {
        format!("{written}.debug")
    } else {
        written.to_owned()
    }
}

pub fn run() {
    // Before WebKitGTK starts, and before the app starts any thread.
    if cfg!(target_os = "linux") && dmabuf_off(std::env::var_os(DMABUF)) {
        std::env::set_var(DMABUF, "1");
    }
    let mut context = tauri::generate_context!();
    let config = context.config_mut();
    config.identifier = identifier(&config.identifier, cfg!(debug_assertions));
    tauri::Builder::default()
        // First, so a second launch hands its files to this process before anything else starts.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            windows::open_arguments(app, &argv, Path::new(&cwd), windows::Launch::Again);
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(Documents::default())
        .manage(MenuChannels::default())
        .manage(Fragments::default())
        .manage(watch::Watchers::default())
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
            recent_files,
            open_recent,
            open_link,
            image_refusal,
            print_page,
            watch_menu,
            watch_document,
            watch_fragments,
            close_window
        ])
        .on_window_event(windows::on_event)
        .on_menu_event(on_menu_event)
        .setup(|app| {
            if cfg!(target_os = "macos") {
                // Without it, Tauri's menu stays, and the welcome window's button still opens a file.
                match file_menu(app.handle()).and_then(|(menu, recent)| {
                    app.set_menu(menu)?;
                    Ok(recent)
                }) {
                    Ok(submenu) => {
                        app.manage(RecentMenu {
                            submenu,
                            files: Mutex::default(),
                        });
                    }
                    Err(error) => eprintln!("The File menu could not be made: {error}"),
                }
            }
            watch::start(app.handle().clone());
            // What the app kept from the last run: the last window's size and place, and the
            // recent files, in its own data folder (#240, #242).
            app.manage(Memory::load(app.path().app_local_data_dir().ok()));
            RecentMenu::refresh(app.handle());
            let argv: Vec<String> = std::env::args().collect();
            windows::open_arguments(
                app.handle(),
                &argv,
                &std::env::current_dir()?,
                windows::Launch::First,
            );
            Ok(())
        })
        .build(context)
        .expect("Hash Block starts")
        .run(on_run_event);
}

/// macOS does not put a double-clicked file on the command line. It sends an open-file event.
#[cfg(target_os = "macos")]
fn on_run_event(app: &tauri::AppHandle, event: RunEvent) {
    if let RunEvent::Opened { urls } = event {
        // Every file Finder hands over at once, with one message for those that do not open (#260).
        let paths: Vec<_> = urls
            .iter()
            .filter_map(|url| url.to_file_path().ok())
            .collect();
        windows::open_all(app, &paths);
    }
}

#[cfg(not(target_os = "macos"))]
fn on_run_event(_app: &tauri::AppHandle, _event: RunEvent) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_each_recent_file_in_the_menu_as_the_welcome_window_does() {
        // #288: only the welcome window listed the files opened last.
        let paths = [
            std::path::PathBuf::from("/a/docs/README.md"),
            std::path::PathBuf::from("/a/README.md"),
            std::path::PathBuf::from("/a/notes.md"),
        ];
        let items = recent_items(&paths);
        let ids: Vec<_> = items.iter().map(|(id, _)| id.as_str()).collect();
        assert_eq!(ids, ["recent-0", "recent-1", "recent-2"]);
        let names: Vec<_> = items.into_iter().map(|(_, name)| name).collect();
        assert_eq!(names, recent_names(&paths));
        assert_eq!(names[2], "notes.md");
        // A click names its file by its place in the list the menu was made from.
        assert_eq!(recent_file(&paths, "recent-1"), Some(paths[1].clone()));
        assert_eq!(recent_file(&paths, "recent-3"), None);
        assert_eq!(recent_file(&paths, "open"), None);
    }

    #[test]
    fn sends_a_window_where_a_link_named_now_or_once_its_page_watches() {
        // #285: a link to a heading in another file opened that file at its top.
        let seen = Arc::new(Mutex::new(Vec::new()));
        let into = seen.clone();
        let channel = Channel::<String>::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                into.lock().unwrap().push(json);
            }
            Ok(())
        });
        let fragments = Fragments::default();
        // A new window's page has not asked yet, so the fragment waits for it.
        fragments.send("doc-1", "#install".into());
        fragments.watch("doc-1", channel);
        // An open window's page takes it at once.
        fragments.send("doc-1", "#usage".into());
        assert_eq!(*seen.lock().unwrap(), [r##""#install""##, r##""#usage""##]);
        // A closed window's line goes with it.
        fragments.forget("doc-1");
        fragments.send("doc-1", "#later".into());
        assert_eq!(seen.lock().unwrap().len(), 2);
    }

    #[test]
    fn offers_every_file_after_markdown_where_the_dialog_can_choose() {
        // #241: the one filter was markdown, so a README with no extension could not be picked.
        let names: Vec<_> = filters().iter().map(|(name, _)| *name).collect();
        if cfg!(target_os = "macos") {
            assert_eq!(names, ["Markdown"]);
        } else {
            assert_eq!(names, ["Markdown", "All files"]);
        }
    }

    #[test]
    fn runs_a_debug_build_apart_from_the_installed_reader() {
        // #287: a test run on a debug build wrote its fixtures into the reader's recent files.
        assert_eq!(
            identifier("dev.hshblk.reader", true),
            "dev.hshblk.reader.debug"
        );
        assert_eq!(identifier("dev.hshblk.reader", false), "dev.hshblk.reader");
    }

    #[test]
    fn turns_the_dmabuf_renderer_off_unless_the_user_set_it() {
        assert!(dmabuf_off(None));
        // Set either way, the user's word stands: `0` keeps the renderer on.
        assert!(!dmabuf_off(Some("0".into())));
        assert!(!dmabuf_off(Some("1".into())));
    }

    #[test]
    fn says_why_a_link_to_a_file_does_not_open_naming_it_as_the_link_does() {
        use assets::Refusal;
        assert_eq!(
            link_refusal(&Refusal::OutsideScope, "../../secret.md"),
            "../../secret.md is outside the repository."
        );
        assert_eq!(
            link_refusal(&Refusal::Missing, "docs/gone.md"),
            "docs/gone.md was not found."
        );
        assert_eq!(
            link_refusal(&Refusal::NotRelative, "C:/x.md"),
            "Only web and mail links open, and links to files in the repository."
        );
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

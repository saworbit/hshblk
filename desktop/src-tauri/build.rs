fn main() {
    // Only these commands exist for the page, and capabilities/default.json grants each by name.
    let manifest = tauri_build::AppManifest::new().commands(&[
        "open_document",
        "document_text",
        "pick_document",
        "open_url",
        "recent_files",
        "open_recent",
        "open_link",
        "image_refusal",
        "print_page",
        "watch_menu",
        "watch_document",
        "close_window",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("the Tauri build step runs");
}

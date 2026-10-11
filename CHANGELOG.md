# Changelog

## Unreleased

- Desktop: an image written percent-encoded, such as `screen%20shot.png`, now loads. Escapes and entities in a link or image destination now read as CommonMark says. (#35)
- CI: the Desktop workflow caches Rust dependencies, `tauri-driver`, and `cargo-deny`, keyed on `Cargo.lock`. Only `main` saves the cache. (#29)
- CI: the bundle job is named `Bundle`, so a pull request shows a readable name when it is skipped. (#30)
- CI: the print test waits for the app's window to show before it focuses it, so a window still mapping no longer fails it.
- Desktop: a find match inside a link's address shows in the link's popover, marked, since the address never shows on the page. (#24)
- Desktop: links that looked clickable now open. Ctrl or ⌘ and a click opens a link in a table, a mail autolink opens as `mailto:`, and a scheme written in capitals opens. A link that cannot open says why in the status line. (#43, #44, #45)
- Desktop: a link to a heading in the same file, such as `[Tables](#tables)`, goes there from **Go to** in its popover or from Ctrl or ⌘ and a click. Headings are named as GitHub names them. (#54)
- Desktop: a find match in a link's title, or anywhere else in its hidden syntax but the address, shows marked in the link's popover. (#53)
- Docs: the design doc records how an image's destination names its file, and find in a link's address.

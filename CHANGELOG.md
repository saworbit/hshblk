# Changelog

## Unreleased

- Desktop: a full stop or comma after a link, an autolink, or a code span stays on that construct's line. The hidden syntax between them no longer leaves a place for the line to break. (#48)
- Desktop: an image written percent-encoded, such as `screen%20shot.png`, now loads. Escapes and entities in a link or image destination now read as CommonMark says. (#35)
- CI: the Desktop workflow caches Rust dependencies, `tauri-driver`, and `cargo-deny`, keyed on `Cargo.lock`. Only `main` saves the cache. (#29)
- Reader: a link's address reads its escapes and entities, as the desktop app does: `a\_b?q=1&amp;r=2` is `a_b?q=1&r=2`. (#55)
- Desktop and reader: `\|` in a table cell's code span shows as `|`, as GFM says. Outside a table it keeps its backslash. (#51)
- CI: the bundle job is named `Bundle`, so a pull request shows a readable name when it is skipped. (#30)
- Desktop: an image whose file name holds `#` or `?`, such as `c%23.png`, now loads. (#39)
- Desktop: an SVG that starts with a comment, a doctype, or a long XML declaration now shows. (#52)
- CI: the print test waits for the app's window to show before it focuses it, so a window still mapping no longer fails it.
- Desktop: a table's short columns keep their words whole, and its table scrolls when they cannot fit. (#42)
- Desktop: a wrapped list item's lines start under its text, not its marker, at every level of nesting. (#49)
- Desktop: an image that shares its line with text or other images stays in the line, so a README's badge row stays a row. One that cannot show is a chip of its words. An image alone in its paragraph is still a block. (#50)
- Desktop: a click on the line below a table lands on that line. The table's margin was outside what CodeMirror measures, so the click landed on the line above.
- Desktop: a find match inside a link's address shows in the link's popover, marked, since the address never shows on the page. (#24)
- Docs: the design doc records how an image's destination names its file, and find in a link's address.
- Desktop: a launch on a missing file or a folder leaves the welcome window open behind the error, so the app no longer runs on with no window. (#47)

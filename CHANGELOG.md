# Changelog

## Unreleased

- Desktop: a full stop or comma after a link, an autolink, or a code span stays on that construct's line. The hidden syntax between them no longer leaves a place for the line to break. (#48)
- Desktop: an image written percent-encoded, such as `screen%20shot.png`, now loads. Escapes and entities in a link or image destination now read as CommonMark says. (#35)
- Desktop: `Ctrl+O`, `Ctrl+P`, and `Ctrl+F` work wherever focus is in the window, the find box included, not only in the page's text. (#46)
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
- Desktop: links that looked clickable now open. Ctrl or ⌘ and a click opens a link in a table, a mail autolink opens as `mailto:`, and a scheme written in capitals opens. A link that cannot open says why in the status line. (#43, #44, #45)
- Desktop: a link to a heading in the same file, such as `[Tables](#tables)`, goes there from **Go to** in its popover or from Ctrl or ⌘ and a click. Headings are named as GitHub names them. (#54)
- Desktop: a find match in a link's title, or anywhere else in its hidden syntax but the address, shows marked in the link's popover. (#53)
- Docs: the design doc records how an image's destination names its file, and find in a link's address.
- Desktop: a launch on a missing file or a folder leaves the welcome window open behind the error, so the app no longer runs on with no window. (#47)
- Docs: why a launch can take 30 seconds on Linux, and the one line that fixes it. A desktop portal that cannot start holds GTK up; CI keeps each test in a bus of its own because of it. (#23)
- Desktop: a large file no longer stops the window for seconds when its whole parse lands. The page draws inline syntax only near the viewport, and reads definitions, heading anchors, and tables between events. A link or image that runs onto the next line is hidden a line at a time, and a line it hides whole takes no space. (#18)
- CI: the punctuation test scrolls to the top again until its paragraph shows. CodeMirror could put the page back at the end in the frame after the find box closed, which failed it at times.
- Docs: SECURITY.md names a reporting route that works while the repository is private: email, to the address on the maintainer's GitHub profile. (#56)
- Desktop: a raw HTML block is drawn, in a sandboxed frame that runs no script and fetches nothing, not even the images it names. It takes the page's fonts and colours. Inline HTML still shows as source. (#25)
- Desktop: an image path that starts with `/`, such as `/images/logo.png`, loads from the repository's root, as GitHub reads it. It still cannot leave the repository. The corpus survey reads it the same way and counts these on their own: 12 in the corpus. (#40)
- Desktop: a click or a drag places the caret and opens no syntax, so the text never moves under the pointer. Opened marks could wrap a word at a line's end onto the next line. The keys and find still open the syntax they reach, and a link's popover still shows on a click. The click-target gate has a row for bold, italic, and code. (#26)
- Desktop: in a blockquote, code, raw HTML, and a table's source hide the quote's `>` on every line, as a paragraph does. Only their first line used to.
- Desktop: a document's text crosses from Rust to the page as UTF-8 bytes, not inside a JSON string, so a large file arrives sooner: 60 ms sooner for a 9.6 MB file, by the median of twelve runs. (#19)
- Docs: the design doc's table rule and render-policy box, and two code comments, say what a click and a raw HTML block do now.
- Desktop: Ctrl or ⌘ and a click opens a link in a raw HTML block, or goes to the heading it names, as on the page. WebKit runs none of the page's listeners in the frame, so the page now takes the pointer over it and reads the link from the frame's document. A click on a summary still opens its details. The frame's text can no longer be selected. (#74)
- Desktop: a `<details>` written as its own blocks around a markdown body shows its summary, and a click on it opens or closes the body. Find opens it while a match is inside, `<details open>` starts open, and print shows every one open. Its tags were empty frames, and its body always showed. (#76)

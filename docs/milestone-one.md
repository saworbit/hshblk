# Milestone one acceptance

[hld.md](hld.md) §8, item by item. How each is checked is in [desktop.md](desktop.md#tests).

Run: 2026-10-10. Ubuntu 24.04 LTS in a cloud container: four cores of a 2.1 GHz Xeon, no GPU, Xvfb, WebKitGTK 2.52.6. This is not the named machine (§12 question 2), so the timings under Item 3 are this machine's and nobody else's. The named machine's have a section of their own.

## Result

| Item | Checked by | Result |
|---|---|---|
| 1. A page, not a code buffer; images | `test/acceptance.mjs` | Pass. Headings, emphasis, code, a list, a fenced block, a table, and links are drawn. A link defined at the end of a long file resolves at the top. Images beside the file and via `../` load. One outside the repository, one through a symlink that leaves it, and a remote one do not, and forged requests from the page for those are refused. |
| 2. No script; raw HTML in a frame that fetches only the repository's images; the file untouched | `test/acceptance.mjs` | Pass. A script block and a clicked `onclick` run nothing in their frames. In an HTML block, an image beside the file loads through the resource channel; a remote image, one outside the repository, a srcset, a CSS background, an SVG image, an image input, a video poster, a table background, a stylesheet, a frame, and a refresh load nothing. The resource channel's log shows the frames asked it for nothing but the images the page named. An inline `onerror` stays as text. The file's hash and modification time are the same afterwards. |
| 3. First paint within 1 second | `test/timing.mjs` | Pass on the named machine, 2026-10-13: 0.64 to 0.84 s for the largest file and its tenfold. On this container, the largest file at the line, and its tenfold over by up to 0.18 s. See below. |
| 4. Quit and reopen | `test/acceptance.mjs` | Pass. Each launch goes straight to the page. Nothing is written beside the file. |
| 5. Copy, find, print | `test/acceptance.mjs` | Pass. Copy gives the source. Find matches hidden syntax and reaches the end of the file. Print, through GTK's dialog to a PDF, has every line, drawn, with no syntax showing. On macOS, where WKWebView ignores `window.print()`, Cmd+P opens WebKit's print panel through Rust (#191). Its preview had every line, and Cancel put the page back. |
| 6. No path reaches the page | `test/acceptance.mjs` | Pass. No path in the DOM, the URL, the window's metadata, resource requests, or the replies of `open_document`, `document_text`, and `image_refusal`, the only replies that carry data. Errors name no path either, `open_link`'s included. `open_url` refuses `file:`. |
| 7. Double-click | `test/double-click.sh` | Linux: pass. Through the installed package and `gio`, the way a file manager opens a file, and a second file opens a second window in the same process. Windows: pass, by hand in File Explorer, once #148 was fixed. macOS: pass, in Finder, once #186 was fixed. See below. |

## Item 3

Milliseconds from the process's start, three runs a file, release build:

| File | Bytes | Page loads | Document arrives | First paint | Whole parse |
|---|---|---|---|---|---|
| A short note | 18 | 762–803 | 837–875 | 882–919 | 850–885 |
| The corpus's largest | 956,573 | 781–793 | 888–907 | 964–1001 | 1376–1440 |
| Ten times that | 9,565,739 | 790–856 | 1027–1081 | 1103–1176 | 3950–4064 |

- Most of the second is the engine's. The page starts loading 0.76 to 0.86 s after the process does, whatever the file, before any of this code runs. Under Xvfb with no GPU that is likely the worst case. A desktop session should be the first thing timed on the named machine.
- The page's own share is about 0.2 s for the largest file and 0.3 s for the tenfold. About half of the tenfold's is the 9 MB string crossing IPC. Since #19 it crosses as bytes, not JSON. On 2026-10-11, over twelve runs each, the tenfold's document arrived 60 ms sooner by the median, and the page's share fell by 40 ms. Handing the text over as the window opens saved about 25 ms more, at the cost of putting the file's text in a script. Compressing it, or asking for it before the page's code loads, saved nothing. The rest is WebKitGTK passing the bytes from Rust to the page.
- The whole parse runs after first paint, between events, and so does the read of its definitions, heading anchors, and tables. When it lands, only the lines near the viewport are drawn again. On 2026-10-11, on this container, the window's longest wait after first paint on the tenfold was 0.09 s, against over 5 s before. The whole parse column above is from before, and holds the old redraw.

## Item 3 on the named machine

Run: 2026-10-13, on the named machine (§12 question 2): Windows 11 build 26300, an AMD Ryzen 9 5900X, 32 GB, a GeForce RTX 3070 Ti, and WebView2 155.0.4283.45. Release build at 330f95a. Milliseconds from the process's start, three runs a file:

| File | Bytes | Page loads | Document arrives | First paint | Whole parse |
|---|---|---|---|---|---|
| A short note | 16 | 444–471 | 502–526 | 640–687 | 518–542 |
| The corpus's largest | 956,573 | 452–499 | 518–561 | 666–719 | 736–774 |
| Ten times that | 9,565,739 | 459–492 | 591–625 | 715–740 | 1405–1459 |

- Item 3 passes here. An earlier run the same day, of the two fixtures only, had first paint at 0.72 to 0.84 s.
- The engine's share is a little over half the Linux container's: the page starts loading 0.44 to 0.50 s after the process does. The page's own share is about 0.2 s for the largest file and 0.25 s for the tenfold, as on Linux.
- On a note this short, the whole parse lands before first paint.
- On Windows the script starts the app with the file on its command line, as a double-click does, and reads the page over WebView2's DevTools port. msedgedriver passes a WebView2 app's arguments as switches, so through WebDriver the app never saw its file.

## Item 7 on Windows

Run: 2026-10-14, on the named machine: Windows 11 Home 26H2, build 26300.9550, WebView2 155.0.4283.45. The NSIS installer built there from 51e2d0b, installed for the user. The installer makes Hash Block the handler for `.md`, and no other default had been chosen, so Windows opened the files with no prompt.

- A double-click on `first.md` in File Explorer opened it in its own window, as a page, in front.
- With File Explorer in front again, a double-click on `second note.md` opened a second window in the same process, and the second launch exited. The name's space reached the app whole.
- At 51e2d0b that second window opened behind File Explorer, which kept the focus, two tries out of two (#148). With the fix, each new window came to the front, two tries out of two.
- With the fix, a file dragged from File Explorer onto a window, by hand, opened in a window of its own, in front.

## Item 7 on macOS

Run: 2026-10-14, on a Mac mini (M1, 8 GB): macOS 27.0.1 (26A434), dark appearance. The CI build of 8036be3, installed from its dmg, which is signed ad hoc (#178). Hash Block is the only app there that claims `.md`, so it was already the default. The run was driven over SSH from the named machine, with clicks, drags, and screenshots through a helper the Mac's owner allowed to post input and read the screen.

- With Hash Block closed, a double-click on `first.md` in Finder opened it in its own window, as a page, in front. Five more cold launches through `open`, which sends the same open-file event, did the same.
- At dc13c6f each cold launch also opened a welcome window in front of the document, five tries out of five (#186). With the fix, none did.
- With Finder in front, a double-click on `second note.md` opened a second window, in front, in the same process.
- `nested.md` dragged from Finder onto a window opened in a window of its own, in front.
- Opened with no file, the app showed its welcome window alone. A file picked from its button, a file double-clicked in Finder, and a file dropped on it each took its place.
- At dc13c6f, File > Open and Cmd+O each opened one Open dialog, and Edit's Select All and Copy gave the file's source.

## Found and fixed on the way

- On Linux a double-click opened an empty window. Tauri's desktop entry ran the app without the file. The entry is ours now.
- An image refused by the resource channel showed as broken, not as its placeholder. CodeMirror put the image back when it swapped itself out.
- Print gave one page: the window's worth. In print the page now flows. Print also folds syntax opened by the selection, and prints dark themes in the light palette.
- On a long file, a link whose definition sat past CodeMirror's parse-ahead stayed plain text. The page now parses the whole file in the background.
- On Windows a file double-clicked while the app ran opened its window behind File Explorer. A new window now takes the focus. (#148)
- On macOS a file that started the app opened under a welcome window. The open-file event arrives before setup, which saw no file on the command line. (#186)

## Not covered

- macOS and Windows: the rest, since only item 7 ran there. `tauri-driver` does not run on macOS, and this run was on Linux only. On Windows, msedgedriver passes a WebView2 app's arguments as switches, so a WebDriver session cannot open a file there.
- A drop from a file manager on Linux. Only the operating system can start one, and WebDriver cannot, so on Windows it ran by hand, and on macOS as a drag posted to the system. Drops are handled in Rust, and the page cannot see them: it has no event permissions.
- A real session, with a compositor and an input method. The host spot-check in §9 is for that. It ran in a VM on 2026-10-13, recorded in [gates/click-target.md](gates/click-target.md). A real GPU is still to come.

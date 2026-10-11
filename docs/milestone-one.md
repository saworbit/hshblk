# Milestone one acceptance

[hld.md](hld.md) §8, item by item. How each is checked is in [desktop.md](desktop.md#tests).

Run: 2026-10-10. Ubuntu 24.04 LTS in a cloud container: four cores of a 2.1 GHz Xeon, no GPU, Xvfb, WebKitGTK 2.52.6. This is not the named machine, which §12 question 2 leaves open, so the timings below are this machine's and nobody else's.

## Result

| Item | Checked by | Result |
|---|---|---|
| 1. A page, not a code buffer; images | `test/acceptance.mjs` | Pass. Headings, emphasis, code, a list, a fenced block, a table, and links are drawn. A link defined at the end of a long file resolves at the top. Images beside the file and via `../` load. One outside the repository, one through a symlink that leaves it, and a remote one do not, and forged requests from the page for those are refused. |
| 2. No script; raw HTML in a frame that fetches only the repository's images; the file untouched | `test/acceptance.mjs` | Pass. A script block and a clicked `onclick` run nothing in their frames. In an HTML block, an image beside the file loads through the resource channel; a remote image, one outside the repository, a srcset, a CSS background, an SVG image, an image input, a video poster, a table background, a stylesheet, a frame, and a refresh load nothing. The resource channel's log shows the frames asked it for nothing but the images the page named. An inline `onerror` stays as text. The file's hash and modification time are the same afterwards. |
| 3. First paint within 1 second | `test/timing.mjs` | On this machine: the largest file at the line, and its tenfold over by up to 0.18 s. See below. |
| 4. Quit and reopen | `test/acceptance.mjs` | Pass. Each launch goes straight to the page. Nothing is written beside the file. |
| 5. Copy, find, print | `test/acceptance.mjs` | Pass. Copy gives the source. Find matches hidden syntax and reaches the end of the file. Print, through GTK's dialog to a PDF, has every line, drawn, with no syntax showing. |
| 6. No path reaches the page | `test/acceptance.mjs` | Pass. No path in the DOM, the URL, the window's metadata, resource requests, or the replies of `open_document` and `document_text`, the only replies that carry data. Errors name no path either. `open_url` refuses `file:`. |
| 7. Double-click | `test/double-click.sh` | Linux: pass. Through the installed package and `gio`, the way a file manager opens a file, and a second file opens a second window in the same process. macOS and Windows: not run. |

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

## Found and fixed on the way

- On Linux a double-click opened an empty window. Tauri's desktop entry ran the app without the file. The entry is ours now.
- An image refused by the resource channel showed as broken, not as its placeholder. CodeMirror put the image back when it swapped itself out.
- Print gave one page: the window's worth. In print the page now flows. Print also folds syntax opened by the selection, and prints dark themes in the light palette.
- On a long file, a link whose definition sat past CodeMirror's parse-ahead stayed plain text. The page now parses the whole file in the background.

## Not covered

- macOS and Windows: double-click, drop, and the rest. `tauri-driver` does not run on macOS, and this run was on Linux only.
- A drop from a file manager. Only the operating system can start one, and WebDriver cannot. Drops are handled in Rust, and the page cannot see them: it has no event permissions.
- A real session, with a compositor and an input method. The host spot-check in §9 is for that.

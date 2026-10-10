# The desktop app

Hash Block as a program of its own. Double-click a markdown file and it opens in a window, as a page, not in a browser. This is milestone one of [hld.md](hld.md): it reads, and nothing in it can write.

## Installing

The Desktop workflow builds the packages on every push to `main`. Open the latest run on `main` under **Actions**, **Desktop**, and download the artifact for your system, `hash-block-Linux`, `hash-block-macOS`, or `hash-block-Windows`. Each is kept for 14 days. There are no releases yet.

| System | In the artifact |
|---|---|
| Linux | `.deb` and `.rpm` |
| macOS | `.dmg` |
| Windows | `.exe` installer and `.msi` |

None is signed yet ([hld.md](hld.md) §12, question 1). The first time, macOS will not open it: in **System Settings**, **Privacy & Security**, choose **Open Anyway**. Windows SmartScreen warns too: **More info**, then **Run anyway**.

On Linux the app uses the system's WebKitGTK, which the package depends on. It is not bundled, so it gets the distribution's security updates ([hld.md](hld.md) §10).

## Making it what a double-click opens

The package tells the system that Hash Block opens `.md` and `.markdown` files. Whether it is the default is your choice:

| System | To make it the default |
|---|---|
| Linux | Right-click a markdown file, **Open With**, choose Hash Block, and set it as the default. From a shell: `xdg-mime default "Hash Block.desktop" text/markdown`. |
| macOS | **Get Info** on a markdown file, choose Hash Block under **Open with**, then **Change All**. |
| Windows | Right-click a markdown file, **Open with**, **Choose another app**, Hash Block, **Always**. |

Each file opens in a window of its own. A second file opens a second window in the app that is already running, not a second app.

## Reading

| Key | Does |
|---|---|
| `Ctrl+O` (`⌘O`) | Open a file |
| `Ctrl+F` (`⌘F`) | Find, in the source |
| `Ctrl+P` (`⌘P`) | Print the whole page |
| `Ctrl+A`, `Ctrl+C` | Select and copy, as source |
| `Ctrl` or `⌘` and click | Open a link in the browser |

- Dropping a file on a window opens it in a new window.
- Put the caret in a construct and its syntax shows, so `**bold**` reads as written. A link never unfolds: its address shows in a popover under it, with **Open** for web and mail addresses. A find match in the address shows there, marked.
- Copy and find work on the source, hidden syntax included. The status line says so.
- Images load when they are inside the document's repository: the enclosing git repository, or the file's folder when there is none. Nothing loads from the network.
- Raw HTML shows as source. No script in a document runs.

## Building it

You need Node 24 and Rust 1.85 or later. On Linux, also Tauri's build packages:

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev librsvg2-dev
```

Then:

```bash
cd desktop
npm ci
npm run tauri dev       # a window on Vite's dev server
npx tauri build         # the packages, in src-tauri/target/release/bundle
```

## How a file becomes a page

1. Rust opens the file ([`documents.rs`](../desktop/src-tauri/src/documents.rs)). It reads the bytes, records their encoding, BOM, line endings, and any NUL, and finds the scope: the enclosing git repository, or the folder. It keeps all of that behind a handle of 128 random bits, and opens a window whose label names the handle.
2. The page asks `open_document` and gets the text and the file's name. Never a path ([hld.md](hld.md) §6).
3. CodeMirror holds the text, read-only. [`src/page/`](../desktop/src/page) draws section 7's dialect as decorations over the source. The rest of the document is parsed in the background after the first paint, so a definition at the end can name a link at the top.
4. An image asks the `doc-asset` scheme for the handle and the reference as written. Rust resolves it inside the scope, symlinks first, and serves it only if its bytes are an image ([`assets.rs`](../desktop/src-tauri/src/assets.rs)).
5. A link leaves through `open_url`, which takes `http`, `https`, and `mailto` and nothing else.

## File layout

| Path | Holds |
|---|---|
| `desktop/src-tauri/src/documents.rs` | Opening a file: its facts, its scope, its handle. |
| `desktop/src-tauri/src/assets.rs` | The resource channel for images. |
| `desktop/src-tauri/src/windows.rs` | Where files come from (the command line, a double-click, the dialog, a drop) and the window each gets. |
| `desktop/src-tauri/src/lib.rs` | The three commands the page may call, and the app. |
| `desktop/src-tauri/linux/hshblk.desktop` | The Linux desktop entry, which passes the double-clicked file. |
| `desktop/src/main.ts` | The window: open, print, the status line, and the welcome. |
| `desktop/src/surface.ts` | The CodeMirror surface, with editing turned off. |
| `desktop/src/page/` | The page: the dialect, its decorations, links, images, tables, the whole-document parse, and the theme. |

## Tests

| Command, in `desktop/` | Checks |
|---|---|
| `npm test` | The page's decorations, in Node. |
| `cargo test`, in `src-tauri/` | Files, scopes, handles, and the resource channel. |
| `node test/acceptance.mjs <app>` | [hld.md](hld.md) §8, items 1, 2, 4, 5, and 6, through the built app. |
| `node test/gate/click-target.mjs <app>` | The click-target gate, §9. |
| `test/double-click.sh` | §8, item 7, on Linux, with the package installed. |
| `node test/timing.mjs <app> <file>...` | §8, item 3: first paint and whole parse, from the process's start. |
| `npm run licences`, and `cargo deny check` in `src-tauri/` | Every licence that ships is on §10's list. |

`<app>` is a built binary, such as `src-tauri/target/debug/hshblk` after `npx tauri build --debug --no-bundle`. The tests that drive the app run on Linux under X. They need `tauri-driver` (`cargo install tauri-driver --locked`) and WebKitWebDriver (`webkit2gtk-driver`). Print also needs `xdotool` and `pdftotext`, and the double-click needs `gio` and a D-Bus session. CI runs them all under Xvfb, each in a D-Bus session of its own: [`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml).

The last run of each is recorded in [milestone-one.md](milestone-one.md) and [gates/](gates/).

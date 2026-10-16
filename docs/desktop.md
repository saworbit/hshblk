# The desktop app

Hash Block as a program of its own. Double-click a markdown file and it opens in a window, as a page, not in a browser. This is milestone one of [hld.md](hld.md): it reads, and nothing in it can write.

## Installing

The Desktop workflow builds the packages on every push to `main`. Open the latest run on `main` under **Actions**, **Desktop**, and download the artifact for your system, `hash-block-Linux`, `hash-block-macOS`, or `hash-block-Windows`. Each is kept for 14 days. A release, once one is published, is under **Releases**.

| System | In the artifact |
|---|---|
| Linux | `.deb` and `.rpm` |
| macOS | `.dmg` |
| Windows | `.exe` installer and `.msi` |

There is no AppImage: Tauri's bundles WebKitGTK, which [hld.md](hld.md) §10 rules out. None is signed yet ([hld.md](hld.md) §12, question 1), and macOS ships unsigned until there is an Apple Developer ID. The first time, macOS will not open it: in **System Settings**, **Privacy & Security**, choose **Open Anyway**. Windows SmartScreen warns too: **More info**, then **Run anyway**.

On Linux the app uses the system's WebKitGTK, which the package depends on. It is not bundled, so it gets the distribution's security updates ([hld.md](hld.md) §10). The app turns off WebKitGTK's DMA-BUF renderer, unless `WEBKIT_DISABLE_DMABUF_RENDERER` is already set. Where the GPU has no working driver, as in a VM, that renderer gives the page no animation frames, and the page stops after its first paint. Its older path still uses the GPU. To keep the DMA-BUF renderer, start the app with `WEBKIT_DISABLE_DMABUF_RENDERER=0`.

### If it takes 30 seconds to open, on Linux

A session with no session manager on its bus, such as a bare window manager, makes GTK ask for the desktop portal as it starts. If the portal is installed but cannot start, GTK waits for it: 25 seconds for D-Bus to give up on starting it, and 5 more for a second call. Every GTK app waits the same way. The portal cannot start when D-Bus starts it without your display, so give D-Bus the display once, when the session starts:

```bash
dbus-update-activation-environment --systemd DISPLAY XAUTHORITY
```

A full desktop does this already. On a GitHub runner the launch went from 31.6 s to 1.1 s with it. Without a portal installed there is no wait at all.

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
| `Ctrl+O` (`⌘O`) | Open a file. On macOS, so does File > Open |
| `Ctrl+F` (`⌘F`) | Find, in the source. On macOS, so does Edit > Find |
| `Ctrl+/` (`⌘/`) | Show all the syntax, or hide it again |
| `Ctrl+Shift+M` (`⌘⇧M`) | Show or hide the frontmatter's panel |
| `Ctrl+P` (`⌘P`) | Print the whole page. On macOS, so does File > Print |
| `Ctrl+=`, `Ctrl+-` (`⌘=`, `⌘-`) | Make the text bigger or smaller |
| `Ctrl+0` (`⌘0`) | Put the text back to its own size |
| `Ctrl+W` (`⌘W`) | Close the window. On macOS, so does File > Close Window |
| `Ctrl+A`, `Ctrl+C` | Select and copy, as source |
| `PageDown`, `Space` | Down a page, by the window less a line. `PageUp` and `Shift+Space` go back up |
| `Ctrl` or `⌘` and click | Open a link in the browser, or a file in the repository in a window of its own, or go to the heading or HTML anchor it names |
| `Alt+Left`, `Alt+Right` (`⌘[`, `⌘]`) | Back to where a link to a heading was followed from, and forward again |
| `Enter` | Open or close a `<details>`, with the caret on its tags. Tick or untick a task box, with the caret in its text |

- Dropping a file on a window opens it in a new window. A file that is already open brings its window to the front instead. `Ctrl+O` starts in the folder of the window's document, offers every file after the markdown ones on Linux and Windows, and takes several at once. Two windows of files with the same name add the folder to their titles. A file that is not text, such as an image, does not open, and the message names it.
- On macOS, the menu bar's File menu has Open, with ⌘O, above Tauri's own items, and Print, with ⌘P, below them. Edit keeps Tauri's Copy and Select All, and ends with Find, with ⌘F. Each new window opens a step down and right of the one before. Linux and Windows have no menu bar, which would sit above the page in every window.
- Move the caret into a construct with the keys, or find in it, and its syntax shows, so `**bold**` reads as written. A click places the caret and opens nothing, so the text holds still under the pointer. A link never unfolds: its address shows in a popover under it, with **Open** for web and mail addresses and for files in the repository, which open in a window of their own. A link that cannot open says why in its popover, and in the status line after `Ctrl` or `⌘` and a click. After following a link to a heading, `Alt+Left` (`⌘[`) goes back to where it was followed from. Print shows a web or mail link's address after its words. A find match in the address shows there, marked.
- Copy and find work on the source, hidden syntax included. The status line says so, after the file's name and when it was last modified. The find box says how many matches there are and which one is current, and marks that one apart from the rest. In a file over a million characters it counts between events, and says "Counting" until it is done.
- Keyboard focus on the app's own buttons and fields shows as a ring in the accent colour.
- The page has no right-click menu, and `F5` and `Ctrl+R` do nothing. A window takes its file's new text by itself when the file changes on disk, within a second, with the caret and the scroll where they were. A file that is moved or deleted says so in the status line, and the page keeps what it showed. The find box's fields keep their menu, for paste.
- The text size the keys set is the window's, until it closes. Print is at the page's own size.
- Images load when they are inside the document's repository: the enclosing git repository, or the file's folder when there is none. One that does not show is a chip of its words that says why: not found, outside the repository, larger than 20 MB, not an image the app shows, or remote. A repository at the home folder or above it does not count, so dotfiles kept in `~/.git` do not open the whole home. A file directly in the home folder shows only the images beside it, not those in folders below. A path that starts with `/` starts at that root, as on GitHub. Nothing loads from the network.
- A raw HTML block is drawn in a frame that runs no script. Its images load from inside the repository, as a markdown image does, and it fetches nothing else. A click on a link in it shows its address, and Ctrl or ⌘ and a click opens it, as on the page. A click on a summary opens its details, and print shows every block with its details open. It draws a table, a heading, and a summary as the page does, an image that cannot load as a chip of its words, and a frame inside it not at all. Nothing in it takes the keyboard or typing. Its text cannot be selected: copy works on the source. Inline HTML shows as source, but for a comment, which folds away. No script in a document runs.
- YAML frontmatter at the top of a file folds away, not drawn as a rule and a heading. A `---` on the first line with a blank line after it is a rule, not frontmatter. The status line says it is there, with a pulse when it first shows. A click on it, or `Ctrl+Shift+M`, opens a panel that lists its fields, with the raw YAML a click away. YAML the panel cannot list shows raw. The caret starts after it, so the first key leaves it folded. The keys and find show its source where they reach it, as a quiet monospace block. TOML frontmatter between `+++` lines folds away the same way, and its panel shows it as written.
- A task list item shows its box, ticked as the file has it, where a bullet's marker was. A numbered item keeps its number. A click on it, or Enter with the caret in its text, ticks or unticks it on the page, never in the file.
- A quote whose first line is one of GitHub's alert markers, such as `[!WARNING]`, shows the alert's name and icon in place of the marker, with its rule and a tint in the alert's colour. Text between single tildes, `~struck~`, is struck through, as between double ones.
- A `<details>` written as its own blocks around markdown, as a README writes it, shows its summary. A click on it, or Enter with the caret on its tags, opens or closes it, find opens it while a match is inside, and print shows it open.

## Building it

You need Node 24 with npm 11.11 or later, and Rust 1.85 or later. An older npm rewrites `package-lock.json`, so `desktop/package.json` refuses it: Node 24.14.1 or later carries a new enough npm, or `npm install -g npm@11`. On Linux, also Tauri's build packages:

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev librsvg2-dev
```

On Windows, also the MSVC build tools (Visual Studio's **Desktop development with C++**) and the WebView2 runtime, which Windows 11 has.

Then:

```bash
cd desktop
npm ci
npm run tauri dev                # a window on Vite's dev server
npx tauri build                  # the packages, in src-tauri/target/release/bundle
npx tauri build --no-bundle      # the app alone: src-tauri/target/release/hshblk, .exe on Windows
```

## Releasing

1. Set the version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `package.json`, and merge that to `main`.
2. Tag the merge and push the tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. The Desktop workflow checks that the tag names the version in all three, runs every test, builds the packages on each system, and puts them in a draft release with notes from the merged pull requests. A second run on the same tag replaces the draft's packages.
4. Read the draft under **Releases**, and publish it by hand.

The macOS app is signed and notarized when the repository has these secrets. Without them it is signed ad hoc, as on `main`, which seals the bundle but names no developer, so a reader still allows it once with **Open Anyway**:

| Secret | Holds |
|---|---|
| `APPLE_CERTIFICATE` | The Developer ID Application certificate, exported from Keychain Access as `.p12`, in base64: `openssl base64 -A -in certificate.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | The password set on that export |
| `APPLE_ID` | The Apple account that notarizes |
| `APPLE_PASSWORD` | An app-specific password for that account |
| `APPLE_TEAM_ID` | The team the certificate belongs to |

Not done yet ([hld.md](hld.md) §12, question 1):

- Windows signing. A code-signing certificate issued since June 2023 keeps its key in hardware or in a signing service, so it cannot be a secret here. Each service signs through its own command, set as `bundle.windows.signCommand`. That waits on choosing one.
- Once the repository is public: a winget manifest, and a Homebrew cask in a tap of the project's own, since homebrew/cask takes only apps that pass Gatekeeper. Each updates the app for those who install it that way.

The app has no updater, by choice ([hld.md](hld.md) §12, question 1). It makes no network request, and keeps no key. The webview's security fixes come from the OS on macOS and Windows, and from the distribution on Linux. A new release reaches readers through the release page. On GitHub, **Watch**, then **Custom**, then **Releases** says when there is one.

## How a file becomes a page

1. Rust opens the file ([`documents.rs`](../desktop/src-tauri/src/documents.rs)). It reads the bytes, records their encoding, BOM, line endings, and any NUL, and finds the scope: the enclosing git repository, or the folder when there is none or the repository is at the home folder or above it. A folder at the home folder or above holds only the files directly in it. It keeps all of that behind a handle of 128 random bits, and opens a window whose label names the handle.
2. The page asks `open_document` for the file's name and when it was last modified, and `document_text` for its text, as UTF-8 bytes. Never a path ([hld.md](hld.md) §6).
3. CodeMirror holds the text, read-only. [`src/page/`](../desktop/src/page) draws section 7's dialect as decorations over the source, inline syntax only near the viewport. The rest of the document is parsed in the background after the first paint, so a definition at the end can name a link at the top.
4. An image asks the `doc-asset` scheme for the handle and the file its destination names, so `screen%20shot.png` asks for `screen shot.png`. Rust checks that the handle is the window's own, resolves the file inside the scope, symlinks first, and serves it only if its bytes are an image ([`assets.rs`](../desktop/src-tauri/src/assets.rs)).
5. A link leaves through `open_url`, which takes `http`, `https`, and `mailto` and nothing else. A link to a file asks `open_link` for the file its destination names, decoded as an image's is. Rust finds it from the window's own document, inside the scope, and opens it in a window of its own.
6. Rust looks at the file twice a second ([`watch.rs`](../desktop/src-tauri/src/watch.rs)). When its size or time changes, it reads it again behind the same handle and tells the window down the channel the page gave `watch_document`. The page asks for the text again and changes only the lines that differ.

## File layout

| Path | Holds |
|---|---|
| `desktop/src-tauri/src/documents.rs` | Opening a file: its facts, its scope, its handle. |
| `desktop/src-tauri/src/assets.rs` | The resource channel for images. |
| `desktop/src-tauri/src/windows.rs` | Where files come from (the command line, a double-click, the dialog, a drop) and the window each gets, and where it opens on macOS. |
| `desktop/src-tauri/src/lib.rs` | The ten commands the page may call, and the app, with its menu bar on macOS. |
| `desktop/src-tauri/src/watch.rs` | Looking at each open file twice a second, and telling its window when it has new text. |
| `desktop/src-tauri/linux/hshblk.desktop` | The Linux desktop entry, which passes the double-clicked file. |
| `desktop/src-tauri/icons/` | The app icon: [`brand/app-icon/`](../brand/app-icon/), file for file. 16 and 32 px are a drawing of their own, so it is copied, never regenerated with `tauri icon`. |
| `desktop/src/main.ts` | The window: open, print, the status line, and the welcome, which names the version. |
| `desktop/src/surface.ts` | The CodeMirror surface, with editing turned off. |
| `desktop/src/page/` | The page: the dialect, its decorations, links, images, tables, the frontmatter panel, find's count, the text size, each line's direction, the whole-document parse, and the theme. |
| `desktop/scripts/` | What CI runs: the unit tests' runner, which fails when no test file matches, the licence check, and the check that a release tag names the version. |

## Tests

| Command, in `desktop/` | Checks |
|---|---|
| `npm test` | The page's decorations and keys, in Node. |
| `npm run typecheck`, `npm run lint` | The page's TypeScript, strict, and ESLint on the scripts and tests, which no type checker reads. |
| `cargo test`, in `src-tauri/` | Files, scopes, handles, and the resource channel. |
| `node test/acceptance.mjs <app>` | [hld.md](hld.md) §8, items 1, 2, 4, 5, and 6, through the built app. |
| `node test/gate/click-target.mjs <app>` | The click-target gate, §9. |
| `test/double-click.sh` | §8, item 7, on Linux, with the package installed. |
| `node test/timing.mjs <app> <file>...` | §8, item 3: first paint and whole parse, from the process's start. On Linux and on Windows, where it reads the page over WebView2's DevTools port and needs no driver. |
| `npm run licences`, and `cargo deny check` in `src-tauri/` | Every licence that ships is on §10's list. |

`<app>` is a built binary, such as `src-tauri/target/debug/hshblk` after `npx tauri build --debug --no-bundle`. The tests that drive the app run on Linux under X. They need `tauri-driver` (`cargo install tauri-driver --locked`) and WebKitWebDriver (`webkit2gtk-driver`). Print also needs `xdotool` and `pdftotext`, and the double-click needs `gio` and a D-Bus session. CI runs them all under Xvfb, each in a D-Bus session of its own: [`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml). The runner's own bus has a portal that cannot start, so a launch on it takes 30 seconds (see above).

A debug build writes each request the resource channel answers, served or refused, as a line in the file `HSHBLK_ASSET_LOG` names. WebKitGTK's resource timing does not see the app's own schemes, so the acceptance test sets it and reads it for item 2. A release build has no log.

The last run of each is recorded in [milestone-one.md](milestone-one.md) and [gates/](gates/).

# The desktop app

Hash Block as a program of its own. Double-click a markdown file and it opens in a window, as a page, not in a browser. This is milestone one of [hld.md](hld.md): it reads, and nothing in it can write.

## Installing

Each system gets one zip, named for it, such as `hash-block-0.1.0-windows-x64.zip`. It holds the app and a README that says how to install it, from [`desktop/packaging/`](../desktop/packaging/). Each release has the three under **Releases**, 0.1.0 the first. Between releases the Desktop workflow makes the same zips on every push to `main`: open the latest run on `main` under **Actions**, **Desktop**, and download the one for your system. Each is kept for 14 days.

| System | In the zip |
|---|---|
| Linux, x64 | `hash-block.deb`, `hash-block.rpm`, and `hshblk`, the app alone |
| macOS 11 or later, Apple silicon | `Hash Block.app` |
| Windows 10 or 11, x64 | `Hash Block setup.exe`, and `Hash Block.exe`, the app with nothing to install |

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
| `Ctrl+Shift+O` (`⌘⇧O`) | Show or hide the outline of the headings, and go to one |
| `F1`, `Ctrl+?` (`F1`, `⌘?`) | Show or hide this list of keys |
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
- On macOS, the menu bar's File menu has Open, with ⌘O, above Tauri's own items, and Print, with ⌘P, below them. Edit keeps Tauri's Copy and Select All, and ends with Find, with ⌘F. Linux and Windows have no menu bar, which would sit above the page in every window. `F1` lists the keys in a panel below the page on every system, and the welcome window lists them under its button.
- A new window opens at the size of the window last moved or resized. On macOS and Windows it steps down and right of the one in front, and the first of a launch opens where the last one was left. The welcome window lists the files opened last, each a click away, and so does File > Open Recent on macOS, whose Clear Menu empties both. On Windows each file opened joins the shell's recent documents, so the taskbar's jump list for Hash Block shows it. On Linux it joins GTK's recent files, which a file manager's Recent and the Open dialog list. A debug build leaves both lists alone. That size and place, and those files, are kept in the app's data folder, never beside a file.
- Move the caret into a construct with the keys, or find in it, and its syntax shows, so `**bold**` reads as written. A click places the caret and opens nothing, so the text holds still under the pointer. A link never unfolds: its address shows in a popover under it, with **Open** for web and mail addresses and for files in the repository, which open in a window of their own. A link that cannot open says why in its popover, and in the status line after `Ctrl` or `⌘` and a click. After following a link to a heading, `Alt+Left` (`⌘[`) goes back to where it was followed from. Print shows a web or mail link's address after its words. A find match in the address shows there, marked.
- `Ctrl+Shift+O`, or Outline in the status line, opens an outline of the headings above the page, the one in view marked. A click or Enter goes to one, and `Alt+Left` comes back. To a screen reader, a heading is a heading of its level and a link is a link; the outline lists every heading, where the page holds only those near the window.
- Copy and find work on the source, hidden syntax included. The status line says so, after the file's name and when it was last modified. The find box says how many matches there are and which one is current, and marks that one apart from the rest. In a file over a million characters it counts between events, and says "Counting" until it is done.
- Keyboard focus on the app's own buttons and fields shows as a ring in the accent colour.
- The page has no right-click menu, and `F5` and `Ctrl+R` do nothing. A window takes its file's new text by itself when the file changes on disk, within a second, with the caret and the scroll where they were. A file that is moved or deleted says so in the status line, and the page keeps what it showed. The find box's fields keep their menu, for paste.
- The text size the keys set is the window's, until it closes. Print is at the page's own size.
- Images load when they are inside the document's repository: the enclosing git repository, or the file's folder when there is none. An image embedded in the file as a `data:` address shows too, as Typora and Obsidian write them, when it is a type the app shows and 20 MB or less. One that does not show is a chip of its words that says why: not found, outside the repository, larger than 20 MB, not an image the app shows, or remote. A repository at the home folder or above it does not count, so dotfiles kept in `~/.git` do not open the whole home. A file directly in the home folder shows only the images beside it, not those in folders below. A path that starts with `/` starts at that root, as on GitHub. Nothing loads from the network.
- Inline HTML that GitHub draws in a README draws here too: bold, italic, code, keys, sub, sup, mark, a line break, an image at the size it gives, and a link. Any other inline tag shows as written.
- A raw HTML block is drawn in a frame that runs no script. Its images load from inside the repository, as a markdown image does, and it fetches nothing else. A click on a link in it shows its address, and Ctrl or ⌘ and a click opens it, as on the page. A click on a summary opens its details, and print shows every block with its details open. It draws a table, a heading, and a summary as the page does, an image that cannot load as a chip of its words, and a frame inside it not at all. Nothing in it takes the keyboard or typing. Its text cannot be selected: copy works on the source. Inline HTML shows as source, but for a comment, which folds away. No script in a document runs.
- YAML frontmatter at the top of a file folds away, not drawn as a rule and a heading. A `---` on the first line with a blank line after it is a rule, not frontmatter. The status line says it is there, with a pulse when it first shows. A click on it, or `Ctrl+Shift+M`, opens a panel that lists its fields, with the raw YAML a click away. YAML the panel cannot list shows raw. The caret starts after it, so the first key leaves it folded. The keys and find show its source where they reach it, as a quiet monospace block. TOML frontmatter between `+++` lines folds away the same way, and its panel shows it as written.
- A task list item shows its box, ticked as the file has it, where a bullet's marker was. A numbered item keeps its number. A click on it, or Enter with the caret in its text, ticks or unticks it on the page, never in the file.
- Footnotes draw as GitHub draws them: a reference as its number, raised, which Ctrl or ⌘ and a click follows to its footnote, and each footnote numbered where it is written, with `↩` back. Emoji shortcodes, such as `:tada:`, show their emoji. Markdown in a `<div align="center">` is centred.
- A fenced code block that names its language, such as ```` ```ts ````, has its tokens coloured: JavaScript and TypeScript, Python, Rust, JSON, shell, and diff. Each language loads the first time a block names it. A block's fences fold away until the keys reach one, and its language is a quiet label at its top right. A fenced block of `mermaid` draws its diagram, light or dark as the page is. A bare web or mail address, `https://…`, `www.…`, or `me@…`, is a link, as on GitHub. Maths draws as GitHub draws it, by KaTeX: `$x^2$` in a line, `$$...$$` and a fenced block of `math` as blocks, while `$5 and $10` stay prices.
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

1. Set the version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `package.json`. In [CHANGELOG.md](../CHANGELOG.md), put the version and the day, such as `## 0.2.0 (2026-11-02)`, under **Unreleased**, so the lines that were there become the release's. From then on a new line goes at the end of **Unreleased**, not of the file. Merge that to `main`.
2. Run the Desktop workflow on `main` by hand: **Actions**, **Desktop**, **Run workflow**, or `gh workflow run Desktop --ref main`. Every job runs, and from a branch **Draft release** is a dry run for the tag the version takes. It writes nothing. Its summary says what a run on the tag would do to the tag's drafts, and shows the notes the draft would start with, GitHub's list of merged pull requests included (#372).
3. Tag the merge and push the tag: `git tag v0.2.0 && git push origin v0.2.0`.
4. The Desktop workflow checks that the tag names the version in all three, runs every test, builds and zips the app on each system, and puts the three zips in a draft release. Its notes start with a table of which zip is for which system, above the merged pull requests, Dependabot's under a heading of their own. A zip that names no system or another version, or a system with no zip, stops the run before any draft is touched. A second run on the same tag deletes the draft and makes it again, so it holds only that run's zips and notes. An edit to the draft by hand goes with it. On the tag of a release already published, the run stops, says so, and changes nothing (#367). GitHub adds the two **Source code** files to every release, and the notes say the app is not in them.
5. Read the draft under **Releases**, and publish it by hand.

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
- A winget manifest, and a Homebrew cask in a tap of the project's own, since homebrew/cask takes only apps that pass Gatekeeper. Each would update the app for those who install it that way (#365).

The app has no updater, by choice ([hld.md](hld.md) §12, question 1). It makes no network request, and keeps no key. The webview's security fixes come from the OS on macOS and Windows, and from the distribution on Linux. A new release reaches readers through the release page. On GitHub, **Watch**, then **Custom**, then **Releases** says when there is one.

## Keeping dependencies current

Dependabot ([`.github/dependabot.yml`](../.github/dependabot.yml)) opens pull requests for the app's npm packages, its crates, and the workflows' actions, each Monday at 06:00, Sydney time. Each runs the Desktop workflow like any other pull request, so one can merge only once the four checks `main` requires pass, the licence check among them.

| Pull request | Holds |
|---|---|
| `tauri` | Tauri's own packages: `@tauri-apps/*` under npm, and `tauri` and `tauri-*` under cargo |
| `minor-and-patch` | Every other minor and patch update, one pull request for npm and one for cargo |
| A major | That one package, since a major can change what the code calls |
| `actions` | Every action the workflows use, moved to a new commit, with its version in the comment beside it |
| `security` | Every update an advisory asks for, one pull request for each ecosystem, as soon as the advisory is out |

- A release waits seven days before it is offered, and a major fourteen, so one that is pulled or patched in its first days never arrives. A security update does not wait.
- Tauri's crate and `@tauri-apps/api` must share a minor version, or `tauri build` refuses them. The two `tauri` pull requests come on the same morning. When they move a minor version, merge one's branch into the other, so one pull request carries both, and close the first.
- `@types/node` stays on the major of the Node the app runs on, 24, from `.nvmrc`.
- `mermaid` stays on 11: 12 takes elkjs, under EPL-2.0, which is not on [hld.md](hld.md) §10's list, so its majors are ignored. Mermaid 11 asks for KaTeX 0.16, which has [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7), so an `overrides` entry in `package.json` gives it the page's KaTeX.
- The identity's build tools in `brand/source/` get security updates only. `verify.py` compares every asset with the pack byte for byte, so a new fonttools, HarfBuzz, or resvg is taken by hand, with the pack rebuilt.
- Dependabot's pull requests write no line in [CHANGELOG.md](../CHANGELOG.md). A draft release's notes list them under **Dependencies**, apart from the rest ([`.github/release.yml`](../.github/release.yml)).
- `prettier` is pinned to one version, since a new one can lay the same code out differently. A bump that does fails `npm run lint`, so `npm run format` on its branch brings the files in line, in the same pull request.
- `cargo deny check` ignores three advisories that mark zbus 5's `zvariant`, `zbus_names`, and `zvariant_derive` unmaintained. Their code moved into zbus 6, and `tauri-plugin-single-instance`, which takes zbus on Linux, still asks for zbus 5. Each ignore in `deny.toml` gives its reason, and they come out when the plugin moves.
- An alert waits when its fix needs what Tauri has not taken. glib 0.18's, [GHSA-wrw7-89jp-8q8g](https://github.com/advisories/GHSA-wrw7-89jp-8q8g), is one: the fix is in glib 0.20. GTK 3's bindings, which Tauri 2 draws with on Linux, took glib 0.22 in gtk 0.19, but Tauri, wry, tao, muda, and webkit2gtk still ask for gtk 0.18 ([wry#1841](https://github.com/tauri-apps/wry/pull/1841), [tao#1331](https://github.com/tauri-apps/tao/pull/1331)). The alert is dismissed as code not used. The unsound iterator is reached only through glib's `Variant::array_iter_str`, and nothing that ships calls it, the app's own code included. While `Cargo.lock` holds glib 0.18, a Tauri update gets the same look, after `cargo fetch` in `desktop/src-tauri`. From the repository's root, this prints nothing while it holds:

  ```bash
  grep -rl --include=*.rs -e array_iter_str -e VariantStrIter desktop/src-tauri/src ~/.cargo/registry/src/*/ | grep -v /glib-0
  ```

## How a file becomes a page

1. Rust opens the file ([`documents.rs`](../desktop/src-tauri/src/documents.rs)). It reads the bytes, records their encoding, BOM, line endings, and any NUL, and finds the scope: the enclosing git repository, or the folder when there is none or the repository is at the home folder or above it. A folder at the home folder or above holds only the files directly in it. It keeps all of that behind a handle of 128 random bits, and opens a window whose label names the handle.
2. The page asks `open_document` for the file's name and when it was last modified, and `document_text` for its text, as UTF-8 bytes. Never a path ([hld.md](hld.md) §6).
3. CodeMirror holds the text, read-only. [`src/page/`](../desktop/src/page) draws section 7's dialect as decorations over the source, inline syntax only near the viewport. The rest of the document is parsed in the background after the first paint, so a definition at the end can name a link at the top.
4. An image asks the `doc-asset` scheme for the handle and the file its destination names, so `screen%20shot.png` asks for `screen shot.png`. Rust checks that the handle is the window's own, resolves the file inside the scope, symlinks first, and serves it only if its bytes are an image ([`assets.rs`](../desktop/src-tauri/src/assets.rs)). One that does not show asks `image_refusal` why, which reads no more of the file than its type takes to tell. An image embedded as a `data:` address asks for nothing: the page shows it when its type is one the channel serves and it holds no more than 20 MB.
5. A link leaves through `open_url`, which takes `http`, `https`, and `mailto` and nothing else. A link to a file asks `open_link` for the file its destination names, decoded as an image's is. Rust finds it from the window's own document, inside the scope, and opens it in a window of its own. A fragment goes beside it, and that window goes to the heading or anchor it names, through the channel its page gave `watch_fragments`.
6. Rust looks at the file twice a second ([`watch.rs`](../desktop/src-tauri/src/watch.rs)). When its size or time changes, it reads it again behind the same handle and tells the window down the channel the page gave `watch_document`. A time kept only to the second, as FAT and HFS+ keep it, can hide a save of the same length, so while such a time is under three seconds old it reads the file each look and tells the window only when the text differs. The page asks for the text again and changes only the lines that differ.
7. A mermaid block's source goes to a hidden frame of its own ([`diagrams.ts`](../desktop/src/page/diagrams.ts)), sandboxed with scripts but no origin, where mermaid draws it, and comes back as an SVG, which the page shows as an image.

## File layout

| Path | Holds |
|---|---|
| `desktop/src-tauri/src/documents.rs` | Opening a file: its facts, its scope, its handle. |
| `desktop/src-tauri/src/assets.rs` | The resource channel for images. |
| `desktop/src-tauri/src/windows.rs` | Where files come from (the command line, a double-click, the dialog, a drop) and the window each gets, and where it opens on macOS. Each file opened joins the recent files, and on Windows and Linux the system's own list. |
| `desktop/src-tauri/src/lib.rs` | The fourteen commands the page may call, and the app, with its menu bar on macOS and File > Open Recent there. |
| `desktop/src-tauri/src/memory.rs` | What the app keeps between runs in its own data folder: the last window's size and place, and the files opened last. |
| `desktop/src-tauri/src/watch.rs` | Looking at each open file twice a second, and telling its window when it has new text. |
| `desktop/src-tauri/src/window_state.rs` | What Rust keeps for each window in one place: its menu bar line, a place a link sends it to, its file's watch, and the welcome window's line for the recent files. A window that closes takes it all. |
| `desktop/src-tauri/linux/hshblk.desktop` | The Linux desktop entry, which passes the double-clicked file. |
| `desktop/src-tauri/icons/` | The app icon: [`brand/app-icon/`](../brand/app-icon/), file for file. 16 and 32 px are a drawing of their own, so it is copied, never regenerated with `tauri icon`. |
| `desktop/src/main.ts` | The window: open, print, the status line, and the welcome, which names the version. |
| `desktop/src/surface.ts` | The CodeMirror surface, with editing turned off. |
| `desktop/src/keys.ts` | The keys, read from the README's key table, for the panel `F1` opens and the welcome window. |
| `desktop/src/page/` | The page: the dialect, its decorations, links, images, tables, footnotes, emoji, code highlighting, the frontmatter panel, the outline, find's count, the text size, each line's direction, the whole-document parse, the theme, maths, and the frame mermaid draws diagrams in. |
| `desktop/src/build/` | What the build and the dev server do to the diagram frame's bundle, so its dependencies load where `Object.prototype` is frozen. |
| `desktop/test/` | The tests that drive the built app: acceptance, the gates, the double-click, WebView2's cases, timing, and the README's screenshot over DevTools through `devtools.mjs`, and in `docker/` the image that runs the Linux suites from any machine. |
| `desktop/scripts/` | What CI runs: the unit tests' runner, which fails when no test file matches, the licence check, and the release job's three: the check that a tag names the version, the notes, and the step that deletes a tag's drafts before the job makes it again, or stops it on a published release, with a dry run that says what it would do. |
| `desktop/packaging/` | The README each system's zip carries, with `@VERSION@` for the version. |

## Tests

| Command, in `desktop/` | Checks |
|---|---|
| `npm test` | The page's decorations and keys, the rewrite the diagram frame's bundle takes, and the release job's notes and what it does with a tag's drafts, in Node. |
| `npm run typecheck`, `npm run lint` | The page's TypeScript, strict, and ESLint on the scripts and tests, which no type checker reads. `npm run lint` also checks the formatting with prettier, pinned in `package.json`, and `npm run format` applies it. |
| `cargo test`, in `src-tauri/` | Files, scopes, handles, the resource channel, what the app keeps between runs, the watch on each file, and each window's state. |
| `node test/acceptance.mjs <app>` | [hld.md](hld.md) §8, items 1, 2, 4, 5, and 6, through the built app. |
| `node test/gate/click-target.mjs <app>` | The click-target gate, §9. |
| `test/double-click.sh` | §8, item 7, on Linux, with the package installed. |
| `node test/webview2.mjs <app>` | On Windows, what only WebView2 shows: F5 and Ctrl+R leave the page be, a right-click opens no menu, print leaves the engine's header and footer no room, and a contrast theme keeps the page's rules. Also a mermaid diagram: it draws, it draws again when the system switches between light and dark, and Rust answers no command from its frame or from a raw HTML block's frame. Also a link to a heading in another file, which takes two windows: it opens that file's window at the heading, brings it forward to go there again, and says there what the file does not have. It reads each window's page over WebView2's DevTools port, through `test/devtools.mjs`, and needs no driver. WebView2 runs with a profile of its own in a temporary folder and takes any free port, which it writes there. Run elevated, as on CI, WebView2 150 and later takes no browser arguments from the environment, so the workflow sets `--remote-debugging-port=0` for `hshblk.exe` under `HKLM\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments`. It presses keys as Windows delivers them, posted to the app's own window by `test/keys.ps1`, since the protocol's keys never reach WebView2's shortcuts. WebView2 drops a key posted while the page has no focus, as when someone at the PC is in another app, so the page gets focus over DevTools first, which leaves the window behind whatever is in front. A debug build runs beside an installed Hash Block, apart from it. A release build is Hash Block itself, so close it first, or it takes the file. A launch that fails prints what the app and WebView2 were doing, from `test/webview2-state.ps1`, and on CI keeps a picture of the screen. |
| `node test/timing.mjs <app> <file>...` | §8, item 3: first paint and whole parse, from the process's start. On Linux and on Windows, where it reads the page over WebView2's DevTools port and needs no driver. There it launches the app through `test/devtools.mjs`, as `test/webview2.mjs` does, with one WebView2 profile of its own for all its runs. A launch before them, which the table leaves out, makes the profile and takes the slow first start that Windows gives a build just made. |
| `node test/screenshot.mjs <app>` | On Windows, not a test: the README's screenshot, light and dark, in `docs/images/`, of `test/screenshot/moving-day.md`. Run it on a debug build, so the sample joins no installed reader's recent files, and again when the page's look changes. |
| `npm run licences`, and `cargo deny check` in `src-tauri/` | Every licence that ships is on §10's list. `cargo deny check` also fails on an advisory anywhere in the crates it builds, tests' aside, an unsound one included, unless `deny.toml` ignores it with its reason. |

`<app>` is a built binary, such as `src-tauri/target/debug/hshblk` after `npx tauri build --debug --no-bundle`. A debug build runs as `dev.hshblk.reader.debug`, not as the installed reader, so it has a data folder, a WebView2 profile, and a single-instance key of its own, and a test's files never join the reader's recent files. The tests that drive the app run on Linux under X, but for `test/webview2.mjs`, which CI runs on a Windows runner. They need `tauri-driver` (`cargo install tauri-driver --locked`) and WebKitWebDriver (`webkit2gtk-driver`). Print also needs `xdotool` and `pdftotext`, and the double-click needs `gio` and a D-Bus session. CI runs them all under Xvfb, each in a D-Bus session of its own: [`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml). The runner's own bus has a portal that cannot start, so a launch on it takes 30 seconds (see above).

WebView2 at times sends a sandboxed frame's requests to the network rather than to Tauri, where nothing answers, so the diagram frame asks for nothing: the page writes its script into it (#351). DevTools holds no frame: one of another origin is a target of its own, which `frames()` in `test/devtools.mjs` lists, and the WebView2 suite says what each logged when a diagram is not drawn.

A debug build writes each request the resource channel answers, served or refused, as a line in the file `HSHBLK_ASSET_LOG` names. WebKitGTK's resource timing does not see the app's own schemes, so the acceptance test sets it and reads it for item 2. A release build has no log.

### The Linux suites in Docker

On Windows or a Mac, Docker runs the three Linux suites as the workflow's acceptance job does, on Ubuntu 24.04 with its packages, from [`desktop/test/docker/Dockerfile`](../desktop/test/docker/Dockerfile). From the repository's root, in PowerShell:

```powershell
docker build -t hshblk-linux desktop/test/docker
docker run --rm -v "${PWD}:/src:ro" -v hshblk-cargo-registry:/usr/local/cargo/registry -v hshblk-target:/build-target hshblk-linux
```

In a Mac's shell, the checkout is `"$PWD:/src:ro"`. The image takes Node and Rust built for the machine Docker runs on, x86-64 or ARM64, so Apple silicon runs it natively, with no `--platform`.

[`suites.sh`](../desktop/test/docker/suites.sh) clones what the checkout has committed into the container, since a build on a Windows bind mount is slow, so commit first. It builds the `.deb` into the `hshblk-target` volume, installs it, and runs `test/acceptance.mjs`, `test/gate/click-target.mjs`, and `test/double-click.sh` as `reader`, who has no password, each under Xvfb in a D-Bus session of its own. It stops at the first that fails. The two volumes keep the cargo registry and the build, so a later run builds only what changed.

The last run of each is recorded in [milestone-one.md](milestone-one.md) and [gates/](gates/).

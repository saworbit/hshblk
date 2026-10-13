# HLD: Local Markdown viewer, editor later

Status: revision 3, after a second review. Not signed off.
Date: 2026-10-09
Amended: 2026-10-09, double-click opening (sections 6 and 8). 2026-10-10, the click-target gate's result and the link popover (sections 7 and 9), the corpus survey (sections 9 and 12), and milestone one's acceptance run (section 8). 2026-10-10, how an image's destination names its file, and find in a link's address (section 7).
Audience: reviewers who were not in the design thread. Attack the remaining claims.

Revision 3 exists because revision 2's line-ending rule broke on an ordinary paste, its save gate bought no fidelity that encoding the string does not already give, its no-path rule broke on Tauri's defaults, its IPC list left out commands the rest of the document relied on, and its licence rule failed on Tauri's own dependencies.

## 1. Purpose

A free, open-source desktop tool that opens a `.md` file and shows a typeset page, and that can later become an editor without throwing the viewer away.

The end-state comparison is Typora: in-place rendering, plain files, Windows / macOS / Linux, no account. Typora is proprietary and paid. This tool's own code is MIT or Apache-2.0. Linked libraries follow the licence rule in section 10, which is not "MIT only."

Milestone one is the editor surface with editing commands disabled. It is not an HTML dump. It is also not, by itself, proof of a Typora-quality editing feel.

What binds milestone one:

| Part | Binds |
|---|---|
| Sections 2, 3, 7, 8, 9, 10 | Milestone one |
| Section 4 and section 6, open side | Milestone one |
| Section 4 and section 6, save side; section 5 | The editor milestone. Designed now so milestone one does not close them off. |

The browser reader that came first rendered HTML, so it could not meet section 8. It is retired. Its display fixtures that apply to the desktop app moved to the page's tests.

## 2. Non-goals

- A knowledge base, vault, graph, or plugin host.
- An account, sync, or collaboration.
- A browser product. A later tab on the same surface is allowed and is not designed here.
- Mobile.
- Matching Typora's caret in milestone one.
- An independent proof of human intent at save time. The save gate checks consistency, not motive.
- Protection against a compromised renderer.

## 3. Decisions

| Decision | Choice | Why |
|---|---|---|
| Host | Tauri 2, provisional | The reason is who patches the engine. A system webview gets Chromium and WebKit fixes from the OS. Electron stays vulnerable until this maintainer ships. Electron is the escape if the maintainer will commit to security releases within days of a renderer zero-day, for years. Size is not the reason. |
| Document | Facts about the bytes, plus a UTF-8 working string | The string is not the file. Encoding, BOM, EOL, mode, ownership, and link count are facts about the bytes. |
| Surface | CodeMirror 6, Lezer markdown | Source is the buffer. Decorations are a view. This is a fidelity strategy. It is not yet evidence of a Typora-grade feel. |
| Viewer | Same document authority, editing commands off | Shared authority matters. Preserving one view instance does not. |
| Authority | One source of truth: the bytes | A second read-only interpreter is allowed if it cannot write. Parser count is not the invariant. |
| Save | Encode the string with the recorded BOM and separator | On every file section 5 lets you save, that reproduces the bytes exactly. See section 5. |
| Rust role | Save gate and path policy | Checks, encodes, and writes. Does not parse Markdown. |
| Sanitize | Render policy only | Stripping HTML on save destroys READMEs. |
| Tables, v1 | Unfold to source when the keys or find enter them | Nested cell editors are a later design, not an accident. |

Rejected:

- Milkdown / ProseMirror-as-authority. Documented rewrites. Block-level source preservation still fails this contract: a one-cell edit must not reformat the table.
- Tiptap as a licence disqualifier. The core is MIT. Rejected for the serializer, not the paid tier.
- `pulldown-cmark` anywhere in the shipped binary. A test-time verifier at most.
- A ChangeSet applied to the original bytes at save. Revision 2's gate. It is the route if mixed line endings prove common, and section 5 says why it is not the default.
- Forking MarkText. Upstream is active. Do not fork, because its editor is the component being replaced.
- Pure Rust UI and from-scratch C++. No shipped native toolkit has document-grade caret, bidi, and IME on three platforms at a solo-developer cost.
- Qt as a second stack. Real document widget, still reserializes.

Known risk, not a rejection: CodeMirror, Lezer, and ProseMirror share one primary maintainer. The lang-markdown repository was archived on 15 April 2026 and now points at the maintainer's forge. Pin source location at lock time. "Framework you do not control" applies here too.

## 4. Architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Tauri 2 (Rust)                                       trust boundary │
│                                                                     │
│  argv, pick, drop                                                   │
│        │                                                            │
│        ▼                                                            │
│  path resolver ── scope root, symlinks resolved                     │
│        │                                                            │
│        ▼                                                            │
│  read bytes ───── hash, encoding, BOM, EOL, mode, owner, links      │
│        │                                                            │
│        ▼                                                            │
│  mint handle                                                        │
│        │                                                            │
│        │ IPC: handle + working string                               │
│        ▼                                                            │
│  ┌───────────────────────────────────────────────────┐              │
│  │ system webview                                    │              │
│  │                                                   │              │
│  │ CodeMirror 6                                      │              │
│  │   document = working string                       │              │
│  │   parser   = Lezer markdown                       │              │
│  │   view     = decorations over source ranges       │              │
│  │   input    = line breaks to recorded separator    │              │
│  │                                                   │              │
│  │ presentation layer (ours, not Lezer):             │              │
│  │   dialect, references, a rule per construct       │              │
│  └───────────────────────────────────────────────────┘              │
│        │                                                            │
│        │ IPC: handle + string                (editor milestone)     │
│        ▼                                                            │
│  save gate: disk hash still matches the handle                      │
│             string uses only the recorded separator                 │
│             encode UTF-8, add the recorded BOM                      │
│             atomic replace, by the rules in section 5               │
│             handle advances to the bytes written                    │
│             conflict if disk changed: do not overwrite              │
│                                                                     │
│  recovery store: app data directory, never beside the file          │
│                                                                     │
│  resource channel: doc-asset scheme, keyed by handle                │
│                    inside the scope root, no path from the webview  │
│                                                                     │
│  render policy: CSP in section 6, navigation denied                 │
│                 HTML blocks in a sandboxed frame, inline as source  │
└─────────────────────────────────────────────────────────────────────┘
```

Rules:

- The webview never receives a path. Rust mints an opaque handle at launch, from its own file dialog, from a dropped file, and at link resolution. The handle carries the resolved path and the facts recorded at read.
- Tauri hands paths to the webview by default in three places. Section 6 replaces each one.
- Rust never interprets Markdown.
- Rendered HTML is never the source of a save.
- A read of a sibling image is not permission to write any sibling.
- After a successful save, the handle describes the bytes just written.

## 5. Fidelity and encoding contract

CodeMirror does not provide no-op identity by default. It splits on LF, CRLF, and CR, and joins with LF unless configured. A configured separator is then the only one recognised, in pasted text as well. Positions are UTF-16 code units, and every line break counts as one position, whatever its bytes. The contract has to say what is preserved, because the editor will not.

| Fact | Rule |
|---|---|
| Valid UTF-8 | Working string is the Unicode scalar values of those bytes. |
| BOM | Preserved. Not part of the working string. |
| Invalid UTF-8, UTF-16 | Open read-only. Save disabled. No lossless path into a JS string. |
| NUL bytes | Open read-only. UTF-16 without a BOM can pass as valid UTF-8, and NUL is how it shows. |
| Uniform LF or CRLF | Preserved by recording the separator and configuring CodeMirror to it. |
| Pasted, dropped, or composed text | Line breaks become the recorded separator before the transaction applies: a `clipboardInputFilter` for paste, a transaction filter for drop and IME. Without it, a Mac clipboard pasted into a CRLF file writes a bare LF, and the file opens read-only next time. |
| Mixed or lone CR | Open read-only until an explicit "normalize line endings" command. Silent repair is a failed no-op. |
| Untouched bytes | Identical, because on every file this table lets you save, encoding the string reproduces the bytes it was decoded from. |
| User edit | A transaction annotated as user input, a formatting command, list continuation we wrote, or paste. Stock CodeMirror Markdown keymap is out of contract: its Enter and Backspace rewrite lines the user did not touch. Those commands are replaced before typing is enabled. |
| External change | Disk hash differs from the handle. Save refuses. The user chooses reload or save-as. Overwrite is not the default. |
| Normalization | Explicit command with a diff preview. Never the default. |

### Save

The webview sends the handle and the whole string. Rust:

1. Refuses if the disk hash no longer matches the handle.
2. Refuses if the string holds a line break other than the recorded separator. This catches a missed input filter.
3. Encodes UTF-8 and prepends the recorded BOM. A lone surrogate never reaches this step: it cannot deserialize into a Rust string, so the save refuses at the IPC boundary.
4. Replaces the file by the rules below.
5. Advances the handle to the hash of the bytes written.

Why not revision 2's ChangeSet applied to the original bytes: on every file this contract lets you save, it produces exactly these bytes. It cannot catch a command that rewrites lines, because CodeMirror records that rewrite in the ChangeSet too. It costs a mapping from UTF-16 positions, with every line break as one, onto byte offsets. It pays for itself only on mixed-ending files, where each untouched line could keep its own ending. If the corpus in section 9 finds those common, that is the route, and this section is rewritten for it.

ChangeSets still matter as evidence. The section 9 corpus test asserts on them. They are not save input.

### Atomic replace

| Condition | Rule |
|---|---|
| Normal | Write a temporary file in the target's directory, fsync, rename over the target, fsync the directory. A symlinked path writes through to its resolved target. |
| Directory not writable | Refuse. Offer save-as. The temporary file has nowhere to go. |
| More than one hard link | Write in place, after the original bytes are in the recovery store. A rename would split the links. |
| Ownership cannot be kept | Refuse. Offer save-as. A save does not change who owns the file. |
| Extended attributes and ACLs | Copied to the new file. A copy that fails refuses the save. |

"Refuse the save" never means discard the buffer. It means do not write, keep the buffer in the recovery store, and say why.

The recovery store is the application's own data directory, keyed by handle, never beside the file. It is written when a save refuses, and on a timer while the buffer has unsaved edits. It is cleared by a successful save or an explicit discard. Milestone one has no edits and no recovery store.

## 6. Trust boundary

Entry points. Each mints a handle in Rust:

- Launch. `app file.md` mints a handle before the webview loads.
- Double-click. The installer registers the app for `.md` and `.markdown`. Windows and Linux start it with the file on its command line, as launch does. macOS starts it, or finds it running, and sends an open-file event, which Rust receives as `RunEvent::Opened` and turns into a handle.
- `pick() -> handle`. Rust runs the native dialog. The dialog plugin's JavaScript `open()` is not used, because it returns a path to the webview.
- Drop. Rust handles the window's drag-drop event and emits a handle. Tauri's frontend drag-drop event carries `paths: string[]`, so it is turned off.

A second file, by double-click or by `app file.md`, goes to the app that is already running and opens in a new window there. One process holds every handle.

IPC, milestone one:

- `open(handle) -> { name, read_only_reason }` after the resolver accepts the path, and `document_text(handle) -> bytes`, the string as UTF-8. A long text crosses faster as bytes than as a JSON string (§8, item 3).
- `read_asset`, served as a custom scheme: `doc-asset://<handle>/<relative>`. Not Tauri's asset protocol, which is addressed by path (`convertFileSrc(filePath)`). A window is served only its own document's images: the handle must be the one its label names.
- `open_url(url)`. `http`, `https`, and `mailto` only, opened in the system browser. A click on a link never navigates the webview.

IPC, editor milestone:

- `save(handle, string) -> result`, by section 5.
- `save_as(handle, string) -> handle`. Rust runs the dialog, writes with the source handle's recorded BOM and separator, and mints a new handle.
- `reload(handle) -> { handle, string }`. Re-reads and re-records. A buffer with edits goes to the recovery store first.
- `resolve_link(handle, relative) -> handle`, for links to other `.md` files, under the asset scope rule.

No general filesystem command. No path argument from the webview. The capability file grants no default plugin: not dialog, fs, shell, or opener.

Asset and link scope:

- The scope root is the enclosing git repository, found by walking up from the document to a `.git` entry. With no repository, it is the document directory. A `.git` at the user's home directory or above it does not count, so with dotfiles kept in `~/.git`, a loose file's scope is still its own folder. When that folder is the home directory or above it, the scope is flat: only the files directly in it, not its folders, so a file saved straight into `~` cannot show all of the home.
- The target, with symlinks and junctions resolved, must sit under the scope root, or directly in it when the scope is flat. `../` is allowed inside it. A reference with one leading `/` starts at the scope root, as GitHub reads it in a repository. It never names the filesystem's root, and two leading slashes name a host, which is remote.
- Assets are regular files of an image type by magic bytes (PNG, JPEG, GIF, WebP, AVIF; SVG by content), at most 20 MB. That excludes devices, FIFOs, and `/dev/zero`.
- Reading outside the document's folder gives an attacker nothing under this threat model. No script runs and nothing leaves the machine, and a hostile image would ship inside the repository anyway.

Network shares. The leak is a fetch the document triggers, which sends credentials to a share. The scope rule already stops it: a target outside the scope root is refused, and a symlink or junction that resolves to another server is outside it. A file the user opens from a share, by dialog, drop, or argv, is allowed, and so are its siblings on that share. Mounted shares on macOS and Linux look like local paths, and the same rule covers them.

CSP:

- `default-src 'none'`.
- `script-src`: the bundle, by hash. No inline script, no eval.
- `style-src`: the bundle, plus one nonce. CodeMirror always injects a `<style>` element into a document, so the nonce goes to `EditorView.cspNonce`.
- `img-src`: `doc-asset:` and the `http://doc-asset.localhost` form Tauri serves custom schemes as on Windows.
- `font-src`: the bundle.
- `connect-src`: Tauri IPC only, `ipc:` and `http://ipc.localhost`.
- `frame-src 'none'`. A raw HTML block's frame is a `srcdoc` document, which loads no URL, so `'none'` still keeps every frame from loading or navigating to one.
- Navigation: the webview's navigation handler denies every origin but the app's own, and `about:srcdoc`, the document of a raw HTML block's frame.

Document-supplied script never runs. "Script blocked" was wrong, because CodeMirror is script.

Raw HTML is never parsed into the editor document. A raw HTML block is drawn from its source in a sandboxed frame. The frame runs no script: its sandbox has no `allow-scripts`, and its own policy refuses script too. It shares the page's origin, so the page can size it to what it holds. With no script in it, nothing in it can use that origin. The page takes the pointer over the frame, since WebKit runs no listener in a frame without `allow-scripts`, the page's own included. It reads what is under the pointer from the frame's document: a click on a link there shows its address and a Ctrl or ⌘ click follows it, as for a link on the page, and a click on a `<summary>` opens or closes its `<details>`. The frame's text cannot be selected. Copy works on the source. Its policy is `default-src 'none'`, with `img-src` the resource channel, as the page's own policy has it. Before the frame is drawn, the page reads the HTML with `DOMParser`, which loads and runs nothing, and points each `<img src>` that names a file in the repository at the channel, which checks it as it checks a markdown image. Any other `src` is dropped, and so is every other place an image can be named: a `srcset`, a `poster`, a `background`, and an `href` on anything but a link, such as an SVG `<image>`'s. So the frame asks the channel only for what the page named. A README's centred logo shows; a remote image, one outside the repository, and an image named in CSS do not. It fetches nothing else the HTML names, stylesheets included, and it takes no style from the HTML. It loads only the page's own fonts, from the app. Inline HTML is shown as source. Each block is a frame of its own, with one exception. A `<details>` whose opening tag and summary are a block of their own, and whose closing tag is another in the same container, with markdown between, is drawn by the page, not in frames. It shows its summary's words, and a click on them, or Enter with the caret on its tags, opens or closes it. While it is closed, its body's lines fold, unless a find match or the keys are in them. `<details open>` starts open, and print opens every one.

Remote images: milestone one does not load them, and `img-src` enforces it. That is provisional. Changing the default waits on a measured broken-README rate. A user-authorised exception is a later trust-boundary change, not a silent relaxation.

Threat model, bounded: a local file from a clone, download, or paste must not execute script, must not fetch remote resources, and must not reach a native API beyond the calls above. Image decoders in the webview are in scope for the host decision in section 3, because a cloned README is a realistic path to a decoder bug. A compromised renderer is still out of scope for the IPC claims.

## 7. Presentation layer

Lezer emits syntax. It does not emit HTML, and it does not resolve reference definitions. The application owns interpretation.

Dialect: CommonMark, plus GFM tables, `~~` strikethrough, and task lists, and YAML frontmatter at the top of a file. Lezer does not take GitHub's single `~`. Anything else is source until added here, bare-address links included.

Each construct has one rule:

| Construct | Paints as |
|---|---|
| Escape | The escaped character, without the backslash. |
| Entity | The decoded character. An unknown name stays as written. |
| Hard break | A line break. |
| Setext heading | A heading. The underline does not paint. |
| Link | Its words. The title is not part of them. Its syntax never unfolds inline: the address shows in a popover at the caret, where the editor will edit it. Unfolding put `[` before the clicked word and wrapped it to the next line (§9). |
| Link reference definition | Nothing. The links that use it carry its address. |
| Frontmatter | As written, in a quiet monospace block: `---` alone on the first line, through the next `---` or `...`. CommonMark would read it as a rule and a heading, so the page finds it, and draws, anchors, and defines nothing in it. |
| Reference with no definition | Its brackets, as written. |
| List marker | As written: `-`, `*`, `1.`, `1)`. |
| Task list item | Its box, in place of its `[ ]`, ticked as the file has it. A click, or Enter with the caret in its text, ticks or unticks it on the page only: the file keeps what it says, and opening it again shows it as written. |
| Raw HTML block | Drawn in a sandboxed frame (§6). A selection in it shows its source. A `<details>` inside one block opens and closes from a click on its summary only, and stays as the reader left it when its frame is drawn again. The keys show the block's source instead, body and all. |
| `<details>` around markdown | Its summary, which a click, or Enter with the caret on its tags, opens or closes. Its body folds while it is closed. A selection in a tag shows that tag's source. |
| Inline HTML | As written. |
| Image in the repository | The image, through the resource channel. Its destination, escapes and entities resolved, is a URL, so it is decoded once to name the file: `screen%20shot.png` is `screen shot.png`. A leading `/` is the repository's root (§6). |
| Remote image | Its alternative text, in milestone one. |

A construct's syntax opens when the keyboard or find puts the selection in it, and folds again when the selection leaves. Up and Down stop on a table, an HTML block, or a summary, as Left and Right do, rather than pass it. So do Ctrl+N and Ctrl+P, which CodeMirror binds to line motion on macOS. A click or a drag places the caret and opens nothing, so the text never moves under the pointer: opened marks wrapped a word at a line's end onto the next line (§9, row 5). A link's syntax never opens. Its address shows in a popover, for a click too.

Accepted deviation from CommonMark: Lezer parses link-shaped brackets as a link before any definition is known. Un-linking an unresolved reference brings back the brackets, but not emphasis CommonMark would find across them. `[foo *bar]* baz` with no definition is `[foo <em>bar]</em> baz` in CommonMark, and plain text here. Fixing it needs a reparse with the definitions known. Not in milestone one.

- Copy from the decorated view copies source, and the UI says so.
- Find searches source, including hidden syntax, until a visible-text find exists. That gap is accepted in milestone one and named in the UI. A match in a link's address, which never shows on the page, shows marked in the link's popover.
- Print paints the decorated page. CodeMirror renders the whole document for print, not only the viewport. Section 8 times it.
- Export, later, walks the Lezer tree. It does not add a second parser. If a second read-only interpreter is ever added, it cannot write, and display tests must show it agrees.

The display fixtures are the page's tests, `desktop/src/page/page.test.ts`. Each rule here has a case, and a rendering bug gets one with its fix.

## 8. Milestone one acceptance

Milestone one ships the open side only: launch, double-click, `pick`, drop, `open`, `read_asset`, and `open_url`. No command can write, so "the file is not modified" holds by construction. Acceptance still checks it.

From `app file.md`, on a named machine:

1. A file in the section 7 dialect, with headings, lists, a fenced block, a GFM table, and a sibling image, paints as a page rather than a code buffer. A remote image does not load. An image via `../` inside the repository loads. One outside it, or through a symlink that leaves it, does not.
2. A script tag does not run. A raw HTML block is drawn in a frame that runs no script and fetches nothing but images in the repository, through the resource channel. Inline HTML is shown as source. The file's bytes and modification time are unchanged.
3. The section 9 fixtures reach first paint within 1 second. Time to a complete parse is recorded beside it, because CodeMirror parses lazily: first paint can pass while find, the outline, and print still wait.
4. Quit and reopen the same path from the shell. No vault, no licence dialog, no write beside the file.
5. Copy, find, and print behave as section 7 says, including the accepted gaps.
6. No IPC message, event, or URL the webview sees carries a filesystem path. Checked by logging IPC traffic through items 1 to 5.
7. Double-click a `.md` file in Finder, in File Explorer, and in the file manager of the named Linux setup. It opens in the app, in its own window, not in a browser. A second double-click while the app runs opens a second window in the same process.

The surface is CodeMirror with editing commands disabled. A `load_html` dump fails the milestone.

Result, 2026-10-10, on a Linux container that is not the named machine: items 1, 2, 4, 5, and 6 pass, and item 7 passes on Linux. Item 3 is at the line for the largest file and over for its tenfold, with most of the second spent before the page loads. The record is [milestone-one.md](milestone-one.md).

## 9. Week-one gates

Product UI waits on two results. The full Linux matrix does not.

**Click-target prototype.** One file. Decorations hide `**bold**` and a folded link. Arrow movement through a block widget must not jump. This is the blind spot revision 1 missed.

CodeMirror resolves a click's position at mousedown, and a click opens no syntax (§7), so a click in the middle of a word lands by construction. The gate tests what that does not cover:

| Case | Pass |
|---|---|
| Click on the first or last visible character of `**bold**` | Caret inside the marks, beside that character. |
| Click past the end of a line that ends in a folded construct | Caret after the closing marks. |
| Click on a folded link in a paragraph wrapped to the window | The clicked character stays on its visual line. |
| Drag from plain text across a folded construct | Selection ends on the character under the pointer at release. |
| Click on the first character of bold, italic, or code in a paragraph wrapped to the window | The clicked character stays on its visual line. |

Fail any row and do not build the viewer shell.

Result, 2026-10-10: pass, 14 of 14, on WebKitGTK 2.52.6, after one fix and one decision. The bold, italic, and code row came on 2026-10-11 and failed until a click stopped opening syntax: 26 of 26 since. The record is [gates/click-target.md](gates/click-target.md).

**Corpus through the real input path.** Programmatic dispatch does not count. Drive Enter, Backspace, and paste through WebDriver on Windows and Linux; `tauri-driver` has no macOS support. WebDriver cannot commit an IME composition, so IME is the manual part of the host spot-check. Paste includes a Mac clipboard into a CRLF file and a Windows clipboard into an LF file. Assert changed ranges stay inside ranges the user input touched, once our keymap exists. Until that keymap exists, the stock Markdown keymap is expected to fail this test, and that failure is the point.

The same run measures what the open decisions need: files with mixed or lone-CR endings (section 5), images via `../`, inside and outside the repository (section 6), remote images, and raw HTML blocks. It also yields the section 8 fixtures: the largest file in the corpus, and a synthetic file ten times its size.

Encoding fixtures in the same run: uniform CRLF, mixed endings, lone CR, BOM, invalid UTF-8, NUL bytes. Expected results are in section 5.

Result, 2026-10-10, the half that measures: 5,936 files in eight repositories, none with mixed endings, 215 images via `../` and all inside their repository, raw HTML in 11%. The record is [gates/corpus.md](gates/corpus.md). The input-path half needs the editor's keymap, so it runs with the editor milestone, before typing is enabled.

**Host spot-check, not a matrix.** One Ubuntu LTS, WebKitGTK version recorded, one session, one input method, on the click-target prototype. IME composition inside emphasis, by hand. GPU failures are field reports, not a gate, unless the window is blank on that one setup.

Fallback rule, precommitted: if that spot-check fails and the cause is WebKitGTK rather than the prototype, Linux is supported only on the Flatpak GNOME runtime's WebKitGTK. Each runtime branch gets WebKitGTK security updates for about a year, then reaches end of life. The maintainer moves the app to the current branch, in a release, before that happens, every year. A release that misses it ships an unpatched engine. Electron is the next escape, taken only with the security-release commitment in section 3. "A Chromium runtime under Tauri" is not an escape until a shippable build exists.

## 10. Dependency and packaging policy

- Own code: MIT or Apache-2.0.
- Everything linked into the shipped binary or bundled into the webview is on an allowlist, checked in CI by `cargo deny` and a JavaScript licence check: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, Zlib, Unicode-3.0, and MPL-2.0 for unmodified upstream code. Tauri 2 needs the last two already: `option-ext` (MPL-2.0, through `dirs`) and `icu_normalizer` (Unicode-3.0, through `url` and `idna`).
- A change to an MPL-2.0 file is published under MPL-2.0.
- Fonts bundled with the app: OFL-1.1.
- Engines dynamically linked and replaceable: LGPL tolerated. WebKit is in this bucket. Vendoring WebKit is not.
- No in-process GPL. Pandoc, if ever used, is a user-installed process.
- Distribution must match the policy. An AppImage that bundles WebKitGTK is vendoring, and does not satisfy "system webview." Flatpak against the GNOME runtime does, on the yearly bump in section 9. The shipped package is checked, not the Tauri default.

## 11. What revision 3 changed

- Save encodes the string. The ChangeSet gate left the save path: it reproduced the same bytes, at the cost of a position mapping.
- Pasted, dropped, and composed text has its line breaks rewritten to the recorded separator. The gate refuses a string that slipped through.
- Tauri's three path-carrying defaults are named and replaced: frontend drag-drop, the dialog plugin, the asset protocol.
- IPC lists `pick`, drop, `open_url`, `save_as`, `reload`, and `resolve_link`. The handle advances after a save. A refused buffer goes to a recovery store outside the document's folder.
- Atomic replace has rules for unwritable directories, hard links, ownership, and extended attributes.
- The asset scope is the repository, not the document directory. Network shares are handled by the scope rule, not banned.
- CSP covers styles, images, fonts, IPC, frames, and navigation, not only script.
- The licence rule is an allowlist Tauri's own tree passes.
- The click gate tests boundaries, reflow, and drag, which a mid-word click cannot fail.
- The dialect says `~~` only, no longer lists fenced info strings as an extension (they are CommonMark), gives each construct a rule, and records the Lezer deviation.
- Milestone one ships no write command, and checks that no path reaches the webview.
- The Flatpak fallback says who bumps the runtime, and when.
- `pulldown-cmark` is test-only. The MarkText date is gone; the decision never rested on it.

## 12. Questions still open

1. Is the security-release commitment true for this maintainer? The app needs a signed auto-update channel either way, for its own bugs and for Tauri and Rust advisories. Once that exists, Electron's extra cost is cadence: a new major every 8 weeks, three supported at a time. If signed auto-update is not running at milestone one, neither host is safe to ship.
2. Which machine is the named machine in section 8? The budget is set. The machine is not.
3. Does the corpus find mixed line endings common enough to bring back ChangeSet saves? It found none in 5,936 files, so no ([gates/corpus.md](gates/corpus.md)). A survey of the maintainer's own notes could still change that.
4. Is unfolding a table on entry acceptable once the click-target prototype exists? A nested cell editor would not break the single-buffer claim, if each cell is a CodeMirror view that dispatches changes into the parent's range and holds no state of its own. Section 3 already accepts misaligned pipes after a one-cell edit.

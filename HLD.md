# HLD: Local Markdown viewer, editor later

Status: revision 2, after peer review. Not signed off.
Date: 2026-10-09
Audience: reviewers who were not in the design thread. Attack the remaining claims.

Revision 2 exists because revision 1 asserted guarantees it could not enforce: a no-op identity that CodeMirror does not provide by default, a save gate that cannot see intent, a trust boundary with no image channel, and a parser-count rule standing in for a presentation layer.

## 1. Purpose

A free, open-source desktop tool that opens a `.md` file and shows a typeset page, and that can later become an editor without throwing the viewer away.

The end-state comparison is Typora: in-place rendering, plain files, Windows / macOS / Linux, no account. Typora is proprietary and paid. This tool's own code is MIT or Apache-2.0. Linked libraries follow the licence rule in section 9, which is not "MIT only."

Milestone one is the editor surface with editing commands disabled. It is not an HTML dump. It is also not, by itself, proof of a Typora-quality editing feel.

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
| Document | Original bytes, plus a UTF-8 working string | The string is not the file. Encoding, BOM, EOL, mode, and ownership are facts about the bytes. |
| Surface | CodeMirror 6, Lezer markdown | Source is the buffer. Decorations are a view. This is a fidelity strategy. It is not yet evidence of a Typora-grade feel. |
| Viewer | Same document authority, editing commands off | Shared authority matters. Preserving one view instance does not. |
| Authority | One source of truth: the bytes | A second read-only interpreter is allowed if it cannot write. Parser count is not the invariant. |
| Rust role | Save gate and path policy | Applies an accepted change set to original bytes. Does not parse Markdown. |
| Sanitize | Render policy only | Stripping HTML on save destroys READMEs. |
| Tables, v1 | Unfold to source on entry | Nested cell editors are a later design, not an accident. |

Rejected:

- Milkdown / ProseMirror-as-authority. Documented rewrites. Block-level source preservation still fails this contract: a one-cell edit must not reformat the table.
- Tiptap as a licence disqualifier. The core is MIT. Rejected for the serializer, not the paid tier.
- `pulldown-cmark` on the open or save path. Optional verifier only.
- Forking MarkText. Upstream is active again. Confirmed release: v0.19.0 on 28 May 2026. A later 2026 release was claimed in review and not confirmed here. Do not fork, because its editor is the component being replaced.
- Pure Rust UI and from-scratch C++. No shipped native toolkit has document-grade caret, bidi, and IME on three platforms at a solo-developer cost.
- Qt as a second stack. Real document widget, still reserializes.

Known risk, not a rejection: CodeMirror, Lezer, and ProseMirror share one primary maintainer. The lang-markdown repository was archived on 15 April 2026 and now points at the maintainer's forge. Pin source location at lock time. "Framework you do not control" applies here too.

## 4. Architecture

```text
┌───────────────────────────────────────────────────────────────┐
│ Tauri 2 (Rust)                                   trust boundary │
│                                                                 │
│  open ─► path resolver ─► read bytes ─► mint handle             │
│              │                     │                            │
│              │ resolved path       │ hash of bytes read         │
│              │ local only          │ encoding, BOM, EOL record  │
│              │ UNC and mapped      │ mode, ownership kept       │
│              │ drives rejected     ▼                            │
│              │              working string (UTF-8)              │
│              │                     │                            │
│              │                     │ IPC: handle + string       │
│              ▼                     ▼                            │
│  ┌──────────────────────────────────────────────┐               │
│  │ system webview                               │               │
│  │                                              │               │
│  │ CodeMirror 6                                 │               │
│  │   document = working string                  │               │
│  │   parser   = Lezer markdown                  │               │
│  │   view     = decorations over source ranges  │               │
│  │   edits    = ChangeSet, user-event annotated │               │
│  │                                              │               │
│  │ presentation layer (ours, not Lezer):        │               │
│  │   reference-link resolution, dialect, HTML   │               │
│  └──────────────────────────────────────────────┘               │
│                          │                                      │
│                          │ IPC: handle + ChangeSet              │
│                          ▼                                      │
│  save gate: disk hash still matches the handle                 │
│             apply ChangeSet to original bytes                  │
│             result must equal the claimed string               │
│             atomic write through a symlink to its target       │
│             preserve mode and ownership                        │
│             conflict if disk changed: do not overwrite         │
│                                                                 │
│  resource channel: handle-scoped read of sibling images        │
│                    no path arguments from the webview          │
│                                                                 │
│  render policy: document script blocked                        │
│                 app script allowed (hashed or nonced)          │
│                 raw HTML in a sandboxed frame, or as source    │
└───────────────────────────────────────────────────────────────┘
```

Rules:

- The webview never receives a path. Rust mints an opaque handle at launch, at the file dialog, and at link resolution. The handle carries the resolved path and the hash of the bytes read.
- Rust never interprets Markdown.
- Rendered HTML is never the source of a save.
- A read of a sibling image is not permission to write any sibling.

## 5. Fidelity and encoding contract

CodeMirror does not provide no-op identity by default. It splits on LF, CRLF, and CR, and joins with LF unless configured. A configured separator is then the only one recognised. Positions are UTF-16 code units, not UTF-8 byte offsets. The contract has to say what is preserved, because the editor will not.

| Fact | Rule |
|---|---|
| Valid UTF-8 | Working string is the Unicode scalar values of those bytes. |
| BOM | Preserved. Not part of the working string. |
| Invalid UTF-8, UTF-16 | Open read-only. Save disabled. No lossless path into a JS string. |
| Uniform LF or CRLF | Preserved on save by recording the separator and configuring CodeMirror to it. |
| Mixed or lone CR | Open read-only until an explicit "normalize line endings" command. Silent repair is a failed no-op. |
| Untouched bytes | Identical because the ChangeSet is applied to the original bytes, not because a diff guessed. |
| User edit | A transaction annotated as user input, a formatting command, list continuation we wrote, or paste. Stock CodeMirror Markdown keymap is out of contract: its Enter and Backspace rewrite lines the user did not touch. Those commands are replaced before typing is enabled. |
| External change | Disk hash differs from the handle. Save refuses. The user chooses reload or save-as. Overwrite is not the default. |
| Normalization | Explicit command with a diff preview. Never the default. |

"Refuse the save" never means discard the buffer. It means do not write, and keep the buffer recoverable.

## 6. Trust boundary

IPC:

- `open(handle) -> string` after the resolver accepts the path. The webview does not pass the path.
- `save(handle, changeset) -> result`. Rust applies the changeset to the original bytes. It checks that the application reproduces the claimed string, and that the disk hash still matches.
- `read_asset(handle, relative) -> bytes` for a sibling image. Relative, resolved, still inside the document directory. Symlinks resolved before the scope check. `../` rejected in milestone one. Repo-root scope is an unmade decision and is not the default.

No general filesystem command. No path argument from the webview.

CSP: bundled application script only, by hash or nonce. No inline script, no eval. Document-supplied script never runs. "Script blocked" was wrong, because CodeMirror is script.

Raw HTML: in milestone one, shown as source, not parsed into the editor document. A later rendered HTML block goes in a sandboxed frame with no script and no shared origin. `<details>` rendering as a widget is an explicit later behaviour, not implied by "the bytes survived."

Remote images: milestone one does not load them. That is provisional. Changing the default waits on a measured broken-README rate. A user-authorised exception is a later trust-boundary change, not a silent relaxation.

UNC paths and drive letters that resolve to a UNC share are rejected. "Not written as a UNC path" is not the check. The check is the resolved target.

Threat model, bounded: a local file from a clone, download, or paste must not execute script, must not fetch remote resources, and must not reach a native API beyond the calls above. Image decoders in the webview are in scope for the host decision in section 3, because a cloned README is a realistic path to a decoder bug. A compromised renderer is still out of scope for the IPC claims.

## 7. Presentation layer

Lezer emits syntax. It does not emit HTML, and it does not resolve reference definitions. The application owns interpretation:

- Dialect: CommonMark plus the GFM table extension, fenced code info strings, and strikethrough. Anything else is source until added here.
- A link-shaped node is not a link unless the definition resolves.
- Sibling images paint through the resource channel. Remote images do not, in milestone one.
- Copy from the decorated view copies source, and the UI says so.
- Find searches source, including hidden syntax, until a visible-text find exists. That gap is accepted in milestone one and named in the UI.
- Export, later, walks the Lezer tree. It does not add a second parser. If a second read-only interpreter is ever added, it cannot write, and display tests must show it agrees.

## 8. Milestone one acceptance

From `app file.md`, on a named machine:

1. A file in the dialect in section 7, with headings, lists, a fenced block, a GFM table, and a sibling image, paints as a page rather than a code buffer. A remote image does not load. An image via `../` does not load.
2. A script tag does not run. Raw HTML is shown as source. The file is not modified.
3. A stated fixture (size, hardware, time-to-first-paint) paints inside the stated budget. "No beachball" is not a criterion.
4. Quit and reopen the same path from the shell. No vault, no licence dialog, no write beside the file.
5. Copy, find, and print behave as section 7 says, including the accepted gaps.

The surface is CodeMirror with editing commands disabled. A `load_html` dump fails the milestone.

## 9. Week-one gates

Product UI waits on two results. The full Linux matrix does not.

**Click-target prototype.** One file. Decorations hide `**bold**` and a folded link. Click the rendered word. The caret must land on the character that was under the pointer after the syntax unfolds. Arrow movement through a block widget must not jump. This is the blind spot revision 1 missed. Fail it and do not build the viewer shell.

**Corpus through the real input path.** Programmatic dispatch does not count. Drive Enter, Backspace, paste, and an IME commit. Assert changed ranges stay inside ranges the user input touched, once our keymap exists. Until that keymap exists, the stock Markdown keymap is expected to fail this test, and that failure is the point.

Encoding fixtures in the same run: uniform CRLF, mixed endings, lone CR, BOM, invalid UTF-8. Expected results are in section 5.

**Host spot-check, not a matrix.** One Ubuntu LTS, WebKitGTK version recorded, one session, one input method, on the click-target prototype. IME composition inside emphasis. GPU failures are field reports, not a gate, unless the window is blank on that one setup.

Fallback rule, precommitted: if that spot-check fails and the cause is WebKitGTK rather than the prototype, Linux is supported only on the Flatpak GNOME runtime's WebKitGTK. Electron is the next escape, taken only with the security-release commitment in section 3. "A Chromium runtime under Tauri" is not an escape until a shippable build exists.

## 10. Dependency and packaging policy

- Own code, and in-process dependencies we vendor: MIT or Apache-2.0.
- Engines dynamically linked and replaceable: LGPL tolerated. WebKit is in this bucket. Vendoring WebKit is not.
- No in-process GPL. Pandoc, if ever used, is a user-installed process.
- Distribution must match the policy. An AppImage that bundles WebKitGTK is vendoring, and does not satisfy "system webview." Flatpak against the GNOME runtime does. The shipped package is checked, not the Tauri default.

## 11. What revision 2 changed

- Save gate applies a ChangeSet to original bytes. A Myers diff of the final string cannot see intent, and refusing on a guessed dirty region can throw away the buffer.
- Line endings and invalid UTF-8 are specified. "EOL kept" in a decode step was a second source map in disguise.
- Handles replace path arguments. Sibling images have a read channel. Mapped drives are in the resolver.
- CSP, raw HTML, and remote images each have one rule.
- Licence rule matches the escape hatches and the package.
- "One parser" is now "one writable authority." Presentation is named work.
- Tables unfold on entry. Nested cell editors are not implied.
- Linux matrix shrunk to a spot-check. Click-target layout shift is the gate that runs first.
- MarkText date corrected to the confirmed release.

## 12. Questions still open

1. After the click-target prototype, is unfolding-on-edit an acceptable end state, or do tables force a nested editor that breaks the single-buffer claim?
2. Is the security-release commitment true for this maintainer? If yes, Electron is the smaller long-run surface. If no, Tauri stays.
3. What is the document-directory scope rule for real repos that store images in `../images`? Milestone one rejects `../`. That may be the wrong product.
4. Which fixture and budget define "paints" for acceptance 3?

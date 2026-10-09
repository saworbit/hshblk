> Superseded. The design is [../hld.md](../hld.md). This draft is kept so its rejected claims are not relitigated.

# HLD: Local Markdown viewer, editor later

Status: ready for peer review
Date: 2026-10-09
Audience: reviewers who were not in the design thread. Attack the decisions. Do not propose a roadmap.

## 1. Purpose

A free, open-source desktop tool that opens a `.md` file and shows a typeset page, and that can later become an editor without throwing the viewer away.

The end-state comparison is Typora: in-place rendering, plain files, Windows / macOS / Linux, no account. Typora is proprietary, paid, and Electron. This tool must be MIT or Apache-2.0 in its own code and in every library it links.

The first milestone is not "an HTML preview." It is the editor surface with typing turned off.

## 2. Non-goals

- A knowledge base, vault, graph, or plugin host.
- An account, sync, or collaboration.
- A browser product. A later tab that renders the same surface is allowed and is not designed here.
- Mobile.
- Byte-identical save after an edit to that region. Untouched regions must be byte-identical. Edited regions may change.
- Matching Typora's caret in milestone one.

## 3. Decisions

| Decision | Choice | Why |
|---|---|---|
| Host | Tauri 2 | Native window, Rust process, system webview, one codebase for three desktops. Electron is the named escape, not a rejected religion. |
| Document | The UTF-8 source string | Fidelity is impossible once a rich-text tree is the authority. |
| Surface | CodeMirror 6, Lezer markdown | Source is the buffer. Decorations hide syntax. Nothing is reserialized on a no-op. |
| Viewer | That surface, read-only | An HTML dump does not survive into the editor. It does not count as the milestone. |
| Parser count | One, in the frontend | A Rust parser and a JS serializer will disagree. |
| Rust role | Save gate and path policy | Not the parser of record. |
| Sanitize | Render policy only | Stripping HTML on save destroys READMEs. |
| Licence | MIT or Apache-2.0 | No in-process GPL. System webview (LGPL WebKit) is an OS component, not vendored. |

Rejected, and why:

- Milkdown / ProseMirror-as-authority. Documented rewrites (list markers, emphasis, whitespace). A framework you do not control sits on the serializer.
- Tiptap, as a licence disqualifier. The core is MIT. Rejected for the same reason as Milkdown, not because a paid tier exists.
- `pulldown-cmark` as the parser of record. It does not serialize and it is not a lossless syntax tree. Optional verifier only.
- Forking MarkText. Upstream is active again (release in October 2026). The reason not to fork is that its editor is the component being replaced.
- Pure Rust UI and from-scratch C++. No shipped native toolkit has document-grade caret, bidi, and IME on three platforms at a cost a solo developer can pay.
- Qt / `QTextEdit` as a second stack. A real document widget, and it still reserializes. Same failure mode already removed.

## 4. Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│ Tauri 2 (Rust)                                  trust boundary │
│                                                                │
│  open ─► path resolver ─► read bytes ─► decode                 │
│              │                        encoding, BOM, EOL kept  │
│              │ local only, UNC blocked                         │
│              ▼                                                 │
│         UTF-8 string ──────────────────────────► save gate     │
│              │                                       ▲         │
│              │ IPC: the string                       │ bytes   │
│              ▼                                       │         │
│  ┌─────────────────────────────────────────────┐     │         │
│  │ system webview                              │     │         │
│  │                                             │     │         │
│  │ CodeMirror 6                                │     │         │
│  │   document = that string                    │     │         │
│  │   parser   = Lezer markdown (the only one)  │     │         │
│  │   viewer   = read-only + decoration widgets │     │         │
│  │   editor   = same instance, typing enabled  │     │         │
│  │   focus unfolds a range to real characters  │     │         │
│  └─────────────────────────────────────────────┘     │         │
│                                                      │         │
│  save gate: atomic write                             │         │
│             preserve encoding and EOL                ┘         │
│             untouched regions byte-identical                   │
│             refuse the save otherwise                          │
│                                                                │
│  render policy: no script, no navigation,                     │
│                 no remote or UNC fetch                        │
│                 raw HTML stays in the string                  │
└──────────────────────────────────────────────────────────────┘
```

Rules:

- Rust never interprets Markdown.
- The webview never opens a path.
- The string read from disk is the string written back, except where the user edited.
- Rendered HTML is never the source of a save.

## 5. Fidelity contract

Three different promises, not synonyms:

| Promise | Meaning | Milestone one |
|---|---|---|
| No-op identity | Open and close does not write. A forced save of an unedited buffer is byte-identical, including EOL and a trailing newline. | Required |
| Edit locality | A one-character edit does not rewrite unrelated regions. | Required once typing exists |
| Semantic fidelity | Supported constructs keep their meaning. | Required, weaker than the two above |

Allowed to differ after an edit to that region: the characters the user changed.

Not allowed, ever, as a side effect of open or save: list-marker normalization, emphasis-delimiter swaps, escaped-character changes, table padding, setext/ATX flips, reference-link collapse, HTML stripping, encoding changes.

Normalization, if it ever exists, is an explicit command with a preview of the diff. It is not the default serializer.

## 6. Trust boundary

The webview receives a string and returns a string.

IPC surface:

- `open(path) -> string` after the resolver accepts the path.
- `save(path, string) -> result` after the untouched-region check.
- `pick_local_image() -> relative path` for a later editor. Not in the viewer milestone.

No general filesystem command. No arbitrary URL. No network permission on the webview.

CSP: script blocked, navigation blocked, outbound requests blocked.

Path resolver: the document directory and explicit user picks only. Remote URLs and UNC paths rejected. A document must not leak credentials to a share or phone home.

Sanitizing changes pixels. It does not change bytes. `<details>`, `<kbd>`, sized images, and aligned blocks survive a no-op open.

Threat model, bounded: a local file from a clone, download, or paste must not execute script, must not fetch remote resources, and must not reach a native API beyond the three calls above. This is not a claim of safety against a compromised renderer. "Hostile-file safe" is not the phrase to use.

## 7. Milestone one acceptance

All four, on a real machine, from `app file.md`:

1. A CommonMark file with headings, lists, a fenced block, a table, and a sibling image paints. A remote image does not load.
2. Raw HTML and a script tag do not run. The prose still paints. The file is not modified.
3. A multi-megabyte file paints without a beachball long enough to reach for a browser.
4. Quit and reopen the same path from the shell. No vault, no licence dialog, no write beside the file.

The surface that paints is CodeMirror in read-only mode. A `load_html` dump fails the milestone even if the page looks right.

## 8. Week-one gates, before product code

These run first. Product UI does not start until both have a result.

**Corpus.** Uncurated `.md` files through CodeMirror load and a forced save. Untouched files must come back byte-identical. Then a one-character edit. The diff must be local. Record allowed exceptions in the contract, not in the implementation.

**IME and selection matrix.** One script, three hosts: WebView2, WKWebView, WebKitGTK. Cases: CJK composition inside emphasis inside a list item, Korean jamo, an emoji ZWJ sequence, an RTL run, selection across a table boundary. Linux named in advance: Ubuntu LTS, NVIDIA proprietary and Intel/AMD, Wayland and X11, IBus and Fcitx5.

Fallback chosen before the results: Linux tier-two, or a Chromium runtime under the same Rust shell if one is shippable, or Electron. "Stop" is reserved for a fidelity failure, not for the first Linux compositor bug.

A static page cannot pass the Linux gate. The gate cannot be run against an HTML dump.

## 9. Dependency policy

- Own code: MIT or Apache-2.0.
- CodeMirror 6 and Lezer: MIT. Confirm at pin time.
- Tauri 2: MIT or Apache-2.0.
- System webview: OS component. WebKit contains LGPL and BSD. Linking the system webview is accepted. Vendoring WebKit is not.
- Pandoc, if ever used for export: separate user-installed process, never linked.
- No in-process GPL renderer.
- Optional `pulldown-cmark` (MIT) as a verifier only. Not on the open or save path.

## 10. What reviewers already killed

Kept so a new review does not relitigate a settled mistake:

- "Rust owns fidelity" via a Rust parser. False. The writer of the edited buffer owns fidelity. Rust owns the save gate.
- Viewer-first as an HTML preview. False progress. Viewer-first as the editor in read-only mode stands.
- Remote images off, sold as the differentiator. Real READMEs go broken. The differentiator is no script and no document-triggered network, with remote images a user setting that defaults off only if the broken-README rate is acceptable. Measure it. Do not assert it.
- IPC-count as a security metric. Privilege and arguments matter. One path-taking command is worse than several narrow ones.
- MarkText is abandoned. It is not. Still not the base.

## 11. Questions for this review

Answer each with agree, disagree, or depends. Name the evidence that would settle it.

1. Is CodeMirror 6 with decorations an acceptable end-state editing feel, or only a fidelity strategy that will lose to an owned ProseMirror schema with block-level source preservation?
2. Is the untouched-region byte check implementable without a second source map that reintroduces the dual-model bug?
3. Does the week-one Linux matrix belong before any viewer, or is a tier-two Linux an acceptable default given a solo maintainer?
4. Is Tauri still earning its place once the document model lives entirely in the webview, or is Electron the smaller maintenance surface for this specific tool?
5. What failure in the first two weeks is this HLD still blind to?

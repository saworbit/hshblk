# Corpus survey

docs/hld.md §9, the half that measures. It answers what the open decisions in sections 5, 6, and 12 need from real files, and picks the section 8 fixtures. The half that types through the real input path is not run yet: see the end.

Run: 2026-10-10, by [`desktop/test/gate/corpus.ts`](../../desktop/test/gate/corpus.ts), which reads each file's bytes and parses it with the page's own dialect.

```bash
cd desktop
node test/gate/corpus.ts <repository>...
```

## The corpus

5,936 markdown files from eight public repositories, each a shallow checkout of its default branch.

| Repository | Commit | Part surveyed |
|---|---|---|
| [sindresorhus/awesome](https://github.com/sindresorhus/awesome) | `bc98e51` | the root |
| [kubernetes/website](https://github.com/kubernetes/website) | `db7db6a` | `content/en/docs/concepts` |
| [mdn/content](https://github.com/mdn/content) | `5ed8a61` | `files/en-us/web/html` |
| [nodejs/node](https://github.com/nodejs/node) | `ae5a0f4` | `doc` |
| [basecamp/omarchy](https://github.com/basecamp/omarchy) | `988f44e` | all of it |
| [rust-lang/book](https://github.com/rust-lang/book) | `1500248` | `src` |
| [tldr-pages/tldr](https://github.com/tldr-pages/tldr) | `f8a4763` | `pages/common` |
| [microsoft/vscode-docs](https://github.com/microsoft/vscode-docs) | `7dde535` | `docs` |

## Result

| Repository | Files | Mixed endings | CRLF | BOM | Invalid UTF-8 | Raw HTML | Images beside | Images via `../` | Remote images | Largest |
|---|---|---|---|---|---|---|---|---|---|---|
| awesome | 6 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 9 | 76 KB |
| kubernetes | 194 | 0 | 0 | 0 | 0 | 173 | 11 | 0 | 2 | 64 KB |
| mdn | 262 | 0 | 0 | 0 | 0 | 182 | 26 | 0 | 1 | 90 KB |
| node | 167 | 0 | 0 | 0 | 0 | 62 | 6 | 0 | 5 | 934 KB |
| omarchy | 95 | 0 | 0 | 0 | 0 | 2 | 47 | 38 | 0 | 49 KB |
| rust-book | 117 | 0 | 0 | 0 | 0 | 87 | 0 | 0 | 1 | 39 KB |
| tldr | 4730 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 11 | 29 KB |
| vscode-docs | 365 | 0 | 0 | 0 | 0 | 145 | 1836 | 177 | 0 | 65 KB |

No file has mixed or lone-CR line endings, uniform CRLF, a BOM, invalid UTF-8, or a NUL byte.

## What it decides

- **Save stays encode-the-string (§5, §12 question 3).** Mixed endings are the one case where a ChangeSet save would keep bytes that encoding the string cannot. None turned up. The caveat: these are the bytes a repository stores, and git normalizes many repositories to LF on commit. A Windows checkout with `core.autocrlf` turns every file CRLF in the working copy. That is uniform CRLF, which section 5 already preserves. Mixed endings come from editing, which this survey cannot see. The read-only rule for them stands.
- **The image scope is the repository, not the folder (§6).** 215 images in 38 files reach up with `../`, in omarchy and vscode-docs, and every one stays inside its repository. A folder scope would have broken all of them. None points outside.
- **Remote images are rare.** 29 in 5,936 files. Milestone one does not load them, and few files lose anything.
- **Raw HTML is common in documentation sites.** 654 files, 11%, mostly in kubernetes, mdn, and rust-book, where most files have some. Milestone one shows it as source, so on those sites the page shows tags. This is the case for the later sandboxed HTML block in section 7, and the first thing a reader of those sites will notice.
- **The encoding fixtures are synthetic.** Nothing in the corpus is invalid, so the read-only paths are tested on made-up files, in [`documents.rs`](../../desktop/src-tauri/src/documents.rs).

## The section 8 fixtures

- The largest file: `node/doc/changelogs/CHANGELOG_V12.md`, 956,573 bytes. A long changelog: lists, headings, and about 9,500 links.
- Ten times its size: ten copies joined by line breaks, 9,565,739 bytes.

## Not run: the input path

The other half of the gate drives Enter, Backspace, and paste through WebDriver, and asserts that every change stays inside what the user touched. It tests the editor's own keymap and input filters. Milestone one is read-only and has neither, so there is nothing to type into. It runs with the editor milestone, before typing is enabled, as section 9 says.

## Not covered

- Private notes. Eight public, English documentation repositories are not a vault written on Windows over years. A survey of the maintainer's own files would be the better sample, and the script takes any folder.
- Working copies. The survey reads what is checked out on Linux, not what a Windows or macOS checkout would hold.

# Contributing

Thanks for looking. Hash Block is one person's project, so a small pull request that does one thing is the one most likely to land. For anything bigger, an issue first saves us both a weekend.

## Bugs

- A file that reads wrong, or a page that misbehaves: open a **Bug** issue, with the smallest piece of markdown that shows it.
- A security problem: not an issue, please. [SECURITY.md](SECURITY.md) says where it goes.

## Building it

[docs/desktop.md](../docs/desktop.md#building-it) has what each system needs. Then, in `desktop/`:

```bash
npm ci
npm run tauri dev
```

## Before a pull request

- In `desktop/`: `npm run typecheck`, `npm run lint`, and `npm test`. `npm run format` fixes what lint says about layout.
- In `desktop/src-tauri/`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test`.
- A line at the end of **Unreleased** in [CHANGELOG.md](../CHANGELOG.md), saying what changed for someone reading a file.
- The docs that describe what you changed, changed too.

CI runs the rest: the acceptance suite, the gates, and the WebView2 cases, which need a built app. `main` takes a pull request once they pass. [docs/desktop.md](../docs/desktop.md#tests) says what each one checks.

## What it will not take

Hash Block reads, and that is the whole point. A change that lets a file run script, fetch from the network, learn a path, or write anything is a different app. Section 6 of [docs/hld.md](../docs/hld.md) says where the lines are.

By sending a pull request, you agree it is released under the [MIT License](../LICENSE), as the rest is.

# Hash Block

A page for a markdown file. Double-click one and it opens in a window of its own, typeset, not in a browser. The characters stay in the file. Nothing here writes them back.

## The desktop app

Packages for Linux, macOS, and Windows come from the Desktop workflow on `main`. [docs/desktop.md](docs/desktop.md) says how to install one and make it what a double-click opens.

| Key | Does |
|---|---|
| `Ctrl+O` (`⌘O`) | Open a file |
| `Ctrl+F` (`⌘F`) | Find, in the source |
| `Ctrl+P` (`⌘P`) | Print the whole page |
| `Ctrl` or `⌘` and click | Open a link in the browser, or go to the heading it names |
| `Enter` | Open or close a `<details>`, with the caret on its tags |

Each file opens in its own window, and dropping one on a window opens it in another. Move the caret into a construct with the keys, or find in it, and its syntax shows. A click opens nothing, so the page holds still under the pointer. A link shows its words, and its address shows under it. Images load from inside the file's repository and nowhere else. A raw HTML block is drawn in a frame that runs no script, and shows only images from inside the repository. Inline HTML shows as source.

To build it, with Node 24 and Rust:

```bash
cd desktop
npm ci
npm run tauri dev
```

## More

- [docs/desktop.md](docs/desktop.md) is how the desktop app is installed, built, and tested.
- [docs/hld.md](docs/hld.md) is its design, and the editor it becomes. It is not signed off. [docs/milestone-one.md](docs/milestone-one.md) records the first milestone's acceptance against it.

## License

Hash Block is released under the [MIT License](LICENSE).

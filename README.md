# Hash Block

A page for a markdown file. Double-click one and it opens in a window of its own, typeset, not in a browser. The characters stay in the file. Nothing here writes them back.

This repository holds two programs:

- **The desktop app**, in [`desktop/`](desktop/). It is what a double-click opens.
- **The browser reader**, at the root. It came first, and goes once the desktop app has replaced it.

## The desktop app

Packages for Linux, macOS, and Windows come from the Desktop workflow on `main`. [docs/desktop.md](docs/desktop.md) says how to install one and make it what a double-click opens.

| Key | Does |
|---|---|
| `Ctrl+O` (`⌘O`) | Open a file |
| `Ctrl+F` (`⌘F`) | Find, in the source |
| `Ctrl+P` (`⌘P`) | Print the whole page |
| `Ctrl` or `⌘` and click | Open a link in the browser, or go to the heading it names |

Each file opens in its own window, and dropping one on a window opens it in another. Put the caret in a construct and its syntax shows. A link shows its words, and its address shows under it. Images load from inside the file's repository and nowhere else. A raw HTML block is drawn in a frame that runs no script and fetches nothing. Inline HTML shows as source.

To build it, with Node 24 and Rust:

```bash
cd desktop
npm ci
npm run tauri dev
```

## The browser reader

Open a file, or drop it on the window.

- **Source** shows the characters as written. **Page** goes back.
- The contents list follows the headings.
- The last file you opened is there when you come back, in this browser only. **Restore sample** forgets it.
- `o` opens a file, `s` switches between page and source, and `t` moves to the next theme, unless the theme picker has focus.

The page follows the system: Paper by day, Ink by night. The picker at the foot of the page holds the rest, after [Omarchy](https://github.com/basecamp/omarchy)'s themes: Flexoki Light, Catppuccin Latte, Rosé Pine, Tokyo Night, Catppuccin, Gruvbox, Nord, Everforest, Kanagawa, Matte Black, Ristretto, and Osaka Jade. Every one passes WCAG AA for text.

It shows CommonMark, GFM tables, and `~~strikethrough~~`. Anything else stays as the characters written: task-list boxes, bare addresses, raw HTML. A link shows its words, with its address on hover, and the page never follows it. An image shows the words meant to stand in for it, and is never fetched. The page asks no server for anything because of the file, and its fonts ship with it.

```bash
npm install
npm run dev
```

## More

- [docs/desktop.md](docs/desktop.md) is how the desktop app is installed, built, and tested.
- [docs/hld.md](docs/hld.md) is its design, and the editor it becomes. It is not signed off. [docs/milestone-one.md](docs/milestone-one.md) records the first milestone's acceptance against it.
- [docs/reader.md](docs/reader.md) is how the browser reader is built and tested.

## License

Hash Block is released under the [MIT License](LICENSE).

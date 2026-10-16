<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/logo/svg/mark-dark.svg">
  <img src="brand/logo/svg/mark.svg" width="80" height="80" alt="">
</picture>

# Hash Block

A page for a markdown file. Double-click one and it opens in a window of its own, typeset, not in a browser. The characters stay in the file. Nothing here writes them back.

## The desktop app

Packages for Linux, macOS, and Windows come from the Desktop workflow on `main`. [docs/desktop.md](docs/desktop.md) says how to install one and make it what a double-click opens.

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
| `PageDown`, `Space` | Down a page, by the window less a line. `PageUp` and `Shift+Space` go back up |
| `Ctrl` or `⌘` and click | Open a link in the browser, or a file in the repository in a window of its own, or go to the heading or HTML anchor it names |
| `Alt+Left`, `Alt+Right` (`⌘[`, `⌘]`) | Back to where a link to a heading was followed from, and forward again |
| `Enter` | Open or close a `<details>`, with the caret on its tags. Tick or untick a task box, with the caret in its text |

Each file opens in its own window, and dropping one on a window opens it in another. When the file changes on disk, its window shows the new text, in the same place. A file that is already open comes to the front instead. A new window opens at the size you last left one, and the welcome window lists the files you opened last. Move the caret into a construct with the keys, or find in it, and its syntax shows. A click opens nothing, so the page holds still under the pointer. A task list shows its boxes, where its bullets were, and a click on one, or Enter in its text, ticks it on the page, never in the file. A GitHub alert, such as `> [!WARNING]`, shows its name, icon, and colour. Footnotes, emoji shortcodes, and markdown in a `<div align="center">` draw as GitHub draws them. A link shows its words, and its address shows under it. A link to another file in the repository opens it in a window of its own, and a link that does not open says why. Print shows a web or mail link's address after its words. Images load from inside the file's repository and nowhere else, and one that does not show says why. A raw HTML block is drawn in a frame that runs no script, and shows only images from inside the repository. Inline HTML shows as source, but for a comment, which folds away. Frontmatter, YAML or TOML, folds away, and the status line opens a panel that lists its fields, or shows TOML as written. The status line's Outline lists the headings, and goes to one. A screen reader hears each heading and link as one.

To build it, with Node 24, npm 11.11 or later, and Rust:

```bash
cd desktop
npm ci
npm run tauri dev
```

## More

- [docs/desktop.md](docs/desktop.md) is how the desktop app is installed, built, and tested.
- [docs/hld.md](docs/hld.md) is its design, and the editor it becomes. It is not signed off. [docs/milestone-one.md](docs/milestone-one.md) records the first milestone's acceptance against it.
- [brand/](brand/) is the identity: the mark, the wordmark, the palette, and [brand/BRAND.md](brand/BRAND.md), its guide. The app icon and the welcome screen's mark come from it.

## License

Hash Block is released under the [MIT License](LICENSE). The name and the mark are kept apart from it, so a fork does not look like this project.

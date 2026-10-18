<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/logo/svg/mark-dark.svg">
  <img src="brand/logo/svg/mark.svg" width="80" height="80" alt="">
</picture>

# Hash Block

A page for a markdown file. Double-click one and it opens in a window of its own, typeset, not in a browser. The characters stay in the file. Nothing here writes them back.

## Why there is no editor

Most markdown tools bundle a viewer with an editor, on the polite assumption that you typed the file. Odds are an AI typed it these days, and you are just the one holding it. You need to read it, not edit it, so this has no editor and keeps its hands off the file. Yes, the [design doc](docs/hld.md) sketches one for later anyway. Old habits.

## The desktop app

Under **Releases**, pick the zip for your system: Linux, macOS, or Windows. Each has the app and a README that says how to install it. [docs/desktop.md](docs/desktop.md) says more, and how to make it what a double-click opens.

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

So what does it do, if it will not let you type? Plenty.

**Windows, and lots of them.**

- Every file gets a window of its own. Drop a file on a window and it gets one too. Nobody shares.
- Open a file that is already open and its window comes to the front, instead of a second copy pretending they have never met.
- When the file changes on disk, the window shows the new text and keeps your place. Handy while something else is still typing it.
- A new window opens at the size you last left one, and the welcome window lists the files you opened last. So do File > Open Recent on a Mac, the taskbar's jump list on Windows, and your file manager's Recent on Linux. It remembers more than I do.

**A page that holds still.**

- The syntax stays out of sight until you go looking. Move the caret into a construct with the keys, or find in it, and its syntax shows.
- A click opens nothing, so the page never jumps under the pointer. There is [a whole document](docs/gates/click-target.md) proving it, 26 clicks long, which tells you something about me.
- A task list shows its boxes where the bullets were. A click, or Enter in its text, ticks one on the page and never in the file. All the joy of ticking things off, none of the commitment.
- A GitHub alert, such as `> [!WARNING]`, shows its name, icon, and colour, so a warning looks properly worried.
- A code block that names its language, such as `ts` or `diff`, has its tokens coloured, and its fences fold away like the rest of the syntax.
- Maths draws, `$x^2$` in a line or `$$...$$` as a block, while `$5 and $10` stay prices. My accountant was relieved.
- A mermaid block draws its diagram, in a little frame of its own that can't touch anything else. Flowcharts, finally, without a browser tab.
- Footnotes, emoji shortcodes, and markdown in a `<div align="center">` draw as GitHub draws them. Yes, people still centre things with a div. I am one of those people.

**Links and images that stay home.**

- A link shows its words, and its address shows under it.
- A link to another file in the repository opens it in a window of its own. A link that does not open says why, instead of leaving you to guess.
- Print puts a web or mail link's address after its words, since paper still has no hover.
- Images load from inside the file's repository and nowhere else, and one that does not show says why. An image embedded in the file as `data:` shows too, since it never left home.
- A bare address, like `https://example.com` or `www.example.com`, is a link, because nobody wraps them in angle brackets. Least of all me.

**HTML on a short leash.**

- A raw HTML block is drawn in a frame that runs no script, and shows only images from inside the repository. Your markdown may wear HTML. It may not run anything in it.
- Inline HTML that GitHub would draw, such as `<kbd>`, `<sup>`, `<br>`, or a linked logo, draws here too. Anything fancier shows as source, except a comment, which folds away as if it was never said.

**Getting around.**

- Frontmatter, YAML or TOML, folds away. The status line opens a panel that lists its fields, or shows TOML as written.
- The status line's Outline lists the headings, and goes to one.
- A screen reader hears a heading as a heading and a link as a link. That sounds like the least a page could do, but this page is secretly an editor with the typing taken out, so it took some doing.

To build it yourself, you need Node 24, npm 11.11 or later, Rust, and something to do while Rust compiles:

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

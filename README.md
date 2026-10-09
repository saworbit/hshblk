# Hash Block

A page for a markdown file. Open one, or drop it on the window. The characters stay in the file. Nothing here writes them back.

## Reading

- **Open** picks a file. Dropping one on the window does the same.
- **Source** shows the characters as written. **Page** goes back.
- The contents list follows the headings.
- The last file you opened is there when you come back, in this browser only. **Restore sample** forgets it.

## Keys

| Key | Does |
|---|---|
| `o` | Open a file |
| `s` | Switch between page and source |
| `t` | Next theme |

Keys do nothing while the theme picker has focus.

## Themes

The page follows the system: Paper by day, Ink by night. The picker at the foot of the page holds the rest, after [Omarchy](https://github.com/basecamp/omarchy)'s themes: Flexoki Light, Catppuccin Latte, Rosé Pine, Tokyo Night, Catppuccin, Gruvbox, Nord, Everforest, Kanagawa, Matte Black, Ristretto, and Osaka Jade. Every one passes WCAG AA for text.

## What the page shows

CommonMark, GFM tables, and `~~strikethrough~~`. Anything else stays as the characters written: task-list boxes, bare addresses, raw HTML. A link shows its words. Its address is there on hover, and the page never follows it. An image shows the words meant to stand in for it, and is never fetched.

The page asks no server for anything because of the file. Its fonts ship with it.

## Running it

```bash
npm install
npm run dev
```

## More

- [docs/reader.md](docs/reader.md) is how the reader is built, and how it is tested.
- [docs/hld.md](docs/hld.md) is the design for the later editor. It is not signed off. It is not a second program in this repository.

## License

Hash Block is released under the [MIT License](LICENSE).

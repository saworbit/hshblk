# Hash Block

A local markdown page. The file you open is the file you still have.

There is one design and two programs. They are not interchangeable.

| Look here | What it is |
|---|---|
| [docs/hld.md](docs/hld.md) | The design. Revision 2. Not signed off. |
| [desktop/](desktop/) | The program the design describes. CodeMirror 6 holds the source, syntax hides, typing is off, and a Tauri 2 shell is sketched. The click-target gate has not been run. |
| [src/routes/index.tsx](src/routes/index.tsx) | The browser reader. This is the page in the preview. It paints HTML. The design says that does not pass milestone one. |

The mark, the favicon, and the card live in [public/](public/).

## Browser reader

From the repository root:

```bash
npm install
npm run dev
```

Open a markdown file, or drop one on the window. Source shows the characters. Nothing is written back.

## Desktop sketch

```bash
cd desktop
npm install
npm run dev
```

The shell is `desktop/src-tauri`. It has not been built.

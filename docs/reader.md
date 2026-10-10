# The reader

How the browser reader in this repository is built. The desktop app is [desktop.md](desktop.md), and its design is [hld.md](hld.md).

## File layout

| Path | Holds |
|---|---|
| `src/routes/index.tsx` | The page: open, drop, source view, contents, themes, keys, and what is remembered between visits. |
| `src/lib/markdown.ts` | The presentation layer. A Lezer syntax tree becomes the blocks a page paints. |
| `src/components/markdown-view.tsx` | Paints those blocks. It decides nothing about markdown. |
| `src/lib/themes.ts` | Every theme's six colours, the stylesheet written from them, and the script that applies a stored choice before the page paints. |
| `src/styles.css` | The six colour tokens, with Paper's values as defaults, and the bundled fonts. |
| `src/lib/sample.ts` | The page shown before any file is opened. |

The rest of `src/`, and `server/`, `scripts/`, and `migrations/`, come from the app template: auth, data, and the platform's install page. The reader uses none of it.

## From file to page

1. The file is read as text, and its line endings become `\n`.
2. `@lezer/markdown` parses it in the dialect of [hld.md](hld.md) section 7: CommonMark, GFM tables, and `~~` strikethrough.
3. `readMarkdown` walks the tree once for link definitions, then again for blocks. Each construct follows its rule in the section 7 table. Anything it does not know becomes source, shown as written.
4. The result is plain data: the blocks, the headings for the contents list, and a word count. Tests read it without a browser.
5. `MarkdownView` paints the blocks.

## Themes

A theme is six colours: `paper`, `ink`, `muted`, `accent`, `rule`, and `code`. Tailwind's utilities (`bg-paper`, `text-accent`, and the rest) read them as CSS variables, so a theme is one rule in the stylesheet `themes.ts` writes.

- With no choice made, the page follows the system: Paper by day, Ink by night.
- A choice sets `data-theme` on `<html>` and is stored in this browser. A script in the head applies it before the page paints, so a dark theme never flashes Paper first.

To add a theme, add its six colours to `THEMES`. The tests hold every theme to WCAG AA: ink and muted text on both the page and code backgrounds, and the accent on the page, all at 4.5:1 or better.

## Tests

`npm test` runs every unit suite in one `node --test`, so one failing suite cannot hide the others.

- `src/lib/markdown.test.ts` holds the display fixtures. Each rule in [hld.md](hld.md) section 7 has a case. A rendering bug gets a case here with its fix.
- `src/lib/themes.test.ts` holds contrast and order for every theme.
- `scripts/**/*.test.mjs` and the rest of `src/lib/` are the template's own tests. Four of them read `.grok/app-env.json`, which the platform writes and nobody commits. Elsewhere, write `{"VITE_AUTH_ENABLED":"false"}` there first, as CI does. Four more pin the platform's prompts to the code, and skip, saying why, where those prompts are absent.

`npm run test:smoke` opens the built page in Chromium. It checks that the sample paints from the page's own server alone, that a hostile file neither runs nor fetches anything, that the keys work, that a file and a theme survive a reload, and that a dark system gets Ink. Run `npm run build` first. With a Chromium that Playwright did not install, set `CHROMIUM_PATH` to it. Each test leaves a screenshot in `test-results/`.

Check a change that shows on the page in a browser, at desktop and phone widths, in a light theme and a dark one.

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every pull request and every push to `main`, in two jobs: typecheck, lint, and `npm test`; then the build and the smoke test, which keeps its screenshots when it fails. Each action is pinned to a commit, with its version beside it.

[`.github/dependabot.yml`](../.github/dependabot.yml) proposes npm and Actions updates every week. A release waits a week before it is proposed. Minor and patch updates come as one pull request per ecosystem; a major update comes on its own.

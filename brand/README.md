# Hash Block brand pack

The identity for [Hash Block](https://github.com/saworbit/hshblk), the markdown viewer: *a page for
a markdown file. Open one. Nothing is written back.*

Open `index.html` for the whole thing on one page. It works offline, straight from the folder.

## The system in three lines

- **The mark** is the app's own `#`: IBM Plex Mono's, from the welcome screen. Its bars never
  cross the gap between its strokes, which no icon set's `#` does. Here it's set heavier and
  opened wider so that gap survives at 16 px.
- **The name** is set the way the app sets a page's H1: Source Serif 4, weight 560.
- **The rule:** the `#` and the name never share a line. `# Hash Block` is the markdown source
  of the title, and the page never shows it. The `#` goes where you see source (icon, favicon);
  the name goes where you read a page (titles, the README, a site). Where both are needed,
  stack them.

## What's where

| Folder | What | Use |
|---|---|---|
| `logo/svg/` | mark (tile), glyph (no tile), wordmark, stack: light, dark, black, white, `currentColor` | Prefer these. Every letter is outlined. |
| `logo/png/` | the same, rasterised; `mark-16.png` is the pixel drawing | Tools that can't take SVG |
| `app-icon/` | `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png`, `icon.ico`, `icon.icns`, plus 1024 masters | A drop-in for `desktop/src-tauri/icons/` |
| `favicon/` | `favicon.svg` (swaps to dark itself), `favicon.ico`, PNGs, touch and PWA icons | Any website or docs site |
| `social/` | `social-preview.png` (GitHub, 1280×640), `og-image.png` (1200×630), `readme-banner.png`, each light and dark | Link previews, posts, slides |
| `colour/` | `tokens.css`, `tokens.json` | The palette and every number in the system |
| `boards/` | the brand board, the in-context sheet, and `evidence/` (the round sheets BRAND.md cites) | Review |
| `source/` | the parametric source | Regenerate or change anything |
| `BRAND.md` | the guidelines, with every decision and who made it | Read before changing anything |

## In the repository

This is the pack `build_pack.py` built in the design folder on 2026-10-13, moved here whole. What the
product takes from it:

| Here | There |
|---|---|
| `app-icon/`, the six files `tauri.conf.json` names | `desktop/src-tauri/icons/`, copied file for file. Never regenerated with `tauri icon`: 16 and 32 px are a drawing of their own. |
| `logo/svg/glyph-current.svg` | The welcome screen. `desktop/src/main.ts` imports it from here, and the stylesheet colours it with `--accent`. |
| `colour/tokens.css` | Nothing: the app has the same five variables in `desktop/src/styles.css`, which is where they came from. |
| `social/social-preview.png` | The repository's social preview, uploaded by hand under Settings. |

The assets are generated, so a change goes in `source/`, not in them. `BRAND.md`, this file,
`index.html` and `pack-manifest.json` were brought up to date with the move; nothing else was
hand-edited.

## Fonts

None are included. Both faces are SIL OFL 1.1, and every letter in the artwork is already an
outline, so nothing here needs them. To set text in the brand faces, get them from upstream:
[Source Serif 4](https://github.com/adobe-fonts/source-serif) and
[IBM Plex Mono](https://github.com/IBM/plex). `source/` fetches them with `npm ci`.

## Licence

The code in saworbit/hshblk is MIT. The name and the mark are kept apart from that licence: they say
which project this is, and a fork should not look like it. The repository's README says the same.

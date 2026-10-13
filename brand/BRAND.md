# Hash Block: brand

> The design project's own guidelines, copied with only its paths changed. Its **Files** section describes the design folder, whose `dist/` is this folder's `logo/`, `favicon/`, `app-icon/`, `social/` and `colour/`. `README.md` says where everything is, and the round sheets it cites are in `boards/evidence/`.

Status: **design shipped, 2026-10-12. In the repository since 2026-10-13.** The integration was a separate pass, by the design process's own rule. It is recorded at the bottom, with the one step left.

Product: [saworbit/hshblk](https://github.com/saworbit/hshblk). The README puts it in one sentence: *"A page for a markdown file. Open one. Nothing is written back."* The repository is `hshblk`, the product is **Hash Block** (`tauri.conf.json` `productName`), and the bundle id is `dev.hshblk.reader`.

Brief type: **derived.** The repo carries a full corpus (README, `docs/hld.md`, `styles.css`, a welcome screen, a placeholder icon), but **no brand paragraph**: `grep -rin "logo|wordmark|icon|brand" docs/` finds nothing. That's the first miss in six sessions.

## The system in one line

**The mark is the welcome screen's own `#`.** That's IBM Plex Mono's, whose bars never cross the gap between its strokes. Here it's opened wider and set heavier, so the gap survives at 16 px.

**The name is the page's own H1.**

**The `#` and the name never share a line.** They're one markdown line in two states:
- `# Hash Block` is the source.
- **Hash Block** is the page.

Six-word test: *"a hash that is open in the middle."*

## Decisions, and who made them

| Decision | Inherited or chosen | Evidence |
|---|---|---|
| The mark is a `#` | **Shane**, round 1 lock: "Plex's open #" | `r1-sheet.png` |
| The `#` is Plex Mono 500's: its construction, 10° slant, bar heights, arm length and 8% thinner horizontals | inherited (welcome screen, `main.ts`, `.welcome-mark`) | `geom.PLEX`; `r2-check.png` overlays the parametric hash on the real glyph, edge for edge |
| Weight ×1.4, gap ×1.75 over Plex's | **chosen (taste)**, from a 3×3 grid | `r3-sheet.png`: below ×1.5 the gap closes at 16 px, and at ×2.0 the glyph splits in two |
| A separate 16 px drawing, snapped to whole pixels | chosen | `r4-grounds.png`: the master scaled to 16 is soft, and the pixel staircase (r4-c) loses the lean and reads as an upright `#` |
| The tile, radius 22% of the side | chosen | as the shipped icon, roughly |
| Wordmark: Source Serif 4, wght 560, tracking -0.01em | inherited (`.pg-h1` in `theme.ts`) | |
| Wordmark opsz 38 | inherited by arithmetic: the H1 is 2.1 × 1.125rem = 37.8 px, and the page uses `font-optical-sizing: auto` | |
| Palette, both themes | inherited (`styles.css`, "Paper by day, Ink by night") | `dist/tokens.json` |
| The `#` and the name never share a line | **recommended to Shane, and he hasn't vetoed it** | see "The rule" below |
| Stacked arrangement (tile above, name below) where both are needed | chosen | `stack.svg` |

## The rule: the `#` and the name never share a line

The README's first line is literally `# Hash Block`. GitHub and the app both render it as **Hash Block** alone; the `#` shows only when the caret enters the line (`docs/hld.md` §7). The identity follows the product:

- **Where you see source, the `#` lives:** the app icon, the favicon, the welcome screen, the taskbar and the dock.
- **Where you read a page, the name lives:** titles, the README banner, a site, an article.
- **Where both are needed** (an about box, the og:image, a store tile), stack them: the tile above, the name below. Never inline.

Three reasons, all observed rather than argued:
1. **It stutters.** Read aloud, `# Hash Block` is "hash Hash Block", the same failure as "d didi".
2. **It's a hashtag.** At a glance it reads as one.
3. **The page never shows it.** The product's own page never shows that line.

## Files

`python build.py` → `node raster.js` → `python board.py` → `node raster.js board`. That's the same order as Cloakroom, and it's load-bearing: `board.py` places the files `build.py` wrote, and `raster.js board` rasterises the board `board.py` wrote.

| Path | What |
|---|---|
| `dist/svg/mark`, `mark-dark` | the open hash on its tile, by day and by night |
| `dist/svg/glyph`, `-dark`, `-black`, `-white`, `-current` | the hash alone, for a ground that already exists; `-current` uses `currentColor` |
| `dist/svg/mark-black`, `mark-white` | one colour, with the glyph a real hole (`evenodd`) |
| `dist/svg/favicon` | the 16 px drawing, with `prefers-color-scheme` swapping it to Ink by night |
| `dist/svg/favicon-16`, `-16-dark` | the same, fixed per theme |
| `dist/svg/icon`, `icon-dark` | 1024 app icon, full-bleed as the shipped one is |
| `dist/svg/icon-macos` | 1024 on Apple's grid: an 824 body, radius 185.4, soft shadow |
| `dist/svg/wordmark`, `-dark`, `-black`, `-white`, `-current` | the name; clear space is half the cap height |
| `dist/svg/stack`, `stack-dark` | tile above name, for where both are needed |
| `dist/svg/readme-banner`, `-dark` | 1280×320: the name and the README's sentence, no `#` (a README is a page) |
| `dist/svg/og-image`, `-dark` | 1200×630: the stack and the sentence |
| `dist/svg/social-preview`, `-dark` | 1280×640, GitHub's social-preview size: the same composition |
| `dist/png/*` | every size from 16 to 1024; 16 is the pixel drawing, 24 and up the master |
| `dist/ico/favicon.ico` | 16 (pixel drawing), 32 (the same, doubled), 48 |
| `dist/tauri/*` | a drop-in for `desktop/src-tauri/icons/`, file for file: `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png`, `icon.ico` (16/24/32/48/64/256), `icon.icns` (10 entries) |
| `dist/tokens.json` | colours, geometry parameters, and the contrast report |
| `hshblk-brand-board.png`, `hshblk-in-context.png` | the board, and every icon at its true pixel size in a tab, a taskbar, the dock, a window and the welcome screen |

`build.py` stops the build if any SVG contains `<text>` or lacks a `<title>`, if any shipping pair is under 3:1, or if the 16 px drawing has an edge off the pixel grid.

### The portable pack

`python build_pack.py` assembles `pack/hshblk-brand/` and `pack/hshblk-brand.zip` from the files above. The pack is never hand-edited in the design folder. This folder is that pack, moved into the repository on 2026-10-13: its assets are as built, and this document, `README.md`, `index.html` and `pack-manifest.json` were brought up to date with the integration.

Its portability rules are checks, and the build stops on any of them:
- no absolute path, and no CR (the repo is `eol=lf`);
- every SVG outlined and well-formed;
- no font file;
- every `index.html` reference resolves;
- every icon `tauri.conf.json` names is present, 8-bit RGBA and the size its name says;
- full ICO and ICNS size sets;
- every file this document names is in the pack, or listed as not shipped;
- every file matches its sha256 in `pack-manifest.json`.

`python build_pack.py --fault` plants one violation of each rule in a scratch copy, and all 12 are caught. To prove it portable, unzip it anywhere, then `npm ci` and `python verify.py` in its `source/`. On 2026-10-13 that regenerated 83 of 83 assets byte for byte and served 45 of 45 page references.

## Checks run, and their results

**Contrast** (WCAG; `dist/tokens.json`):

| Pair | Ratio |
|---|---|
| mark on paper | 6.33 |
| mark on ink | 6.80 |
| name on paper | 15.16 |
| name on ink | 13.74 |
| sentence on paper | 5.04 |
| sentence on ink | 5.39 |
| light tile on a dark tab | 10.45 |
| dark tile on a light tab | 13.36 |
| **dark tile on a dark tab** | **1.45** |

The last pair is the one exception. There the tile vanishes and the mark's own 6.8:1 carries it, which `hshblk-in-context.png` shows in the dark tab strip.

**Greyscale by L\*:** the mark and its tile are 57.6 apart by day and 57.4 by night. The two themes are almost exactly balanced, and that came inherited.

**Geometry:**
- The slant is 9.99°: Plex's own, not a near-miss of 15°.
- The mark is 180° rotationally symmetric, as Plex's `#` is (computed).
- The farthest ink is 39.4 from the centre of a 100 tile, so a circular avatar crop keeps it whole.
- The smallest gap at 16 px is 2 px (1/8 of the canvas).

**Naive-viewer pass.** Checklist: jewellery, body parts, food, tools, road signs, household objects, anatomy, weapons, religious symbols, UI icons, app icons.

| Read | Verdict |
|---|---|
| Anatomy | Nothing. There are no circles anywhere. |
| Religious symbols | Nothing. No bar crosses a stroke on both sides, so there's no cross shape. |
| Weapons | Nothing. A double dagger needs two-sided arms. |
| A coat stand, chopsticks | Faint. |
| The right half alone, as an italic **F** (the left as a mirrored one) | Present at r2-d's wide gap, receded at ×1.75. |
| Code comment `//` | Harmless. |

**Competitors** (looked at, not searched):

- **Typora** ([typora.io](https://typora.io)), the end-state comparison in `hld.md` §1: a lowercase sans wordmark and no `#`.
- **HASH** ([hash.ai](https://hash.ai)), "a workspace for structured knowledge" built on the *Block Protocol*: an upright, square-cut `#`. That is the shipped placeholder's shape, and it's why r1-a died.
- **HASH, Slack, Discord and Lucide `hash`:** every one of their `#`s crosses in the middle, and this one does not.

## Audit findings, and what became of them

1. **The shipped icon** (`desktop/src-tauri/icons/`, in since the first commit) is an upright square-cut `#` that matches neither of the product's faces. The welcome screen draws Plex's `#` while the app icon draws a generic one. **Replaced** in the integration pass: `desktop/src-tauri/icons/` is `app-icon/`, file for file.
2. **The shipped icon is HASH's mark** in a different colour (seen at hash.ai/images/favicon.png on 2026-10-12; HASH's mark is not redistributed in this pack, so this copy of `r1-sheet.png` ends above the comparison). HASH is an adjacent category with a near-identical name. This is the highest-value thing to replace. **Replaced**, as above.
3. **`.welcome-mark` has no weight of its own.** It inherits the body's 460, and with only 400 and 500 loaded, CSS matching lands on 500. That's correct by accident. If 400 were ever the only weight loaded, the welcome `#` would go thin. **Moot**: the welcome screen now draws `glyph-current.svg`, not the font's glyph.

## Rounds

| Round | Territories | Candidates | Sheet | Result |
|---|---|---|---|---|
| 1 | 6 | 9 (`r1-a` … `r1-i`) | `r1-sheet.png`, `r1-16px-zoom.png` | 1 lives (b), 1 weak (c), 7 die, each with its collision named on the sheet. **Lock with Shane: Plex's open `#`.** |
| 2 | 1 | 8 (`r2-a` … `r2-h`) | `r2-sheet.png`, `r2-zoom.png`, `r2-check.png` | a, b: the gap closes at 16 px. d: it splits. e: reads as daggers. g: two-tone halves read as a slash plus an F. **c and f live.** |
| 3 | 1 | 9 (`r3-a1` … `r3-c3`) | `r3-sheet.png` | **r3-b2 (×1.4, ×1.75)**: the widest gap that's still one glyph |
| 4 | 1 | 4 (`r4-a`, `b`, `b2`, `c`) | `r4-grounds.png` | **r4-b**: a 2 px gap on whole pixels. b2's 3 px gap on half pixels blurs, and c's staircase loses the lean. |

Territories by round: 6 → 1 → 1 → 1.

## Skills used, and how

These are the house set plus the six Shane named (the digests stay in the design folder). None ran through an image model, because there's no key; their methods were applied by hand or in `build.py`.

- **kaankiziltug/logo-design:**
  - the near-miss-angle check (10° is Plex's, not 3° off 15°)
  - the detail floor (2 px of 16)
  - real holes only (`evenodd` one-colour)
  - the orientation test (180°-symmetric)
  - the familiarity test (HASH)
- **fatihaydost/brand-identity:**
  - one named defect per candidate per round
  - the reflex/cliché list: "initial in a rounded square" is the nearest tag, and is accepted for an app tile whose glyph is the product's own
  - greyscale by L*
  - compute, don't eyeball (geometry from measured Plex numbers)
- **b1rdmania/claude-brand-skills:** a size ladder at true pixels, and render before every presentation.
- **HermeticOrmus/design-mastery:**
  - a separate small drawing for 16 px
  - the circular-crop test
  - `currentColor` and `<title>` in every SVG
  - at most two type families (the product's own two)
- **cofoundy/brand-skills:** a competitor map by looking (Typora, HASH), and the category's clichés (hashtag, Slack, Discord, the document icon) named before drawing.
- **samuraigpt/logo-creator:** "at most three elements, flat, solid". The mark is two contours.
- **logo-generator, base-logo-generator and logo-colorway-generator:** their board structures informed `board.py`. Their image-model renders were not used.
- **ip-as-logo and mascot-logo-generator:** not applicable. This is a typographic mark, and ip-as-logo forbids a vector fallback.

## The integration pass, 2026-10-13

What the design left outstanding, and what the pass did with each:

1. **`desktop/src-tauri/icons/` is `app-icon/`**, file for file, and `tauri.conf.json` needed no change. Not regenerated with `tauri icon` from the 1024 PNG: that would resample 16 px from the master and lose the pixel drawing in `icon.ico` and `icon.icns`. `docs/desktop.md`'s file layout says so, beside the icons.
2. **The welcome screen draws `glyph-current.svg`**, inline, in `--accent`, in place of the font's `#`. `main.ts` imports the file from this folder, so the app and the pack share one drawing. Its box is 54 px: 3rem of Plex's `#` is 33.5 px of ink, and the drawing's ink is 62 % of its box, so the mark is the size the glyph was.
3. **The README has no banner.** Its first line is still `# Hash Block`, the wordmark's source, and GitHub sets it as the page's H1: that's the rule working. It gained one line under *More*, pointing here, and the licence sentence below. `readme-banner.png` stays for places that show a picture instead of rendering markdown, such as a release post or a talk slide.
4. **The GitHub social preview is still to do, by hand:** Settings → General → Social preview, upload `social/social-preview.png` (1280×640, GitHub's own size). GitHub has no API for it, so no commit can. `og-image.png` (1200×630) is for any site.
5. **The licence:** the code is MIT, and the name and the mark are kept apart from it, so a fork does not look like this project. The README says so, in one line, which is all it takes to reverse.

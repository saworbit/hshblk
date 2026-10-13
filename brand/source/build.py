"""Hash Block identity: the one source of truth. Everything in dist/svg comes from
here, and dist/png and dist/ico come from dist/svg (raster.js).

The system in one line: the mark is the welcome screen's own '#', IBM Plex Mono's,
whose bars never cross the gap between its strokes, opened wider and set heavier so
that gap survives at 16 px. The name is the page's own H1. The '#' and the name are
one markdown line in two states, source and page, so they never share a line.

Inherited, not chosen (saworbit/hshblk, desktop/src/styles.css and page/theme.ts):
  palette  --paper --ink --muted --accent --rule, both themes ("Paper by day, Ink by night")
  mark     Plex Mono 500's numbersign: its construction, slant, bar positions, arm length,
           and its 8 % thinner horizontals (geom.PLEX, measured, proven by r2-check.png)
  wordmark Source Serif 4, wght 560, tracking -0.01em, as .pg-h1 sets it; opsz 38 is the
           axis value the page reaches for its H1 (2.1 x 1.125rem = 37.8 px, opsz auto)
Chosen, and said so:
  weight x1.4 and gap x1.75 over Plex's (r3-sheet.png: the gap closes below x1.5 at
  16 px and the glyph splits in two at x2.0), the 16 px drawing (r4-grounds.png), the
  tile radius (22 % of the side), and the stacked arrangement for places that need both.
"""
import json
import os

from geom import open_hash, open_hash_16
from glyphs import text, text_ink

# ---------------------------------------------------------------- parameters
MASTER = dict(h=62, weight=1.4, gapx=1.75)      # r3-b2, on a 100 tile
SIXTEEN = dict(lt=6, rt=10, la=3, ra=13)        # r4-b, on a 16 grid
TILE_R = 22                                     # of 100
WORD = dict(name="serif", wght=560, opsz=38, track=-0.01)

C = {
    "light": dict(ground="#f3eee6", mark="#8f3d2b", text="#1c1915", muted="#6c6459", rule="#e4d9c8"),
    "dark": dict(ground="#1c1915", mark="#e08c71", text="#ebe3d5", muted="#948e84", rule="#3a332b"),
}
TAGLINE = "A page for a markdown file. Open one. Nothing is written back."   # README, line 3

OUT = "dist/svg"


# ---------------------------------------------------------------- colour maths
def lum(hexc):
    r, g, b = (int(hexc[i:i + 2], 16) / 255 for i in (1, 3, 5))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def contrast(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


# ---------------------------------------------------------------- pieces
def hash_paths(**over):
    return open_hash(**{**MASTER, **over})


def glyph_g(fill, cx=50, cy=50, scale=1.0):
    """The open hash alone, in a 100 box, optionally scaled about (cx, cy)."""
    l, r = hash_paths(cx=cx, cy=cy, h=MASTER["h"] * scale)
    return f'<path d="{l}" fill="{fill}"/><path d="{r}" fill="{fill}"/>'


def tile_g(theme, size=100, x=0, y=0, edge=False):
    """The mark on its tile. edge: a 1 px hairline in --rule, for when the tile sits on
    its own ground (an about box, the og:image) and would otherwise not exist."""
    c = C[theme]
    k = size / 100
    stroke = f' stroke="{c["rule"]}" stroke-width="{1 / k:.3f}"' if edge else ""
    return (f'<g transform="translate({x},{y}) scale({k})">'
            f'<rect width="100" height="100" rx="{TILE_R}" fill="{c["ground"]}"{stroke}/>{glyph_g(c["mark"])}</g>')


def wordmark_paths(size, x=0, y=0):
    """Path data and ink box for the name, baseline at y."""
    d, adv, bb = text_ink("Hash Block", WORD["name"], size, x, y, WORD["wght"], WORD["opsz"], WORD["track"])
    return d, bb


def svg(w, h, body, title=None, vb=None):
    t = f"<title>{title}</title>" if title else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
            f'viewBox="{vb or f"0 0 {w} {h}"}" role="img">{t}{body}</svg>\n')


# ---------------------------------------------------------------- assets
def assets():
    a = {}
    L, D = C["light"], C["dark"]
    # the mark: the open hash on its tile. Light is the page by day, dark by night.
    a["mark"] = svg(100, 100, tile_g("light"), "Hash Block")
    a["mark-dark"] = svg(100, 100, tile_g("dark"), "Hash Block")
    # the glyph alone, for places that already have a ground
    for nm, fill in (("glyph", L["mark"]), ("glyph-dark", D["mark"]), ("glyph-black", "#000000"),
                     ("glyph-white", "#ffffff"), ("glyph-current", "currentColor")):
        a[nm] = svg(100, 100, glyph_g(fill), "Hash Block")
    # one-colour tiles: the glyph knocked out of a solid tile (real holes, evenodd)
    l, r = hash_paths()
    tile_path = (f"M{TILE_R} 0H{100 - TILE_R}A{TILE_R} {TILE_R} 0 0 1 100 {TILE_R}V{100 - TILE_R}"
                 f"A{TILE_R} {TILE_R} 0 0 1 {100 - TILE_R} 100H{TILE_R}A{TILE_R} {TILE_R} 0 0 1 0 {100 - TILE_R}"
                 f"V{TILE_R}A{TILE_R} {TILE_R} 0 0 1 {TILE_R} 0Z")
    for nm, fill in (("mark-black", "#000000"), ("mark-white", "#ffffff")):
        a[nm] = svg(100, 100, f'<path d="{tile_path} {l} {r}" fill="{fill}" fill-rule="evenodd"/>', "Hash Block")

    # favicon: the 16 px drawing, which is also exact at 32. It swaps to Ink by night.
    fl, fr = open_hash_16(**SIXTEEN)
    style = (f"<style>.g{{fill:{L['ground']}}}.m{{fill:{L['mark']}}}"
             f"@media (prefers-color-scheme:dark){{.g{{fill:{D['ground']}}}.m{{fill:{D['mark']}}}}}</style>")
    r16 = round(TILE_R * 16 / 100, 2)
    a["favicon"] = svg(16, 16, f'{style}<rect class="g" width="16" height="16" rx="{r16}"/>'
                               f'<path class="m" d="{fl}"/><path class="m" d="{fr}"/>', "Hash Block")
    for theme in ("light", "dark"):
        c = C[theme]
        a[f"favicon-16{'-dark' if theme == 'dark' else ''}"] = svg(
            16, 16, f'<rect width="16" height="16" rx="{r16}" fill="{c["ground"]}"/>'
                    f'<path d="{fl}" fill="{c["mark"]}"/><path d="{fr}" fill="{c["mark"]}"/>', "Hash Block")

    # app icons. `icon` is full-bleed, as the shipped icon is; `icon-macos` sits on
    # Apple's 1024 grid (an 824 body, radius 185.4, centred), which macOS does not do for you.
    a["icon"] = svg(1024, 1024, tile_g("light", 1024), "Hash Block")
    a["icon-dark"] = svg(1024, 1024, tile_g("dark", 1024), "Hash Block")
    k = 824 / 100
    body = (f'<defs><filter id="s" x="-10%" y="-10%" width="120%" height="125%">'
            f'<feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="0.22"/></filter></defs>'
            f'<g transform="translate(100,100)"><rect width="824" height="824" rx="185.4" fill="{L["ground"]}" filter="url(#s)"/>'
            f'<g transform="scale({k})">{glyph_g(L["mark"])}</g></g>')
    a["icon-macos"] = svg(1024, 1024, body, "Hash Block")

    # the wordmark: the page's H1, nothing added. Clear space is the cap height / 2.
    for nm, fill in (("wordmark", L["text"]), ("wordmark-dark", D["text"]),
                     ("wordmark-black", "#000000"), ("wordmark-white", "#ffffff"),
                     ("wordmark-current", "currentColor")):
        d, (x0, y0, x1, y1) = wordmark_paths(100, 0, 100)
        pad = (y1 - y0) / 2 * 0.5
        w, h = x1 - x0 + 2 * pad, y1 - y0 + 2 * pad
        a[nm] = svg(round(w, 1), round(h, 1), f'<path d="{d}" fill="{fill}"/>', "Hash Block",
                    vb=f"{x0 - pad:.2f} {y0 - pad:.2f} {w:.2f} {h:.2f}")

    # stacked: for the few places that need both (an about box, a store tile). The tile
    # sits above the name, never beside it: a '#' then the name on one line is the
    # markdown source of the title, and the page never shows that line.
    for theme in ("light", "dark"):
        c = C[theme]
        d, (x0, y0, x1, y1) = wordmark_paths(64, 0, 0)
        ww = x1 - x0
        W = max(ww, 160) + 80
        tile_s = 160
        tx = (W - tile_s) / 2
        base = 40 + tile_s + 48 - y0          # baseline so the cap top sits 48 below the tile
        d, (x0, y0, x1, y1) = wordmark_paths(64, (W - ww) / 2 - x0, base)
        H = y1 + 40
        body = (f'<rect width="{W:.1f}" height="{H:.1f}" fill="{c["ground"]}"/>'
                f'{tile_g(theme, tile_s, tx, 40, edge=True)}<path d="{d}" fill="{c["text"]}"/>')
        a[f"stack{'-dark' if theme == 'dark' else ''}"] = svg(round(W, 1), round(H, 1), body, "Hash Block")

    # README banner: a README is a page, so it gets the page's half: the name and the
    # repository's own sentence, no '#'.
    for theme in ("light", "dark"):
        c = C[theme]
        W, H = 1280, 320
        d, (x0, y0, x1, y1) = wordmark_paths(112, 0, 0)
        d, (x0, y0, x1, y1) = wordmark_paths(112, (W - (x1 - x0)) / 2 - x0, 168)
        t, tadv, (tx0, ty0, tx1, ty1) = text_ink(TAGLINE, "serif", 30, 0, 0, 460, 20)
        t, _, _ = text_ink(TAGLINE, "serif", 30, (W - (tx1 - tx0)) / 2 - tx0, 236, 460, 20)
        body = (f'<rect width="{W}" height="{H}" fill="{c["ground"]}"/>'
                f'<path d="{d}" fill="{c["text"]}"/><path d="{t}" fill="{c["muted"]}"/>')
        a[f"readme-banner{'-dark' if theme == 'dark' else ''}"] = svg(W, H, body, "Hash Block")

    # og:image, 1200 x 630, and GitHub's social preview, 1280 x 640 (its own
    # recommended size; a 1200 x 630 upload is cropped to 2:1). The stack and the sentence.
    for kind, W, H, theme in (("og-image", 1200, 630, "light"), ("og-image", 1200, 630, "dark"),
                              ("social-preview", 1280, 640, "light"), ("social-preview", 1280, 640, "dark")):
        c = C[theme]
        ts, gap1, gap2 = 176, 56, 44          # tile; tile to cap top; name to sentence (ink)
        _, (_, wy0, _, wy1) = wordmark_paths(84, 0, 0)
        _, _, (tx0, ty0, tx1, ty1) = text_ink(TAGLINE, "serif", 30, 0, 0, 460, 20)
        top = (H - (ts + gap1 + (wy1 - wy0) + gap2 + (ty1 - ty0))) / 2   # the block, centred
        d, (x0, y0, x1, y1) = wordmark_paths(84, 0, 0)
        d, (x0, y0, x1, y1) = wordmark_paths(84, (W - (x1 - x0)) / 2 - x0, top + ts + gap1 - wy0)
        t, _, _ = text_ink(TAGLINE, "serif", 30, (W - (tx1 - tx0)) / 2 - tx0, y1 + gap2 - ty0, 460, 20)
        tile = tile_g(theme, ts, (W - ts) / 2, top, edge=True)
        body = (f'<rect width="{W}" height="{H}" fill="{c["ground"]}"/>{tile}'
                f'<path d="{d}" fill="{c["text"]}"/><path d="{t}" fill="{c["muted"]}"/>')
        a[f"{kind}{'-dark' if theme == 'dark' else ''}"] = svg(W, H, body, "Hash Block")
    return a


# ---------------------------------------------------------------- checks
def checks(a):
    """Claims in BRAND.md that are checks, not prose. A failed check stops the build."""
    bad = []
    for nm, s in a.items():
        if "<text" in s:
            bad.append(f"{nm}: <text> would render against the machine's fonts")
        if "<title>" not in s:
            bad.append(f"{nm}: no <title>")
    pairs = {
        "mark on its tile (light)": (C["light"]["mark"], C["light"]["ground"]),
        "mark on its tile (dark)": (C["dark"]["mark"], C["dark"]["ground"]),
        "wordmark on paper": (C["light"]["text"], C["light"]["ground"]),
        "wordmark on ink": (C["dark"]["text"], C["dark"]["ground"]),
        "tagline on paper": (C["light"]["muted"], C["light"]["ground"]),
        "tagline on ink": (C["dark"]["muted"], C["dark"]["ground"]),
        "light tile on a dark tab strip": (C["light"]["ground"], "#35363a"),
        "dark tile on a light tab strip": (C["dark"]["ground"], "#dee1e6"),
        "dark tile on a dark tab strip": (C["dark"]["ground"], "#35363a"),
    }
    report = {k: round(contrast(*v), 2) for k, v in pairs.items()}
    # the bar is 3:1 (a logo is large text). The dark tile on a dark strip is the one
    # pair that cannot meet it, so a dark-theme favicon relies on the mark's own 6.8:1.
    for k, v in report.items():
        if v < 3 and k != "dark tile on a dark tab strip":
            bad.append(f"contrast {k}: {v}")
    # the 16 px drawing: every horizontal edge and every stroke end on a whole pixel
    fl, fr = open_hash_16(**SIXTEEN)
    import re
    ys = [float(m) for m in re.findall(r"[ML][-\d.]+ ([-\d.]+)", fl + fr)]
    if any(abs(y - round(y)) > 1e-6 for y in ys):
        bad.append("favicon-16: a horizontal edge is off the pixel grid")
    return bad, report


def main():
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        os.remove(os.path.join(OUT, f))
    a = assets()
    bad, report = checks(a)
    for nm, s in a.items():
        with open(os.path.join(OUT, nm + ".svg"), "w", encoding="utf-8", newline="\n") as f:
            f.write(s)
    with open("dist/tokens.json", "w", encoding="utf-8", newline="\n") as f:
        json.dump({"colours": C, "master": MASTER, "sixteen": SIXTEEN, "tile_radius": TILE_R,
                   "wordmark": WORD, "contrast": report}, f, indent=2)
    print(f"{len(a)} svgs -> {OUT}")
    for k, v in report.items():
        print(f"  {v:>5}  {k}")
    if bad:
        raise SystemExit("CHECKS FAILED:\n  " + "\n  ".join(bad))
    print("checks: pass")


if __name__ == "__main__":
    main()

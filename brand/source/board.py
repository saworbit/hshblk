"""The brand board and the in-context sheet. Both place the real files from dist/svg
(nested <svg>), so neither can drift from what ships. Run after build.py; then
`node raster.js board` rasterises them.
"""
import itertools
import re

from build import C, MASTER, TILE_R, contrast
from geom import open_hash
from glyphs import glyph, text, text_ink

L, D = C["light"], C["dark"]
_IDS = itertools.count(1)


def place(name, x, y, w, h=None):
    """A dist/svg asset, nested at (x, y), w wide (height from its own aspect)."""
    s = open(f"dist/svg/{name}.svg", encoding="utf-8").read()
    vb = re.search(r'viewBox="([^"]+)"', s).group(1)
    vx, vy, vw, vh = map(float, vb.split())
    h = h or w * vh / vw
    inner = re.sub(r"^<svg[^>]*>|</svg>\s*$", "", s.strip())
    inner = re.sub(r"<title>.*?</title>", "", inner)
    # a nested asset's filter id must be unique in the board, and stable between runs
    # (Python's hash() of a str is salted per process, which broke byte-identical rebuilds)
    uid = f"s{next(_IDS)}"
    inner = inner.replace('id="s"', f'id="{uid}"').replace("url(#s)", f"url(#{uid})")
    return f'<svg x="{x}" y="{y}" width="{w}" height="{h:.2f}" viewBox="{vb}">{inner}</svg>'


def t(s, x, y, size=13, face="mono400", fill=None, **kw):
    d, adv = text(s, face, size, x, y, **kw)
    return f'<path d="{d}" fill="{fill or L["text"]}"/>', adv


def serif(s, x, y, size, wght=560, fill=None, opsz=None):
    return t(s, x, y, size, "serif", fill, wght=wght, opsz=opsz or min(60, max(8, size)))[0]


def label(s, x, y, fill=None, size=12):
    return t(s, x, y, size, "mono500", fill or L["muted"])[0]


# ---------------------------------------------------------------- brand board
def board(path="hshblk-brand-board.svg"):
    W, H = 1600, 2170
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
         f'<rect width="{W}" height="{H}" fill="#fbf9f5"/>']
    o.append(label("HASH BLOCK / IDENTITY / 2026-10-12", 64, 64, size=13))
    o.append(place("wordmark", 64, 96, 520))

    # 1. the mark, by day and by night
    y = 300
    o.append(label("THE MARK  the welcome screen's own #, opened and weighted", 64, y))
    o.append(place("mark", 64, y + 24, 300))
    o.append(place("mark-dark", 388, y + 24, 300))

    # 2. construction: Plex Mono 500's '#' (outline) under the mark (fill)
    cx0, cy0 = 740, y + 24
    o.append(f'<rect x="{cx0}" y="{cy0}" width="300" height="300" rx="16" fill="#ffffff" stroke="{L["rule"]}"/>')
    k = 3.0
    l, r = open_hash(**MASTER)
    o.append(f'<g transform="translate({cx0},{cy0}) scale({k})"><path d="{l} {r}" fill="{L["mark"]}" opacity="0.9"/>'
             f'<path d="{" ".join(open_hash(h=MASTER["h"]))}" fill="none" stroke="{L["text"]}" stroke-width="0.35"/></g>')
    o.append(label("outline: Plex Mono 500, as drawn", cx0, cy0 + 324))
    o.append(label("fill: the mark, weight x1.4, gap x1.75", cx0, cy0 + 342))
    notes = ["The bars stop at each stroke. Nothing",
             "crosses the gap, so the glyph is two",
             "halves, and no icon set's # is open.",
             "",
             "Slant, bar heights, arm length and the",
             "8% thinner horizontals are Plex's own.",
             "Only weight and gap are chosen: below",
             "x1.5 the gap closes at 16 px; at x2.0",
             "the glyph splits in two (r3-sheet.png)."]
    for i, n in enumerate(notes):
        o.append(t(n, 1076, y + 44 + i * 21, 13, "mono400", L["text"])[0])

    # 3. sizes, at true size
    y = 720
    o.append(label("SIZES  true pixels; 16 is drawn on its own grid (r4-b), 24 and up is the master", 64, y))
    x = 64
    for s, nm in ((16, "favicon-16"), (24, "mark"), (32, "mark"), (48, "mark"), (64, "mark"), (128, "mark")):
        o.append(place(nm, x, y + 24 + (128 - s), s))
        o.append(place(nm.replace("mark", "mark-dark").replace("favicon-16", "favicon-16-dark"), x, y + 170 + (128 - s), s))
        o.append(label(str(s), x, y + 316))
        x += s + 40
    # on the grounds a favicon meets
    gx = 760
    for j, (bg, nm) in enumerate((("#ffffff", "white"), ("#dee1e6", "light tab"), ("#35363a", "dark tab"))):
        o.append(f'<rect x="{gx + j * 120}" y="{y + 24}" width="104" height="104" fill="{bg}" stroke="{L["rule"]}"/>')
        o.append(place("favicon-16", gx + j * 120 + 44, y + 44, 16))
        o.append(place("favicon-16-dark", gx + j * 120 + 44, y + 92, 16))
        o.append(label(nm, gx + j * 120, y + 146))
    o.append(t("light and dark favicons on each ground; the SVG favicon", gx, y + 190, 13)[0])
    o.append(t("swaps itself by prefers-color-scheme.", gx, y + 210, 13)[0])

    # 4. the rule: one line, two states
    y = 1080
    o.append(label("THE RULE  the # and the name are one markdown line in two states, so they never share a line", 64, y))
    o.append(f'<rect x="64" y="{y + 24}" width="1472" height="270" rx="16" fill="#ffffff" stroke="{L["rule"]}"/>')
    hd, hadv = text("#", "mono500", 46, 104, y + 106)
    o.append(f'<path d="{hd}" fill="{L["mark"]}"/>')
    o.append(t(" Hash Block", 104 + hadv, y + 106, 46, "mono500", L["muted"])[0])
    o.append(label("SOURCE  where you see syntax: the app icon, the favicon, the welcome screen. The # lives here.", 104, y + 142))
    o.append(serif("Hash Block", 104, y + 236, 64, 560, L["text"], 38))
    o.append(label("PAGE  where you read: titles, the README, a site. The name lives here, set as the page's H1.", 104, y + 270))
    o.append(f'<line x1="900" y1="{y + 48}" x2="900" y2="{y + 270}" stroke="{L["rule"]}"/>')
    for i, n in enumerate(["The README's first line is literally",
                           "`# Hash Block`, and GitHub and the app",
                           "both show only 'Hash Block'. Set side",
                           "by side, the line reads aloud as",
                           "'hash Hash Block' and looks like a",
                           "hashtag. When both are needed, stack",
                           "them: the tile above, the name below."]):
        o.append(t(n, 932, y + 72 + i * 22, 14)[0])

    # 5. stacked, wordmark, one-colour
    y = 1400
    o.append(label("WHERE BOTH ARE NEEDED  stacked, never inline", 64, y))
    o.append(place("stack", 64, y + 24, 300))
    o.append(place("stack-dark", 388, y + 24, 300))
    o.append(label("ONE COLOUR  the glyph is a real hole (evenodd)", 760, y))
    o.append(place("mark-black", 760, y + 24, 120))
    o.append(f'<rect x="900" y="{y + 24}" width="120" height="120" fill="#1c1915"/>')
    o.append(place("mark-white", 900, y + 24, 120))
    o.append(f'<rect x="1040" y="{y + 24}" width="120" height="120" fill="{L["mark"]}"/>')
    o.append(place("glyph-white", 1050, y + 34, 100))
    o.append(place("glyph", 1180, y + 24, 120))

    # 6. palette, inherited
    y = 1745
    o.append(label("PALETTE  inherited from styles.css, both themes. Nothing here was chosen.", 64, y))
    sw = [("paper", "ground"), ("ink", "text"), ("muted", "muted"), ("accent", "mark"), ("rule", "rule")]
    for i, (nm, key) in enumerate(sw):
        x = 64 + i * 200
        o.append(f'<rect x="{x}" y="{y + 24}" width="180" height="72" fill="{L[key]}" stroke="{L["rule"]}"/>')
        o.append(f'<rect x="{x}" y="{y + 96}" width="180" height="72" fill="{D[key]}"/>')
        o.append(label(f"--{nm}", x, y + 192, L["text"]))
        o.append(label(f"{L[key]}  {D[key]}", x, y + 210))
    o.append(label("CONTRAST", 1100, y + 40, L["text"]))
    for i, (a, b, n) in enumerate(((L["mark"], L["ground"], "mark on paper"), (D["mark"], D["ground"], "mark on ink"),
                                   (L["text"], L["ground"], "name on paper"), (D["text"], D["ground"], "name on ink"))):
        o.append(label(f"{contrast(a, b):5.2f}  {n}", 1100, y + 66 + i * 22))

    # 7. type
    y = 2010
    o.append(label("TYPE  the product's own two faces", 64, y))
    o.append(serif("Source Serif 4  560", 64, y + 56, 34, 560, L["text"], 38))
    o.append(label("the name; the page's H1, tracking -0.01em, opsz 38", 64, y + 84))
    o.append(t("IBM Plex Mono 500", 760, y + 56, 30, "mono500", L["text"])[0])
    o.append(label("the mark's source glyph; the app's chrome", 760, y + 84))
    o.append("</svg>")
    open(path, "w", encoding="utf-8", newline="\n").write("\n".join(o))


# ---------------------------------------------------------------- in context
def context(path="hshblk-in-context.svg"):
    W, H = 1600, 1180
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
         '<rect width="100%" height="100%" fill="#ffffff"/>']
    o.append(label("HASH BLOCK / IN CONTEXT  every icon at its true pixel size", 48, 48, size=13))

    # browser tab strips, light and dark: favicon at 16
    for j, (strip, tab, ink, fav) in enumerate((("#dee1e6", "#ffffff", "#1f1f1f", "favicon-16"),
                                                ("#202124", "#35363a", "#e8eaed", "favicon-16-dark"))):
        y = 80 + j * 64
        o.append(f'<rect x="48" y="{y}" width="720" height="48" fill="{strip}"/>')
        o.append(f'<path d="M64 {y + 48}V{y + 14}a8 8 0 0 1 8 -8H300a8 8 0 0 1 8 8V{y + 48}Z" fill="{tab}"/>')
        o.append(place(fav, 80, y + 19, 16))
        o.append(t("Hash Block", 106, y + 32, 13, "mono400", ink)[0])
        o.append(f'<rect x="324" y="{y + 18}" width="16" height="16" rx="3" fill="#9aa0a6"/>')
        o.append(t("Another tab", 348, y + 32, 13, "mono400", ink)[0])
    o.append(label("browser tabs, light and dark, 16 px", 48, 228))

    # Windows taskbar, 24 px icons at 100 %, and 32 at 150 %
    o.append(f'<rect x="820" y="80" width="732" height="48" fill="#202020"/>')
    for i in range(6):
        x = 1000 + i * 48
        if i == 3:
            o.append(f'<rect x="{x - 8}" y="84" width="40" height="40" rx="4" fill="#3a3a3a"/>')
            o.append(place("mark", x, 92, 24))
            o.append(f'<rect x="{x + 4}" y="122" width="16" height="3" rx="1.5" fill="#76b9ed"/>')
        else:
            o.append(f'<rect x="{x}" y="92" width="24" height="24" rx="5" fill="#5f6368"/>')
    o.append(f'<rect x="820" y="144" width="732" height="64" fill="#202020"/>')
    for i in range(6):
        x = 960 + i * 64
        if i == 3:
            o.append(place("mark", x, 160, 32))
        else:
            o.append(f'<rect x="{x}" y="160" width="32" height="32" rx="7" fill="#5f6368"/>')
    o.append(label("Windows taskbar, 24 px and 32 px", 820, 228))

    # macOS dock
    o.append(f'<rect x="48" y="268" width="720" height="104" rx="26" fill="#e6e3df" stroke="#d2cec8"/>')
    for i in range(7):
        x = 84 + i * 94
        if i == 3:
            o.append(place("icon-macos", x - 10, 268 + 10 - 4, 84))
        else:
            o.append(f'<rect x="{x}" y="284" width="64" height="64" rx="14.4" fill="#b8b3ab"/>')
    o.append(label("macOS dock, 64 pt body on Apple's 1024 grid", 48, 396))

    # the window: title bar, then a page as the app draws it
    wx, wy, ww, wh = 48, 440, 760, 700
    o.append(f'<rect x="{wx}" y="{wy}" width="{ww}" height="{wh}" rx="10" fill="{L["ground"]}" stroke="#cfc8bd"/>')
    o.append(f'<path d="M{wx} {wy + 40}H{wx + ww}" stroke="{L["rule"]}"/>')
    o.append(place("favicon-16", wx + 16, wy + 12, 16))
    o.append(t("README.md", wx + 42, wy + 25, 12.5, "mono400", L["text"])[0])
    px = wx + 96
    o.append(serif("Hash Block", px, wy + 128, 37.8, 560, L["text"], 38))
    for i, line in enumerate(["A page for a markdown file. Double-click one and",
                              "it opens in a window of its own, typeset, not in a",
                              "browser. The characters stay in the file. Nothing",
                              "here writes them back."]):
        o.append(serif(line, px, wy + 184 + i * 30.6, 18, 460, L["text"], 18))
    o.append(serif("The desktop app", px, wy + 346, 27, 560, L["text"], 27))
    for i, line in enumerate(["Packages for Linux, macOS, and Windows come from",
                              "the Desktop workflow on main."]):
        o.append(serif(line, px, wy + 392 + i * 30.6, 18, 460, L["text"], 18))
    # the caret in a heading: its syntax shows (hld.md section 7), in the heading's own face
    hd, hadv = text("# ", "serif", 27, px, wy + 498, wght=560, opsz=27)
    o.append(f'<path d="{hd}" fill="{L["text"]}"/>')
    o.append(serif("More", px + hadv, wy + 498, 27, 560, L["text"], 27))
    o.append(f'<rect x="{px + hadv - 1}" y="{wy + 474}" width="2" height="30" fill="{L["mark"]}"/>')
    o.append(label("the caret in a heading: its syntax shows", px + 120, wy + 492))
    o.append(f'<rect x="{wx}" y="{wy + wh - 36}" width="{ww}" height="36" fill="{L["ground"]}"/>')
    o.append(f'<path d="M{wx} {wy + wh - 36}H{wx + ww}" stroke="{L["rule"]}"/>')
    o.append(t("README.md   Modified 12 Oct 2026   Copy and find work on the source", wx + 16, wy + wh - 14, 11.5,
               "mono400", L["muted"])[0])

    # the welcome screen, by night: the mark at home
    vx, vy, vw, vh = 856, 280, 696, 860
    o.append(f'<rect x="{vx}" y="{vy}" width="{vw}" height="{vh}" rx="10" fill="{D["ground"]}"/>')
    # 3rem of Plex is 33.5 px of ink (0.698 em); the asset's ink is 62 % of its box
    gw = 48 * 0.698 / 0.62
    o.append(place("glyph-dark", vx + (vw - gw) / 2, vy + 330, gw))
    bw = 280
    o.append(f'<rect x="{vx + (vw - bw) / 2}" y="{vy + 400}" width="{bw}" height="46" rx="23" fill="{D["text"]}"/>')
    d, adv = text("Open a markdown file", "mono400", 15, 0, 0)
    o.append(t("Open a markdown file", vx + (vw - adv) / 2, vy + 428, 15, "mono400", D["ground"])[0])
    d, adv = text("or drop one on this window", "mono400", 12.8, 0, 0)
    o.append(t("or drop one on this window", vx + (vw - adv) / 2, vy + 482, 12.8, "mono400", D["muted"])[0])
    o.append(label("the welcome screen (main.ts), Ink by night, the mark at the font #'s own 3rem",
                   vx, vy + vh + 24 if vy + vh + 24 < H else vy - 12))
    o.append("</svg>")
    open(path, "w", encoding="utf-8", newline="\n").write("\n".join(o))


if __name__ == "__main__":
    board()
    context()

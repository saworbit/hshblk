"""Glyph outlines as SVG path data, so letters are geometry, not <text>.

resvg would render <text> against whatever fonts the machine has, which makes a
render unreproducible. Every letter in this project goes through here.

Both faces are the product's own (desktop/src/styles.css in saworbit/hshblk):
  --serif  Source Serif 4 Variable, opsz axis (fontsource "opsz" file: wght 200-900,
           opsz 8-60). The page sets body 460, headings 560, strong 650.
  --mono   IBM Plex Mono 400 and 500. The welcome screen's "#" is Plex Mono, accent.
Shaping (kerning) is HarfBuzz on the instanced font, so a wordmark is spaced the
way the page would space it.
"""
import io
import os
from functools import lru_cache

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

HERE = os.path.dirname(os.path.abspath(__file__))
# Both are SIL OFL 1.1, fetched by `npm ci` (package-lock.json pins the bytes), so
# no font file is copied into this folder or into the brand pack.
_SS = "node_modules/@fontsource-variable/source-serif-4/files/"
_PX = "node_modules/@fontsource/ibm-plex-mono/files/"
FONTS = {
    "serif": _SS + "source-serif-4-latin-opsz-normal.woff2",
    "mono400": _PX + "ibm-plex-mono-latin-400-normal.woff2",
    "mono500": _PX + "ibm-plex-mono-latin-500-normal.woff2",
    "mono600": _PX + "ibm-plex-mono-latin-600-normal.woff2",
    "mono700": _PX + "ibm-plex-mono-latin-700-normal.woff2",
}


@lru_cache(maxsize=None)
def load(name, wght=None, opsz=None):
    """(TTFont, hb.Font) for a face, instanced when it is variable."""
    f = TTFont(os.path.join(HERE, FONTS[name]))
    if "fvar" in f:
        axes = {}
        if wght is not None:
            axes["wght"] = wght
        if opsz is not None:
            axes["opsz"] = opsz
        f = instantiateVariableFont(f, axes)
    f.flavor = None
    buf = io.BytesIO()
    f.save(buf)
    data = buf.getvalue()
    f = TTFont(io.BytesIO(data))
    hbf = hb.Font(hb.Face(data))
    return f, hbf


def _outline(f, gname, x, y, scale):
    gs = f.getGlyphSet()
    pen = SVGPathPen(gs)
    # font units, y up -> SVG px, y down; baseline at y
    gs[gname].draw(TransformPen(pen, (scale, 0, 0, -scale, x, y)))
    return pen.getCommands()


def text(s, name, size, x=0.0, y=0.0, wght=None, opsz=None, track=0.0, features=None):
    """Path data for a string set at `size` px with its baseline at y.

    track is in em, as CSS letter-spacing (added after every glyph, the last
    one included, which is what a browser does). Returns (d, advance_px)."""
    if not s:
        return "", 0.0
    f, hbf = load(name, wght, opsz)
    upem = f["head"].unitsPerEm
    scale = size / upem
    buf = hb.Buffer()
    buf.add_str(s)
    buf.guess_segment_properties()
    hb.shape(hbf, buf, features or {"kern": True, "liga": True})
    order = f.getGlyphOrder()
    d, pen_x = [], x
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        g = order[info.codepoint]
        d.append(_outline(f, g, pen_x + pos.x_offset * scale, y - pos.y_offset * scale, scale))
        pen_x += pos.x_advance * scale + track * size
    return " ".join(c for c in d if c), pen_x - x


def bounds(s, name, wght=None, opsz=None):
    """Ink bounds of a single glyph in font units: (xMin, yMin, xMax, yMax), advance."""
    f, _ = load(name, wght, opsz)
    cmap = f.getBestCmap()
    g = cmap[ord(s)]
    gs = f.getGlyphSet()
    from fontTools.pens.boundsPen import BoundsPen
    bp = BoundsPen(gs)
    gs[g].draw(bp)
    return bp.bounds, f["hmtx"][g][0], f["head"].unitsPerEm


def glyph(ch, name, size, cx, cy, wght=None, opsz=None):
    """One glyph, its ink box centred on (cx, cy). Returns path data."""
    (x0, y0, x1, y1), _, upem = bounds(ch, name, wght, opsz)
    s = size / upem
    x = cx - (x0 + x1) / 2 * s
    y = cy + (y0 + y1) / 2 * s
    d, _ = text(ch, name, size, x, y, wght, opsz, features={"kern": False})
    return d


def text_ink(s, name, size, x=0.0, y=0.0, wght=None, opsz=None, track=0.0):
    """As text(), plus the exact ink box (x0, y0, x1, y1) in SVG px."""
    from fontTools.pens.boundsPen import BoundsPen
    f, hbf = load(name, wght, opsz)
    scale = size / f["head"].unitsPerEm
    buf = hb.Buffer()
    buf.add_str(s)
    buf.guess_segment_properties()
    hb.shape(hbf, buf, {"kern": True, "liga": True})
    order, gs = f.getGlyphOrder(), f.getGlyphSet()
    bp = BoundsPen(gs)
    pen_x = x
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        g = order[info.codepoint]
        gs[g].draw(TransformPen(bp, (scale, 0, 0, -scale, pen_x + pos.x_offset * scale, y - pos.y_offset * scale)))
        pen_x += pos.x_advance * scale + track * size
    d, adv = text(s, name, size, x, y, wght, opsz, track)
    return d, adv, bp.bounds

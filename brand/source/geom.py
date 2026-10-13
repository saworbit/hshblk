"""The open hash, as parameters. Shared by every round and by build.py.

Measured from IBM Plex Mono 500's numbersign (the welcome screen's '#'), in
units of the glyph's height (r0.py prints the path; these are its numbers):

  stroke width, horizontal    50.96 / 390.88 = 0.1304
  horizontal bar thickness    47.04 / 390.88 = 0.1203   (Plex thins it 8 %)
  slant, dx per dy            68.88 / 390.88 = 0.1762   (about 10 degrees)
  gap between the strokes     54.32 / 390.88 = 0.1390   (about one stroke)
  bar centres from the top    0.3567 and 0.6433
  stub length, from stroke    71.75 / 390.88 = 0.1836

The property that matters: the bars stop at each stroke. Nothing crosses the
gap, so the glyph is two contours, a left half and a right half.
"""

PLEX = dict(w=0.1304, b=0.1203, k=0.1762, gap=0.1390, y1=0.3567, y2=0.6433, stub=0.1836)


def open_hash(cx=50, cy=50, h=62, w=None, b=None, k=None, gap=None, y1=None, y2=None,
              stub=None, weight=1.0, gapx=1.0, stubx=1.0, **_):
    """Two path strings (left half, right half) for an open '#', ink box centred on (cx, cy).

    weight scales stroke and bar together (keeping Plex's 8 % thinning),
    gapx scales the open middle, stubx the arms. Explicit values win."""
    p = dict(PLEX)
    for key, v in dict(w=w, b=b, k=k, gap=gap, y1=y1, y2=y2, stub=stub).items():
        if v is not None:
            p[key] = v
    W, B = p["w"] * weight * h, p["b"] * weight * h
    K, G, L = p["k"], p["gap"] * gapx * h, p["stub"] * stubx * h
    top = cy - h / 2
    # x of a stroke's left edge at height y, for a stroke whose left edge at the top is x0
    edge = lambda x0, y: x0 - K * (y - top)
    # total ink width at the bar heights decides centring; lay out from 0 then shift
    xl_top = 0.0                       # left stroke, left edge, at the top
    xr_top = xl_top + W + G            # right stroke, left edge, at the top
    bars = [(top + p["y1"] * h - B / 2, top + p["y1"] * h + B / 2),
            (top + p["y2"] * h - B / 2, top + p["y2"] * h + B / 2)]

    def half(x0, side):
        """One stroke and its two arms, as a single outline (clockwise)."""
        y_bot = top + h
        pts = []
        if side == "left":
            # walk: top-left of stroke, top-right, down the right edge to bottom,
            # bottom-left, then up the left edge, stepping out along each arm
            pts += [(edge(x0, top), top), (edge(x0, top) + W, top),
                    (edge(x0, y_bot) + W, y_bot), (edge(x0, y_bot), y_bot)]
            for (a, c) in reversed(bars):            # lower bar first, going up
                xm = edge(x0, (a + c) / 2) - L          # arm ends are cut vertical, as Plex's are
                pts += [(edge(x0, c), c), (xm, c), (xm, a), (edge(x0, a), a)]
        else:
            pts += [(edge(x0, top), top), (edge(x0, top) + W, top)]
            for (a, c) in bars:                      # upper bar first, going down
                xm = edge(x0, (a + c) / 2) + W + L
                pts += [(edge(x0, a) + W, a), (xm, a), (xm, c), (edge(x0, c) + W, c)]
            pts += [(edge(x0, y_bot) + W, y_bot), (edge(x0, y_bot), y_bot)]
        return pts

    L_pts, R_pts = half(xl_top, "left"), half(xr_top, "right")
    xs = [x for x, _ in L_pts + R_pts]
    dx = cx - (min(xs) + max(xs)) / 2
    fmt = lambda pts: "M" + "L".join(f"{x + dx:.3f} {y:.3f}" for x, y in pts) + "Z"
    return fmt(L_pts), fmt(R_pts)


def open_hash_16(lt, rt, la, ra, w=2, top=3, bot=13, lean=2, bars=((5, 7), (9, 11))):
    """A 16 px open hash with every horizontal edge and every stroke end on a whole
    pixel. lt / rt: the left / right stroke's left edge at the top; the stroke leans
    `lean` px left by the bottom. la / ra: the left / right arms' outer ends (one
    column each: the slant of Plex's arm ends is sub-pixel at this size)."""
    k = lean / (bot - top)
    ex = lambda x_top, y: x_top - k * (y - top)
    def half(x_top, side):
        p = [(ex(x_top, top), top), (ex(x_top, top) + w, top)]
        if side == "R":
            for a_, c_ in bars:
                p += [(ex(x_top, a_) + w, a_), (ra, a_), (ra, c_), (ex(x_top, c_) + w, c_)]
            p += [(ex(x_top, bot) + w, bot), (ex(x_top, bot), bot)]
        else:
            p += [(ex(x_top, bot) + w, bot), (ex(x_top, bot), bot)]
            for a_, c_ in reversed(bars):
                p += [(ex(x_top, c_), c_), (la, c_), (la, a_), (ex(x_top, a_), a_)]
        return "M" + "L".join(f"{x:.3f} {y:.3f}" for x, y in p) + "Z"
    return half(lt, "L"), half(rt, "R")

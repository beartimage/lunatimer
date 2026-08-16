#!/usr/bin/env python3
"""Render lunatimer app icons — warm paper tile, gold timer ring + knob, gold crescent moon.
Palette matches the app: paper #f5f1e8/#faf6ee/#efe9dc, gold #b58d3c/#e6cd82/#8a6b23, ink #423a24."""
import math
from PIL import Image, ImageDraw, ImageFilter

try:
    import numpy as np
    HAVE_NP = True
except Exception:
    HAVE_NP = False

SS = 4  # supersample factor


def hex2rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def multi_lerp(stops, t):
    # stops: list of (pos, rgb)
    t = max(0.0, min(1.0, t))
    for i in range(len(stops) - 1):
        p0, c0 = stops[i]
        p1, c1 = stops[i + 1]
        if p0 <= t <= p1:
            lt = 0 if p1 == p0 else (t - p0) / (p1 - p0)
            return lerp(c0, c1, lt)
    return stops[-1][1]


GOLD = [(0.0, hex2rgb('#b58d3c')), (0.5, hex2rgb('#e6cd82')), (1.0, hex2rgb('#8a6b23'))]
PAPER = [(0.0, hex2rgb('#faf6ee')), (0.55, hex2rgb('#f5f1e8')), (1.0, hex2rgb('#efe9dc'))]
INK = hex2rgb('#423a24')
CREAM = hex2rgb('#fbf8f0')


def gold_image(W, H):
    """Diagonal gold gradient: bottom-left -> top-right."""
    if HAVE_NP:
        xs = np.linspace(0, 1, W)[None, :]
        ys = np.linspace(0, 1, H)[:, None]
        t = (xs + (1 - ys)) / 2.0  # 0 at bottom-left, 1 at top-right
        img = np.zeros((H, W, 3), dtype=np.uint8)
        pos = np.array([s[0] for s in GOLD])
        cols = np.array([s[1] for s in GOLD], dtype=float)
        for c in range(3):
            img[:, :, c] = np.interp(t, pos, cols[:, c]).astype(np.uint8)
        return Image.fromarray(img, 'RGB')
    im = Image.new('RGB', (W, H))
    px = im.load()
    for y in range(H):
        for x in range(W):
            px[x, y] = multi_lerp(GOLD, (x / W + (1 - y / H)) / 2.0)
    return im


def paper_image(W, H):
    """Radial paper gradient centered high (cx=.5, cy=.30)."""
    cx, cy = 0.5 * W, 0.30 * H
    maxr = 0.95 * max(W, H)
    if HAVE_NP:
        xs = np.arange(W)[None, :]
        ys = np.arange(H)[:, None]
        d = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2) / maxr
        img = np.zeros((H, W, 3), dtype=np.uint8)
        pos = np.array([s[0] for s in PAPER])
        cols = np.array([s[1] for s in PAPER], dtype=float)
        for c in range(3):
            img[:, :, c] = np.interp(d, pos, cols[:, c]).astype(np.uint8)
        return Image.fromarray(img, 'RGB')
    im = Image.new('RGB', (W, H))
    px = im.load()
    for y in range(H):
        for x in range(W):
            d = math.hypot(x - cx, y - cy) / maxr
            px[x, y] = multi_lerp(PAPER, d)
    return im


def ring_mask(size, cx, cy, r, width, start_deg, end_deg, round_caps=True):
    """Alpha mask (L) for an arc stroke with optional round caps."""
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    bbox = [cx - r, cy - r, cx + r, cy + r]
    d.arc(bbox, start_deg, end_deg, fill=255, width=width)
    if round_caps:
        rr = width / 2.0
        for ang in (start_deg, end_deg):
            a = math.radians(ang)
            ex, ey = cx + r * math.cos(a), cy + r * math.sin(a)
            d.ellipse([ex - rr, ey - rr, ex + rr, ey + rr], fill=255)
    return m


def build(px_out, radius_frac=0.219, opaque=False):
    S = px_out * SS
    k = S / 512.0

    def sc(v):
        return v * k

    # ----- background (paper) -----
    paper = paper_image(S, S)
    bg = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    tile_mask = Image.new('L', (S, S), 0)
    dm = ImageDraw.Draw(tile_mask)
    if opaque:
        dm.rectangle([0, 0, S, S], fill=255)
    else:
        dm.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(radius_frac * S), fill=255)
    bg.paste(paper, (0, 0), tile_mask)

    canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    canvas = Image.alpha_composite(canvas, bg)

    gold = gold_image(S, S).convert('RGBA')

    cx = cy = sc(256)
    R = sc(164)

    # ----- soft shadow layer (drawn from combined element alpha) -----
    shadow_src = Image.new('L', (S, S), 0)
    ds = ImageDraw.Draw(shadow_src)
    # arc footprint
    arc_m = ring_mask(S, cx, cy, R, int(sc(14)), -90, 180)
    shadow_src.paste(arc_m, (0, 0), arc_m)
    # moon footprint
    moon_full = Image.new('L', (S, S), 0)
    dmn = ImageDraw.Draw(moon_full)
    dmn.ellipse([sc(248) - sc(88), sc(258) - sc(88), sc(248) + sc(88), sc(258) + sc(88)], fill=255)
    dmn2 = ImageDraw.Draw(moon_full)
    dmn2.ellipse([sc(292) - sc(76), sc(234) - sc(76), sc(292) + sc(76), sc(234) + sc(76)], fill=0)
    shadow_src.paste(moon_full, (0, 0), moon_full)
    # knob footprint
    ds.ellipse([sc(256) - sc(19), sc(92) - sc(19), sc(256) + sc(19), sc(92) + sc(19)], fill=255)

    shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    shcol = Image.new('RGBA', (S, S), INK + (255,))
    sh_alpha = shadow_src.point(lambda v: int(v * 0.20))
    shadow.paste(shcol, (0, int(sc(6))), sh_alpha)
    shadow = shadow.filter(ImageFilter.GaussianBlur(sc(8)))
    # clip shadow to tile
    sh_clipped = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    sh_clipped.paste(shadow, (0, 0), tile_mask)
    canvas = Image.alpha_composite(canvas, sh_clipped)

    # ----- faint guide ring -----
    guide = ring_mask(S, cx, cy, R, max(1, int(sc(3))), 0, 360, round_caps=False)
    guide_col = Image.new('RGBA', (S, S), hex2rgb('#b58d3c') + (0,))
    guide_layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    guide_layer.paste(Image.new('RGBA', (S, S), hex2rgb('#b58d3c') + (255,)),
                      (0, 0), guide.point(lambda v: int(v * 0.28)))
    canvas = Image.alpha_composite(canvas, guide_layer)

    # ----- gold progress arc (270deg from top) -----
    arc_layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    arc_layer.paste(gold, (0, 0), arc_m)
    canvas = Image.alpha_composite(canvas, arc_layer)

    # ----- crescent moon -----
    moon_layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    moon_layer.paste(gold, (0, 0), moon_full)
    canvas = Image.alpha_composite(canvas, moon_layer)

    # ----- knob at arc head (top) -----
    knob = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    dk = ImageDraw.Draw(knob)
    # gold ring
    ring_m = Image.new('L', (S, S), 0)
    dr = ImageDraw.Draw(ring_m)
    dr.ellipse([sc(256) - sc(19), sc(92) - sc(19), sc(256) + sc(19), sc(92) + sc(19)], fill=255)
    dr.ellipse([sc(256) - sc(12), sc(92) - sc(12), sc(256) + sc(12), sc(92) + sc(12)], fill=0)
    knob.paste(gold, (0, 0), ring_m)
    dk.ellipse([sc(256) - sc(12), sc(92) - sc(12), sc(256) + sc(12), sc(92) + sc(12)], fill=CREAM + (255,))
    canvas = Image.alpha_composite(canvas, knob)

    # subtle inner gold border on the tile edge
    if not opaque:
        border = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        db = ImageDraw.Draw(border)
        db.rounded_rectangle([sc(8), sc(8), S - sc(8), S - sc(8)],
                             radius=int(radius_frac * S - sc(6)),
                             outline=hex2rgb('#b58d3c') + (46,), width=max(1, int(sc(2))))
        canvas = Image.alpha_composite(canvas, border)

    out = canvas.resize((px_out, px_out), Image.LANCZOS)
    if opaque:
        flat = Image.new('RGB', (px_out, px_out), CREAM)
        flat.paste(out, (0, 0), out)
        return flat
    return out


import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
build(512).save('icon-512.png')
build(192).save('icon-192.png')
build(180, opaque=True).save('apple-touch-icon.png')
print('rendered icon-512.png icon-192.png apple-touch-icon.png')

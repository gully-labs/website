"""Product brand assets for Gully AI, composed only from its kit files (no redrawing).

HolderMaps is not built here: its brand kit (Desktop/GULLY LABS GRAPHICS/HolderMaps/brand-kit) ships final icons,
logos, share images and badges, copied byte-exact to public/brand/holdermaps (favicon.ico packs the kit's 16/32/48
PNGs unchanged).

    python -I scripts/product-brand-assets.py "C:/Users/Admin/Desktop/GULLY LABS GRAPHICS" .

The Gully AI kit (Desktop/GULLY LABS GRAPHICS/GullyAI) ships one logo PNG, on a dark backdrop (not transparent),
plus mascots; no tokens, favicons or share image. This script:
  - reads the kit files in place (nothing is copied: no page uses the full-size master);
  - cuts the logo's own mark (the robot on the G) out of the logo, rectangle by
    rectangle, and pads it to a square with the logo's own backdrop colour (sampled from the logo's edge, so the pad
    is seamless) for the favicons, app icons and the maskable icon. Downscaling only, Lanczos;
  - writes a 1200x630 share image: the kit logo and one kit mascot on the backdrop colour, with the product's
    tagline in Poppins 800 (the stack's own font, @fontsource/poppins);
  - writes downscaled header logos (the master is 2172 px wide; a header shows them ~170 px wide), their
    edges feathered into the backdrop colour so they sit on a page of that colour with no visible box.
The palette Gully AI's CSS uses (src/brand/products.ts, src/index.css) is sampled from the same logo; the
sampled values are printed at the end so a kit update can be re-checked.
"""
import statistics as st
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

kit = Path(sys.argv[1])
root = Path(sys.argv[2])
FONT = root / "node_modules/@fontsource/poppins/files/poppins-latin-800-normal.woff"
FONT_MED = root / "node_modules/@fontsource/poppins/files/poppins-latin-600-normal.woff"

PRODUCTS = {
    "gullyai": {
        "dir": kit / "GullyAI",
        "logo": "GullyAI Neon Robot Logo.png",
        "mascot": "GullyAI_02_Pointing.png",
        "page_mascot": ("GullyAI_03_Thinking.png", 192),
        # The robot on the G: above y 285 the headphone reaches x 788; below it the wordmark's "G" starts at x 750,
        # so the cut is two rectangles (the rest of the square is the logo's own backdrop colour).
        "mark": [(250, 40, 790, 285), (250, 285, 746, 680)],
        "tagline": ["Ask anything", "about Gully Labs."],
        "sub": "Answers with sources, live figures",
        "accent": (0x00, 0xF5, 0xF3),
    },
}


def median(px):
    return tuple(int(st.median(p[i] for p in px)) for i in range(3))


def backdrop(im):
    """The logo's backdrop: the median of its left edge (where the mark sits)."""
    return median([im.getpixel((x, y)) for x in range(0, 6) for y in range(im.height)])


def hexc(c):
    return "#%02X%02X%02X" % c


def feather_mask(size, rects, f):
    """A mask that is opaque inside the rectangles and fades to nothing over f px at their outer edges, so a cut
    from the logo melts into the backdrop colour instead of showing a box (the logo's backdrop is not flat)."""
    # Drawn on a canvas with an f px empty border, so an edge on the tile's own border fades too (the filters
    # extend edge pixels outwards), then cropped back.
    m = Image.new("L", (size[0] + 2 * f, size[1] + 2 * f), 0)
    d = ImageDraw.Draw(m)
    for r in rects:
        d.rectangle((r[0] + f, r[1] + f, r[2] + f, r[3] + f), fill=255)
    if f > 0:
        m = m.filter(ImageFilter.MinFilter(2 * (f // 2) + 1)).filter(ImageFilter.GaussianBlur(f / 2))
    return m.crop((f, f, f + size[0], f + size[1]))


def on_backdrop(tile, bg, f, rects=None):
    """tile (RGB or RGBA) over the backdrop colour, its edges feathered by f px."""
    base = Image.new("RGB", tile.size, bg)
    mask = feather_mask(tile.size, rects or [(0, 0, tile.width - 1, tile.height - 1)], f)
    if tile.mode == "RGBA":
        mask = _min(mask, tile.getchannel("A"))
    base.paste(tile.convert("RGB"), (0, 0), mask)
    return base


def _min(a, b):
    from PIL import ImageChops
    return ImageChops.darker(a, b)


def mark_square(logo, rects, bg):
    x0 = min(r[0] for r in rects)
    y0 = min(r[1] for r in rects)
    x1 = max(r[2] for r in rects)
    y1 = max(r[3] for r in rects)
    w, h = x1 - x0, y1 - y0
    side = max(w, h)
    pad = round(side * 0.08)
    side += 2 * pad
    ox = (side - w) // 2
    oy = (side - h) // 2
    tile = Image.new("RGB", (side, side), bg)
    placed = []
    for r in rects:
        tile.paste(logo.crop(r), (ox + r[0] - x0, oy + r[1] - y0))
        placed.append((ox + r[0] - x0, oy + r[1] - y0, ox + r[2] - x0 - 1, oy + r[3] - y0 - 1))
    # Only the cut edges inside the logo fade; an edge that is the logo's own border (y 0 of HolderMaps) does too,
    # which keeps the pad seamless.
    return on_backdrop(tile, bg, max(8, side // 24), placed)


def down(im, size):
    if size > im.width:
        # Never upscale: a small mark is drawn at its own size, centred on the backdrop.
        bg = im.getpixel((0, 0))
        out = Image.new("RGB", (size, size), bg)
        out.paste(im, ((size - im.width) // 2, (size - im.height) // 2))
        return out
    return im.resize((size, size), Image.Resampling.LANCZOS)


def save(im, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, optimize=True)
    print("wrote", path.relative_to(root), im.size)


def og(name, cfg, logo, bg):
    W, H = 1200, 630
    out = Image.new("RGB", (W, H), bg)
    mascot = Image.open(cfg["dir"] / cfg["mascot"])
    if mascot.mode == "RGBA":
        mascot = mascot.crop(mascot.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox())
    # Mascot on the right, bottom aligned, never upscaled past 1.25x its master.
    mh = min(520, round(mascot.height * 1.25))
    mw = round(mascot.width * mh / mascot.height)
    m = mascot.resize((mw, mh), Image.Resampling.LANCZOS)
    if m.mode == "RGBA":
        out.paste(m.convert("RGB"), (W - mw - 64, H - mh - 30), m.getchannel("A"))
    else:
        # The HolderMaps mascots carry their own dark scene: feathered into the backdrop on every side.
        out.paste(on_backdrop(m, bg, 70), (W - mw - 48, H - mh))
    lw = 500
    lh = round(logo.height * lw / logo.width)
    out.paste(on_backdrop(logo.resize((lw, lh), Image.Resampling.LANCZOS), bg, 22), (48, 56))
    d = ImageDraw.Draw(out)
    big = ImageFont.truetype(str(FONT), 60)
    small = ImageFont.truetype(str(FONT_MED), 28)
    y = 56 + lh + 52
    for i, line in enumerate(cfg["tagline"]):
        d.text((64, y), line, font=big, fill=cfg["accent"] if i == len(cfg["tagline"]) - 1 else (0xF4, 0xF4, 0xF4))
        y += 74
    d.text((66, y + 18), cfg["sub"], font=small, fill=(0xA6, 0xC8, 0xCC))
    return out


for name, cfg in PRODUCTS.items():
    dest = root / "public/brand" / name
    dest.mkdir(parents=True, exist_ok=True)
    logo = Image.open(cfg["dir"] / cfg["logo"]).convert("RGB")
    bg = backdrop(logo)
    mark = mark_square(logo, cfg["mark"], bg)
    save(down(mark, 512), dest / "mark-512.png")
    for s in (16, 32, 48):
        save(down(mark, s), dest / f"favicon-{s}.png")
    for s in (180, 192, 512):
        save(down(mark, s), dest / f"app-icon-{s}.png")
    # Maskable: the mark inside the 80 % safe zone.
    mk = Image.new("RGB", (512, 512), bg)
    inner = down(mark, 410)
    mk.paste(inner, (51, 51))
    save(mk, dest / "maskable-512.png")
    ico = down(mark, 48)
    ico.save(dest / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("wrote", (dest / "favicon.ico").relative_to(root))
    for w in (360, 720):
        h = round(logo.height * w / logo.width)
        # Edges feathered into the backdrop colour (the backdrop has a glow, so a plain cut shows as a box on it).
        save(on_backdrop(logo.resize((w, h), Image.Resampling.LANCZOS), bg, max(4, round(w * 0.012))), dest / f"logo-{w}w.png")
    save(og(name, cfg, logo, bg), dest / "og-1200x630.png")
    pm, pw = cfg["page_mascot"]
    src = Image.open(cfg["dir"] / pm)
    save(src.resize((pw, round(src.height * pw / src.width)), Image.Resampling.LANCZOS), dest / f"mascot-{pw}w.png")
    print(f"{name}: backdrop {hexc(bg)} accent {hexc(cfg['accent'])}")

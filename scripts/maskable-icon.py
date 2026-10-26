"""Compose the Gully Labs maskable PWA icon from kit files only (no redrawing).

The kit's app icons have transparent rounded corners, so they can't be maskable. This centres the kit mark
(public/brand/icon/gully-labs-icon-1024.png, byte-exact kit copy) at 62% of the canvas, inside the 80% maskable safe
zone, on the kit background #06050D. Run: python scripts/maskable-icon.py
"""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent / "public" / "brand" / "icon"
mark = Image.open(root / "gully-labs-icon-1024.png").convert("RGBA")
bbox = mark.getchannel("A").getbbox()
mark = mark.crop(bbox)
size = 512
side = round(size * 0.62)
scale = side / max(mark.size)
mark = mark.resize((round(mark.width * scale), round(mark.height * scale)), Image.LANCZOS)
canvas = Image.new("RGBA", (size, size), (6, 5, 13, 255))
canvas.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
canvas.convert("RGB").save(root / "app-icon-maskable-512.png", optimize=True)
print("wrote", root / "app-icon-maskable-512.png")

"""Gully Core's 1200x630 share image, composed only from its kit (Downloads/Gully Core brand kit/Gully Core Graphics).

The kit (2026-11-08) ships no 1200x630 OG image. Its X banner (04-x/x-banner-1500x500.png: the hex-C logotype, the
tagline and two kit robots on cream, an orange stripe on the left edge) is the closest kit art, so this script
scales it to 1200x400 (Lanczos, downscale only, nothing redrawn) and centres it on a 1200x630 canvas filled with
the banner's own cream ground; the orange stripe is carried over the full height with the banner's own colour,
both sampled from the banner. The output's hash and the kit file's hash are in src/data/productBrands.ts.

    python -I scripts/gully-core-og.py "C:/Users/Admin/Downloads/Gully Core brand kit/Gully Core Graphics" .
"""
import sys
from pathlib import Path

from PIL import Image

kit = Path(sys.argv[1])
root = Path(sys.argv[2])
banner = Image.open(kit / "04-x/x-banner-1500x500.png").convert("RGB")
W, H = banner.size
ground = banner.getpixel((W // 2, 4))
stripe = banner.getpixel((2, H // 2))
sw = 0
while sw < 40 and banner.getpixel((sw, H // 2)) == stripe:
    sw += 1
scaled = banner.resize((1200, round(H * 1200 / W)), Image.LANCZOS)
out = Image.new("RGB", (1200, 630), ground)
out.paste(Image.new("RGB", (round(sw * 1200 / W), 630), stripe), (0, 0))
out.paste(scaled, (0, (630 - scaled.size[1]) // 2))
dst = root / "public/brand/products/gully-core-og-1200x630.png"
out.save(dst, optimize=True)
print(f"ground {ground} stripe {stripe} ({sw}px) -> {dst} {dst.stat().st_size} bytes")

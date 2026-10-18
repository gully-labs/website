"""Cuts the favicon set and the small marks from the brand kit's icon master, by downscaling only.

    python -I scripts/brand-icons.py public/brand/gullylabs-mark-640.png .

Run by scripts/brand-from-kit.mjs. The master is the kit's gullylabs-telegram-channel-640x640.png (the kit's
CLAUDE_PROMPT.md names it as the source for favicon.ico 16/32/48, apple-touch-icon 180 and icon-192/512).
Every output is smaller than 640 px: nothing is ever upscaled. Lanczos resampling, PNG optimised.
"""
import sys
from pathlib import Path

from PIL import Image

master = Path(sys.argv[1])
root = Path(sys.argv[2])
src = Image.open(master).convert("RGBA")
if src.size != (640, 640):
    raise SystemExit(f"{master}: expected 640x640, got {src.size}")


def down(size: int) -> Image.Image:
    if size > src.width:
        raise SystemExit(f"refusing to upscale to {size}")
    return src.resize((size, size), Image.Resampling.LANCZOS)


OUT = {
    "public/favicon-16.png": 16,
    "public/favicon-32.png": 32,
    "public/apple-touch-icon.png": 180,
    "public/icon-192.png": 192,
    "public/icon-512.png": 512,
    "public/favicon.png": 512,  # kept at this path: server/seo.mjs and older links point at it
    "public/brand/gully-mark-96.png": 96,
    "public/brand/gully-mark-192.png": 192,
    "public/brand/gully-mark-512.png": 512,
}
for rel, size in OUT.items():
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    down(size).save(p, "PNG", optimize=True)

# favicon.ico: 16, 32 and 48 px frames.
ico = root / "public" / "favicon.ico"
down(48).save(ico, format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])
print(f"icons: {len(OUT)} PNGs and favicon.ico from {master.name}")

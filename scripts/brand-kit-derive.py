#!/usr/bin/env python3
# scripts/brand-kit-derive.py: every web asset of the Gully Labs parent brand, derived by script from the kit, which
# stays byte-identical in brand/gully-labs-kit-2026-11. Nothing here draws or types a logo.
#   - SVGs the site shows are copied unchanged to public/brand/kit/ (scripts/test-brand-kit.mjs checks the bytes).
#   - PNGs: the kit's own rasters are the sources. Favicons and app icons are social/x-pfp.png (the mark on navy),
#     scaled; the maskable icon adds the safe zone by padding with the same navy.
#   - The owl: each pose cropped to its opaque area, scaled to 800 and 400 px tall, WebP with alpha.
#   - The share card: the kit's X banner (1500x500) centred on a 1200x630 ground of the banner's own colour.
#   - The mascot crops report their aspect so pages can reserve the box (no layout shift).
#   python scripts/brand-kit-derive.py     (needs Pillow; output is committed, the build does not run this)
import hashlib, io, json, os, shutil, sys
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
KIT = os.path.join(ROOT, 'brand', 'gully-labs-kit-2026-11')
OUT = os.path.join(ROOT, 'public', 'brand', 'kit')
NAVY = (14, 28, 56, 255)
os.makedirs(os.path.join(OUT, 'owl'), exist_ok=True)
os.makedirs(os.path.join(OUT, 'icon'), exist_ok=True)

for rel in ['logo/logotype-color.svg', 'logo/logotype-reversed.svg', 'logo/mark-color.svg', 'logo/mark-reversed.svg', 'logo/wordmark-color.svg', 'logo/wordmark-reversed.svg', 'badges/powered-by-light.svg', 'badges/powered-by-dark.svg', 'badges/powered-by-clear-navy.svg', 'badges/powered-by-clear-white.svg', 'icons/community-color.svg', 'icons/deployers-color.svg', 'icons/news-color.svg', 'icons/trending-color.svg']:
    shutil.copyfile(os.path.join(KIT, rel), os.path.join(OUT, os.path.basename(rel)))

pfp = Image.open(os.path.join(KIT, 'social', 'x-pfp.png')).convert('RGBA')
for n in (16, 32, 48, 180, 192, 512):
    pfp.resize((n, n), Image.LANCZOS).save(os.path.join(OUT, 'icon', f'icon-{n}.png'), optimize=True)
g = Image.new('RGBA', (512, 512), NAVY)
inner = pfp.resize((410, 410), Image.LANCZOS)
g.alpha_composite(inner, (51, 51))
g.save(os.path.join(OUT, 'icon', 'icon-maskable-512.png'), optimize=True)
pfp.resize((48, 48), Image.LANCZOS).save(os.path.join(OUT, 'icon', 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])

sizes = {}
for pose in ('laptop', 'notebook', 'presenting', 'tablet', 'thumbs-up'):
    im = Image.open(os.path.join(KIT, 'mascot', f'owl-{pose}.png')).convert('RGBA')
    im = im.crop(im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox())
    for h in (800, 400):
        w = round(im.width * h / im.height)
        im.resize((w, h), Image.LANCZOS).save(os.path.join(OUT, 'owl', f'owl-{pose}-{h}.webp'), quality=82, method=6)
    sizes[pose] = [im.width, im.height]

banner = Image.open(os.path.join(KIT, 'social', 'x-banner.png')).convert('RGBA')
ground = banner.getpixel((4, 4))
card = Image.new('RGBA', (1200, 630), ground)
b = banner.resize((1200, 400), Image.LANCZOS)
card.alpha_composite(b, (0, 115))
card.convert('RGB').save(os.path.join(OUT, 'og-default-1200x630.png'), optimize=True)

json.dump({'owl': sizes}, open(os.path.join(OUT, 'sizes.json'), 'w'), indent=1)
total = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(OUT) for f in fs)
print('derived', total // 1024, 'KB in public/brand/kit; banner ground', ground, 'owl sizes', sizes)

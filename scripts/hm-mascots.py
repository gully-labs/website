"""HolderMaps mascots for the web (holdermaps.xyz, 2026-10-26).

Reads the five kit mascots (Desktop/GULLY LABS GRAPHICS/HolderMaps/Mascot_0*_*.png, opaque RGB on the kit's dark
scene) and writes public/brand/holdermaps/mascot/<pose>-<lg|sm>.<avif|webp|png>:
  lg   the master's own size (never upscaled), PNG byte-exact copy of the master
  sm   half size (Lanczos), for empty states, toasts and the share card
AVIF and WebP are what browsers load (<picture> in src/holdermaps/Mascot.tsx); the PNG is the fallback.

  python scripts/hm-mascots.py "C:/Users/Admin/Desktop/GULLY LABS GRAPHICS/HolderMaps"
"""
import os
import shutil
import sys

from PIL import Image

POSES = {
    "point": "Mascot_01_Point.png",
    "laptop": "Mascot_02_Laptop.png",
    "map": "Mascot_03_Map.png",
    "hologram": "Mascot_04_Hologram.png",
    "backpack": "Mascot_05_Backpack.png",
}


def main(src_dir: str) -> None:
    out = os.path.join(os.path.dirname(__file__), "..", "public", "brand", "holdermaps", "mascot")
    os.makedirs(out, exist_ok=True)
    for pose, name in POSES.items():
        src = os.path.join(src_dir, name)
        im = Image.open(src).convert("RGB")
        w, h = im.size
        sizes = {"lg": im, "sm": im.resize((round(w / 2), round(h / 2)), Image.LANCZOS)}
        for key, img in sizes.items():
            base = os.path.join(out, f"{pose}-{key}")
            img.save(base + ".avif", quality=62, speed=4)
            img.save(base + ".webp", quality=80, method=6)
            if key == "lg":
                shutil.copyfile(src, base + ".png")
            else:
                img.save(base + ".png", optimize=True)
            print(pose, key, img.size, {ext: os.path.getsize(base + ext) for ext in (".avif", ".webp", ".png")})


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "C:/Users/Admin/Desktop/GULLY LABS GRAPHICS/HolderMaps")

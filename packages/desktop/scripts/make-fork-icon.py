#!/usr/bin/env python3
"""Generate the Paseo Fork app icon from the upstream Paseo icon.

The fork build ships beside a stock Paseo install, so the icon has to be
distinguishable in the Dock and app switcher at 16px, where text is unreadable.
Two changes carry that: the black plate becomes violet, and a branch badge sits
in the lower-right corner.

Usage: python3 scripts/make-fork-icon.py
Writes assets/icon-fork.png and assets/icon-fork.icns.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parent.parent / "assets"
SOURCE = ASSETS / "icon.png"
OUT_PNG = ASSETS / "icon-fork.png"
OUT_ICNS = ASSETS / "icon-fork.icns"

PLATE = (91, 33, 182)  # violet-800, replaces the black plate
GLYPH = (255, 255, 255)
BADGE = (245, 158, 11)  # amber-500


def recolor(img: Image.Image) -> Image.Image:
    """Map the plate/glyph luminance ramp onto violet/white, keeping alpha."""
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            # Luminance 0 -> plate colour, 255 -> glyph colour. Preserves the
            # antialiased edges of the original artwork instead of hard keying.
            t = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
            px[x, y] = (
                round(PLATE[0] + (GLYPH[0] - PLATE[0]) * t),
                round(PLATE[1] + (GLYPH[1] - PLATE[1]) * t),
                round(PLATE[2] + (GLYPH[2] - PLATE[2]) * t),
                a,
            )
    return img


def draw_branch_badge(img: Image.Image) -> Image.Image:
    """Draw a git-branch mark in the lower-right corner."""
    w, h = img.size
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)

    r = int(w * 0.21)
    cx, cy = int(w * 0.75), int(h * 0.75)

    # Plate-coloured ring separates the badge from the artwork behind it.
    ring = int(w * 0.028)
    d.ellipse([cx - r - ring, cy - r - ring, cx + r + ring, cy + r + ring], fill=PLATE)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BADGE)

    # Branch: a trunk with one limb splitting off to the upper right.
    node = int(r * 0.26)
    line = max(3, int(r * 0.15))
    trunk_x = cx - int(r * 0.34)
    top_y = cy - int(r * 0.46)
    bot_y = cy + int(r * 0.46)
    limb_x = cx + int(r * 0.40)

    d.line([(trunk_x, top_y), (trunk_x, bot_y)], fill=PLATE, width=line)
    d.line(
        [(trunk_x, cy + int(r * 0.06)), (limb_x, cy + int(r * 0.06)), (limb_x, top_y)],
        fill=PLATE,
        width=line,
        joint="curve",
    )
    for x, y in ((trunk_x, top_y), (trunk_x, bot_y), (limb_x, top_y)):
        d.ellipse([x - node, y - node, x + node, y + node], fill=PLATE)

    return Image.alpha_composite(img, overlay)


def write_icns(png: Path, icns: Path) -> None:
    if not shutil.which("iconutil"):
        print("iconutil not found; skipping .icns")
        return
    base = Image.open(png).convert("RGBA")
    with tempfile.TemporaryDirectory() as tmp:
        iconset = Path(tmp) / "icon.iconset"
        iconset.mkdir()
        for size in (16, 32, 128, 256, 512):
            base.resize((size, size), Image.LANCZOS).save(iconset / f"icon_{size}x{size}.png")
            base.resize((size * 2, size * 2), Image.LANCZOS).save(
                iconset / f"icon_{size}x{size}@2x.png"
            )
        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(icns)],
            check=True,
        )


def main() -> None:
    img = draw_branch_badge(recolor(Image.open(SOURCE)))
    img.save(OUT_PNG)
    write_icns(OUT_PNG, OUT_ICNS)
    print(f"wrote {OUT_PNG.name} and {OUT_ICNS.name}")


if __name__ == "__main__":
    main()

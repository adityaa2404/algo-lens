"""Generate Algo Lens PNG icons at 16/32/48/128/256 px.

The logo is a minimalist "lens over bracket" mark: a cyan lens ring
with an inner magnifier dot sits on a dark gradient square. Drawn
procedurally so it stays crisp at every scale.

Run:
    python scripts/generate_icons.py
"""
from __future__ import annotations

import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "icons")
SIZES = (16, 32, 48, 128, 256)

BG_TOP = (9, 13, 20)
BG_BOTTOM = (30, 50, 80)
LENS = (126, 225, 255)
LENS_CORE = (255, 255, 255)
BRACKET = (135, 245, 182)


def gradient_background(size: int) -> Image.Image:
    bg = Image.new("RGB", (size, size), BG_TOP)
    top = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / max(size - 1, 1)
        r = int(BG_TOP[0] * (1 - t) + BG_BOTTOM[0] * t)
        g = int(BG_TOP[1] * (1 - t) + BG_BOTTOM[1] * t)
        b = int(BG_TOP[2] * (1 - t) + BG_BOTTOM[2] * t)
        top.putpixel((0, y), (r, g, b))
    bg = top.resize((size, size))
    return bg.convert("RGBA")


def rounded_mask(size: int, radius_ratio: float = 0.22) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    r = int(size * radius_ratio)
    draw.rounded_rectangle([(0, 0), (size - 1, size - 1)], radius=r, fill=255)
    return mask


def draw_icon(size: int) -> Image.Image:
    # Supersample 4x for crisp AA, then downscale
    scale = 4
    s = size * scale
    canvas = gradient_background(s)
    overlay = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Left bracket glyph "<"
    stroke = max(2, int(s * 0.055))
    bx1 = int(s * 0.18)
    by_top = int(s * 0.24)
    by_mid = int(s * 0.50)
    by_bot = int(s * 0.76)
    bx_mid = int(s * 0.30)
    draw.line([(bx1, by_mid), (bx_mid, by_top)], fill=BRACKET, width=stroke)
    draw.line([(bx1, by_mid), (bx_mid, by_bot)], fill=BRACKET, width=stroke)

    # Lens ring (magnifier)
    cx, cy = int(s * 0.62), int(s * 0.46)
    radius = int(s * 0.22)
    ring = stroke
    draw.ellipse(
        [(cx - radius, cy - radius), (cx + radius, cy + radius)],
        outline=LENS,
        width=ring,
    )
    # Inner highlight arc
    hl_r = int(radius * 0.55)
    draw.ellipse(
        [(cx - hl_r, cy - hl_r), (cx + hl_r, cy + hl_r)],
        outline=LENS_CORE,
        width=max(1, ring // 2),
    )
    # Lens handle
    hx1 = int(cx + radius * 0.72)
    hy1 = int(cy + radius * 0.72)
    hx2 = int(cx + radius * 1.55)
    hy2 = int(cy + radius * 1.55)
    draw.line([(hx1, hy1), (hx2, hy2)], fill=LENS, width=ring)

    # Soft glow behind lens
    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    gdraw.ellipse(
        [(cx - radius - ring, cy - radius - ring), (cx + radius + ring, cy + radius + ring)],
        fill=(LENS[0], LENS[1], LENS[2], 70),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(radius=s * 0.04))
    canvas = Image.alpha_composite(canvas, glow)
    canvas = Image.alpha_composite(canvas, overlay)

    # Apply rounded mask
    mask = rounded_mask(s)
    rounded = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    rounded.paste(canvas, (0, 0), mask)

    # Downscale
    return rounded.resize((size, size), Image.LANCZOS)


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        img = draw_icon(size)
        out = os.path.join(OUT_DIR, f"icon{size}.png")
        img.save(out, "PNG", optimize=True)
        print(f"wrote {out}")


if __name__ == "__main__":
    main()

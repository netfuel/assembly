"""Renders Assembly's app icons into public/icons. Run: python3 scripts/make-icons.py

The mark is a block "A" printed slightly off-register over sodium orange, with a UV pin dot.
Keep this in step with public/icons/favicon.svg.
"""
from pathlib import Path
from PIL import Image, ImageDraw

GROUND = (10, 10, 11, 255)
FG = (237, 237, 238, 255)
SODIUM = (255, 61, 242, 255)  # offset print in the accent magenta
UV = (169, 139, 255, 255)

OUTER = [(214, 96), (298, 96), (412, 420), (332, 420), (310, 352), (202, 352), (180, 420), (100, 420)]
COUNTER = [(226, 286), (286, 286), (256, 192)]

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"


def draw_mark(size: int, scale: float, rounded: bool) -> Image.Image:
    ss = 4  # supersample for smooth edges
    s = size * ss
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(s * 0.22) if rounded else 0
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=GROUND)

    def tx(pts, dx=0, dy=0):
        k = s / 512 * scale
        off = (s - 512 * k) / 2
        return [(off + (x + dx) * k, off + (y + dy) * k) for x, y in pts]

    d.polygon(tx(OUTER, 16, 14), fill=SODIUM)
    d.polygon(tx(COUNTER, 16, 14), fill=GROUND)
    d.polygon(tx(OUTER), fill=FG)
    d.polygon(tx(COUNTER), fill=GROUND)
    cx, cy = tx([(392, 128)])[0]
    r = 30 * s / 512 * scale
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=UV)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    draw_mark(192, 1.0, True).save(OUT / "icon-192.png")
    draw_mark(512, 1.0, True).save(OUT / "icon-512.png")
    # Maskable icons get cropped to a circle or squircle: full-bleed ground, mark inside the safe zone.
    draw_mark(512, 0.72, False).save(OUT / "icon-maskable-512.png")
    # iOS adds its own rounding.
    draw_mark(180, 0.9, False).save(OUT / "apple-touch-icon.png")
    print("wrote icons to", OUT)


if __name__ == "__main__":
    main()

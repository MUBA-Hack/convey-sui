"""Derive Convey PWA icon assets from the supplied transparent mark.

Inputs : public/brand/convey-mark.png  (transparent RGBA source mark)
Outputs: public/icons/convey-192.png           (any purpose, 192x192)
         public/icons/convey-512.png           (any purpose, 512x512)
         public/icons/convey-maskable-512.png  (maskable, 512x512, mark in
                                                central 80% safe zone on a
                                                full-bleed white background)

The product language is minimal premium black-and-white: the mark is composited
on a solid white canvas (no gradients, no chroma). The any-purpose icons keep a
small margin so the mark never touches the edge; the maskable icon scales the
mark into the central 80% diameter safe zone so Android adaptive-icon shaping
never crops it, with a full-bleed white background so any mask shape (circle,
squircle) reveals only white at the corners.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "brand" / "convey-mark.png"
ICONS = ROOT / "public" / "icons"

WHITE = (255, 255, 255, 255)


def load_mark() -> Image.Image:
    img = Image.open(SRC).convert("RGBA")
    # Trim fully-transparent borders so the mark is fit to its visible bounds
    # before scaling — keeps the composition consistent regardless of source
    # padding.
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    return img


def composite_any(mark: Image.Image, size: int) -> Image.Image:
    """Any-purpose icon: mark on white with a ~12% margin on every side."""
    canvas = Image.new("RGBA", (size, size), WHITE)
    margin = int(size * 0.12)
    box = size - margin * 2
    scaled = mark.resize((box, box), Image.LANCZOS)
    canvas.alpha_composite(scaled, (margin, margin))
    return canvas.convert("RGB")


def composite_maskable(mark: Image.Image, size: int) -> Image.Image:
    """Maskable icon: full-bleed white, mark scaled so its corners sit inside
    the central 80% safe-zone CIRCLE (diameter = 0.8 * size). A square mark's
    diagonal must clear that circle, so the box side is 0.8 * size / sqrt(2)
    ~= 0.566 * size — kept just under to leave a hair of breathing room."""
    canvas = Image.new("RGBA", (size, size), WHITE)
    box = int(size * 0.56)
    scaled = mark.resize((box, box), Image.LANCZOS)
    offset = (size - box) // 2
    canvas.alpha_composite(scaled, (offset, offset))
    return canvas.convert("RGB")


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)
    mark = load_mark()
    for size in (192, 512):
        composite_any(mark, size).save(ICONS / f"convey-{size}.png", "PNG")
    composite_maskable(mark, 512).save(ICONS / "convey-maskable-512.png", "PNG")
    print("wrote convey-192.png, convey-512.png, convey-maskable-512.png")


if __name__ == "__main__":
    main()

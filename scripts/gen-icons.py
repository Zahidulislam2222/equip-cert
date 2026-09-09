"""Rasterise the brand mark from public/icon.svg's geometry.

PIL cannot read SVG, so the shield is redrawn here from the same coordinates. Keep the two
in step: the SVG is the reference, this is the raster mirror of it.

Usage: python scripts/gen-icons.py
"""
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")
APP = os.path.join(ROOT, "src", "app")

INK = (16, 15, 14, 255)      # --background, hsl(30 8% 6%)
ACCENT = (255, 199, 26, 255)  # --primary, hsl(45 100% 55%)

# Shield outline in the SVG's 64x64 space.
SHIELD = [
    (32, 11), (49, 17.4), (49, 32.2),
    (46.5, 38.0), (41.5, 44.0), (32, 53.4),
    (22.5, 44.0), (17.5, 38.0), (15, 32.2),
    (15, 17.4),
]
CHECK = [(23.5, 31.8), (29.4, 37.9), (41.0, 25.6)]


def draw_mark(size, ss=8, rounded=True):
    """Render at `ss`x then downsample — PIL has no antialiasing of its own."""
    n = size * ss
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = n / 64.0

    if rounded:
        d.rounded_rectangle([0, 0, n - 1, n - 1], radius=int(14 * k), fill=INK)
    else:
        d.rectangle([0, 0, n - 1, n - 1], fill=INK)

    d.polygon([(x * k, y * k) for x, y in SHIELD], fill=ACCENT)
    d.line(
        [(x * k, y * k) for x, y in CHECK],
        fill=INK,
        width=int(5.4 * k),
        joint="curve",
    )
    # Round the check's end caps, which `line` leaves square.
    r = 2.7 * k
    for x, y in (CHECK[0], CHECK[-1]):
        d.ellipse([x * k - r, y * k - r, x * k + r, y * k + r], fill=INK)

    return img.resize((size, size), Image.LANCZOS)


def main():
    written = []

    for name, size, target in [
        ("apple-icon.png", 180, PUBLIC),
        ("icon-192.png", 192, PUBLIC),
        ("icon-512.png", 512, PUBLIC),
    ]:
        path = os.path.join(target, name)
        draw_mark(size).save(path, "PNG", optimize=True)
        written.append((path, os.path.getsize(path)))

    # Multi-resolution .ico. Next.js App Router serves src/app/favicon.ico at /favicon.ico,
    # so the brand mark has to replace the framework default there, not merely sit in public/.
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    base = draw_mark(256)
    for path in (os.path.join(APP, "favicon.ico"), os.path.join(PUBLIC, "favicon.ico")):
        base.save(path, "ICO", sizes=[(s, s) for s in ico_sizes])
        written.append((path, os.path.getsize(path)))

    for path, size in written:
        print("  %-58s %7d bytes" % (os.path.relpath(path, ROOT).replace("\\", "/"), size))


if __name__ == "__main__":
    main()

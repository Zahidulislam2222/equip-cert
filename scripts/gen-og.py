"""Composite the social card: Blender render + typography.

Text is drawn here rather than generated, so the headline is always legible and always
matches the site. Run after the Blender beauty pass.

Usage: python scripts/gen-og.py <render.png> <out.png> <archivo.ttf>
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
ACCENT = (255, 199, 26, 255)
INK = (16, 15, 14, 255)
PAPER = (242, 240, 236, 255)
MUTED = (163, 157, 148, 255)

HEADLINE = ["Equipment inspections", "that hold up."]
KICKER = "EQUIPMENT SAFETY COMPLIANCE"
SUB = "AI identification · dynamic checklists · GPS evidence · OSHA-ready reports"


def var_font(path, size, weight, width=100):
    font = ImageFont.truetype(path, size)
    try:
        font.set_variation_by_axes([weight, width])
    except Exception:
        # Static build or no FreeType variation support — the default instance still reads.
        pass
    return font


def scrim(base):
    """Left-to-right darkening so type stays legible over the render."""
    grad = Image.new("L", (W, 1))
    for x in range(W):
        t = x / (W - 1)
        # Opaque through the left third, easing out by ~72% across.
        a = 255 if t < 0.33 else max(0, int(255 * (1 - (t - 0.33) / 0.39)))
        grad.putpixel((x, 0), a)
    mask = grad.resize((W, H))
    layer = Image.new("RGBA", (W, H), INK)
    layer.putalpha(mask)
    return Image.alpha_composite(base, layer)


def shield(d, x, y, s):
    pts = [(32, 11), (49, 17.4), (49, 32.2), (46.5, 38.0), (41.5, 44.0), (32, 53.4),
           (22.5, 44.0), (17.5, 38.0), (15, 32.2), (15, 17.4)]
    k = s / 64.0
    d.polygon([(x + px * k, y + py * k) for px, py in pts], fill=ACCENT)
    check = [(23.5, 31.8), (29.4, 37.9), (41.0, 25.6)]
    d.line([(x + px * k, y + py * k) for px, py in check], fill=INK,
           width=max(1, int(5.4 * k)), joint="curve")


def main():
    render_path, out_path, font_path = sys.argv[1], sys.argv[2], sys.argv[3]

    base = Image.open(render_path).convert("RGBA")
    if base.size != (W, H):
        base = base.resize((W, H), Image.LANCZOS)
    img = scrim(base)
    d = ImageDraw.Draw(img)

    f_kicker = var_font(font_path, 19, 600, 112)
    f_head = var_font(font_path, 62, 900, 96)
    f_sub = var_font(font_path, 21, 500)
    f_mark = var_font(font_path, 26, 800)

    x = 72

    # Brand lockup
    shield(d, x, 60, 40)
    d.text((x + 54, 66), "EquipCert AI", font=f_mark, fill=PAPER)

    # Kicker with the accent rule the site uses
    ky = 188
    d.line([(x, ky + 10), (x + 30, ky + 10)], fill=ACCENT, width=2)
    d.text((x + 44, ky), KICKER, font=f_kicker, fill=MUTED)

    # Headline — tight leading, the display voice of the site
    y = 232
    for i, line in enumerate(HEADLINE):
        d.text((x, y), line, font=f_head, fill=ACCENT if i == 1 else PAPER)
        y += 70

    d.text((x, y + 26), SUB, font=f_sub, fill=MUTED)

    img.convert("RGB").save(out_path, "PNG", optimize=True)
    print("  %s  %dx%d  %d bytes" % (
        os.path.basename(out_path), img.width, img.height, os.path.getsize(out_path)))


if __name__ == "__main__":
    main()

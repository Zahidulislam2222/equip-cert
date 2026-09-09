"""Measure label contrast against the film as it is actually composited on screen.

Playbook §10: "measure text contrast against the composited background at visible motion
states; an automated check that skips faded text leaves a gap."

A checker that reads CSS alone sees `text-muted-foreground` on `bg-background` and passes.
That is not what a visitor sees: the copy sits over a translucent scrim over a moving film,
so the real background changes every frame. This composites the scrim over each rendered
frame, samples the region the text occupies, and reports the WORST contrast found.

Usage: python scripts/check-overlay-contrast.py <frames_dir> [--viewport 1440]
"""
import argparse
import glob
import os
import re
import sys

from PIL import Image

# Design tokens from src/app/globals.css (HSL as authored).
TOKENS = {
    "background": (30, 0.08, 0.06),
    "foreground": (36, 0.12, 0.92),
    "muted-foreground": (34, 0.07, 0.58),
    "primary": (45, 1.00, 0.55),
}

def load_scrim():
    """Read the scrim stops from globals.css so the check cannot drift from the design.

    The `.flight-scrim` rule is the single owner of these values; parsing them here means a
    designer changing the gradient automatically changes what this script measures.
    """
    css_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                            "src", "app", "globals.css")
    css = open(css_path, encoding="utf-8").read()
    block = re.search(r"\.flight-scrim\s*\{(.*?)\}", css, re.S)
    if not block:
        raise SystemExit("`.flight-scrim` not found in globals.css")
    stops = re.findall(r"hsl\(var\(--background\)\s*/\s*([0-9.]+)\)\s*([0-9.]+)%",
                       block.group(1))
    if not stops:
        raise SystemExit("could not parse .flight-scrim stops")
    return sorted((float(pos) / 100.0, float(alpha)) for alpha, pos in stops)


SCRIM = None  # populated in main()

# WCAG 2.2 SC 1.4.3
MIN_BODY = 4.5
MIN_LARGE = 3.0


def hsl_to_rgb(h, s, ll):
    c = (1 - abs(2 * ll - 1)) * s
    hp = (h % 360) / 60.0
    x = c * (1 - abs(hp % 2 - 1))
    r, g, b = [(c, x, 0), (x, c, 0), (0, c, x), (0, x, c), (x, 0, c), (c, 0, x)][int(hp)]
    m = ll - c / 2
    return tuple(round(255 * (v + m)) for v in (r, g, b))


def luminance(rgb):
    out = []
    for v in rgb:
        v = v / 255.0
        out.append(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2]


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def scrim_alpha(t):
    for (t0, a0), (t1, a1) in zip(SCRIM, SCRIM[1:]):
        if t0 <= t <= t1:
            k = 0 if t1 == t0 else (t - t0) / (t1 - t0)
            return a0 + (a1 - a0) * k
    return 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("frames_dir")
    ap.add_argument("--viewport", type=int, default=1440)
    ap.add_argument("--step", type=int, default=5, help="sample every Nth frame")
    args = ap.parse_args()

    global SCRIM
    SCRIM = load_scrim()
    print("  scrim stops read from globals.css: %s" % SCRIM)

    frames = sorted(glob.glob(os.path.join(args.frames_dir, "*.png")))[:: args.step]
    if not frames:
        raise SystemExit("no frames in " + args.frames_dir)

    bg = hsl_to_rgb(*TOKENS["background"])

    # Text column geometry: max-w-6xl (1152px) centred, px-5, then max-w-md (448px).
    vw = args.viewport
    container_left = max(0, (vw - 1152) / 2)
    text_left = container_left + 20
    text_right = text_left + 448
    t_left, t_right = text_left / vw, text_right / vw

    worst = {name: (99.0, None, None) for name in ("foreground", "muted-foreground", "primary")}

    for path in frames:
        im = Image.open(path).convert("RGB")
        W, H = im.size
        # Vertical band the copy occupies: roughly the middle half of the viewport.
        y0, y1 = int(H * 0.30), int(H * 0.72)
        for name in worst:
            fg = hsl_to_rgb(*TOKENS[name])
            # Walk across the text column; the scrim thins to the right, so the worst
            # case is normally its right edge over a bright part of the frame.
            for step in range(0, 21):
                t = t_left + (t_right - t_left) * step / 20.0
                x = min(W - 1, max(0, int(t * W)))
                a = scrim_alpha(t)
                col = im.crop((x, y0, x + 1, y1))
                px = list(col.convert('RGB').getdata())
                # Brightest pixel in the column is the worst case for light text.
                bright = max(px, key=luminance)
                comp = tuple(round(bg[i] * a + bright[i] * (1 - a)) for i in range(3))
                ratio = contrast(fg, comp)
                if ratio < worst[name][0]:
                    worst[name] = (ratio, os.path.basename(path), round(t, 3))

    print("=== worst composited contrast across %d sampled frames ===" % len(frames))
    print("  viewport %dpx | text column x=%d..%d\n" % (vw, text_left, text_right))
    failed = False
    for name, (ratio, frame, t) in worst.items():
        need = MIN_LARGE if name == "foreground" else MIN_BODY
        ok = ratio >= need
        failed = failed or not ok
        print("  %-18s %5.2f:1  (needs %.1f)  %s   worst at %s, x=%.0f%%"
              % (name, ratio, need, "PASS" if ok else "FAIL", frame, t * 100))

    print("\n  %s" % ("All sampled text passes WCAG 1.4.3 over the film."
                      if not failed else
                      "FAILS — darken the scrim, narrow the text column, or lift the text colour."))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

"""Generate the tiling surface-detail maps the glTF export cannot carry.

Why this exists
---------------
`scripts/blender/extinguisher.py` builds its materials with procedural noise driving
roughness and a bump node driving micro-relief, and that is most of why the Cycles render
does not look like untouched CG. glTF has no representation for a Blender node graph, so
`flatten_materials_for_gltf()` strips both on the way out. The exported model therefore
carries flat scalar roughness and no normal detail at all, and in the browser it reads as
moulded plastic next to its own render.

Baking the procedural noise per object would mean twelve texture sets in the GLB for what is,
in the end, one tiling grunge pattern. So it is generated here once, as a single small pair of
tiling maps applied to every material in the viewer with per-material strength.

Outputs (both tile seamlessly, both are deterministic for a given seed):

  public/media/surface-detail.webp   grayscale; modulates roughness
  public/media/surface-normal.webp   tangent-space normal map derived from the same field

Run:  npm run gen:surface
"""

from __future__ import annotations

import argparse
import pathlib

import numpy as np
from PIL import Image

# Fixed seed: the maps are a design decision, not a random one. Regenerating must produce the
# same surface, or the model's look changes silently between builds.
SEED = 20260909


def value_noise(size: int, frequency: int, rng: np.random.Generator) -> np.ndarray:
    """One octave of tiling value noise, bilinearly interpolated.

    Tiling comes from generating the lattice with `np.roll`-safe wrapping: the lattice is
    frequency x frequency and sampled with wrap-around, so the left edge meets the right.
    """
    lattice = rng.random((frequency, frequency), dtype=np.float64)

    coords = np.linspace(0, frequency, size, endpoint=False)
    x0 = np.floor(coords).astype(int) % frequency
    x1 = (x0 + 1) % frequency
    tx = coords - np.floor(coords)
    # Smoothstep the interpolant, otherwise the lattice shows as a visible grid.
    tx = tx * tx * (3 - 2 * tx)

    top = lattice[np.ix_(x0, x0)] * (1 - tx)[None, :] + lattice[np.ix_(x0, x1)] * tx[None, :]
    bottom = lattice[np.ix_(x1, x0)] * (1 - tx)[None, :] + lattice[np.ix_(x1, x1)] * tx[None, :]
    return top * (1 - tx)[:, None] + bottom * tx[:, None]


def fractal(size: int, octaves: int, base_frequency: int, rng: np.random.Generator) -> np.ndarray:
    """Sum octaves at doubling frequency and halving amplitude, normalised to 0..1."""
    total = np.zeros((size, size), dtype=np.float64)
    amplitude = 1.0
    frequency = base_frequency
    norm = 0.0
    for _ in range(octaves):
        total += value_noise(size, frequency, rng) * amplitude
        norm += amplitude
        amplitude *= 0.5
        frequency *= 2
    total /= norm
    return (total - total.min()) / max(1e-9, float(np.ptp(total)))  # np.ptp: ndarray.ptp() was removed in numpy 2.x


def to_normal_map(height: np.ndarray, strength: float) -> np.ndarray:
    """Sobel-free tangent-space normal from a height field, using wrapped gradients.

    `np.roll` keeps the derivative continuous across the edges, so the normal map tiles for
    the same reason the height field does.
    """
    dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * strength
    dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * strength
    nz = np.ones_like(height)
    length = np.sqrt(dx * dx + dy * dy + nz * nz)
    # glTF tangent-space convention: +X right, +Y up, +Z out, packed 0..1.
    r = (-dx / length) * 0.5 + 0.5
    g = (-dy / length) * 0.5 + 0.5
    b = (nz / length) * 0.5 + 0.5
    return np.stack([r, g, b], axis=-1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=512)
    ap.add_argument("--octaves", type=int, default=5)
    ap.add_argument("--frequency", type=int, default=8, help="base lattice frequency")
    ap.add_argument("--normal-strength", type=float, default=14.0)
    ap.add_argument("--out", default="public/media")
    args = ap.parse_args()

    rng = np.random.default_rng(SEED)
    height = fractal(args.size, args.octaves, args.frequency, rng)

    # A little contrast so the roughness modulation reads, without turning the surface into
    # visible noise. The viewer scales this per material anyway.
    detail = np.clip((height - 0.5) * 1.25 + 0.5, 0, 1)

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    detail_path = out / "surface-detail.webp"
    Image.fromarray((detail * 255).astype(np.uint8), mode="L").save(
        detail_path, format="WEBP", quality=88, method=6
    )

    normal = to_normal_map(height, args.normal_strength)
    normal_path = out / "surface-normal.webp"
    Image.fromarray((normal * 255).astype(np.uint8), mode="RGB").save(
        normal_path, format="WEBP", quality=92, method=6
    )

    # Prove the tiling claim rather than asserting it: compare each edge with the one it will
    # meet when repeated. A seam shows up here long before it shows up on the model.
    seam_x = float(np.abs(height[:, 0] - height[:, -1]).mean())
    seam_y = float(np.abs(height[0, :] - height[-1, :]).mean())
    interior = float(np.abs(np.diff(height, axis=1)).mean())

    print(f"detail : {detail_path}  {detail_path.stat().st_size:,} bytes")
    print(f"normal : {normal_path}  {normal_path.stat().st_size:,} bytes")
    print(f"seam continuity  x={seam_x:.4f}  y={seam_y:.4f}  (interior mean step {interior:.4f})")
    if seam_x > interior * 3 or seam_y > interior * 3:
        raise SystemExit("FAILED: edges do not tile — a seam would be visible on the model")
    print("tiling verified")


if __name__ == "__main__":
    main()

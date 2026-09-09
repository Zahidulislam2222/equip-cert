"""Assemble rendered frames into web video, and compare encodes rather than assuming one.

Playbook §7: inspect the master with ffprobe, then compare candidate encodes on size and
seek cost before choosing. A short GOP reduces seek work and increases bytes; that trade is
the whole point of scrub encoding, so it is measured here rather than asserted.

Usage:
  python scripts/encode-flight.py <frames_dir> [--pick GOP]
"""
import argparse
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "src", "content", "inspection-flight.json")
OUT_DIR = os.path.join(ROOT, "public", "media")


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit("FAILED: %s\n%s" % (" ".join(cmd[:6]), p.stderr[-1500:]))
    return p.stdout


def probe(path):
    out = run(["ffprobe", "-v", "error", "-print_format", "json",
               "-show_streams", "-show_format", path])
    d = json.loads(out)
    v = next(s for s in d["streams"] if s["codec_type"] == "video")
    return {
        "codec": v.get("codec_name"),
        "profile": v.get("profile"),
        "pix_fmt": v.get("pix_fmt"),
        "size": "%sx%s" % (v.get("width"), v.get("height")),
        "fps": v.get("r_frame_rate"),
        "frames": v.get("nb_frames"),
        "duration_s": round(float(d["format"].get("duration", 0)), 2),
        "bytes": int(d["format"].get("size", 0)),
        "audio_streams": sum(1 for s in d["streams"] if s["codec_type"] == "audio"),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("frames_dir")
    ap.add_argument("--pick", type=int, default=None,
                    help="GOP to publish; omit to only compare candidates")
    args = ap.parse_args()

    manifest = json.load(open(MANIFEST, encoding="utf-8"))
    fps = manifest["fps"]
    pattern = os.path.join(args.frames_dir, "f_%04d.png")
    n = len([f for f in os.listdir(args.frames_dir) if f.endswith(".png")])
    if n != manifest["frames"]:
        print("  WARNING: %d frames on disk, manifest declares %d" % (n, manifest["frames"]))

    os.makedirs(OUT_DIR, exist_ok=True)
    work = args.frames_dir

    # --- master: visually lossless, the thing we keep -------------------------
    master = os.path.join(work, "master.mp4")
    run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", pattern,
         "-c:v", "libx264", "-crf", "12", "-preset", "slow", "-pix_fmt", "yuv420p",
         "-movflags", "+faststart", "-an", master])
    m = probe(master)
    print("=== master (kept, not shipped) ===")
    for k, v in m.items():
        print("  %-14s %s" % (k, v))
    print("  %-14s %.2f MiB" % ("size", m["bytes"] / 1048576.0))

    # --- candidates -----------------------------------------------------------
    print("\n=== candidate web encodes ===")
    print("  %-6s %-5s %10s %10s   %s" % ("GOP", "CRF", "bytes", "MiB", "note"))
    candidates = [(4, 21), (8, 21), (8, 24), (16, 21), (25, 21)]
    results = []
    for gop, crf in candidates:
        cand = os.path.join(work, "cand_g%d_crf%d.mp4" % (gop, crf))
        run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", pattern,
             "-c:v", "libx264", "-crf", str(crf), "-g", str(gop), "-keyint_min", str(gop),
             "-sc_threshold", "0", "-preset", "slow", "-pix_fmt", "yuv420p",
             "-movflags", "+faststart", "-an", cand])
        size = os.path.getsize(cand)
        note = {4: "finest seek, largest", 8: "scrub default",
                16: "coarser seek", 25: "1 keyframe/sec — normal web video"}.get(gop, "")
        if gop == 8 and crf == 24:
            note = "scrub, lower quality"
        print("  %-6d %-5d %10d %10.2f   %s" % (gop, crf, size, size / 1048576.0, note))
        results.append((gop, crf, size, cand))

    if args.pick is None:
        print("\n  No --pick given: candidates left in %s for inspection." % work)
        return

    chosen = [r for r in results if r[0] == args.pick]
    if not chosen:
        raise SystemExit("no candidate with GOP %d" % args.pick)
    gop, crf, size, path = chosen[0]

    dest = os.path.join(OUT_DIR, "inspection-flight.mp4")
    with open(path, "rb") as src, open(dest, "wb") as dst:
        dst.write(src.read())

    # Poster must match the clip's FIRST displayed frame, not a nearby seek.
    poster = os.path.join(OUT_DIR, "inspection-flight-poster.webp")
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", os.path.join(args.frames_dir, "f_0001.png"),
         "-c:v", "libwebp", "-quality", "82", poster])

    print("\n=== published ===")
    p = probe(dest)
    for k, v in p.items():
        print("  %-14s %s" % (k, v))
    print("  %-14s %.2f MiB" % ("size", p["bytes"] / 1048576.0))
    print("  %-14s %s (%d bytes)" % ("poster", os.path.basename(poster), os.path.getsize(poster)))
    if p["audio_streams"] != 0:
        print("  WARNING: audio stream present; scrubbed video should carry none")


if __name__ == "__main__":
    main()

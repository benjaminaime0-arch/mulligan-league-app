#!/usr/bin/env python3
"""
Subset the Nobel TRIAL OTFs to their non-watermarked codepoints and emit
WOFF2 files for next/font.

WHY
---
The app shipped all 12 OTF faces (~1.85 MB, globally preloaded) from
public/fonts/nobel/ — the single largest chunk of first-load weight, and a
publicly downloadable copy of a trial-licensed font. Meanwhile the
"nobel-trial-patch" CSS family (see gen_nobel_fallback_range.py) already
hands every WATERMARKED codepoint to a system font, so Nobel glyphs for
those codepoints are dead weight: they can never legitimately render.

This script therefore:
  1. reuses gen_nobel_fallback_range's band detection to find the
     watermarked codepoints per face,
  2. subsets each face to (cmap MINUS watermarked) — letters, digits,
     space, comma, period and the few other clean glyphs,
  3. writes WOFF2 to src/fonts/nobel/ (bundled by next/font, NOT servable
     as loose public files).

Hardening side effect: the subset faces simply do not contain the
watermark artwork, so a "TRIAL" label can no longer render even if the
CSS patch block were lost — a missing glyph falls through the font stack
to the system font instead.

The ORIGINAL OTFs live in assets/fonts/nobel-trial/ (outside public/):
they are the input to this script and to gen_nobel_fallback_range.py
--check, and the reference for re-deriving everything after buying the
retail font. Do not delete them; do not move them back under public/.

USAGE
-----
    python3 scripts/build_nobel_woff2.py            # (re)build src/fonts/nobel/*.woff2
    python3 scripts/build_nobel_woff2.py --check    # exit 1 if outputs are stale/missing

Requires fonttools + brotli.
"""

from __future__ import annotations

import argparse
import io
import os
import pathlib
import sys

# fontTools stamps head.modified at save time, which would make every build
# byte-different and --check useless. SOURCE_DATE_EPOCH pins it (must be set
# before any save; value is arbitrary but fixed).
os.environ.setdefault("SOURCE_DATE_EPOCH", "1500000000")

from fontTools import subset
from fontTools.ttLib import TTFont

import gen_nobel_fallback_range as gen

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "assets" / "fonts" / "nobel-trial"
OUT_DIR = ROOT / "src" / "fonts" / "nobel"

# The 12 faces layout.tsx registers. The Cond cuts were never referenced
# anywhere and are not archived.
FACES = [
    "NobelTRIAL-ExtraLight",
    "NobelTRIAL-ExtraLightItalic",
    "NobelTRIAL-Light",
    "NobelTRIAL-LightItalic",
    "NobelTRIAL-Book",
    "NobelTRIAL-BookItalic",
    "NobelTRIAL-Regular",
    "NobelTRIAL-RegularItalic",
    "NobelTRIAL-Bold",
    "NobelTRIAL-BoldItalic",
    "NobelTRIAL-Black",
    "NobelTRIAL-BlackItalic",
]


def build_face(src: pathlib.Path) -> bytes:
    marked = gen.watermarked_codepoints(src)

    font = TTFont(str(src))
    try:
        cmap = font.getBestCmap()
        keep = sorted(set(cmap) - marked)
        # Sanity: the clean core must survive, or the subset would render
        # body text in the fallback stack and nobody would notice in dev.
        missing = [cp for cp in gen.CLEAN_ASCII if cp in cmap and cp not in keep]
        if missing:
            sys.exit(
                f"ABORT — {src.name}: clean glyphs classed as watermarked: "
                + " ".join(repr(chr(c)) for c in missing)
            )

        options = subset.Options()
        options.flavor = "woff2"
        # Keep kerning/ligatures for the glyphs that remain.
        options.layout_features = ["*"]
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=keep)
        subsetter.subset(font)

        buf = io.BytesIO()
        font.flavor = "woff2"
        font.save(buf)
        return buf.getvalue()
    finally:
        font.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="exit 1 if any output is stale")
    args = ap.parse_args()

    missing_src = [f for f in FACES if not (SRC_DIR / f"{f}.otf").exists()]
    if missing_src:
        sys.exit(f"Missing source OTFs in {SRC_DIR}: {', '.join(missing_src)}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stale = []
    total = 0
    for face in FACES:
        src = SRC_DIR / f"{face}.otf"
        out = OUT_DIR / f"{face}.woff2"
        data = build_face(src)
        total += len(data)
        if args.check:
            if not out.exists() or out.read_bytes() != data:
                stale.append(out.name)
            continue
        out.write_bytes(data)
        print(f"{out.relative_to(ROOT)}  {len(data):,} bytes")

    if args.check:
        if stale:
            sys.exit("STALE — rebuild with scripts/build_nobel_woff2.py: " + ", ".join(stale))
        print(f"OK — {len(FACES)} subset faces current ({total:,} bytes total).")
        return
    print(f"Total: {total:,} bytes across {len(FACES)} faces.")


if __name__ == "__main__":
    main()

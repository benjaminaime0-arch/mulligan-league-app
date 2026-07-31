#!/usr/bin/env python3
"""
Regenerate the Nobel TRIAL fallback @font-face block in src/app/globals.css.

WHY THIS EXISTS
---------------
public/fonts/nobel/ ships the *TRIAL* cut of Nobel. A trial font is not
glyph-restricted in the usual sense — its cmap covers 577 codepoints — but
422 of those map to a watermark glyph that draws a small rotated "TRIAL"
label instead of the real character. Affected codepoints include ASCII
punctuation the app uses constantly (- @ ? ( ) % / & + = " $ _ [ ] { } |),
every accented Latin letter, the euro sign, en/em dashes, smart quotes,
the bullet, the ellipsis, and U+2212 MINUS SIGN (golf scores).

The fix — until a licensed Nobel is purchased — is to declare extra
@font-face entries under the SAME family name next/font/local generates,
pointing at system fonts, with a unicode-range covering exactly the
watermarked set. The browser then uses Helvetica/Arial for those code
points only and stays on Nobel for everything else.

Two things this script gets right that hand-editing did not:
  1. The range is derived from the font binaries, not guessed.
  2. One face is emitted PER WEIGHT. CSS font matching prefers the
     narrowest weight descriptor, so a single 400-only (or 100-900 range)
     fallback loses to Nobel's own exact-weight faces at every other
     weight and the watermarks reappear in Light body and Black display.

USAGE
-----
    python3 scripts/gen_nobel_fallback_range.py          # print the CSS
    python3 scripts/gen_nobel_fallback_range.py --check  # verify committed CSS is current

Requires fonttools. Re-run whenever the font files or the next/font config
in src/app/layout.tsx change (the generated family hash is read from
globals.css itself and must match what next/font emits).
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
FONT_DIR = ROOT / "public" / "fonts" / "nobel"
CSS = ROOT / "src" / "app" / "globals.css"

# Detection. The watermark is one piece of artwork (rotated "TRIAL" text)
# stretched to each glyph's advance width, so its width varies but its
# VERTICAL extent does not: every instance sits in one of two bands. We
# derive those bands from anchor characters that were confirmed watermarked
# by rendering them at 64px in a browser, then flag every glyph sharing a
# band. CLEAN_ASCII is the guard — if detection ever catches a real letter,
# digit, comma or period, the script aborts instead of writing a fallback
# that would silently swap half the alphabet to Helvetica.
WATERMARK_ANCHORS = [
    0x3A, 0x3B, 0x21, 0x2D, 0x40, 0x3F, 0x28, 0x29, 0x25, 0x2F,  # : ; ! - @ ? ( ) % /
    0xE9, 0xE0, 0xE7,                                            # é à ç
    0x2014, 0x2026, 0x2022, 0x20AC, 0x2212,                      # — … • € −
    0x22, 0x26, 0x2B, 0x3D,                                      # " & + =
]
CLEAN_ASCII = [
    ord(c)
    for c in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789,. "
]

# Weights and styles declared by next/font/local in src/app/layout.tsx.
# layout.tsx registers 12 faces (each weight in normal AND italic). A
# fallback that omits font-style defaults to `normal`, so italic text would
# not match it and would fall straight back to Nobel's italic face —
# watermarks and all. Nothing renders italic today, but an <em> or an
# `italic` class would silently reintroduce the bug, so we mirror both axes.
WEIGHTS = [200, 300, 400, 500, 700, 900]
STYLES = ["normal", "italic"]

# Our own family, placed FIRST in the Tailwind sans stack. Because its faces
# only declare the watermarked unicode-range, every other character falls
# through to Nobel. Keep in sync with tailwind.config.ts.
PATCH_FAMILY = "nobel-trial-patch"

FALLBACK_SRC = (
    'local("Helvetica Neue"), local("Helvetica"), local("Arial"), '
    'local("Segoe UI"), local("Roboto")'
)

BEGIN = "/* BEGIN generated: nobel-trial-watermark-fallback */"
END = "/* END generated: nobel-trial-watermark-fallback */"


def watermarked_codepoints(font_path: pathlib.Path) -> set[int]:
    font = TTFont(str(font_path))
    try:
        cmap = font.getBestCmap()
        charstrings = font["CFF "].cff[font["CFF "].cff.fontNames[0]].CharStrings

        vextent: dict[int, tuple[float, float]] = {}
        for cp, glyph_name in cmap.items():
            pen = BoundsPen(None)
            try:
                charstrings[glyph_name].draw(pen)
            except Exception:
                continue
            if pen.bounds:
                vextent[cp] = (pen.bounds[1], pen.bounds[3])  # yMin, yMax

        bands = {vextent[cp] for cp in WATERMARK_ANCHORS if cp in vextent}
        if not bands:
            sys.exit(f"No watermark anchors resolved in {font_path.name}.")

        found = {cp for cp, v in vextent.items() if v in bands}

        collisions = sorted(cp for cp in CLEAN_ASCII if cp in found)
        if collisions:
            sys.exit(
                f"ABORT — watermark detection flagged real glyphs in {font_path.name}: "
                + " ".join(repr(chr(c)) for c in collisions)
                + "\nThe font changed; re-derive the detection before writing CSS."
            )
        return found
    finally:
        font.close()


def to_ranges(codepoints) -> str:
    out, start, prev = [], None, None
    for cp in sorted(codepoints):
        if start is None:
            start = prev = cp
        elif cp == prev + 1:
            prev = cp
        else:
            out.append((start, prev))
            start = prev = cp
    if start is not None:
        out.append((start, prev))
    return ", ".join(
        f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in out
    )


def read_family(css_text: str, override: str | None) -> str:
    """
    The fallback declares its OWN family (PATCH_FAMILY), which is then placed
    FIRST in the Tailwind font stack — see tailwind.config.ts.

    It used to re-declare next/font's hashed family (__nobel_<hash>) instead,
    relying on same-family unicode-range to win. That silently does nothing in
    a production build: when two @font-face rules share family/weight/style and
    both unicode-ranges cover a character, CSS picks the LAST declared one, and
    Next bundles globals.css BEFORE the next/font CSS — so Nobel always won and
    every watermark stayed on screen. It appeared to work only in dev, where the
    injection order is reversed.

    Font-STACK order is authoritative and independent of @font-face order, so
    keying off our own family is correct in both dev and prod — and it drops the
    dependency on the hash, which changed whenever the layout.tsx font config did.
    """
    return override or PATCH_FAMILY


def build_css(family: str, unicode_range: str, n_cp: int, n_faces: int) -> str:
    header = (
        f"{BEGIN}\n"
        f"/* Do not edit by hand — run scripts/gen_nobel_fallback_range.py.\n"
        f"   Nobel TRIAL draws a rotated \"TRIAL\" watermark instead of the real\n"
        f"   glyph for {n_cp} of its codepoints (ASCII punctuation such as - @ ? ( )\n"
        f"   % / & + =, every accented Latin letter, the euro sign, dashes, smart\n"
        f"   quotes, the bullet, the ellipsis and U+2212 MINUS). These faces hand\n"
        f"   exactly those code points to a system font and leave the rest on Nobel.\n"
        f"   This family is listed FIRST in the Tailwind sans stack; its faces only\n"
        f"   cover the watermarked range, so every other character falls through to\n"
        f"   Nobel. Do NOT switch this back to re-declaring next/font's hashed family\n"
        f"   — same-family unicode-range loses to the later-bundled next/font CSS in\n"
        f"   production and the whole block silently does nothing (it only appeared to\n"
        f"   work in dev, where the injection order is reversed).\n"
        f"   One face per weight AND style: CSS prefers an exact weight/style match,\n"
        f"   and omitting font-style would leave italic text on watermarked Nobel.\n"
        f"   Derived from {n_faces} font files. Deleting this block AND its entry in\n"
        f"   tailwind.config.ts is the first step after licensing the retail font. */"
    )
    blocks = [
        "@font-face {\n"
        f'  font-family: "{family}";\n'
        f"  src: {FALLBACK_SRC};\n"
        f"  font-weight: {w};\n"
        f"  font-style: {s};\n"
        f"  unicode-range: {unicode_range};\n"
        "  font-display: swap;\n"
        "}"
        for w in WEIGHTS
        for s in STYLES
    ]
    return header + "\n" + "\n".join(blocks) + "\n" + END


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="exit 1 if globals.css is stale")
    ap.add_argument("--write", action="store_true", help="rewrite the block in globals.css")
    ap.add_argument("--family", help="seed the next/font family name, e.g. __nobel_3fad05")
    args = ap.parse_args()

    faces = sorted(FONT_DIR.glob("NobelTRIAL-*.otf"))
    if not faces:
        sys.exit(f"No NobelTRIAL-*.otf found in {FONT_DIR}")

    # Union across faces: a codepoint watermarked in any weight must fall back
    # in every weight, otherwise the text changes typeface with font-weight.
    marked: set[int] = set()
    for f in faces:
        marked |= watermarked_codepoints(f)

    css_text = CSS.read_text(encoding="utf-8")
    family = read_family(css_text, args.family)
    block = build_css(family, to_ranges(marked), len(marked), len(faces))

    if args.check or args.write:
        pattern = re.compile(re.escape(BEGIN) + r".*?" + re.escape(END), re.S)
        if not pattern.search(css_text):
            sys.exit("Generated block markers not found in globals.css.")
        updated = pattern.sub(lambda _: block, css_text)
        if args.check:
            if updated != css_text:
                sys.exit("globals.css fallback block is STALE — run with --write.")
            print(f"OK — fallback covers {len(marked)} watermarked codepoints.")
            return
        CSS.write_text(updated, encoding="utf-8")
        print(f"Wrote {len(marked)} watermarked codepoints into {CSS.relative_to(ROOT)}")
        return

    print(block)


if __name__ == "__main__":
    main()

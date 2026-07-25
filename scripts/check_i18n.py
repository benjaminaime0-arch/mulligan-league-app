#!/usr/bin/env python3
"""
i18n integrity check (T1.7).

Three failure modes this catches, all of which ship silently otherwise:

  1. LOCALE DRIFT — a key exists in `en` but not `fr` (or vice versa). The runtime
     falls back to English, so a French user sees an English string with no error.

  2. UNDEFINED KEY — a component calls t("some.key") that no dictionary defines.
     The runtime returns the key itself, so the user literally reads
     "games.create.title" on the page.

  3. UNUSED KEY — a dictionary entry nothing references. Harmless at runtime but
     it rots, and a stale translation is worse than a missing one. Reported, not
     fatal, since keys can legitimately be built dynamically.

Dynamic lookups — t(variable) or t(`tmpl.${x}`) — cannot be resolved statically.
They are counted and listed so a human can eyeball them; they never fail the run,
because the alternative is banning a legitimate pattern (see the badge list in
src/app/page.tsx, which maps over literal key names).

USAGE
    python3 scripts/check_i18n.py            # report
    python3 scripts/check_i18n.py --check    # exit 1 on drift or undefined keys
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DICT = ROOT / "src" / "lib" / "i18n" / "dictionaries.ts"
SRC = ROOT / "src"

# Keys reached only through a dynamic t() call, so the static scan can't see
# them. Each is verified against the values its call site can actually produce.
# Add sparingly, and say where the value comes from.
ALLOW_UNUSED: set[str] = {
    # Built by string interpolation, so the literal never appears in source:
    #   t(`games.format.${fmt}`)  — src/app/games/[id]/page.tsx
    # `fmt` comes from the DB, whose games.format CHECK allows
    # 'stableford' | 'stroke_play'. The other two variants ARE literals in
    # source (the FORMATS array in games/create/page.tsx), so the indirect
    # scan already covers them and they must not be listed here — a
    # needlessly broad allow-list hides genuinely dead keys.
    "games.format.stroke_play",
}


def parse_dictionaries(text: str) -> dict[str, dict[str, str]]:
    """
    Pull the `en` and `fr` object literals out of dictionaries.ts.

    Deliberately regex-based rather than a TS parse: the file is a flat map of
    string->string by construction, and adding a parser dependency to a repo
    whose CI is tsc + lint + shell would cost more than it returns. The brace
    scan below is exact for that shape and raises if the shape ever changes.
    """
    out: dict[str, dict[str, str]] = {}
    for locale in ("en", "fr"):
        m = re.search(rf"^export const {locale}: Dict = {{$", text, re.M)
        if not m:
            sys.exit(f"check_i18n: could not find `export const {locale}: Dict = {{` in {DICT}")
        start = m.end()
        end = text.find("\n}", start)
        if end == -1:
            sys.exit(f"check_i18n: unterminated `{locale}` object in {DICT}")
        body = text[start:end]
        # Prettier wraps long entries so the value lands on the NEXT line:
        #     "onboarding.pitch":
        #       "Une phrase longue…",
        # A line-anchored regex silently misses those and reports the key as
        # undefined — which is a false alarm far worse than no check at all.
        # So match across newlines, and allow a value built from adjacent
        # concatenated literals ("a" + "b").
        entries: dict[str, str] = {}
        for km in re.finditer(
            r'"((?:[^"\\]|\\.)*)"\s*:\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+)',
            body,
        ):
            parts = re.findall(r'"((?:[^"\\]|\\.)*)"', km.group(2))
            entries[km.group(1)] = "".join(parts)
        out[locale] = entries
    return out


def scan_usage() -> tuple[dict[str, list[str]], list[str], set[str]]:
    """
    Return three things:
      used     {key: [files]} for direct  t("…")  calls
      dynamic  call sites like t(v) / t(`…${x}`) that can't be resolved statically
      indirect key literals that appear in source but NOT inside a t() call —
               almost always a lookup table fed to t(), e.g.

                   const MONTH_NAME_KEYS = ["common.month.january", …]
                   …
                   {t(MONTH_NAME_KEYS[d.getMonth()])}

               Treating those as unused produced 19 false "dead key" reports and
               an allow-list that would need hand-editing on every new lookup
               table. Presence of the literal is the signal.
    """
    used: dict[str, list[str]] = {}
    dynamic: list[str] = []
    indirect: set[str] = set()
    for path in sorted(SRC.rglob("*.ts*")):
        # Skip the dictionary itself, and editor droppings like .page.tsx.swp
        # which match *.ts* but are binary (a stale vim swap lives under
        # src/app/profile/ and made an earlier version of this script crash).
        if path == DICT or path.name.startswith("."):
            continue
        if path.suffix not in (".ts", ".tsx"):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            print(f"  skipping non-UTF-8 file: {path.relative_to(ROOT)}")
            continue
        rel = str(path.relative_to(ROOT))
        for m in re.finditer(r"\bt\(\s*(.)", text):
            opener = m.group(1)
            if opener == '"':
                lm = re.match(r'\bt\(\s*"((?:[^"\\]|\\.)*)"', text[m.start():])
                if lm:
                    used.setdefault(lm.group(1), []).append(rel)
            elif opener in "`'":
                dynamic.append(f"{rel}: template/quote literal")
            elif opener.isidentifier():
                # t(someVar) — resolvable only at runtime
                line = text[: m.start()].count("\n") + 1
                dynamic.append(f"{rel}:{line}")
        # Any dotted key-shaped literal anywhere in the file (lookup tables).
        for lm in re.finditer(r'"([a-z][a-z0-9]*(?:\.[a-z0-9_]+)+)"', text):
            indirect.add(lm.group(1))
    return used, dynamic, indirect


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="exit 1 on drift or undefined keys")
    args = ap.parse_args()

    dicts = parse_dictionaries(DICT.read_text(encoding="utf-8"))
    en, fr = dicts["en"], dicts["fr"]
    used, dynamic, indirect = scan_usage()

    missing_fr = sorted(set(en) - set(fr))
    missing_en = sorted(set(fr) - set(en))
    undefined = sorted(k for k in used if k not in en and k not in fr)
    unused = sorted(set(en) - set(used) - indirect - ALLOW_UNUSED)

    indirect_only = sorted((set(en) & indirect) - set(used))
    print(f"en keys: {len(en)}   fr keys: {len(fr)}   "
          f"referenced: {len(used)} direct + {len(indirect_only)} via lookup tables")

    fatal = False
    if missing_fr:
        fatal = True
        print(f"\nFAIL — {len(missing_fr)} key(s) in en but not fr (French user sees English):")
        for k in missing_fr:
            print(f"  {k}")
    if missing_en:
        fatal = True
        print(f"\nFAIL — {len(missing_en)} key(s) in fr but not en (breaks the English fallback):")
        for k in missing_en:
            print(f"  {k}")
    if undefined:
        fatal = True
        print(f"\nFAIL — {len(undefined)} key(s) used but defined nowhere (renders the raw key):")
        for k in undefined:
            print(f"  {k}   <- {', '.join(sorted(set(used[k])))}")

    if unused:
        print(f"\nwarn — {len(unused)} defined but unreferenced key(s):")
        for k in unused[:20]:
            print(f"  {k}")
        if len(unused) > 20:
            print(f"  … and {len(unused) - 20} more")
    if dynamic:
        print(f"\nnote — {len(dynamic)} dynamic t() call site(s), not statically checkable:")
        for d in sorted(set(dynamic))[:10]:
            print(f"  {d}")

    if not fatal:
        print("\nPASS — locales in parity, every referenced key is defined.")
    if args.check and fatal:
        sys.exit(1)


if __name__ == "__main__":
    main()

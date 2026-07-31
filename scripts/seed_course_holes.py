#!/usr/bin/env python3
"""Generate the course_holes seed migration from Golfs_Ile_de_France.xlsx.

One-off, run locally (stdlib only — the workbook stores every cell as an
inline string, so zipfile + ElementTree is all it takes; no openpyxl):

    python3 scripts/seed_course_holes.py \
        --xlsx ../Golfs_Ile_de_France.xlsx \
        --seed supabase/migrations/20260724120000_seed_courses.sql \
        --out  supabase/migrations/<timestamp>_seed_course_holes.sql \
        --report scripts/course_holes_mapping.md

Why matching is the hard part, not parsing:
- `courses` rows are per *installation or routing* as listed in the workbook's
  main sheet (129 rows), while the 97 per-course sheets are per *routing*,
  with names truncated to Excel's 31-char sheet limit and spelled with/without
  accents inconsistently.
- The generated SQL therefore keys on (lower(name), lower(city)) — the seed
  migration's own idempotency key — never on UUIDs, so it replays identically
  in CI (`supabase db reset`) and prod, where the generated ids differ.
- Sheets whose hole data contradicts the seeded course (par sum or hole count)
  are REPORTED and SKIPPED, never guessed. Example that motivated this:
  the sheet titled "Crécy Golf - Montpichet" contains 18 holes summing to par
  72, but the seeded 'Crécy Golf - Parcours Montpichet' is the 9-hole par-70
  routing. Seeding it would attach the wrong scorecard to every Crécy game.
- Human-reviewed resolutions go in OVERRIDES below; re-run to regenerate.

Output migration is idempotent: INSERT ... ON CONFLICT (course_id,
hole_number) DO UPDATE.
"""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field

M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RID = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"

NON_COURSE_SHEETS = {
    "Golfs Île-de-France",
    "Index Cartes",
    "Cartes de Score (résumé)",
    "Résumé par Département",
}

# sheet-title → seeded course name, for pairs the matcher cannot resolve but a
# human has verified. Value None = reviewed and confirmed unseedable.
OVERRIDES: dict[str, str | None] = {
    # Reviewed 2026-07-30 against the seed rows for each installation:
    # name drift between sources (brand prefixes, estate names, truncation).
    "Golf de Bussy-Guermantes - La J": "Golf de Bussy-Guermantes - La Brèche",  # sheet = 'La Jonchère' (truncated); seed named the same (only) 18T routing 'La Brèche'
    "Lésigny Hyverneaux-Corbuches": None,  # the seed's single 18T row is already fed by the 'Golf de Réveillon (Lésigny)' sheet; second combo has no row
    "Tremblay-Mauldre Château Bertin": "Golf du Tremblay-sur-Mauldre - Château",
    "Tremblay-Mauldre Parc Irlandais": "Golf du Tremblay-sur-Mauldre - Le Parc",
    "DailyGolf Verrières (9T)": "Golf de Verrières-le-Buisson",  # DailyGolf = operator brand
    "Greenparc P&P L'Arbalète (9T)": "Golf de Sénart - L'Arbalète",  # Greenparc = Sénart's domain name
    "Golf de Mennecy Chevannes (18T)": "Golf de Mennecy Chevannes - 18T",  # seed's 18T row carries copy-pasted 9T data → REPAIRS
    "Golf Blue Green Guerville": "Golf Blue Green de Guerville",  # really 18 holes; seed says 9 → REPAIRS
    "Gif-Chevry - Chevry II (9T)": "Golf de Gif-Chevry",  # really 9 holes; seed says 18 (2518 m over 18 holes is impossible) → REPAIRS
    # Reviewed and confirmed unseedable:
    "Crécy Golf - Montpichet": None,  # sheet has 18 holes/par 72; Montpichet is the 9T/70 routing — source sheet mislabeled
    "Meaux-Boutigny Compact (9T)": None,  # compact routing has no seed row
    "Golf Blue Green Marolles-en-Bri": None,  # 18-hole course, only a 9-hole card published
    "Lésigny-Réveillon - Rouge (9T)": None,  # seed's two Lésigny 9T rows are indistinguishable placeholders '(1)'/'(2)'
    "Golf des Corbuches ASPTT (9T)": None,  # ASPTT Paris club — no seed row
}

# Courses whose SEED row is demonstrably wrong (holes/par/distances contradict
# the internally-consistent hole card). Keyed by seeded course name; the
# migration repairs the row so the pair stays self-consistent.
REPAIRS: set[str] = {
    "Golf de Mennecy Chevannes - 18T",
    "Golf Blue Green de Guerville",
    "Golf de Gif-Chevry",
}


# ---------------------------------------------------------------- xlsx layer
def cell_text(c) -> str:
    if c.get("t") == "inlineStr":
        return "".join(t.text or "" for t in c.iter(M + "t"))
    v = c.find(M + "v")
    return "" if v is None or v.text is None else v.text


def load_sheets(path: str) -> list[tuple[str, list[list[str]]]]:
    z = zipfile.ZipFile(path)
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    relmap = {r.get("Id"): r.get("Target").lstrip("/") for r in rels}
    out = []
    for s in wb.find(M + "sheets"):
        name = s.get("name")
        target = "xl/" + relmap[s.get(RID)].removeprefix("xl/")
        root = ET.fromstring(z.read(target))
        rows = [[cell_text(c) for c in row.findall(M + "c")] for row in root.iter(M + "row")]
        out.append((name, rows))
    return out


# ------------------------------------------------------------- sheet parsing
@dataclass
class Hole:
    number: int
    par: int
    hcp: int | None
    dist: int | None


@dataclass
class Card:
    sheet: str
    title: str
    city: str
    dept: str
    par: int
    holes_declared: int
    tee: str
    holes: list[Hole] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def par_sum(self) -> int:
        return sum(h.par for h in self.holes)


def to_int(s: str) -> int | None:
    s = (s or "").strip()
    if not s or s in ("—", "-", "–"):
        return None
    try:
        return int(float(s))
    except ValueError:
        return None


HEADER_LINE2 = re.compile(
    r"^(?P<city>.+?)\s*\((?P<dept>\d{2,3})\)\s*—\s*Par\s*(?P<par>\d+)\s*—\s*(?P<holes>\d+)\s*trous\s*—\s*Départ\s*(?P<tee>\S+)",
    re.IGNORECASE,
)


def parse_card(sheet_name: str, rows: list[list[str]]) -> Card | None:
    """Rows: title / city-dept-par-holes-tee / (optional blanks) / header / holes / TOTAL…"""
    flat = [r for r in rows if any((c or "").strip() for c in r)]
    if len(flat) < 4:
        return None
    title = flat[0][0].split("—")[0].strip()
    m = HEADER_LINE2.match(flat[1][0].strip()) if flat[1] else None
    if not m:
        card = Card(sheet_name, title, "?", "?", 0, 0, "?")
        card.problems.append(f"unparseable line 2: {flat[1][0]!r}")
        return card
    card = Card(
        sheet_name,
        title,
        m["city"].strip(),
        m["dept"],
        int(m["par"]),
        int(m["holes"]),
        m["tee"].lower().rstrip("s"),
    )
    # locate the header row ('Trou', 'Par', 'HCP…', 'Distance…')
    hdr_i = next((i for i, r in enumerate(flat) if (r[0] or "").strip().lower() == "trou"), None)
    if hdr_i is None:
        card.problems.append("no 'Trou' header row")
        return card
    hdr = flat[hdr_i]
    dist_hdr = next((h for h in hdr if "distance" in (h or "").lower()), "")
    tee_in_hdr = dist_hdr.split("—")[-1].strip().lower() if "—" in dist_hdr else ""
    # header may carry a parenthetical ('noir (blancs non publiés)') — prefix compare
    if tee_in_hdr and not tee_in_hdr.startswith(card.tee):
        card.problems.append(f"tee mismatch: line2={card.tee!r} header={tee_in_hdr!r}")
    for r in flat[hdr_i + 1 :]:
        first = (r[0] or "").strip().upper()
        if first.startswith(("TOTAL", "OUT", "IN", "SOURCE")):
            break
        n = to_int(r[0] if len(r) > 0 else "")
        par = to_int(r[1] if len(r) > 1 else "")
        hcp = to_int(r[2] if len(r) > 2 else "")
        dist = to_int(r[3] if len(r) > 3 else "")
        if n is None or par is None:
            card.problems.append(f"bad hole row: {r!r}")
            continue
        card.holes.append(Hole(n, par, hcp, dist))
    # structural validation
    nums = [h.number for h in card.holes]
    if nums != list(range(1, len(nums) + 1)):
        card.problems.append(f"hole numbers not 1..n: {nums}")
    if len(card.holes) != card.holes_declared:
        card.problems.append(f"declared {card.holes_declared} trous, parsed {len(card.holes)}")
    if card.par_sum != card.par:
        card.problems.append(f"declared par {card.par}, holes sum to {card.par_sum}")
    # Duplicate HCP indexes = the source card is unreliable on stroke index.
    # Keep the holes (par + distance are still good) but null every hcp so
    # Phase C's deterministic par-desc fallback allocation applies instead of
    # trusting contradictory published data. Note, don't reject.
    hcps = [h.hcp for h in card.holes if h.hcp is not None]
    if hcps and len(set(hcps)) != len(hcps):
        for h in card.holes:
            h.hcp = None
        card.notes.append("duplicate HCP indexes → hcp nulled, par-desc fallback")
    for h in card.holes:
        if not (3 <= h.par <= 6):
            card.problems.append(f"hole {h.number} par {h.par} outside 3..6")
        if h.hcp is not None and not (1 <= h.hcp <= 18):
            card.problems.append(f"hole {h.number} hcp {h.hcp} outside 1..18")
    return card


# ------------------------------------------------------- seed-SQL courses
_F = r"(?:'(?:[^']|'')*'|NULL)"  # one quoted-or-NULL text field
_N = r"(?:NULL|\d+)"
SEED_ROW = re.compile(
    r"^\s*\('(?P<name>(?:[^']|'')*)',\s*(?P<city>" + _F + r"),\s*" + _F + r",\s*" + _F + r",\s*"
    r"(?P<dept>" + _F + r"),\s*" + _F + r",\s*" + _F + r",\s*(?P<holes>" + _N + r"),\s*(?P<par>" + _N + r"),"
    r"\s*(?P<dw>" + _N + r"),\s*(?P<dy>" + _N + r"),\s*(?P<dr>" + _N + r")\)"
)


def unq(field: str) -> str:
    return "" if field == "NULL" else field[1:-1].replace("''", "'")


@dataclass
class SeedCourse:
    name: str
    city: str
    dept: str
    holes: int | None
    par: int | None
    dist_yellow: int | None = None


def load_seed_courses(path: str) -> list[SeedCourse]:
    out = []
    for line in open(path, encoding="utf-8"):
        m = SEED_ROW.match(line)
        if m:
            out.append(
                SeedCourse(
                    m["name"].replace("''", "'"),
                    unq(m["city"]),
                    unq(m["dept"]),
                    None if m["holes"] == "NULL" else int(m["holes"]),
                    None if m["par"] == "NULL" else int(m["par"]),
                    None if m["dy"] == "NULL" else int(m["dy"]),
                )
            )
    return out


# ---------------------------------------------------------------- matching
STOP = {"golf", "de", "du", "des", "le", "la", "les", "l", "d", "parcours", "golfclub", "club"}


def norm_tokens(s: str) -> frozenset[str]:
    # Excel sheet names drop apostrophes but keep the camel-case boundary:
    # 'Golf dOrmesson' / 'Saint-Ouen-lAumône'. Reinsert before case-folding.
    s = re.sub(r"\b([dlDL])([A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜ])", r"\1'\2", s)
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    s = re.sub(r"\(\d+t\)|\b\d+\s*trous\b", " ", s)  # drop routing-size suffixes
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return frozenset(t for t in s.split() if t and t not in STOP)


def tokens_match(a: frozenset[str], b: frozenset[str]) -> bool:
    """Containment with prefix tolerance, so 31-char-truncated sheet names
    ('… - La J') still match their full course name ('… - La Jonchère')."""
    if not a or not b:
        return False
    small, big = (a, b) if len(a) <= len(b) else (b, a)
    return all(any(t == u or u.startswith(t) or t.startswith(u) for u in big) for t in small)


def norm_city(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def match_card(card: Card, seeds: list[SeedCourse]) -> tuple[SeedCourse | None, str]:
    if card.sheet in OVERRIDES:
        target = OVERRIDES[card.sheet]
        if target is None:
            return None, "override: confirmed unseedable"
        hit = next((s for s in seeds if s.name == target), None)
        return hit, "override" if hit else "override target missing!"
    ct = norm_tokens(card.title)
    city = norm_city(card.city)
    exact = [s for s in seeds if norm_tokens(s.name) == ct and norm_city(s.city) == city]
    if len(exact) == 1:
        return exact[0], "exact"
    # token containment (prefix-tolerant), same city
    fuzzy = [s for s in seeds if norm_city(s.city) == city and tokens_match(ct, norm_tokens(s.name))]
    if len(fuzzy) == 1:
        return fuzzy[0], "fuzzy(name≈, city=)"
    # disambiguate multiple same-city candidates by routing size
    if len(fuzzy) > 1:
        sized = [s for s in fuzzy if s.holes == card.holes_declared]
        if len(sized) == 1:
            return sized[0], "fuzzy(name≈, city=, holes=)"
    # last resort: unique prefix-token containment, same département (city
    # spellings drift, but a cross-dept match is always wrong — 'Parc du
    # Tremblay' (94) must never claim 'Tremblay-Mauldre' (78))
    loose = [s for s in seeds if s.dept == card.dept and tokens_match(ct, norm_tokens(s.name))]
    if len(loose) == 1:
        return loose[0], "loose(name≈ only)"
    cand = "; ".join(s.name for s in (fuzzy or loose)[:4])
    return None, f"unmatched (candidates: {cand or 'none'})"


# ------------------------------------------------------------------ emitters
def sql_quote(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def emit_migration(
    pairs: list[tuple[Card, SeedCourse]],
    course_fixes: list[tuple[SeedCourse, dict[str, int]]],
    out_path: str,
) -> None:
    parts: list[str] = []
    parts.append(
        """-- ============================================================================
-- Seed per-hole scorecards (course_holes) for Île-de-France courses
-- ============================================================================
-- GENERATED by scripts/seed_course_holes.py from Golfs_Ile_de_France.xlsx
-- (97 per-course sheets; see scripts/course_holes_mapping.md for the
-- sheet→course mapping and the sheets rejected as contradictory/unmatched).
-- Courses are addressed by the seed's own idempotency key
-- (lower(name), lower(city)) because course UUIDs differ between CI replays
-- and prod. Safe to re-run: ON CONFLICT (course_id, hole_number) DO UPDATE.
-- ============================================================================
"""
    )
    if course_fixes:
        parts.append("-- Course-row fixes: repairs where the internally-consistent hole card\n"
                     "-- contradicts the résumé-sourced row, plus NULL backfills (par/holes/\n"
                     "-- dist_yellow) so every seeded course carries displayable values.\n"
                     "-- 9-hole convention: par/distance stored as two-loop (18-hole) totals.\n")
        for seed, fixes in course_fixes:
            sets = ", ".join(f"{col} = {val}" for col, val in sorted(fixes.items()))
            parts.append(
                f"UPDATE public.courses SET {sets} "
                f"WHERE lower(name) = lower({sql_quote(seed.name)}) "
                f"AND lower(coalesce(city, '')) = lower({sql_quote(seed.city)});"
            )
        parts.append("")
    for card, seed in pairs:
        rows = ",\n    ".join(
            f"({h.number}, {h.par}, {h.hcp if h.hcp is not None else 'NULL'}, "
            f"{h.dist if h.dist is not None else 'NULL'})"
            for h in card.holes
        )
        tee_note = "NULL" if card.tee == "jaune" else sql_quote(card.tee)
        parts.append(
            # Casts are load-bearing: a VALUES column that is entirely NULL
            # (e.g. an hcp-nulled card) is typed text by default → 42804.
            f"""-- {card.sheet}  →  {seed.name} ({seed.city})
INSERT INTO public.course_holes (course_id, hole_number, par, hcp_index, dist_yellow_m, tee_note)
SELECT c.id, v.hole_number::smallint, v.par::smallint, v.hcp_index::smallint, v.dist_m::smallint, {tee_note}
FROM (VALUES
    {rows}
) AS v(hole_number, par, hcp_index, dist_m)
JOIN public.courses c
  ON lower(c.name) = lower({sql_quote(seed.name)})
 AND lower(coalesce(c.city, '')) = lower({sql_quote(seed.city)})
ON CONFLICT (course_id, hole_number) DO UPDATE
  SET par = EXCLUDED.par,
      hcp_index = EXCLUDED.hcp_index,
      dist_yellow_m = EXCLUDED.dist_yellow_m,
      tee_note = EXCLUDED.tee_note;
"""
        )
    parts.append(
        """-- Verification (run manually):
--   SELECT count(DISTINCT course_id) AS courses,
--          count(*) AS holes
--   FROM public.course_holes;
--   -- every seeded course's hole-par sum must equal courses.par:
--   SELECT c.name, c.par, sum(ch.par) AS par_sum
--   FROM public.course_holes ch JOIN public.courses c ON c.id = ch.course_id
--   GROUP BY c.id HAVING sum(ch.par) IS DISTINCT FROM c.par;
"""
    )
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(parts))


def emit_report(results, out_path: str) -> None:
    lines = [
        "# course_holes seed — sheet→course mapping",
        "",
        "Generated by `scripts/seed_course_holes.py`. Review before trusting the",
        "migration: only ✅ rows are seeded.",
        "",
        "| sheet | matched course | how | holes | par(sheet) | status |",
        "|---|---|---|---|---|---|",
    ]
    for card, seed, how, status in results:
        target = f"{seed.name} ({seed.city})" if seed else "—"
        note = ("; ".join(card.notes)) if card.notes else ""
        lines.append(
            f"| {card.sheet} | {target} | {how} | {len(card.holes)} | {card.par_sum} | {status}{' — ' + note if note else ''} |"
        )
    lines.append("")
    n_ok = sum(1 for *_, s in results if s == "✅ seeded")
    lines.append(f"**{n_ok} sheets seeded / {len(results)} parsed.**")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


# ---------------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", required=True)
    ap.add_argument("--seed", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--report", required=True)
    args = ap.parse_args()

    seeds = load_seed_courses(args.seed)
    print(f"seed courses: {len(seeds)}")
    sheets = [(n, r) for n, r in load_sheets(args.xlsx) if n not in NON_COURSE_SHEETS]
    print(f"per-course sheets: {len(sheets)}")

    results = []  # (card, seed|None, how, status)
    seeded: list[tuple[Card, SeedCourse]] = []
    course_fixes: list[tuple[SeedCourse, dict[str, int]]] = []  # (course, col→value)
    claimed: dict[str, str] = {}  # course name -> sheet, to catch double-claims
    for name, rows in sheets:
        card = parse_card(name, rows)
        if card is None:
            print(f"  !! {name}: unparseable, skipped")
            continue
        seed, how = match_card(card, seeds)
        if card.problems:
            status = "⚠️ data problems: " + "; ".join(card.problems)
            results.append((card, seed, how, status))
            continue
        if seed is None:
            results.append((card, None, how, f"❌ {how}"))
            continue
        n = len(card.holes)
        # Seed convention: a 9-hole course advertises its two-loop values
        # (par 68 = 2×34, distances likewise). All derived fixes follow it.
        loop = 2 if n == 9 else 1
        card_par = card.par_sum * loop
        card_dist = sum(h.dist or 0 for h in card.holes) * loop or None
        fixes: dict[str, int] = {}
        if seed.name in REPAIRS:
            # Seed row contradicts the internally-consistent hole card on
            # holes/par/distances — repair the row wholesale from the card.
            fixes = {"holes": n, "par": card_par}
            if card_dist:
                fixes["dist_yellow"] = card_dist
            card.notes.append(f"seed row repaired from card: {fixes}")
        else:
            if seed.holes is not None and n != seed.holes:
                results.append(
                    (card, seed, how, f"❌ holes mismatch: sheet {n} vs course {seed.holes}")
                )
                continue
            if seed.par is not None and card_par != seed.par:
                # Small contradictions (|Δ| ≤ 3): the per-hole card is the
                # finer-grained, internally-consistent source — trust it and
                # repair courses.par in the same migration. Logged, not silent.
                if abs(card_par - seed.par) <= 3:
                    fixes["par"] = card_par
                    card.notes.append(f"courses.par repaired {seed.par} → {card_par} (hole-card sum)")
                else:
                    results.append(
                        (card, seed, how, f"❌ par mismatch: sheet sums {card.par_sum} vs course {seed.par}")
                    )
                    continue
            # Backfill NULLs so every seeded course carries displayable par.
            if seed.par is None:
                fixes["par"] = card_par
                card.notes.append(f"courses.par NULL → {card_par} (from card)")
            if seed.holes is None:
                fixes["holes"] = n
            if seed.dist_yellow is None and card_dist:
                fixes["dist_yellow"] = card_dist
                card.notes.append(f"courses.dist_yellow NULL → {card_dist} (from card)")
        if fixes:
            course_fixes.append((seed, fixes))
        if seed.name in claimed:
            results.append((card, seed, how, f"❌ course already claimed by sheet {claimed[seed.name]!r}"))
            continue
        claimed[seed.name] = name
        seeded.append((card, seed))
        results.append((card, seed, how, "✅ seeded"))

    emit_report(results, args.report)
    emit_migration(seeded, course_fixes, args.out)

    n_bad = sum(1 for *_, s in results if not s.startswith("✅"))
    print(f"seeded: {len(seeded)}  flagged: {n_bad}  → {args.report}")
    for card, seed, how, status in results:
        if not status.startswith("✅"):
            print(f"  {status:60.60s} {card.sheet}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

/**
 * Game-format-aware helpers. Single source of truth for the
 * direction of "better" and all the per-format copy.
 *
 * If a third format is added later (match play, modified stableford,
 * skins…), extend here and every callsite picks it up automatically.
 */

import type { Game, GameFormat } from "@/components/match/types"

/**
 * Normalize the game's raw `format` column to a known enum. Treats
 * anything missing or unrecognised as stroke play so the rest of the
 * app has a single defined axis to branch on.
 */
export function resolveFormat(
  game: Pick<Game, "format"> | null | undefined,
): GameFormat {
  if (!game) return "stroke_play"
  return game.format === "stableford" ? "stableford" : "stroke_play"
}

/**
 * Per-format rendering contract. One place for the direction of
 * "better", the noun users see, and the pluralisation the UI needs.
 *
 *   betterIsLower — true for stroke play (lower score wins),
 *                   false for stableford (higher points win).
 *   noun          — "strokes" / "points". Used in copy like
 *                   "12 {noun} behind".
 *   unit          — "pts" suffix for stableford, empty for stroke.
 *                   Pairs with a number: "37 pts" vs "82".
 *   superlative   — "Lowest" / "Best" — how to label the best-round
 *                   badge and records.
 *   behindWord    — "behind" / "from" — used in "12 behind leader".
 *                   Stays "behind" for both formats for now; keep
 *                   as a field so we can tune per-format later.
 */
export interface FormatCopy {
  betterIsLower: boolean
  noun: "strokes" | "points"
  nounSingular: "stroke" | "point"
  unit: string
  superlative: "Lowest" | "Best"
  bestRoundLabel: string
}

export function formatCopy(format: GameFormat): FormatCopy {
  if (format === "stableford") {
    return {
      betterIsLower: false,
      noun: "points",
      nounSingular: "point",
      unit: " pts",
      superlative: "Best",
      bestRoundLabel: "Best round",
    }
  }
  return {
    betterIsLower: true,
    noun: "strokes",
    nounSingular: "stroke",
    unit: "",
    superlative: "Lowest",
    bestRoundLabel: "Lowest round",
  }
}

/**
 * "Is A better than B?" per format. Null-safe for easy use against
 * optional scores/totals from the DB.
 */
export function isBetter(
  a: number | null | undefined,
  b: number | null | undefined,
  format: GameFormat,
): boolean {
  if (a == null) return false
  if (b == null) return true
  return format === "stableford" ? a > b : a < b
}

/**
 * Signed gap "ahead" — always a positive number when `you` is ahead
 * of `them`, negative when trailing, 0 when tied. Useful for "+N
 * ahead" chips where we only render when the result is > 0.
 *
 * stroke_play: ahead means lower → gap = them - you
 * stableford:  ahead means higher → gap = you - them
 */
export function gapAhead(
  you: number | null | undefined,
  them: number | null | undefined,
  format: GameFormat,
): number | null {
  if (you == null || them == null) return null
  return format === "stableford" ? you - them : them - you
}

/**
 * Sort comparator for totals (or any score-like number). Smaller
 * index = better. Returns a stable negative/positive/zero number.
 * Null-safe: nulls sort to the bottom.
 */
export function compareByTotal(
  a: number | null | undefined,
  b: number | null | undefined,
  format: GameFormat,
): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return format === "stableford" ? b - a : a - b
}

/**
 * Format a score for display with the format's unit suffix.
 * "82" for stroke play, "37 pts" for stableford.
 */
export function formatScore(
  score: number | null | undefined,
  format: GameFormat,
): string {
  if (score == null) return "–"
  const unit = formatCopy(format).unit
  return `${score}${unit}`
}

/**
 * Score relative to par: +16, E, −3. Null when either side is unknown —
 * callers render nothing rather than a wrong number. Uses the typographic
 * minus (U+2212) to match the en-dash style used elsewhere.
 */
export function vsPar(
  score: number | null | undefined,
  par: number | null | undefined,
): string | null {
  if (score == null || par == null) return null
  const d = score - par
  if (d === 0) return "E"
  return d > 0 ? `+${d}` : `−${-d}`
}

/**
 * Single helper for the "88 (+16)" display (Phase B): stroke-play totals on
 * a course with known par gain the vs-par suffix; stableford points and
 * par-less courses fall back to plain formatScore. Every surface showing a
 * round total goes through here — never hand-roll the parenthesis.
 */
export function formatScoreVsPar(
  score: number | null | undefined,
  par: number | null | undefined,
  format: GameFormat,
): string {
  const base = formatScore(score, format)
  if (format !== "stroke_play") return base
  const rel = vsPar(score, par)
  return rel == null ? base : `${base} (${rel})`
}

/**
 * Per-hole result vs par, for scorecard cells and live strips.
 * net = strokes − par: −2 eagle, −1 birdie, 0 par, +1 bogey, +2 double.
 */
export type HoleRelative = "eagle" | "birdie" | "par" | "bogey" | "double_plus"

export function holeRelative(strokes: number, par: number): HoleRelative {
  const d = strokes - par
  if (d <= -2) return "eagle"
  if (d === -1) return "birdie"
  if (d === 0) return "par"
  if (d === 1) return "bogey"
  return "double_plus"
}

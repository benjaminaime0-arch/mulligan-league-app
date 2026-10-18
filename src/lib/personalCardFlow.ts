import type { PersonalCard, PersonalHole, PersonalRevision } from "./personalRounds"
export type CardLeague = PersonalCard["leagues"][number]

export function scoreChange(raw: string): Pick<PersonalHole, "completion" | "strokes"> {
  return raw === "" ? { completion: "not_played", strokes: null } : { completion: "completed", strokes: Number(raw) }
}
export function togglePickedUp(hole: PersonalHole): Pick<PersonalHole, "completion" | "strokes"> {
  return { completion: hole.completion === "picked_up" ? "not_played" : "picked_up", strokes: null }
}
export function invalidScore(hole: PersonalHole): boolean {
  return hole.completion === "completed" && (!Number.isInteger(hole.strokes) || hole.strokes! < 1 || hole.strokes! > 30)
}
export function cardEntrySummary(holes: PersonalHole[]) {
  return { entered: holes.filter(h => h.completion === "picked_up" || (h.completion === "completed" && !invalidScore(h))).length,
    gross: holes.every(h => h.completion === "completed" && !invalidScore(h)) ? holes.reduce((n,h) => n + h.strokes!,0) : null,
    pickedUp: holes.filter(h => h.completion === "picked_up").length }
}
export function groupCardLeagues(leagues: CardLeague[]) {
  const unique = Array.from(new Map(leagues.map(league => [league.id,league])).values())
  return { eligible: unique.filter(g => !g.reason && !g.submission_status), submitted: unique.filter(g => !!g.submission_status),
    incompatible: unique.filter(g => !!g.reason && !g.submission_status) }
}
export function selectedCardLeagues(leagues: CardLeague[], selected: string[]): CardLeague[] {
  const ids = new Set(selected)
  return groupCardLeagues(leagues).eligible.filter(g => ids.has(g.id))
}

// Keep a league handoff as a local, validated identifier. Eligibility still comes from the server.
export function leagueContext(value: string | null | undefined): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null
}
export function withLeagueContext(path: string, leagueId?: string | null): string {
  const id = leagueContext(leagueId)
  return id ? `${path}${path.includes("?") ? "&" : "?"}league=${id}` : path
}
export function intendedCardLeague(leagues: CardLeague[], leagueId?: string | null): string | null {
  return groupCardLeagues(leagues).eligible.find(g => g.id === leagueContext(leagueId))?.id ?? null
}

export function cardScoresChanged(scores: PersonalHole[], original: PersonalHole[]): boolean {
  const previous = new Map(original.map(h => [h.hole_number, h]))
  return scores.length !== original.length || scores.some(h => {
    const before = previous.get(h.hole_number)
    return !before || h.completion !== before.completion || h.strokes !== before.strokes
  })
}

type ScoreRevision = Pick<PersonalRevision, "id" | "revision_number" | "scores">
export function correctionComparison(current: ScoreRevision | null, revisions: ScoreRevision[]): { before: PersonalHole; after: PersonalHole }[] | null {
  if (!current) return null
  const previous = revisions.find(revision => revision.revision_number === current.revision_number - 1)
  if (!previous || previous.scores.length !== current.scores.length) return null
  const original = new Map(previous.scores.map(hole => [hole.hole_number, hole]))
  if (original.size !== previous.scores.length || new Set(current.scores.map(hole => hole.hole_number)).size !== current.scores.length || current.scores.some(hole => !original.has(hole.hole_number))) return null
  return current.scores.filter(hole => {
    const before = original.get(hole.hole_number)!
    return before.completion !== hole.completion || before.strokes !== hole.strokes
  }).sort((a, b) => a.hole_number - b.hole_number).map(after => ({ before: original.get(after.hole_number)!, after }))
}

import type { PersonalCard, PersonalHole } from "./personalRounds"
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

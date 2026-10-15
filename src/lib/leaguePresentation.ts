import type { PersonalLeagueSummary } from "./personalRounds"
import { sectionForStatus, type EnrichedGame, type HubSection, type LeaderboardStanding } from "./userGames"

export type HubGame = EnrichedGame & {
  standing: LeaderboardStanding
  section: HubSection
  personal?: PersonalLeagueSummary
}

export function leagueSection(game: EnrichedGame, details?: PersonalLeagueSummary): HubSection {
  return details
    ? ({ upcoming: "upcoming", active: "active", closed_provisional: "completed", finalized: "completed" } as const)[details.lifecycle_state]
    : sectionForStatus(game.status)
}

/** Calendar days in the course timezone, inclusive of the last playing day.
 * UTC calendar arithmetic avoids a 23/25-hour daylight-saving day changing it. */
export function leagueDays(date: string | null, timezone = "Europe/Paris", now = new Date()): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const target = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== date) return null
  try {
    const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now)
    const part = (type: string) => parts.find(p => p.type === type)?.value
    const today = Date.parse(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`)
    return Math.round((target - today) / 86400000)
  } catch { return null }
}

/** Home puts live leagues first; never invent a rank when choosing a league. */
export function featuredLeagues(games: HubGame[]): HubGame[] {
  const order = { active: 0, upcoming: 1, completed: 2 }
  return [...games].sort((a, b) => order[a.section] - order[b.section]
    || (a.personal?.end_date || a.end_date || "9999").localeCompare(b.personal?.end_date || b.end_date || "9999")
    || a.name.localeCompare(b.name))
}

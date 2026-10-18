import type { PersonalLeague, PersonalRoundSummary } from "./personalRounds"
import { leagueCardWindow } from "./cardLeagueReview"
import { leagueContext } from "./personalCardFlow"

export function leagueCardReturn(rounds: PersonalRoundSummary[], league: PersonalLeague, userId: string, today: string) {
  const submission = league.submissions.find(s => s.user_id === userId && ["pending", "accepted"].includes(s.status)) ?? null
  const window = leagueCardWindow(league, today)
  const draft = !submission && window.open ? rounds.find(r => r.status === "draft" && r.tee_id === league.rules.tee_id && r.played_on >= window.min && r.played_on <= window.max) ?? null : null
  return { submission, draft }
}

export function inviteMemberDestination(id: string, cardIntent: boolean, personal: boolean, completed: boolean) {
  const gameId = leagueContext(id)
  if (!gameId) return "/games"
  return cardIntent && personal && !completed ? `/rounds?new=1&league=${gameId}` : `/games/${gameId}`
}

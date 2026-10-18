import type { PersonalLeague, PersonalRoundSummary } from "./personalRounds"
import { leagueCardWindow } from "./cardLeagueReview"
import { leagueContext } from "./personalCardFlow"

export function leagueCardReturn(rounds: PersonalRoundSummary[], league: PersonalLeague, userId: string, today: string) {
  const own = league.submissions.filter(s => s.user_id === userId)
  // An in-flight replacement always takes priority over older counted cards.
  const submission = own.find(s => s.status === "pending") ?? own.find(s => s.status === "accepted") ?? null
  const window = leagueCardWindow(league, today)
  const member = league.board.find(row => row.user_id === userId)
  const required = league.game.scoring_cards_count ?? 1
  const remaining = member ? Math.max(0, required - member.rounds_counted) : 0
  const replacement = window.open && remaining > 0 && !own.some(s => s.status === "pending") && own.some(s => s.status === "rejected" && s.card_status === "disputed" && s.revision_number > 1)
    ? { remaining, counted: member!.rounds_counted, required } : null
  const draft = (!submission || replacement) && window.open ? rounds.find(r => r.status === "draft" && r.tee_id === league.rules.tee_id && r.played_on >= window.min && r.played_on <= window.max) ?? null : null
  return { submission: replacement ? null : submission, draft, replacement }
}

export function inviteMemberDestination(id: string, cardIntent: boolean, personal: boolean, completed: boolean) {
  const gameId = leagueContext(id)
  if (!gameId) return "/games"
  return cardIntent && personal && !completed ? `/rounds?new=1&league=${gameId}` : `/games/${gameId}`
}

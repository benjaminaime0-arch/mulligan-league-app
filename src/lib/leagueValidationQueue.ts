import type { PersonalLeague } from "./personalRounds"
import { leagueContext } from "./personalCardFlow"

/** Responsibility follows the current card state, never the league organizer role. */
export function leagueValidationQueue(data: PersonalLeague, viewer: string) {
  if (!data.organizer_progress) return []
  return data.submissions.filter(card => card.status === "pending" &&
    ["pending_validation", "pending_player_confirmation"].includes(card.card_status) && leagueContext(card.round_id))
    .map(card => {
      const kind = card.card_status === "pending_player_confirmation" ? "correction" as const : "validation" as const
      const actorId = kind === "correction" ? card.user_id : card.validator_id
      const actorName = kind === "correction" ? card.player_name : data.board.find(member => member.user_id === actorId)?.player_name
      return { card, kind, actorId, actorName, mine: actorId === viewer, key: `${card.round_id}:${card.revision_number}:${kind}:${actorId}` }
    })
}

import type { PersonalLeague } from "./personalRounds"
import { countedLeagueCards, leagueCardContribution } from "./personalStandings"

/** Acceptance and best-card selection are separate; the server board owns the total. */
export function leagueCorrectionResults(data: PersonalLeague) {
  const counted = countedLeagueCards(data)
  const required = data.game.scoring_cards_count ?? 1
  return data.submissions.filter(card => card.revision_number > 1 &&
    ((card.status === "accepted" && card.card_status === "validated") || (card.status === "rejected" && card.card_status === "disputed")))
    .map(card => {
      const member = data.board.find(row => row.user_id === card.user_id)
      const remaining = Math.max(0, required - (member?.rounds_counted ?? 0))
      const pending = data.submissions.some(s => s.user_id === card.user_id && s.status === "pending")
      return { card, contribution: leagueCardContribution(data, card, counted), refused: card.card_status === "disputed", remaining, pending }
    })
}

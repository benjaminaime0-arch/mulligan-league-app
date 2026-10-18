import type { PersonalLeague } from "./personalRounds"

type Submission = PersonalLeague["submissions"][number]
export function leagueScore(s: Submission, format: string): number | null {
  if (format === "stroke_gross") return s.gross_total
  if (format === "stroke_net") return s.net_total
  if (format === "stableford_net") return s.stableford_points
  return null
}

/** Mirrors personal_leaderboard's best-N ordering. Only expose attribution when
 * it reconciles with the server board; that board remains the source of ranks. */
export function countedLeagueCards(data: PersonalLeague): Set<string> {
  const counted = new Set<string>()
  for (const row of data.board) {
    const eligible = data.submissions.filter(s => s.user_id === row.user_id && s.status === "accepted" && s.card_status === "validated")
    if (eligible.some(s => leagueScore(s, data.rules.format) == null)) continue
    if (new Set(eligible.map(s => s.round_id)).size !== eligible.length) continue
    const ordered = [...eligible].sort((a, b) => {
      const score = leagueScore(a, data.rules.format)! - leagueScore(b, data.rules.format)!
      return (data.rules.format === "stableford_net" ? -score : score) || a.played_on.localeCompare(b.played_on) || a.id.localeCompare(b.id)
    })
    const selected = ordered.slice(0, data.game.scoring_cards_count ?? 1)
    if (eligible.length !== row.rounds_played || selected.length !== row.rounds_counted || selected.reduce((total, s) => total + leagueScore(s, data.rules.format)!, 0) !== row.total_score) continue
    for (const s of selected) counted.add(s.id)
  }
  return counted
}

export function leagueCardContribution(data: PersonalLeague, s: Submission, counted: Set<string>): "counted" | "reserve" | "excluded" | "pending" | "accepted" {
  if (s.status === "superseded" || s.status === "rejected" || s.card_status === "disputed") return "excluded"
  if (s.status !== "accepted" || s.card_status !== "validated") return "pending"
  if (counted.has(s.id)) return "counted"
  // No attribution if the client cannot reconcile this player's cards with the board.
  const reconciled = data.board.some(row => row.user_id === s.user_id && row.rounds_counted > 0 && data.submissions.filter(card => card.user_id === s.user_id && counted.has(card.id)).length === row.rounds_counted)
  return reconciled ? "reserve" : "accepted"
}

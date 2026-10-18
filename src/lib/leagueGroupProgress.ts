import type { PersonalLeague } from "./personalRounds"

/** Submitting a card and earning a ranked position are separate milestones. */
export function leagueGroupProgress(data: PersonalLeague, viewer: string) {
  const members = data.board.map(member => {
    const cards = data.submissions.filter(s => s.user_id === member.user_id && s.status !== "superseded")
    const counted = member.rounds_counted > 0
    const pending = cards.find(s => s.status === "pending")
    const accepted = cards.some(s => s.status === "accepted" && s.card_status === "validated")
    const status = pending
      ? pending.card_status === "pending_player_confirmation" ? "correction" : "pending"
      : counted ? "counted" : accepted ? "received" : cards.length ? "replace" : "missing"
    const review = cards.find(s => s.status === "pending" && s.card_status === "pending_validation" && s.validator_id === viewer)
    return { ...member, status, submitted: cards.length > 0, reviewRound: review?.round_id }
  })
  const ids = new Set(members.map(m => m.user_id))
  const awaiting = Array.from(new Map((data.organizer_progress?.awaiting_join ?? []).filter(p => !ids.has(p.user_id)).map(p => [p.user_id, p])).values())
  const needsAction = members.filter(m => !["counted", "received"].includes(m.status)).length + awaiting.length
  const toReview = members.filter(m => m.reviewRound).length
  return { members, awaiting, needsAction, toReview, submitted: members.filter(m => m.submitted).length, missing: members.filter(m => !m.submitted).length }
}

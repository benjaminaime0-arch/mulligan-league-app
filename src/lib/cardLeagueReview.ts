import type { PersonalCard, PersonalLeague } from "./personalRounds"

/** The server still makes the final eligibility decision atomically. This
 * policy prevents presenting irreversible solo confirmation for a peer league. */
export function cardLeagueReview(data: PersonalCard, league: PersonalLeague | null, validator: string) {
  const witnessRequired = league?.rules.attestation === "peer_required"
  const validators = witnessRequired ? data.validators.filter(v => v.id !== data.round.user_id && league!.board.some(row => row.user_id === v.id)) : data.validators
  const matching = !!league && league.rules.tee_id === data.round.tee_id && data.round.played_on >= league.game.start_date && data.round.played_on <= league.game.end_date && ["open", "upcoming"].includes(league.closure_status)
  const validatorAllowed = !validator ? !witnessRequired : validators.some(v => v.id === validator)
  return { witnessRequired, validators, ready: matching && validatorAllowed }
}
export function leagueCardError(message: string): string | null {
  return /league_card_rejected:([a-z_]+)/.exec(message)?.[1] ?? null
}

export function leagueCardWindow(league: PersonalLeague, today: string) {
  const yesterday = new Date(`${today}T12:00:00Z`)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const earliest = yesterday.toISOString().slice(0, 10)
  const min = league.game.start_date > earliest ? league.game.start_date : earliest
  const max = league.game.end_date < today ? league.game.end_date : today
  return { min, max, initial: today > max ? max : today, open: league.closure_status === "open" && min <= max }
}

import type { PersonalLeague } from "./personalRounds"

export function leagueHasEnded(data: PersonalLeague): boolean {
  return data.closure_status === "finalized" || data.closure_status === "closed_provisional"
}
export function nextLeagueDefaults(data: PersonalLeague, today: string) {
  if (!leagueHasEnded(data)) return null
  const date = new Date(`${data.game.end_date}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  const after = date.toISOString().slice(0, 10)
  return {
    tee: data.rules.tee_id,
    name: data.game.name.slice(0, 80),
    start: after > today ? after : today,
    months: [1, 2, 3].includes(data.rules.duration_months ?? 0) ? data.rules.duration_months! : 1,
    format: data.rules.format,
    cards: data.game.scoring_cards_count ?? 1,
    witness: data.rules.attestation === "peer_required",
  }
}
export function leagueWinners(data: PersonalLeague) {
  if (data.closure_status !== "finalized") return []
  return data.board.filter(row => row.position === 1 && row.rounds_counted >= (data.game.scoring_cards_count ?? 1))
}
export function sourceLeagueId(value: string | null | undefined): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null
}
export function todayInLeague(timezone = "Europe/Paris", now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {timeZone: timezone, year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now)
  const p = (type: string) => parts.find(part => part.type === type)!.value
  return `${p("year")}-${p("month")}-${p("day")}`
}

/** Keep partial invitation failures separate from league creation. A retry only
 * repeats invitation RPCs, whose duplicate protection remains server-owned. */
export async function inviteReturningFriends(
  friends: { id: string; username: string }[],
  send: (username: string) => Promise<{ sent?: boolean; duplicate?: boolean }>,
): Promise<{ successes: string[]; failures: string[] }> {
  const successes: string[] = [], failures: string[] = []
  for (const friend of friends) {
    try {
      const result = await send(friend.username)
      if (!result?.sent && !result?.duplicate) throw new Error("Not sent")
      successes.push(friend.id)
    } catch { failures.push(friend.id) }
  }
  return { successes, failures }
}

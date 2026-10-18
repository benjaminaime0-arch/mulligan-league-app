import { leagueValidationQueue } from "./leagueValidationQueue"
import type { PersonalLeague } from "./personalRounds"
import { leagueGroupProgress } from "./leagueGroupProgress"
import { leagueCardWindow } from "./cardLeagueReview"
import { leagueContext } from "./personalCardFlow"

export type LeagueReminder = { id: string; name: string; kind: "join" | "card" | "validation" | "correction"; path: string; player?: string; playedOn?: string }

/** A reminder is a message to prepare, never proof of sending or completion. */
export function leagueReminders(data: PersonalLeague, viewer: string, today: string): LeagueReminder[] {
  if (!data.organizer_progress || !["open", "upcoming"].includes(data.closure_status) || today > data.game.end_date) return []
  if (!/^(?:[A-Z0-9]{6}|[A-Z0-9]{10})$/i.test(data.game.invite_code)) return []
  const progress = leagueGroupProgress(data, viewer)
  const result: LeagueReminder[] = []
  if (/^(?:[A-Z0-9]{6}|[A-Z0-9]{10})$/i.test(data.game.invite_code)) {
    for (const person of progress.awaiting) if (person.user_id !== viewer) {
      result.push({ id: person.user_id, name: person.player_name, kind: "join", path: `/join/${encodeURIComponent(data.game.invite_code)}?reminder=join` })
    }
  }
  if (leagueContext(data.game.id) && leagueContext(data.rules.tee_id) && leagueCardWindow(data, today).open) {
    // Public context first; membership and card state are checked after sign-in.
    const path = `/join/${encodeURIComponent(data.game.invite_code)}?reminder=card`
    for (const member of progress.members) if (member.user_id !== viewer && member.status === "missing") {
      result.push({ id: member.user_id, name: member.player_name, kind: "card", path })
    }
  }
  return result
}

export function reminderMessage(reminder: LeagueReminder, leagueName: string, origin: string, t: (key: string, vars?: Record<string, string | number>) => string) {
  return `${t(`reminder.message.${reminder.kind}`, { name: reminder.name, league: leagueName, player: reminder.player ?? "", date: reminder.playedOn ?? "" })}\n${new URL(reminder.path, origin).href}`
}

export function reminderWhatsAppUrl(message: string) {
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}

export async function copyLeagueReminder(message: string, clipboard?: { writeText: (value: string) => Promise<void> }): Promise<"copied" | "failed"> {
  try {
    if (!clipboard) return "failed"
    await clipboard.writeText(message)
    return "copied"
  } catch { return "failed" }
}

/** Review stays available after league entry closes; never remind an unknown witness. */
export function leagueValidationReminders(data: PersonalLeague, viewer: string): (LeagueReminder & { key: string })[] {
  return leagueValidationQueue(data, viewer).flatMap(item => item.actorId && item.actorName && !item.mine ? [{
    key: item.key, id: item.actorId, name: item.actorName, kind: item.kind,
    player: item.card.player_name, playedOn: item.card.played_on,
    path: `/?tab=login&redirect=${encodeURIComponent(`/rounds/${item.card.round_id}`)}`,
  }] : [])
}

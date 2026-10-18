import type { PersonalLeague } from "./personalRounds"
import { leagueGroupProgress } from "./leagueGroupProgress"
import { leagueCardWindow } from "./cardLeagueReview"
import { leagueContext } from "./personalCardFlow"

export type LeagueReminder = { id: string; name: string; kind: "join" | "card"; path: string }

/** A reminder is a message to prepare, never proof of sending or completion. */
export function leagueReminders(data: PersonalLeague, viewer: string, today: string): LeagueReminder[] {
  if (!data.organizer_progress || !["open", "upcoming"].includes(data.closure_status) || today > data.game.end_date) return []
  const progress = leagueGroupProgress(data, viewer)
  const result: LeagueReminder[] = []
  if (/^(?:[A-Z0-9]{6}|[A-Z0-9]{10})$/i.test(data.game.invite_code)) {
    for (const person of progress.awaiting) if (person.user_id !== viewer) {
      result.push({ id: person.user_id, name: person.player_name, kind: "join", path: `/join/${encodeURIComponent(data.game.invite_code)}` })
    }
  }
  if (leagueContext(data.game.id) && leagueContext(data.rules.tee_id) && leagueCardWindow(data, today).open) {
    const entry = `/rounds?tee=${data.rules.tee_id}&league=${data.game.id}`
    // Returning players see login if needed; the exact league/tee survives auth.
    const path = `/?tab=login&redirect=${encodeURIComponent(entry)}`
    for (const member of progress.members) if (member.user_id !== viewer && member.status === "missing") {
      result.push({ id: member.user_id, name: member.player_name, kind: "card", path })
    }
  }
  return result
}

export function reminderMessage(reminder: LeagueReminder, leagueName: string, origin: string, t: (key: string, vars?: Record<string, string | number>) => string) {
  return `${t(`reminder.message.${reminder.kind}`, { name: reminder.name, league: leagueName })}\n${new URL(reminder.path, origin).href}`
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

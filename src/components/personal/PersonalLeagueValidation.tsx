"use client"
import Link from "next/link"
import { useState } from "react"
import { useI18n } from "@/lib/i18n"
import { leagueValidationQueue } from "@/lib/leagueValidationQueue"
import { leagueValidationReminders, reminderMessage } from "@/lib/leagueReminders"
import type { PersonalLeague } from "@/lib/personalRounds"
import { LeagueReminderDialog } from "./LeagueReminderDialog"

export function PersonalLeagueValidation({ data, userId }: { data: PersonalLeague; userId: string }) {
  const { t, locale } = useI18n()
  const [selected, setSelected] = useState<string | null>(null)
  const [origin, setOrigin] = useState("")
  const queue = leagueValidationQueue(data, userId)
    .sort((a, b) => Number(b.mine) - Number(a.mine))
  const reminders = leagueValidationReminders(data, userId)
  const reminder = reminders.find(item => item.key === selected)
  if (!queue.length) return null
  return <section className="mb-4 border-b border-primary/10 pb-3" aria-label={t("validationQueue.title")}>
    <h3 className="text-sm font-bold">{t("validationQueue.title")} · {queue.length}</h3>
    <ul className="mt-1 divide-y divide-primary/10">{queue.map(item => <li key={item.key} className="py-3">
      <p className="break-words text-sm font-semibold">{item.card.player_name} <span className="font-normal text-primary/60">· {new Date(`${item.card.played_on}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" })}</span></p>
      <p className="mt-1 break-words text-xs leading-relaxed text-primary/70">{t(`validationQueue.${item.kind}`, { name: item.mine ? t("group.you") : item.actorName || t("validationQueue.witness") })}</p>
      <div className="mt-1 flex flex-wrap gap-x-4">
        {item.mine ? <Link href={`/rounds/${item.card.round_id}`} className="inline-flex min-h-[44px] items-center text-xs font-bold underline">{t(`validationQueue.action.${item.kind}`)}</Link> : reminders.some(r => r.key === item.key) ? <button type="button" aria-label={t("reminder.title", { name: item.actorName! })} onClick={() => { setOrigin(window.location.origin); setSelected(item.key) }} className="min-h-[44px] break-words text-left text-xs font-bold underline">{t("reminder.title", { name: item.actorName! })}</button> : <p className="py-2 text-xs text-primary/60">{t("validationQueue.unknown")}</p>}
      </div>
    </li>)}</ul>
    {reminder && origin && <LeagueReminderDialog key={reminder.key} name={reminder.name} kind={reminder.kind} message={reminderMessage(reminder, data.game.name, origin, t)} onClose={() => setSelected(null)} />}
  </section>
}

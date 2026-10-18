"use client"
import Link from "next/link"
import { useState } from "react"
import { leagueReminders, reminderMessage } from "@/lib/leagueReminders"
import { todayInLeague } from "@/lib/nextLeague"
import { LeagueReminderDialog } from "./LeagueReminderDialog"
import { useI18n } from "@/lib/i18n"
import { leagueGroupProgress } from "@/lib/leagueGroupProgress"
import type { PersonalLeague } from "@/lib/personalRounds"

export function PersonalLeagueProgress({ data, userId, onInvite }: { data: PersonalLeague; userId: string; onInvite: () => void }) {
  const { t } = useI18n()
  const [selected, setSelected] = useState<string | null>(null)
  const [origin, setOrigin] = useState("")
  if (!data.organizer_progress) return null
  const progress = leagueGroupProgress(data, userId)
  const reminders = leagueReminders(data, userId, todayInLeague(data.rules.timezone))
  const reminder = reminders.find(person => `${person.id}:${person.kind}` === selected)
  const openReminder = (id: string) => {
    const candidate = reminders.find(person => person.id === id)
    if (!candidate) return
    setOrigin(window.location.origin); setSelected(`${candidate.id}:${candidate.kind}`)
  }
  return <section className="app-surface mb-4 p-4" aria-label={t("group.title")}>
    <h2 className="font-bold">{t("group.title")}</h2>
    <p className="mt-1 text-xs leading-relaxed text-primary/70">{t("group.summary", { joined: progress.members.length, submitted: progress.submitted })}</p>
    <details className="mt-2" open={progress.members.length <= 6}>
      <summary className="min-h-[44px] cursor-pointer py-3 text-xs font-semibold">{t(progress.missing ? "group.missing" : "group.allSubmitted", { n: progress.missing })}</summary>
      <ul className="divide-y divide-primary/10">{progress.members.map(member => <li key={member.user_id} className="flex min-h-[64px] items-center justify-between gap-3 py-3">
        <div className="min-w-0"><p className="break-words text-sm font-semibold">{member.player_name}{member.user_id === userId && <span className="font-normal text-primary/60"> · {t("group.you")}</span>}</p><p className="mt-1 text-xs leading-relaxed text-primary/70">{t(`group.status.${member.status}`)}</p></div>
        {reminders.some(person => person.id === member.user_id) && <button type="button" aria-label={t("reminder.title", { name: member.player_name })} onClick={() => openReminder(member.user_id)} className="min-h-[44px] shrink-0 text-xs font-bold underline">{t("reminder.cta")}</button>}
        {member.reviewRound && <Link href={`/rounds/${member.reviewRound}`} className="inline-flex min-h-[44px] shrink-0 items-center text-xs font-bold underline">{t("group.review")}</Link>}
      </li>)}</ul>
    </details>
    <details className="border-t border-primary/10">
      <summary className="min-h-[44px] cursor-pointer py-3 text-xs font-semibold">{t("group.awaiting", { n: progress.awaiting.length })}</summary>
      {!!progress.awaiting.length && <ul className="mb-2 space-y-2">{progress.awaiting.map(person => <li key={person.user_id} className="flex items-center justify-between gap-3 py-1"><div className="min-w-0 break-words text-sm">{person.player_name}<span className="mt-0.5 block text-xs text-primary/60">{t("group.invited")}</span></div>{reminders.some(item => item.id === person.user_id) && <button type="button" aria-label={t("reminder.title", { name: person.player_name })} onClick={() => openReminder(person.user_id)} className="min-h-[44px] shrink-0 text-xs font-bold underline">{t("reminder.cta")}</button>}</li>)}</ul>}
      <p className="pb-3 text-xs leading-relaxed text-primary/60">{t("group.linkHint")}</p>
    </details>
    <div className="flex flex-wrap gap-x-5 border-t border-primary/10">
      <button type="button" onClick={onInvite} className="min-h-[44px] text-xs font-semibold underline">{t("group.share")}</button>
      {progress.submitted > 0 && <a href="#league-cards" className="inline-flex min-h-[44px] items-center text-xs font-semibold underline">{t("group.cards")}</a>}
    </div>
    {reminder && origin && <LeagueReminderDialog key={`${reminder.id}:${reminder.kind}`} name={reminder.name} kind={reminder.kind} message={reminderMessage(reminder, data.game.name, origin, t)} onClose={() => setSelected(null)} />}
  </section>
}

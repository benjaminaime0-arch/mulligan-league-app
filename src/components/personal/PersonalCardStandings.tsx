"use client"
import Link from "next/link"
import { useI18n } from "@/lib/i18n"
import type { PersonalCard } from "@/lib/personalRounds"

export function PersonalCardStandings({ data }: { data: PersonalCard }) {
  const { t } = useI18n()
  const leagues = data.leagues.filter(g => g.submission_status === "accepted")
  if (!data.is_owner || data.round.status !== "validated" || !leagues.length) return null
  return <section aria-label={t("standings.cardTitle")} className="my-4 rounded-2xl bg-sage/25 p-4">
    <h2 className="text-sm font-bold">{t("standings.cardTitle")}</h2>
    <p className="mt-1 text-xs leading-relaxed text-primary/70">{t("standings.cardHint")}</p>
    <ul className="mt-2 divide-y divide-primary/10">{leagues.map(g => <li key={g.id}><Link href={`/games/${g.id}#league-standings`} className="flex min-h-[48px] flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm font-semibold"><span className="min-w-0 break-words">{g.name}</span><span className="text-xs">{t("standings.view")} →</span></Link></li>)}</ul>
  </section>
}

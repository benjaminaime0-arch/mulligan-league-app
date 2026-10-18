"use client"
import { useI18n } from "@/lib/i18n"
import { leagueHasEnded, leagueWinners } from "@/lib/nextLeague"
import type { PersonalLeague } from "@/lib/personalRounds"

export function PersonalSeasonEnd({ data }: { data: PersonalLeague }) {
  const { t } = useI18n()
  if (!leagueHasEnded(data)) return null
  const winners = leagueWinners(data)
  const pending = data.submissions.filter(s => s.status === "pending").length
  const provisional = data.closure_status === "closed_provisional"
  return <section className="app-surface mt-4 p-4" aria-label={t(provisional ? "season.provisional" : "season.final")}>
    <h2 className="text-base font-bold">{t(provisional ? "season.provisional" : "season.final")}</h2>
    {provisional ? <><p className="mt-1 text-sm text-primary/70">{t(pending === 1 ? "season.pendingOne" : "season.pending", { n: pending })}</p><a href="#league-cards" className="inline-flex min-h-[44px] items-center text-xs font-bold">{t("season.review")} →</a></> : <p className="mt-2 break-words text-sm font-semibold">{winners.length ? t(winners.length > 1 ? "season.tied" : "season.winner", { name: winners.map(row => row.player_name).join(", ") }) : t("season.noWinner")}</p>}
    {!provisional && <p className="mt-2 text-xs leading-relaxed text-primary/70">{t("season.nextHint")}</p>}
  </section>
}

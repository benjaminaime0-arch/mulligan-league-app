"use client"
import { useI18n } from "@/lib/i18n"
import { leagueScore } from "@/lib/personalStandings"
import { leagueCorrectionResults } from "@/lib/leagueCorrectionResults"
import { leagueCardWindow } from "@/lib/cardLeagueReview"
import { todayInLeague } from "@/lib/nextLeague"
import type { PersonalLeague } from "@/lib/personalRounds"

export function PersonalLeagueCorrectionResults({ data }: { data: PersonalLeague }) {
  const { t, locale } = useI18n()
  if (!data.organizer_progress) return null
  const results = leagueCorrectionResults(data)
  if (!results.length) return null
  const open = leagueCardWindow(data, todayInLeague(data.rules.timezone)).open
  return <details className="my-3 border-b border-primary/10 pb-2" open={results.length <= 4}>
    <summary className="min-h-[44px] cursor-pointer py-3 text-sm font-bold">{t("correctionResults.title")} · {results.length}</summary>
    <ul className="divide-y divide-primary/10">{results.map(({ card, contribution, refused, remaining, pending }) => <li key={card.id} className="py-3">
      <p className="break-words text-sm font-semibold">{card.player_name} <span className="font-normal text-primary/60">· {new Date(`${card.played_on}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" })}</span></p>
      <p className="mt-1 text-xs text-primary/70">{t(refused ? "correctionResults.refused" : "correctionResults.accepted")} · {t("personal.confirmedRevision", { n: card.revision_number })}</p>
      <p className="mt-1 text-xs font-bold">{t(`standings.contribution.${contribution}`)}{leagueScore(card, data.rules.format) != null && <span className="font-normal text-primary/65"> · {leagueScore(card, data.rules.format)} {t(data.rules.format === "stableford_net" ? "standings.points" : "standings.strokes")}</span>}</p>
      {refused && remaining > 0 && <p className="mt-2 text-xs leading-relaxed text-primary/70">{t(pending ? "correctionResults.waiting" : open ? "correctionResults.replace" : "correctionResults.closed", { n: remaining })}</p>}
      <a href={`#league-card-${card.id}`} className="mt-1 inline-flex min-h-[44px] items-center text-xs font-semibold underline">{t("correctionResults.view")}</a>
    </li>)}</ul>
  </details>
}

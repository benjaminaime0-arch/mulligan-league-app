"use client"
import Link from "next/link"
import { useI18n } from "@/lib/i18n"
import type { PersonalLeague } from "@/lib/personalRounds"
import { leagueScore, countedLeagueCards } from "@/lib/personalStandings"

export function PersonalStandings({ data, userId }: { data: PersonalLeague; userId: string }) {
  const { t, locale } = useI18n()
  const stableford = data.rules.format === "stableford_net"
  const n = data.game.scoring_cards_count ?? 1
  const mine = data.board.find(row => row.user_id === userId)
  const counted = countedLeagueCards(data)
  const cards = data.submissions.filter(s => s.user_id === userId && counted.has(s.id))
  const unit = t(stableford ? "standings.points" : "standings.strokes")
  return <section aria-label={t("games.standings.title")}>
    <div className="app-surface mb-3 p-4">
      <h2 className="text-base font-bold">{t("games.standings.title")}</h2>
      <p className="mt-1 text-sm font-semibold">{t(n === 1 ? "standings.bestOne" : "standings.bestMany", { n })} · {t(`personal.format.${data.rules.format}`)}</p>
      <p className="mt-1 text-xs leading-relaxed text-primary/70">{t(stableford ? "standings.higher" : "standings.lower")}</p>
      <p className="mt-1 text-xs leading-relaxed text-primary/70">{t("standings.replacement")}</p>
      {mine && mine.rounds_counted < n && <p className="mt-2 text-xs font-semibold">{t("standings.remaining", { n: n - mine.rounds_counted })}</p>}
      {!!cards.length && <div className="mt-3 border-t border-primary/10 pt-3"><h3 className="text-xs font-bold">{t("standings.yourTotal", { n: mine!.total_score, unit })}</h3><ul className="mt-1">{cards.map(s => <li key={s.id}><Link href={`/rounds/${s.round_id}`} className="flex min-h-[44px] items-center justify-between gap-2 text-xs"><span>{new Date(`${s.played_on}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" })} · {t("personal.confirmedRevision", { n: s.revision_number })}</span><span className="shrink-0 font-bold">{leagueScore(s, data.rules.format)} {unit} ↗</span></Link></li>)}</ul></div>}
    </div>
    <div className="app-surface overflow-hidden p-3"><table className="w-full table-fixed text-xs"><caption className="sr-only">{t("games.standings.title")}</caption><thead><tr className="border-b border-primary/10 text-primary/60"><th scope="col" className="w-8 py-2 text-left">#</th><th scope="col" className="text-left">{t("games.standings.col.player")}</th><th scope="col" className="w-16 text-right">{t("games.standings.col.total")}</th><th scope="col" className="w-14 text-right">{t("games.standings.col.counted")}</th></tr></thead><tbody>{[...data.board].sort((a,b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER)).map(row => <tr key={row.user_id} className={`border-b border-primary/5 last:border-0 ${row.user_id === userId ? "bg-sage/25" : ""}`}><td className="py-3 font-bold">{row.position ?? "–"}</td><th scope="row" className="py-2 pr-2 text-left font-medium"><Link href={`/players/${row.user_id}`} className="flex min-h-[44px] items-center break-all">{row.player_name}</Link></th><td className="text-right font-bold tabular-nums">{row.rounds_counted ? row.total_score : "–"}<span className="block text-[10px] font-normal text-primary/60">{unit}</span></td><td className="text-right tabular-nums">{row.rounds_counted}/{n}</td></tr>)}</tbody></table><p className="mt-2 text-[10px] text-primary/60">{t("standings.fraction")}</p></div>
  </section>
}

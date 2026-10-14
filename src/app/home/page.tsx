"use client"
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useAuth } from "@/hooks/useAuth"
import { useT } from "@/lib/i18n"
import { loadUserGames, loadMyStandings, type EnrichedGame, type LeaderboardStanding } from "@/lib/userGames"
import { loadPersonalOverview, personalButton, type PersonalOverview } from "@/lib/personalRounds"
import { PersonalLevelCard } from "@/components/personal/PersonalLevelCard"
import { RoundList } from "@/components/personal/RoundList"
import { PersonalInbox } from "@/components/personal/PersonalInbox"
export default function HomePage() {
  const { user, loading } = useAuth()
  const t = useT()
  const [data, setData] = useState<PersonalOverview | null>(null)
  const [games, setGames] = useState<EnrichedGame[]>([])
  const [standings, setStandings] = useState<Map<string, LeaderboardStanding>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    if (!user) return
    const [overview, leagues] = await Promise.all([loadPersonalOverview(), loadUserGames(user.id)])
    const positions = await loadMyStandings(leagues.map(g => g.id), user.id)
    setData(overview); setGames(leagues); setStandings(positions); setError(null)
  }, [user])
  useEffect(() => { void reload().catch(e => setError(e.message)) }, [reload])
  if (loading || !user) return <main className="p-6">{t("common.loading")}</main>
  return <main className="mx-auto max-w-2xl px-4 py-6">
    <section className="relative mb-6 overflow-hidden rounded-3xl bg-primary p-6 text-cream">
      <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-60 w-60 rounded-full border border-sage/20"><div className="m-8 h-44 w-44 rounded-full border border-sage/20" /></div>
      <p className="relative text-xs font-bold uppercase tracking-[0.18em] text-sage">Mulligan</p>
      <h1 className="relative my-4 text-4xl font-bold">{t("nav.home")}</h1>
      <Link href="/rounds?new=1" className="relative inline-flex min-h-[48px] items-center gap-3 rounded-xl bg-cream px-5 py-3 text-sm font-bold text-primary">+ {t("personal.new")} <span aria-hidden="true">→</span></Link>
    </section>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {data ? <><PersonalInbox items={data.inbox} /><PersonalLevelCard overview={data} /><section className="my-6"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-bold">{t("personal.ui.recent")}</h2><Link href="/rounds" className="py-3 text-sm font-semibold">{t("personal.ui.allCards")} →</Link></div><RoundList rounds={data.rounds.slice(0, 2)} /></section></> : !error && <p>{t("common.loading")}</p>}
    <button className="min-h-[44px] py-2 text-sm underline" onClick={() => void reload().catch(e => setError(e.message))}>{t("personal.refresh")}</button>
    <section className="mt-5">
      <div className="flex items-center justify-between"><h2 className="font-semibold">{t("nav.games")}</h2><Link href="/games" className="min-h-[44px] py-2 text-sm underline">{t("personal.viewLeagues")}</Link></div>
      <div className="my-3 flex flex-wrap gap-3"><Link href="/games/create" className={personalButton}>{t("personal.createLeague")}</Link><Link href="/games/join" className="min-h-[44px] py-2 text-sm underline">{t("nav.new.join")}</Link></div>
      <ul className="space-y-2">{games.map(g => <li key={g.id}><Link href={`/games/${g.id}`} className="flex min-h-[48px] items-center justify-between gap-3 rounded-2xl border border-primary/10 bg-white p-4 text-sm"><span>{g.name}<span className="block text-xs text-primary/70">{g.course_name} · {g.start_date} → {g.end_date}</span></span><span>{standings.get(g.id)?.position != null ? `P${standings.get(g.id)?.position}` : "—"}</span></Link></li>)}</ul>
    </section>
  </main>
}

"use client"
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useAuth } from "@/hooks/useAuth"
import { useT } from "@/lib/i18n"
import { loadUserGames, loadMyStandings, type EnrichedGame, type LeaderboardStanding } from "@/lib/userGames"
import { loadPersonalOverview, personalButton, type PersonalOverview } from "@/lib/personalRounds"
import { PersonalLevelCard } from "@/components/personal/PersonalLevelCard"
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
    <h1 className="text-2xl font-bold">{t("nav.home")}</h1>
    <Link href="/rounds" className={`${personalButton} my-4 inline-flex min-h-[44px] items-center`}>{t("personal.new")}</Link>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {data ? <><PersonalLevelCard overview={data} /><PersonalInbox items={data.inbox} /></> : !error && <p>{t("common.loading")}</p>}
    <button className="min-h-[44px] py-2 text-sm underline" onClick={() => void reload().catch(e => setError(e.message))}>{t("personal.refresh")}</button>
    <section className="mt-5">
      <div className="flex items-center justify-between"><h2 className="font-semibold">{t("nav.games")}</h2><Link href="/games" className="min-h-[44px] py-2 text-sm underline">{t("personal.viewLeagues")}</Link></div>
      <div className="my-3 flex flex-wrap gap-3"><Link href="/games/create" className={personalButton}>{t("personal.createLeague")}</Link><Link href="/games/join" className="min-h-[44px] py-2 text-sm underline">{t("nav.new.join")}</Link></div>
      <ul className="space-y-2">{games.map(g => <li key={g.id}><Link href={`/games/${g.id}`} className="flex min-h-[44px] items-center justify-between rounded-xl border border-primary/15 p-3 text-sm"><span>{g.name}<span className="block text-xs text-primary/70">{g.course_name} · {g.start_date} → {g.end_date}</span></span><span>{standings.get(g.id)?.position != null ? `P${standings.get(g.id)?.position}` : "—"}</span></Link></li>)}</ul>
    </section>
  </main>
}

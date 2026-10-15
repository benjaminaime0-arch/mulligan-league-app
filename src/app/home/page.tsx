"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { useAuth } from "@/hooks/useAuth"
import { useT } from "@/lib/i18n"
import { loadUserGames, loadMyStandings } from "@/lib/userGames"
import { featuredLeagues, leagueSection, type HubGame } from "@/lib/leaguePresentation"
import { supabase } from "@/lib/supabase"
import { loadPersonalOverview, personalResult, type PersonalOverview, type PersonalLeagueSummary } from "@/lib/personalRounds"
import { PersonalLevelCard } from "@/components/personal/PersonalLevelCard"
import { RoundList } from "@/components/personal/RoundList"
import { PersonalInbox } from "@/components/personal/PersonalInbox"
import { LeagueCard } from "@/components/home/LeagueCard"
import { AppIcon } from "@/components/ui/AppIcon"

export default function HomePage() {
  const { user, loading } = useAuth()
  const t = useT()
  const [data, setData] = useState<PersonalOverview | null>(null)
  const [games, setGames] = useState<HubGame[]>([])
  const [cardsError, setCardsError] = useState(false)
  const [leaguesError, setLeaguesError] = useState(false)
  const [leaguesLoaded, setLeaguesLoaded] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!user) return
    let active = true
    setCardsError(false); setLeaguesError(false)
    void loadPersonalOverview().then(overview => { if (active) setData(overview) }).catch(() => { if (active) setCardsError(true) })
    void (async () => {
      const [leagues, personal] = await Promise.all([
        loadUserGames(user.id),
        supabase.rpc("get_personal_leagues").then(r => personalResult<PersonalLeagueSummary[]>(r)),
      ])
      const standings = await loadMyStandings(leagues.map(g => g.id), user.id)
      if (!active) return
      setGames(leagues.map(g => {
        const details = personal.find(p => p.id === g.id)
        return { ...g, personal: details, section: leagueSection(g, details), standing: standings.get(g.id) ?? { position: null, roundsCounted: null } }
      }))
      setLeaguesLoaded(true)
    })().catch(() => { if (active) { setLeaguesError(true); setLeaguesLoaded(true) } })
    return () => { active = false }
  }, [user, refresh])
  if (loading || !user) return <main className="app-page" role="status">{t("common.loading")}</main>
  const name = user.user_metadata?.first_name || user.user_metadata?.username
  const draft = data?.rounds.find(r => r.status === "draft")
  const league = featuredLeagues(games)[0]
  const recent = data?.rounds.filter(r => r.id !== draft?.id).slice(0, 2) ?? []
  return <main className="app-page space-y-5">
    <header className="pt-1"><p className="text-sm text-primary/70">{typeof name === "string" && name.trim() ? t("home.greeting", { name }) : t("home.greeting.anon")}</p><h1 className="mt-1 text-[30px] font-bold leading-tight tracking-tight">{t("app.play")}</h1></header>
    {cardsError && <p role="alert" className="app-surface p-4 text-sm text-red-700">{t("personal.loadError")} <button onClick={() => setRefresh(v => v + 1)} className="min-h-[44px] font-bold underline">{t("app.retry")}</button></p>}
    {data ? <>
      {data.inbox.length > 0 && <PersonalInbox items={data.inbox} />}
      <Link href={draft ? `/rounds/${draft.id}` : "/rounds?new=1"} className="app-surface group flex items-center gap-3 p-4">
        <span className="app-icon-tile"><AppIcon name={draft ? "edit" : "flag"} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-bold">{draft ? t("app.draft") : t("app.ready")}</span><span className="mt-0.5 block truncate text-xs text-primary/70">{draft ? `${draft.course_name} · ${t("personal.picker.holeCount", { n: draft.hole_count })}` : t("app.newCard")}</span></span><span className="inline-flex shrink-0 items-center gap-1 text-xs font-bold">{draft ? t("app.resume") : ""}<AppIcon name="arrow" className="h-4 w-4" /></span>
      </Link>
      <PersonalLevelCard overview={data} compact />
    </> : !cardsError && <div className="app-surface h-48 animate-pulse bg-white/60" role="status"><span className="sr-only">{t("common.loading")}</span></div>}
    <section><SectionHeading title={t("app.yourLeague")} href="/games" label={t("app.all")} />
      {leaguesError ? <p role="alert" className="app-surface p-4 text-sm text-red-700">{t("personal.loadError")}</p> : league ? <LeagueCard game={league} preview /> : leaguesLoaded ? <div className="app-surface flex items-center gap-3 p-4"><span className="app-icon-tile"><AppIcon name="trophy" /></span><div className="min-w-0 flex-1"><p className="text-sm font-bold">{t("games.empty.title")}</p><Link href="/games/create" className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold">{t("games.create.full")} <AppIcon name="arrow" className="h-4 w-4" /></Link></div></div> : <div className="app-surface h-40 animate-pulse" role="status"><span className="sr-only">{t("common.loading")}</span></div>}
    </section>
    {data && <section><SectionHeading title={t("personal.ui.recent")} href="/rounds" label={t("app.all")} />{recent.length ? <RoundList rounds={recent} /> : <p className="app-surface p-5 text-sm text-primary/70">{t("personal.empty")}</p>}</section>}
    <div className="text-center"><button className="min-h-[44px] px-4 text-xs font-semibold text-primary/70" onClick={() => setRefresh(v => v + 1)}>{t("personal.refresh")}</button></div>
  </main>
}
function SectionHeading({ title, href, label }: { title: string; href: string; label: string }) {
  return <div className="mb-2 flex items-center justify-between gap-3"><h2 className="text-base font-bold">{title}</h2><Link href={href} className="inline-flex min-h-[44px] items-center gap-1 text-xs font-semibold text-primary/70">{label}<AppIcon name="arrow" className="h-3.5 w-3.5" /></Link></div>
}

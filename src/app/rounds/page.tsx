"use client"
import Link from "next/link"
import { leagueCardReturn } from "@/lib/leagueCardReturn"
import { LeagueCardReturnPanel } from "@/components/personal/LeagueCardReturnPanel"
import { leagueCardWindow } from "@/lib/cardLeagueReview"
import { todayInLeague } from "@/lib/nextLeague"
import { leagueContext, withLeagueContext } from "@/lib/personalCardFlow"
import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuth } from "@/hooks/useAuth"
import { useT } from "@/lib/i18n"
import { CourseTeePicker } from "@/components/personal/CourseTeePicker"
import { PersonalLevelCard } from "@/components/personal/PersonalLevelCard"
import { PersonalInbox } from "@/components/personal/PersonalInbox"
import { RoundList } from "@/components/personal/RoundList"
import { AppIcon } from "@/components/ui/AppIcon"
import { cachedPersonalCards, isCardNetworkError } from "@/lib/cardOffline"
import { todayLocalIso } from "@/lib/date"
import { supabase } from "@/lib/supabase"
import { loadPersonalOverview, personalResult, personalInput, personalButton, type PersonalOverview, type PersonalLeague } from "@/lib/personalRounds"

export default function PersonalRoundsPage() {
  return <Suspense><PersonalRoundsContent /></Suspense>
}
function PersonalRoundsContent() {
  const { user, loading } = useAuth()
  const t = useT(), router = useRouter(), params = useSearchParams()
  const leagueId = leagueContext(params.get("league"))
  const requested = params.get("tee"), course = params.get("course"), requestedNew = params.has("new")
  const loadKey = `${user?.id ?? ""}:${leagueId ?? ""}:${requested ?? ""}:${course ?? ""}:${requestedNew}`
  const [data, setData] = useState<PersonalOverview | null>(null)
  const [tee, setTee] = useState("")
  const [date, setDate] = useState(todayLocalIso)
  const [showNew, setShowNew] = useState(false)
  const [filter, setFilter] = useState<"all" | "drafts" | "pending" | "validated">("all")
  const [cardLeague, setCardLeague] = useState<PersonalLeague | null>(null)
  const createFlight = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  const [offline, setOffline] = useState(false)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => { setData(await loadPersonalOverview()) }, [])
  useEffect(() => {
    if (!user) return
    let active = true
    setLoadedFor(null); setData(null); setCardLeague(null); setError(null)
    const load = () => Promise.all([
      loadPersonalOverview(),
      leagueId ? supabase.rpc("get_personal_league", { p_game: leagueId }).then(result => personalResult<PersonalLeague | null>(result)) : Promise.resolve(null),
    ]).then(([d, league]) => {
      if (!active) return
      if (leagueId && !league) throw new Error("league_context")
      setCardLeague(league)
      setData(d)
      setLoadedFor(loadKey)
      setOffline(false)
      setError(null)
      const choices = course ? d.tees.filter(x => x.course_id === course) : d.tees
      if (league) setDate(leagueCardWindow(league, todayInLeague(league.rules.timezone)).initial)
      setTee(league?.rules.tee_id || choices.find(x => x.id === requested)?.id || choices.find(x => x.ready)?.id || choices[0]?.id || "")
      const existing = league ? leagueCardReturn(d.rounds, league, user.id, todayInLeague(league.rules.timezone)) : null
      setShowNew((requestedNew || !!requested || !!course) && !existing?.draft && !existing?.submission)
    }).catch(e => {
      if (!active) return
      if (isCardNetworkError(e)) {
        const cards = cachedPersonalCards(user.id)
        setData({ inbox: [], level: { value: null, status: "unavailable", cards_count: 0, cards_used: 0, revision_ids: [] }, official_index: null, tees: [], history: [],
          rounds: cards.map(c => ({ id: c.round.id, played_on: c.round.played_on, status: c.round.status, course_name: c.tee.course_name, tee_name: c.tee.name, hole_count: c.tee.hole_count, gross_total: c.revision?.gross_total ?? null, net_total: c.revision?.net_total ?? null, stableford_points: c.revision?.stableford_points ?? null, differential: c.revision?.differential ?? null })) })
        setLoadedFor(loadKey); setOffline(true); setShowNew(false); setError(null)
      } else setError(e.message)
    })
    void load()
    window.addEventListener("online", load)
    return () => { active = false; window.removeEventListener("online", load) }
  }, [user, requested, course, requestedNew, leagueId, loadKey])
  useEffect(() => {
    if (showNew) formRef.current?.querySelector<HTMLSelectElement>("select")?.focus()
  }, [showNew])
  if (loading || !user || (loadedFor !== loadKey && !error)) return <main className="p-6">{t("common.loading")}</main>
  const cardWindow = cardLeague ? leagueCardWindow(cardLeague, todayInLeague(cardLeague.rules.timezone)) : null
  const existing = cardLeague && data && !offline ? leagueCardReturn(data.rounds, cardLeague, user.id, todayInLeague(cardLeague.rules.timezone)) : null
  const hasExisting = !!(existing?.draft || existing?.submission)
  const rounds = data?.rounds.filter(r => filter === "all" || (filter === "drafts" ? r.status === "draft" : filter === "validated" ? r.status === "validated" : ["pending_validation", "pending_player_confirmation", "confirmed"].includes(r.status))) ?? []
  return <main className="app-page">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-3xl font-bold">{t(leagueId ? "friendCard.newTitle" : "personal.cards")}</h1></div>
      {(!hasExisting || showNew) && <button className={`${personalButton} gap-2`} disabled={!data || offline} aria-expanded={showNew} aria-controls="new-card" onClick={() => setShowNew(v => !v)}><AppIcon name={showNew ? "close" : "plus"} className="h-4 w-4" />{showNew ? t("personal.ui.close") : t("app.newCard")}</button>}
    </div>
    {leagueId && <Link href={`/games/${leagueId}`} className="mt-4 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold">← {t("friend.backLeague")}</Link>}
    {offline && <p role="status" className="mt-4 text-sm text-primary/70">{t("personal.offline.list")}</p>}
    {error && <p role="alert" className="my-4 text-sm text-red-700">{error === "league_context" ? t("friendCard.rulesFailed") : error}</p>}
    {data && <>
      {!leagueId && data.inbox.length > 0 && <PersonalInbox items={data.inbox} />}
      {existing && cardLeague && !showNew && <LeagueCardReturnPanel league={cardLeague} state={existing} allowNew={!!cardWindow?.open} onNew={() => setShowNew(true)} />}
      {showNew && <form ref={formRef} id="new-card" className="my-5 space-y-4 rounded-2xl border border-primary/10 bg-white p-5" onSubmit={async e => {
        e.preventDefault(); if (createFlight.current || busy || (leagueId && !cardWindow?.open)) return
        createFlight.current = true; setBusy(true); setError(null)
        try {
          const r = personalResult<{ id: string }>(await supabase.rpc("create_personal_round", { p_tee: cardLeague?.rules.tee_id ?? tee, p_played_on: date }))
          router.push(withLeagueContext(`/rounds/${r.id}`, leagueId))
        } catch (e) { setError(e instanceof Error ? e.message : t("personal.loadError")); setBusy(false); createFlight.current = false }
      }}>
        <h2 className="font-bold">{t("personal.new")}</h2>
        {cardLeague ? <div className="rounded-xl bg-sage/25 p-3"><p className="break-words text-sm font-bold">{cardLeague.game.name}</p><p className="mt-1 text-xs leading-relaxed text-primary/70">{cardLeague.tee.course_name} · {t("personal.picker.holeCount", { n: cardLeague.tee.hole_count })} · {cardLeague.tee.name}</p><p className="mt-2 text-xs text-primary/70">{t("friendCard.fixedTee")}</p></div> : <CourseTeePicker tees={data.tees} value={tee} onChange={setTee} disabled={busy} />}
        {cardWindow && !cardWindow.open && <p role="status" className="text-sm text-primary/70">{t("friendCard.notOpen")}</p>}
        <label className="block text-sm font-medium">{t("personal.playedOn")}<input type="date" required min={cardWindow?.min} max={cardWindow?.max ?? todayLocalIso()} value={date} onChange={e => setDate(e.target.value)} disabled={busy || (!!cardWindow && !cardWindow.open)} className={personalInput} /></label>
        {data.tees.find(x => x.id === tee)?.ready === false && <p className="text-xs text-amber-800">{t("personal.referencePending")}</p>}
        <button className={`${personalButton} w-full`} disabled={busy || !tee || (!!leagueId && !cardWindow?.open)}>{busy ? t("common.loading") : t("personal.start")}</button>
      </form>}
      <CardHistory focused={!!leagueId}>
      {leagueId && data.inbox.length > 0 && <PersonalInbox items={data.inbox} />}
      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label={t("personal.ui.state")}>
        {(["all", "drafts", "pending", "validated"] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`min-h-[44px] rounded-full border px-3 text-xs font-semibold transition-colors ${filter === value ? "border-primary bg-primary text-white" : "border-primary/10 bg-white text-primary/70 hover:border-primary/30"}`}>{t(value === "all" ? "app.filterAll" : `app.${value}`)}{value === "all" && <span className="ml-1.5 opacity-75">{data.rounds.length}</span>}</button>)}
      </div>
      <section className="my-6" aria-label={t("personal.history")}>
        {rounds.length === 0 ? <p className="app-surface p-5 text-sm text-primary/70">{t(data.rounds.length ? "app.noResults" : "personal.empty")}</p> : <RoundList rounds={rounds} leagueId={leagueId} />}
      </section>
      {!offline && <details><summary className="mb-3 cursor-pointer py-3 text-sm font-semibold">{t("app.levelDetails")}</summary><PersonalLevelCard overview={data} editableIndex showHistory onIndexChange={reload} /></details>}
      </CardHistory>
    </>}
    {!data && !error && <p className="mt-5" role="status">{t("common.loading")}</p>}
  </main>
}

function CardHistory({ focused, children }: { focused: boolean; children: React.ReactNode }) {
  const t = useT()
  return focused ? <details className="app-surface mt-5 p-4"><summary className="cursor-pointer py-2 text-sm font-semibold">{t("friendCard.otherCards")}</summary>{children}</details> : <>{children}</>
}

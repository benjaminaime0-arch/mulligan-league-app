"use client"
import { Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuth } from "@/hooks/useAuth"
import { useT } from "@/lib/i18n"
import { CourseTeePicker } from "@/components/personal/CourseTeePicker"
import { PersonalLevelCard } from "@/components/personal/PersonalLevelCard"
import { PersonalInbox } from "@/components/personal/PersonalInbox"
import { RoundList } from "@/components/personal/RoundList"
import { cachedPersonalCards, isCardNetworkError } from "@/lib/cardOffline"
import { todayLocalIso } from "@/lib/date"
import { supabase } from "@/lib/supabase"
import { loadPersonalOverview, personalResult, personalInput, personalButton, type PersonalOverview } from "@/lib/personalRounds"

export default function PersonalRoundsPage() {
  return <Suspense><PersonalRoundsContent /></Suspense>
}
function PersonalRoundsContent() {
  const { user, loading } = useAuth()
  const t = useT(), router = useRouter(), params = useSearchParams()
  const requested = params.get("tee"), course = params.get("course"), requestedNew = params.has("new")
  const [data, setData] = useState<PersonalOverview | null>(null)
  const [tee, setTee] = useState("")
  const [date, setDate] = useState(todayLocalIso)
  const [showNew, setShowNew] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const [offline, setOffline] = useState(false)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => { setData(await loadPersonalOverview()) }, [])
  useEffect(() => {
    if (!user) return
    let active = true
    const load = () => loadPersonalOverview().then(d => {
      if (!active) return
      setData(d)
      setLoadedFor(user.id)
      setOffline(false)
      setError(null)
      const choices = course ? d.tees.filter(x => x.course_id === course) : d.tees
      setTee(choices.find(x => x.id === requested)?.id || choices.find(x => x.ready)?.id || choices[0]?.id || "")
      setShowNew(requestedNew || !!requested || !!course)
    }).catch(e => {
      if (!active) return
      if (isCardNetworkError(e)) {
        const cards = cachedPersonalCards(user.id)
        setData({ inbox: [], level: { value: null, status: "unavailable", cards_count: 0, cards_used: 0, revision_ids: [] }, official_index: null, tees: [], history: [],
          rounds: cards.map(c => ({ id: c.round.id, played_on: c.round.played_on, status: c.round.status, course_name: c.tee.course_name, tee_name: c.tee.name, hole_count: c.tee.hole_count, gross_total: c.revision?.gross_total ?? null, net_total: c.revision?.net_total ?? null, stableford_points: c.revision?.stableford_points ?? null, differential: c.revision?.differential ?? null })) })
        setLoadedFor(user.id); setOffline(true); setShowNew(false); setError(null)
      } else setError(e.message)
    })
    void load()
    window.addEventListener("online", load)
    return () => { active = false; window.removeEventListener("online", load) }
  }, [user, requested, course, requestedNew])
  useEffect(() => {
    if (showNew) formRef.current?.querySelector<HTMLSelectElement>("select")?.focus()
  }, [showNew])
  if (loading || !user || (loadedFor !== user.id && !error)) return <main className="p-6">{t("common.loading")}</main>
  return <main className="mx-auto max-w-2xl px-4 py-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-3xl font-bold">{t("personal.cards")}</h1>
      <button className={personalButton} disabled={!data || offline} aria-expanded={showNew} aria-controls="new-card" onClick={() => setShowNew(v => !v)}>{showNew ? t("personal.ui.close") : `+ ${t("personal.new")}`}</button>
    </div>
    {offline && <p role="status" className="mt-4 text-sm text-primary/70">{t("personal.offline.list")}</p>}
    {error && <p role="alert" className="my-4 text-sm text-red-700">{error}</p>}
    {data && <>
      {data.inbox.length > 0 && <PersonalInbox items={data.inbox} />}
      {showNew && <form ref={formRef} id="new-card" className="my-5 space-y-4 rounded-2xl border border-primary/10 bg-white p-5" onSubmit={async e => {
        e.preventDefault(); setBusy(true); setError(null)
        try {
          const r = personalResult<{ id: string }>(await supabase.rpc("create_personal_round", { p_tee: tee, p_played_on: date }))
          router.push(`/rounds/${r.id}`)
        } catch (e) { setError(e instanceof Error ? e.message : t("personal.loadError")); setBusy(false) }
      }}>
        <h2 className="font-bold">{t("personal.new")}</h2>
        <CourseTeePicker tees={data.tees} value={tee} onChange={setTee} disabled={busy} />
        <label className="block text-sm font-medium">{t("personal.playedOn")}<input type="date" required max={todayLocalIso()} value={date} onChange={e => setDate(e.target.value)} disabled={busy} className={personalInput} /></label>
        {data.tees.find(x => x.id === tee)?.ready === false && <p className="text-xs text-amber-800">{t("personal.referencePending")}</p>}
        <button className={`${personalButton} w-full`} disabled={busy || !tee}>{busy ? t("common.loading") : t("personal.start")}</button>
      </form>}
      <section className="my-6" aria-label={t("personal.history")}>
        {data.rounds.length === 0 ? <p className="rounded-2xl bg-white p-5 text-sm text-primary/70">{t("personal.empty")}</p> : <RoundList rounds={data.rounds} />}
      </section>
      {!offline && <PersonalLevelCard overview={data} editableIndex showHistory onIndexChange={reload} />}
    </>}
    {!data && !error && <p className="mt-5" role="status">{t("common.loading")}</p>}
  </main>
}

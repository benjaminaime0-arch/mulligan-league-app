"use client"
import { nextLeagueDefaults, sourceLeagueId, todayInLeague } from "@/lib/nextLeague"
import { CourseTeePicker } from "./CourseTeePicker"
import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/lib/i18n"
import { AppIcon } from "@/components/ui/AppIcon"
import { supabase } from "@/lib/supabase"
import { track } from "@/lib/analytics"
import { AnalyticsView } from "@/components/AnalyticsView"
import { todayLocalIso } from "@/lib/date"
import { calendarLeagueEnd } from "@/lib/leagueCalendar"
import { loadPersonalOverview, personalButton, personalInput, personalResult, type PersonalTee, type PersonalLeague } from "@/lib/personalRounds"
export function CalendarLeagueCreator() {
  const { user, loading } = useAuth()
  const { t, locale } = useI18n(), router = useRouter(), params = useSearchParams()
  const userId = user?.id
  const from = params.get("from"), sourceId = sourceLeagueId(from)
  const [source, setSource] = useState<PersonalLeague | null>(null)
  const [ready, setReady] = useState(false)
  const submitting = useRef(false)
  const requestedTee = params.get("tee"), requestedStart = params.get("start"), requestedCourse = params.get("course")
  const [tees, setTees] = useState<PersonalTee[]>([])
  const [tee, setTee] = useState(""), [name, setName] = useState("")
  const [start, setStart] = useState(() => requestedStart && calendarLeagueEnd(requestedStart, 1) ? requestedStart : todayLocalIso())
  const [months, setMonths] = useState(1), [format, setFormat] = useState("stableford_net")
  const [cards, setCards] = useState(1), [witness, setWitness] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const end = calendarLeagueEnd(start, months)
  useEffect(() => {
    if (!userId) return
    let active = true
    setReady(false); setError(null)
    void (async () => {
      if (from && !sourceId) throw new Error("season.sourceError")
      const [d, previous] = await Promise.all([
        loadPersonalOverview(),
        sourceId ? supabase.rpc("get_personal_league", { p_game: sourceId }).then(result => personalResult<PersonalLeague | null>(result)) : Promise.resolve(null),
      ])
      if (!active) return
      const available = d.tees.filter(x => x.ready)
      setTees(available)
      if (sourceId) {
        const defaults = previous && nextLeagueDefaults(previous, todayInLeague(previous.rules.timezone))
        if (!defaults || !available.some(x => x.id === defaults.tee)) throw new Error("season.sourceError")
        setSource(previous); setTee(defaults.tee); setName(defaults.name); setStart(defaults.start)
        setMonths(defaults.months); setFormat(defaults.format); setCards(defaults.cards); setWitness(defaults.witness)
      } else {
        setSource(null); setTee(available.find(x => x.id === requestedTee)?.id ?? available.find(x => x.course_id === requestedCourse)?.id ?? available[0]?.id ?? "")
      }
      setReady(true)
    })().catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [userId, requestedTee, requestedCourse, from, sourceId])
  if (loading || !user) return <main className="app-page" role="status">{t("common.loading")}</main>
  const endLabel = end ? new Date(`${end}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : "—"
  return <main className="app-page !pt-2">
    <AnalyticsView event="league_create_viewed" viewKey="creator" />
    <Link href="/games" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-primary/70">← {t("nav.games")}</Link>
    <header className="mt-2 flex items-start gap-3"><span className="app-icon-tile"><AppIcon name="trophy" /></span><div><h1 className="text-2xl font-bold tracking-tight">{t("personal.createLeague")}</h1><p className="mt-1 text-sm text-primary/70">{t("personal.calendar.intro")}</p></div></header>
    {source && <aside className="mt-4 rounded-xl bg-sage/25 p-4"><p className="break-words text-sm font-bold">{t("season.from", { name: source.game.name })}</p><p className="mt-1 text-xs leading-relaxed text-primary/70">{t("season.prefilled")}</p></aside>}
    {!ready ? <p role={error ? "alert" : "status"} className="app-surface mt-4 p-4 text-sm">{error === "season.sourceError" ? t("season.sourceError") : error ?? t("common.loading")}</p> : <form className="mt-5 space-y-4 pb-28 md:pb-0" onSubmit={async e => {
      e.preventDefault(); if (!end || !ready || submitting.current) return
      submitting.current = true; setBusy(true); setError(null)
      try {
        const result = personalResult<{ game_id: string }>(await supabase.rpc("create_calendar_league", {
          p_name: name.trim(), p_tee: tee, p_start: start, p_duration_months: months,
          p_format: format, p_cards: cards, p_attestation: witness ? "peer_required" : "self_declared",
        }))
        track("game_created", { league_id: result.game_id, format, duration_months: months })
        router.push(`/games/${result.game_id}${sourceId ? `?from=${sourceId}` : ""}#league-invitation`)
      } catch (e) { setError(e instanceof Error ? e.message : t("common.error.generic")); setBusy(false); submitting.current = false }
    }}>
      <section className="app-surface space-y-4 p-4 sm:p-5" aria-labelledby="league-course-title">
      <h2 id="league-course-title" className="flex items-center gap-2 text-sm font-bold"><AppIcon name="flag" className="h-4 w-4" />{t("league.design.course")}</h2>
      <label className="block text-sm font-medium">{t("personal.leagueName")}<input aria-label={t("personal.leagueName")} className={personalInput} required maxLength={80} placeholder={t("personal.leagueNameExample")} value={name} onChange={e => setName(e.target.value)} disabled={busy} /></label>
      <CourseTeePicker tees={tees} value={tee} onChange={setTee} disabled={busy} />
      </section>
      <section className="app-surface space-y-4 p-4 sm:p-5" aria-labelledby="league-season-title">
      <h2 id="league-season-title" className="flex items-center gap-2 text-sm font-bold"><AppIcon name="clock" className="h-4 w-4" />{t("league.design.season")}</h2>
      <label className="block text-sm font-medium">{t("personal.calendar.start")}<input aria-label={t("personal.calendar.start")} className={personalInput} type="date" required min={source ? todayInLeague(source.rules.timezone) : undefined} value={start} onChange={e => setStart(e.target.value)} disabled={busy} /></label>
      <fieldset disabled={busy}><legend className="mb-2 text-sm font-medium">{t("personal.calendar.duration")}</legend><div className="grid grid-cols-3 gap-2">{[1,2,3].map(n => <label key={n} className="relative cursor-pointer"><input className="peer sr-only" type="radio" name="duration" value={n} checked={months === n} onChange={() => setMonths(n)} /><span className="flex min-h-[48px] items-center justify-center rounded-xl border border-primary/15 text-sm font-semibold peer-checked:border-primary peer-checked:bg-primary peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary">{t(n === 1 ? "personal.calendar.monthOne" : "personal.calendar.months", { n })}</span></label>)}</div></fieldset>
      <p className="flex items-center gap-2 rounded-xl bg-sage/25 p-3 text-sm font-semibold" role="status"><AppIcon name="check" className="h-4 w-4 shrink-0" />{t("personal.calendar.end", { date: endLabel })}</p>
      <details className="text-sm text-primary/70"><summary className="cursor-pointer py-2">{t("personal.ui.rules")}</summary><p className="mt-1 text-xs leading-relaxed">{t("personal.calendar.convention")}</p></details>
      </section>
      <section className="app-surface space-y-4 p-4 sm:p-5" aria-labelledby="league-format-title">
      <h2 id="league-format-title" className="flex items-center gap-2 text-sm font-bold"><AppIcon name="cards" className="h-4 w-4" />{t("personal.format")}</h2>
      <label className="block text-sm"><span className="sr-only">{t("personal.format")}</span><select aria-label={t("personal.format")} className={personalInput} value={format} onChange={e => setFormat(e.target.value)} disabled={busy}>{["stroke_gross", "stroke_net", "stableford_net"].map(f => <option key={f} value={f}>{t(`personal.format.${f}`)}</option>)}</select></label>
      <details className="border-t border-primary/10 pt-2"><summary className="cursor-pointer py-2 text-sm font-semibold">{t("personal.calendar.options")}</summary>
        <label className="mt-3 block text-sm">{t("personal.requiredCards")}<input aria-label={t("personal.requiredCards")} className={personalInput} type="number" min={1} max={20} required value={cards} onChange={e => setCards(Number(e.target.value))} disabled={busy} /></label>
        <label className="mt-3 flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" checked={witness} onChange={e => setWitness(e.target.checked)} disabled={busy} />{t("personal.witnessRequired")}</label>
        <p className="mt-2 text-xs text-primary/70">{t("personal.leagueRules")}</p>
      </details>
      </section>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-20 mx-auto max-w-[42rem] rounded-2xl border border-primary/10 bg-white/95 p-3 shadow-lg backdrop-blur md:static md:mt-4 md:max-w-none md:border-0 md:bg-transparent md:p-0 md:shadow-none"><button type="submit" className={`${personalButton} w-full gap-2`} disabled={busy || !tee || !end}><AppIcon name="plus" className="h-4 w-4" />{busy ? t("common.loading") : t("personal.createAndInvite")}</button></div>
    </form>}
  </main>
}

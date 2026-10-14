"use client"
import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/hooks/useAuth"
import { useT } from "@/lib/i18n"
import { supabase } from "@/lib/supabase"
import { todayLocalIso } from "@/lib/date"
import { calendarLeagueEnd } from "@/lib/leagueCalendar"
import { loadPersonalOverview, personalButton, personalInput, personalResult, type PersonalTee } from "@/lib/personalRounds"
export function CalendarLeagueCreator() {
  const { user, loading } = useAuth()
  const t = useT(), router = useRouter(), params = useSearchParams()
  const requestedTee = params.get("tee"), requestedStart = params.get("start")
  const [tees, setTees] = useState<PersonalTee[]>([])
  const [tee, setTee] = useState(""), [name, setName] = useState("")
  const [start, setStart] = useState(() => requestedStart && calendarLeagueEnd(requestedStart, 1) ? requestedStart : todayLocalIso())
  const [months, setMonths] = useState(1), [format, setFormat] = useState("stableford_net")
  const [cards, setCards] = useState(1), [witness, setWitness] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const end = calendarLeagueEnd(start, months)
  useEffect(() => {
    if (!user) return
    let active = true
    loadPersonalOverview().then(d => {
      if (!active) return
      const available = d.tees.filter(x => x.ready)
      setTees(available); setTee(available.find(x => x.id === requestedTee)?.id ?? available[0]?.id ?? "")
    }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [user, requestedTee])
  if (loading || !user) return <main className="p-6">{t("common.loading")}</main>
  return <main className="mx-auto max-w-2xl px-4 py-6">
    <Link href="/games" className="text-sm underline">← {t("nav.games")}</Link>
    <h1 className="mt-3 text-2xl font-bold">{t("personal.createLeague")}</h1>
    <p className="mt-2 text-sm text-primary/70">{t("personal.calendar.intro")}</p>
    <form className="mt-5 space-y-4" onSubmit={async e => {
      e.preventDefault(); if (!end) return
      setBusy(true); setError(null)
      try {
        const result = personalResult<{ game_id: string }>(await supabase.rpc("create_calendar_league", {
          p_name: name.trim(), p_tee: tee, p_start: start, p_duration_months: months,
          p_format: format, p_cards: cards, p_attestation: witness ? "peer_required" : "self_declared",
        }))
        router.push(`/games/${result.game_id}`)
      } catch (e) { setError(e instanceof Error ? e.message : t("common.error.generic")); setBusy(false) }
    }}>
      <label className="block text-sm">{t("personal.leagueName")}<input aria-label={t("personal.leagueName")} className={personalInput} required maxLength={80} value={name} onChange={e => setName(e.target.value)} disabled={busy} /></label>
      <label className="block text-sm">{t("personal.tee")}<select aria-label={t("personal.tee")} className={personalInput} required value={tee} onChange={e => setTee(e.target.value)} disabled={busy}>
        {!tees.length && <option value="">{t("common.loading")}</option>}{tees.map(x => <option key={x.id} value={x.id}>{x.course_name} · {x.hole_count} · {x.name}</option>)}
      </select></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">{t("personal.calendar.start")}<input aria-label={t("personal.calendar.start")} className={personalInput} type="date" required value={start} onChange={e => setStart(e.target.value)} disabled={busy} /></label>
        <label className="block text-sm">{t("personal.calendar.duration")}<select aria-label={t("personal.calendar.duration")} className={personalInput} value={months} onChange={e => setMonths(Number(e.target.value))} disabled={busy}>{[1,2,3].map(n => <option key={n} value={n}>{t("personal.calendar.months", { n })}</option>)}</select></label>
      </div>
      <p className="rounded-xl bg-cream p-3 text-sm" role="status">{t("personal.calendar.end", { date: end ?? "—" })}</p>
      <p className="text-xs text-primary/70">{t("personal.calendar.convention")}</p>
      <label className="block text-sm">{t("personal.format")}<select aria-label={t("personal.format")} className={personalInput} value={format} onChange={e => setFormat(e.target.value)} disabled={busy}>{["stroke_gross", "stroke_net", "stableford_net"].map(f => <option key={f} value={f}>{t(`personal.format.${f}`)}</option>)}</select></label>
      <details className="rounded-xl border border-primary/15 p-3"><summary className="cursor-pointer text-sm">{t("personal.calendar.options")}</summary>
        <label className="mt-3 block text-sm">{t("personal.requiredCards")}<input aria-label={t("personal.requiredCards")} className={personalInput} type="number" min={1} max={20} required value={cards} onChange={e => setCards(Number(e.target.value))} disabled={busy} /></label>
        <label className="mt-3 flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" checked={witness} onChange={e => setWitness(e.target.checked)} disabled={busy} />{t("personal.witnessRequired")}</label>
        <p className="mt-2 text-xs text-primary/70">{t("personal.leagueRules")}</p>
      </details>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button className={personalButton} disabled={busy || !tee || !end}>{busy ? t("common.loading") : t("personal.createLeague")}</button>
    </form>
  </main>
}

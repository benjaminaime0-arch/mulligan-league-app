"use client"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ValidationTimer } from "./ValidationTimer"
import { ConfirmModal } from "@/components/ConfirmModal"
import { QuickScoreEntry } from "./QuickScoreEntry"
import { PersonalLeagueSubmission } from "./PersonalLeagueSubmission"
import { cardEntrySummary, withLeagueContext, intendedCardLeague, cardScoresChanged } from "@/lib/personalCardFlow"
import { AppIcon } from "@/components/ui/AppIcon"
import { ScoreSummary } from "./ScoreSummary"
import { useI18n } from "@/lib/i18n"
import { supabase } from "@/lib/supabase"
import { useCardDraft } from "@/lib/useCardDraft"
import {
  cardIsComplete,
  holesAsJson,
  personalResult,
  personalInput,
  personalButton,
  type PersonalCard,
  type PersonalHole,
} from "@/lib/personalRounds"
export function PersonalRoundEditor({
  data,
  onReload,
  leagueId,
}: {
  data: PersonalCard
  leagueId?: string | null
  onReload: () => Promise<void>
}) {
  const { t, locale } = useI18n()
  const makeHoles = () =>
    data.reference_holes.map(
      (h) =>
        (data.round.status === "draft" ? data.holes : data.revision?.scores ?? data.holes).find((s) => s.hole_number === h.hole_number) ?? {
          hole_number: h.hole_number,
          completion: "not_played" as const,
          strokes: null,
        },
    )
  const [reviewHoles, setReviewHoles] = useState<PersonalHole[]>(makeHoles)
  const [entryReview, setEntryReview] = useState(false)
  const [validator, setValidator] = useState("")
  const [present, setPresent] = useState(false)
  const [correctionReason, setCorrectionReason] = useState("")
  const [correcting, setCorrecting] = useState(false)
  const reviewFlight = useRef(false)
  const intended = intendedCardLeague(data.leagues, leagueId)
  const ownerDraft = data.is_owner && data.round.status === "draft"
  const autosave = useCardDraft(data, ownerDraft)
  const holes = ownerDraft ? autosave.state.holes : reviewHoles
  const playerName = data.events.find(event => event.action === "submitted")?.actor_name
  const validatorReview = !data.is_owner && data.round.status === "pending_validation"
  const editable = ownerDraft || (validatorReview && correcting && autosave.online)
  const displayTime = (value: string) => new Date(value).toLocaleString(locale, { timeZone: data.round.course_timezone })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    setReviewHoles(
      data.reference_holes.map(
        (h) =>
          (data.round.status === "draft" ? data.holes : data.revision?.scores ?? data.holes).find((s) => s.hole_number === h.hole_number) ?? {
            hole_number: h.hole_number,
            completion: "not_played",
            strokes: null,
          },
      ),
    )
  }, [data])
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (!autosave.online) throw new Error("offline")
      await fn()
    } catch (e) {
      const message = e instanceof Error ? e.message : ""
      setError(["offline", "session", "conflict", "invalid", "storageError", "blocked"].includes(message) ? t(`personal.autosave.${message}`) : message || t("personal.loadError"))
    } finally {
      setBusy(false)
    }
  }
  const save = () => autosave.flush()
  const change = (n: number, patch: Partial<PersonalHole>) => {
    const next = holes.map(h => h.hole_number === n ? { ...h, ...patch } : h)
    if (ownerDraft) autosave.change(n, patch)
    else setReviewHoles(next)
  }
  useEffect(() => {
    setCorrecting(false); setPresent(false); setCorrectionReason("")
  }, [data.round.id, data.revision?.id, data.round.status])
  const changed = cardScoresChanged(holes, data.revision?.scores ?? [])
  const correctionReady = correcting && changed && cardIsComplete(holes, data.tee.hole_count) && correctionReason.trim().length >= 3 && correctionReason.trim().length <= 500
  const review = async (correct: boolean) => {
    if (!validatorReview || !data.revision || !present || !autosave.online || reviewFlight.current || (correct ? !correctionReady : correcting)) return
    reviewFlight.current = true
    try {
      personalResult(await supabase.rpc("review_personal_card", {
        p_round: data.round.id, p_revision: data.revision.id, p_present: present,
        p_scores: correct ? holesAsJson(holes) : null, p_reason: correct ? correctionReason.trim() : null,
      }))
      await onReload()
      setNotice(t(correct ? "validation.correctionSent" : "validation.approved"))
    } finally { reviewFlight.current = false }
  }
  const resolve = async (accept: boolean) => {
    if (!data.revision) return
    personalResult(await supabase.rpc("resolve_personal_correction", {
      p_round: data.round.id, p_revision: data.revision.id, p_accept: accept,
    }))
    await onReload()
  }
  const complete = cardIsComplete(holes, data.tee.hole_count)
  const entryReviewBlocked = busy || !complete || !data.tee.ready || !autosave.online || ['offline', 'conflict', 'blocked', 'session', 'invalid', 'storageError'].includes(autosave.state.status)
  const summary = cardEntrySummary(holes)
  const entered = summary.entered
  const rules = (<details className="app-surface my-4 px-4 text-xs text-primary/70"><summary className="cursor-pointer py-3 font-semibold">{t("personal.ui.rules")}</summary>{ownerDraft && <div className="space-y-2 pb-1"><p>{t("personal.lifecycle.deadline")}: {displayTime(data.round.entry_deadline_at)} ({data.round.course_timezone})</p><p>{t("personal.lifecycle.validatorHelp")}</p></div>}<p className="mt-3 text-sm">
        {t("personal.handicapSnapshot")}: {data.round.handicap_index} (
        {t(`personal.source.${data.round.handicap_source}`)})
      </p>
      {data.tee.hole_count === 9 && (
        <p className="mt-2 text-xs text-primary/70">
          {t("personal.nineEstimate")}
        </p>
      )}
      </details>)
  return (
    <main className={`app-page !pt-2 ${ownerDraft ? "!pb-28 md:!pb-4" : validatorReview ? "!pb-44 md:!pb-4" : ""}`}>
      {leagueId && data.is_owner && <aside className="my-2 rounded-xl bg-sage/25 px-4 py-3 text-sm">
        <Link href={`/games/${leagueId}`} className="inline-flex min-h-[44px] items-center font-semibold">{data.leagues.find(g => g.id === leagueId)?.name ?? t("friend.backLeague")} <span className="ml-2" aria-hidden="true">↗</span></Link>
        {intended && data.revision && !ownerDraft && data.round.status !== "disputed" && <a href="#card-league-submission" className={`${personalButton} mt-2 w-full`}>{t("friend.submitLeague")}</a>}
      </aside>}
      <Link href={withLeagueContext("/rounds", leagueId)} className="inline-flex min-h-[44px] items-center gap-2 text-xs font-semibold text-primary/70">
        ← {t("personal.cards")}
      </Link>
      {!data.is_owner && playerName && <p className="mt-2 text-sm font-semibold">{t("validation.playerCard", { name: playerName })}</p>}
      <header className="mt-2 flex items-start gap-3"><span className="app-icon-tile"><AppIcon name="flag" /></span><div className="min-w-0"><h1 className="break-words text-2xl font-bold leading-tight tracking-tight">{data.tee.course_name}</h1><p className="mt-1 text-xs text-primary/70">{t("personal.picker.holeCount", { n: data.tee.hole_count })} · {data.tee.name}</p></div></header>
      <p className="mt-1 text-sm text-primary/70">
        {new Date(`${data.round.played_on}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })}
      </p>
      {validatorReview && <aside className="my-4 rounded-xl bg-sage/25 p-4"><h2 className="text-sm font-bold">{t(correcting ? "validation.correctTitle" : "validation.title")}</h2><p className="mt-1 text-xs leading-relaxed text-primary/70">{t(correcting ? "validation.correctHint" : "validation.hint")}</p></aside>}
      {validatorReview && <a href="#card-validation-actions" className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-20 mx-auto flex min-h-[48px] max-w-[42rem] items-center justify-center rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white shadow-lg md:hidden">{t(correcting ? "validation.reviewCorrection" : "validation.reviewDecision")}</a>}
      {ownerDraft && <section className="mt-3 rounded-xl bg-sage/20 px-3 py-2 text-xs" aria-label={t("personal.autosave.title")}>
        <p role="status" className={['conflict', 'blocked', 'storageError', 'invalid', 'session'].includes(autosave.state.status) ? "text-amber-800" : "text-primary/70"}>{t(`personal.autosave.${autosave.state.status}`)}</p>
        {autosave.state.status === "offline" && <p className="mt-1 text-xs text-primary/70">{t("personal.offline.confirmOnline")}</p>}
        {['offline', 'session', 'storageError'].includes(autosave.state.status) && <button className="mt-2 min-h-[44px] underline" onClick={() => void run(async () => { await save() })}>{t("personal.offline.retry")}</button>}
        {autosave.state.conflict && <div className="mt-2 rounded-xl border border-amber-300 bg-white p-3">
          <ul className="space-y-1 text-xs">{holes.map((h, i) => {
            const other = autosave.state.conflict![i]
            return h.completion !== other.completion || h.strokes !== other.strokes ? <li key={h.hole_number}>{t("personal.hole", { n: h.hole_number })}: {t("personal.offline.mine")} {h.strokes ?? t(`personal.hole.${h.completion}`)} · {t("personal.offline.other")} {other.strokes ?? t(`personal.hole.${other.completion}`)}</li> : null
          })}</ul>
          <div className="mt-2 flex flex-wrap gap-3"><button className="min-h-[44px] underline" onClick={() => autosave.choose(false)}>{t("personal.offline.useOther")}</button><button className="min-h-[44px] font-bold underline" onClick={() => autosave.choose(true)}>{t("personal.offline.keepMine")}</button></div>
        </div>}
      </section>}
      <section className="app-surface my-4 p-4" aria-label={t("personal.lifecycle.title")}>
        <h2 className={`app-pill ${data.round.status === "disputed" ? "bg-red-50 text-red-800" : data.round.status.startsWith("pending") ? "bg-amber-50 text-amber-900" : "bg-sage/35"}`}><AppIcon name={data.round.status === "validated" ? "check" : "clock"} className="h-3.5 w-3.5" />{t(`personal.status.${data.round.status}`)}</h2>
        {!ownerDraft && <p className="mt-3 text-xs text-primary/70">{t("personal.lifecycle.deadline")}: {displayTime(data.round.entry_deadline_at)} ({data.round.course_timezone})</p>}
        {data.round.status === "pending_validation" && data.round.auto_validation_at && (
          <div><p className="mt-2 text-sm">{t("personal.lifecycle.timer")}: {displayTime(data.round.auto_validation_at)} ({data.round.course_timezone})</p><ValidationTimer due={data.round.auto_validation_at} serverNow={data.server_now} /><button className="mt-2 text-sm underline" disabled={busy} onClick={() => void run(onReload)}>{t("personal.refresh")}</button></div>
        )}
        {data.round.status === "pending_player_confirmation" && <p className="mt-2 text-sm">{t("personal.lifecycle.timerCancelled")}</p>}
        {data.round.validated_at && <p className="mt-2 text-sm">{t("personal.lifecycle.validatedAt")}: {displayTime(data.round.validated_at)} · {t(`personal.method.${data.round.validation_method}`)}</p>}
        {data.round.status === "disputed" && <p className="mt-2 text-sm text-red-700">{t("personal.lifecycle.disputed")}</p>}
        {ownerDraft && <label className="mt-3 block text-sm">{t("personal.lifecycle.validator")}
          <select aria-label={t("personal.lifecycle.validator")} className={personalInput} value={validator} onChange={(e) => setValidator(e.target.value)} disabled={busy}>
            <option value="">{t("personal.lifecycle.self")}</option>
            {data.validators.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>

        </label>}
      </section>
      {!data.tee.ready && (
        <p className="my-3 text-sm text-amber-800">
          {t("personal.referencePending")}
        </p>
      )}
      {!ownerDraft && rules}
      {data.revision && (
        <section className="my-4 rounded-[20px] bg-primary p-5 text-white">
          <h2 className="mb-4 text-xs font-semibold text-sage">{t("personal.confirmedRevision", { n: data.revision.revision_number })}</h2>
          <ScoreSummary gross={data.revision.gross_total} net={data.revision.net_total} stableford={data.revision.stableford_points} differential={data.revision.differential} />
          {data.is_owner && <p className="mt-3 text-sm">
            {t("personal.level.title")}: {data.level.value ?? "—"} ·{" "}
            {t(`personal.level.${data.level.status}`)}
          </p>}
          <p className="mt-2 text-xs text-sage">
            {t("personal.lifecycle.lockNotice")}
          </p>
        </section>
      )}
      {error && !validatorReview && (
        <p role="alert" className="my-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && data.is_owner && (
        <p role="status" className="my-3 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      <section className="mt-5" aria-label={t("personal.ui.scores")}>
        <div className="app-surface mb-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="inline-flex items-center gap-2 font-bold"><AppIcon name="cards" className="h-4 w-4" />{t(editable ? "personal.enterScores" : "personal.ui.scores")}</h2>{editable && <p className="text-xs text-primary/70" role="status">{t("personal.ui.progress", { n: entered, total: data.tee.hole_count })}</p>}</div>
          {editable && <div role="progressbar" aria-label={t("personal.enterScores")} aria-valuemin={0} aria-valuemax={data.tee.hole_count} aria-valuenow={entered} className="mt-3 h-1.5 overflow-hidden rounded-full bg-primary/10"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${entered / data.tee.hole_count * 100}%` }} /></div>}
          {data.tee.hole_count === 18 && <nav aria-label={t("detail.scoreSections")} className="mt-3 flex gap-2">{[1, 10].map(n => <a key={n} href={`#holes-${n}`} className="inline-flex min-h-[44px] items-center rounded-full bg-primary/5 px-4 text-xs font-bold">{t("personal.ui.hole")} {n}–{n + 8}</a>)}</nav>}
        </div>
        {editable ? <QuickScoreEntry references={data.reference_holes} holes={holes} onChange={change}
          disabled={busy || (ownerDraft && (!autosave.ready || ['conflict', 'blocked', 'session'].includes(autosave.state.status)))}
          onDone={() => { if (ownerDraft) { if (!entryReviewBlocked) setEntryReview(true) } else document.getElementById("card-validation-actions")?.scrollIntoView({ block: "center", behavior: "smooth" }) }} /> : <div className="grid gap-4 md:grid-cols-2">
          {[0, ...(data.tee.hole_count === 18 ? [9] : [])].map(start => <div key={start} id={`holes-${start + 1}`} className="app-surface scroll-mt-20 overflow-hidden">
            <h3 className="border-b border-primary/10 bg-sage/25 px-3 py-3 text-sm font-bold">{t("personal.ui.hole")} {start + 1}–{Math.min(start + 9, data.tee.hole_count)}</h3>
            <table className="w-full text-left text-sm"><caption className="sr-only">{t("personal.ui.scores")} · {t("personal.ui.hole")} {start + 1}–{start + 9}</caption>
              <thead className="text-xs text-primary/70"><tr><th scope="col" className="px-3 py-2">{t("personal.ui.hole")}</th><th scope="col">Par</th><th scope="col">{t("personal.ui.index")}</th><th scope="col" className="pr-3 text-right">{t("personal.ui.strokes")}</th></tr></thead>
              <tbody>{data.reference_holes.slice(start, start + 9).map(ref => {
                const h = holes.find(x => x.hole_number === ref.hole_number)!
                return <tr key={ref.hole_number} className="border-t border-primary/5"><th scope="row" className="px-3 py-2 font-semibold">{ref.hole_number}</th><td>{ref.par}</td><td>{ref.stroke_index ?? "—"}</td><td className="pr-3 text-right font-bold">{h.completion === "completed" ? h.strokes ?? "—" : t(`personal.hole.${h.completion}`)}</td></tr>
              })}</tbody>
            </table>
          </div>)}
        </div>}
        {editable && <div className="app-surface mt-3 flex items-center justify-between gap-3 p-4 text-sm"><span>{t("personal.gross")}: <strong>{summary.gross ?? "—"}</strong></span><span className="text-xs text-primary/65">{summary.pickedUp ? t("cardFlow.pickedUpCount", { n: summary.pickedUp }) : t("personal.ui.progress", { n: entered, total: data.tee.hole_count })}</span></div>}
      </section>
      {ownerDraft && <div className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-20 mx-auto flex max-w-[42rem] gap-2 rounded-2xl border border-primary/10 bg-white/95 p-3 shadow-lg backdrop-blur md:static md:mt-4 md:max-w-none md:shadow-none">
        <button
          className="inline-flex min-h-[48px] flex-1 items-center justify-center rounded-xl bg-primary/5 px-3 py-2 text-xs font-bold"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await save()
              setNotice(t("personal.saved"))
            })
          }
        >
          {t("personal.saveDraft")}
        </button>
        <button
          className={`${personalButton} flex-1 !px-3 !text-xs`}
          disabled={entryReviewBlocked}
          onClick={() => setEntryReview(true)}
        >
          {t("cardFlow.review")}
        </button>
      </div>}
      {notice && !data.is_owner && <aside role="status" className="app-surface my-4 p-4"><p className="text-sm font-semibold">{notice}</p><Link href="/home" className="mt-2 inline-flex min-h-[44px] items-center text-sm font-bold">{t("validation.backInbox")} →</Link></aside>}
      {ownerDraft && rules}
      {validatorReview && (
        <section id="card-validation-actions" className="app-surface mt-4 scroll-mt-20 space-y-3 p-4">
          <h2 className="font-bold">{t(correcting ? "validation.correctTitle" : "validation.title")}</h2>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          {correcting && <label className="block text-sm">{t("personal.lifecycle.correctionReason")}
            <textarea className={personalInput} maxLength={500} value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} disabled={busy} />
          </label>}
          <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl bg-primary/5 p-3 text-sm"><input type="checkbox" checked={present} disabled={busy || !autosave.online} onChange={(e) => setPresent(e.target.checked)} className="h-5 w-5 shrink-0 accent-primary" />{t("personal.present")}</label>
          {correcting ? <>
            <button className={`${personalButton} w-full`} disabled={busy || !present || !autosave.online || !correctionReady} onClick={() => void run(() => review(true))}>{t("personal.lifecycle.propose")}</button>
            <button className="min-h-[44px] text-sm font-semibold underline" disabled={busy} onClick={() => { setCorrecting(false); setReviewHoles(makeHoles()); setCorrectionReason(""); setPresent(false) }}>{t("validation.cancelCorrection")}</button>
          </> : <>
            <button className={`${personalButton} w-full`} disabled={busy || !present || !autosave.online} onClick={() => void run(() => review(false))}>{t("validation.approve")}</button>
            <button className="min-h-[44px] text-sm font-semibold underline" disabled={busy || !autosave.online} onClick={() => { setCorrecting(true); window.requestAnimationFrame(() => document.getElementById("holes-1")?.scrollIntoView({ block: "start" })) }}>{t("validation.correct")}</button>
          </>}
          {!autosave.online && <p role="status" className="text-xs text-amber-800">{t("personal.offline.confirmOnline")}</p>}
        </section>
      )}
      {data.round.status === "pending_player_confirmation" && (
        <section className="app-surface my-5 !border-amber-400 p-4">
          <h2 className="font-semibold">{t("personal.lifecycle.reviewCorrection")}</h2>
          <p className="mt-2 text-sm">{data.revision?.correction_reason}</p>
          <ol className="my-3 space-y-1 text-sm">{data.revision?.scores.map((h) => {
            const before = data.revisions[data.revisions.length - 2]?.scores.find((x) => x.hole_number === h.hole_number)
            return before && (before.strokes !== h.strokes || before.completion !== h.completion) ? <li key={h.hole_number}>{t("personal.hole", { n: h.hole_number })}: {before.strokes ?? t(`personal.hole.${before.completion}`)} → {h.strokes ?? t(`personal.hole.${h.completion}`)}</li> : null
          })}</ol>
          {data.is_owner && <><p className="my-3 text-sm">{t("personal.lifecycle.refusalWarning")}</p>
            <div className="flex flex-wrap gap-2"><button className={personalButton} disabled={busy} onClick={() => void run(() => resolve(true))}>{t("personal.lifecycle.accept")}</button>
            <button className="rounded-lg border border-red-600 px-4 py-2.5 text-sm text-red-700" disabled={busy} onClick={() => void run(() => resolve(false))}>{t("personal.lifecycle.refuse")}</button></div>
          </>}
        </section>
      )}
      {data.events.length > 0 && <details className="app-surface mt-5 p-4 text-xs text-primary/70"><summary className="cursor-pointer py-2 font-semibold">{t("personal.lifecycle.audit")}</summary><ol className="mt-2 space-y-2">{data.events.map((e) => <li key={e.id}>{displayTime(e.occurred_at)} · {t(`personal.event.${e.action}`)}{e.actor_name ? ` · ${e.actor_name}` : ""}{e.metadata.reason ? ` · ${e.metadata.reason}` : ""}</li>)}</ol></details>}
      {ownerDraft && !complete && (
        <p className="mt-2 text-xs text-primary/70">
          {t("personal.incomplete")}
        </p>
      )}
      {data.is_owner && data.round.status !== "disputed" && (ownerDraft || data.revision) && <PersonalLeagueSubmission data={data} leagueId={leagueId} online={autosave.online} busy={busy} onBusyChange={setBusy} onReload={onReload} />}
      <ConfirmModal open={entryReview && ownerDraft} title={t("cardFlow.reviewTitle")} confirmLabel={t("personal.confirm")} confirmDisabled={entryReviewBlocked} loading={busy} onCancel={() => setEntryReview(false)} onConfirm={() => {
        if (entryReviewBlocked) return
        setEntryReview(false)
        void run(async () => {
          const v = await save()
          personalResult(await supabase.rpc("request_personal_validation", { p_round: data.round.id, p_expected_version: v, p_validator: validator || null }))
          await onReload()
          setNotice(t(validator ? "personal.lifecycle.requested" : "personal.confirmed"))
        })
      }}>
        <p className="mt-3 text-sm font-bold">{data.tee.course_name} · {t("personal.picker.holeCount", { n: data.tee.hole_count })}</p>
        <p className="mt-1 text-xs text-primary/65">{data.round.played_on} · {data.tee.name}</p>
        <div className="my-4 flex justify-between rounded-xl bg-sage/25 p-3 text-sm"><span>{t("personal.gross")} <strong>{summary.gross ?? "—"}</strong></span><span>{t("cardFlow.pickedUpCount", { n: summary.pickedUp })}</span></div>
        <div className="grid grid-cols-9 gap-1">{holes.map(h => <div key={h.hole_number} className="rounded-md bg-primary/5 py-2 text-center"><p className="text-[10px] text-primary/60">{h.hole_number}</p><p className="text-xs font-bold">{h.completion === "picked_up" ? t("cardFlow.pickedUpShort") : h.strokes ?? "—"}</p></div>)}</div>
        <p className="mt-4 text-xs text-primary/70">{validator ? `${t("personal.lifecycle.validator")}: ${data.validators.find(v => v.id === validator)?.name ?? ""}` : t("personal.lifecycle.self")}</p>
        <p className="mt-2 text-xs text-primary/65">{t("cardFlow.lockNotice")}</p>
      </ConfirmModal>
    </main>
  )
}

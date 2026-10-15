"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { ValidationTimer } from "./ValidationTimer"
import { personalSubmissionStatusKey } from "@/lib/personalSubmissionStatus"
import { useT } from "@/lib/i18n"
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
}: {
  data: PersonalCard
  onReload: () => Promise<void>
}) {
  const t = useT()
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
  const [validator, setValidator] = useState("")
  const [present, setPresent] = useState(false)
  const [correctionReason, setCorrectionReason] = useState("")
  const ownerDraft = data.is_owner && data.round.status === "draft"
  const autosave = useCardDraft(data, ownerDraft)
  const holes = ownerDraft ? autosave.state.holes : reviewHoles
  const validatorReview = !data.is_owner && data.round.status === "pending_validation"
  const editable = ownerDraft || (validatorReview && autosave.online)
  const displayTime = (value: string) => new Date(value).toLocaleString(undefined, { timeZone: data.round.course_timezone })
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
  const review = async (correct: boolean) => {
    if (!data.revision) return
    personalResult(await supabase.rpc("review_personal_card", {
      p_round: data.round.id, p_revision: data.revision.id, p_present: present,
      p_scores: correct ? holesAsJson(holes) : null, p_reason: correct ? correctionReason : null,
    }))
    await onReload()
  }
  const resolve = async (accept: boolean) => {
    if (!data.revision) return
    personalResult(await supabase.rpc("resolve_personal_correction", {
      p_round: data.round.id, p_revision: data.revision.id, p_accept: accept,
    }))
    await onReload()
  }
  const complete = cardIsComplete(holes, data.tee.hole_count)
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Link href="/rounds" className="text-sm underline">
        ← {t("personal.cards")}
      </Link>
      <h1 className="mt-3 text-2xl font-bold">{data.tee.course_name}</h1>
      <p className="mt-1 text-sm text-primary/70">
        {data.round.played_on} · {data.tee.hole_count} · {data.tee.name}
      </p>
      {ownerDraft && <section className="mt-3 text-sm" aria-label={t("personal.autosave.title")}>
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
      <p className="mt-3 text-sm">
        {t("personal.handicapSnapshot")}: {data.round.handicap_index} (
        {t(`personal.source.${data.round.handicap_source}`)})
      </p>
      <section className="my-4 rounded-2xl border border-primary/15 bg-white p-4" aria-label={t("personal.lifecycle.title")}>
        <h2 className="font-semibold">{t(`personal.status.${data.round.status}`)}</h2>
        <p className="mt-2 text-sm">{t("personal.lifecycle.deadline")}: {displayTime(data.round.entry_deadline_at)} ({data.round.course_timezone})</p>
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
          <span className="mt-2 block text-xs text-primary/70">{t("personal.lifecycle.validatorHelp")}</span>
        </label>}
      </section>
      {!data.tee.ready && (
        <p className="my-3 text-sm text-amber-800">
          {t("personal.referencePending")}
        </p>
      )}
      {data.tee.hole_count === 9 && (
        <p className="mt-2 text-xs text-primary/70">
          {t("personal.nineEstimate")}
        </p>
      )}
      {data.revision && (
        <section className="my-4 rounded-2xl border border-primary/10 bg-white p-4">
          <h2 className="font-semibold">
            {t("personal.confirmedRevision", {
              n: data.revision.revision_number,
            })}
          </h2>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt>{t("personal.gross")}</dt>
              <dd className="font-bold">{data.revision.gross_total ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("personal.net")}</dt>
              <dd className="font-bold">{data.revision.net_total ?? "—"}</dd>
            </div>
            <div>
              <dt>{t("personal.stableford")}</dt>
              <dd className="font-bold">{data.revision.stableford_points}</dd>
            </div>
            <div>
              <dt>{t("personal.differential")}</dt>
              <dd className="font-bold">{data.revision.differential}</dd>
            </div>
          </dl>
          {data.is_owner && <p className="mt-3 text-sm">
            {t("personal.level.title")}: {data.level.value ?? "—"} ·{" "}
            {t(`personal.level.${data.level.status}`)}
          </p>}
          <p className="mt-2 text-xs text-primary/70">
            {t("personal.lifecycle.lockNotice")}
          </p>
        </section>
      )}
      {error && (
        <p role="alert" className="my-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="my-3 text-sm text-emerald-800">
          {notice}
        </p>
      )}
      <section className="mt-5" aria-label={t("personal.ui.scores")}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-bold">{t(editable ? "personal.enterScores" : "personal.ui.scores")}</h2>
          {editable && <p className="text-xs text-primary/70" role="status">{t("personal.ui.progress", { n: holes.filter(h => h.completion === "picked_up" || (h.completion === "completed" && Number.isInteger(h.strokes) && h.strokes! >= 1 && h.strokes! <= 30)).length, total: data.tee.hole_count })}</p>}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {[0, ...(data.tee.hole_count === 18 ? [9] : [])].map(start => <div key={start} className="overflow-hidden rounded-2xl border border-primary/10 bg-white">
            <h3 className="bg-primary/5 px-3 py-3 text-sm font-bold">{t("personal.ui.hole")} {start + 1}–{Math.min(start + 9, data.tee.hole_count)}</h3>
            {editable ? <fieldset disabled={busy || (ownerDraft && (!autosave.ready || ['conflict', 'blocked', 'session'].includes(autosave.state.status)))}>
              <legend className="sr-only">{t("personal.ui.hole")} {start + 1}–{start + 9}</legend>
              <div aria-hidden="true" className="grid grid-cols-[28px_40px_1fr_60px] items-center gap-2 border-b border-primary/10 px-3 py-2 text-[11px] text-primary/70"><span>{t("personal.ui.hole")}</span><span>Par /<br />{t("personal.ui.index")}</span><span>{t("personal.ui.state")}</span><span>{t("personal.ui.strokes")}</span></div>
              {data.reference_holes.slice(start, start + 9).map(ref => {
                const h = holes.find(x => x.hole_number === ref.hole_number)!
                return <div key={ref.hole_number} className="grid grid-cols-[28px_40px_1fr_60px] items-center gap-2 border-b border-primary/5 px-3 py-2 last:border-0">
                  <span className="text-sm font-bold">{ref.hole_number}</span>
                  <span className="text-xs text-primary/70">{ref.par} / {ref.stroke_index ?? "—"}</span>
                  <select aria-label={t("personal.holeState", { n: ref.hole_number })} className={`${personalInput} !mt-0 !px-2`} value={h.completion} onChange={e => change(ref.hole_number, { completion: e.target.value as PersonalHole["completion"], strokes: e.target.value === "completed" ? h.strokes ?? ref.par : null })}>
                    <option value="not_played">{t("personal.hole.not_played")}</option>
                    <option value="completed">{t("personal.hole.completed")}</option>
                    <option value="picked_up">{t("personal.hole.picked_up")}</option>
                  </select>
                  {h.completion === "completed" ? <input aria-label={t("personal.holeScore", { n: ref.hole_number })} className={`${personalInput} !mt-0 !px-2 text-center`} type="number" inputMode="numeric" min="1" max="30" step="1" value={h.strokes ?? ""} onChange={e => change(ref.hole_number, { strokes: e.target.value === "" ? null : Number(e.target.value) })} /> : <span className="text-center text-primary/40">—</span>}
                </div>
              })}
            </fieldset> : <table className="w-full text-left text-sm">
              <caption className="sr-only">{t("personal.ui.scores")} · {t("personal.ui.hole")} {start + 1}–{start + 9}</caption>
              <thead className="text-xs text-primary/70"><tr><th scope="col" className="px-3 py-2">{t("personal.ui.hole")}</th><th scope="col">Par</th><th scope="col">{t("personal.ui.index")}</th><th scope="col" className="pr-3 text-right">{t("personal.ui.strokes")}</th></tr></thead>
              <tbody>{data.reference_holes.slice(start, start + 9).map(ref => {
                const h = holes.find(x => x.hole_number === ref.hole_number)!
                return <tr key={ref.hole_number} className="border-t border-primary/5"><th scope="row" className="px-3 py-2 font-semibold">{ref.hole_number}</th><td>{ref.par}</td><td>{ref.stroke_index ?? "—"}</td><td className="pr-3 text-right font-bold">{h.completion === "completed" ? h.strokes ?? "—" : t(`personal.hole.${h.completion}`)}</td></tr>
              })}</tbody>
            </table>}
          </div>)}
        </div>
      </section>
      {ownerDraft && <div className="mt-4 flex flex-wrap gap-2">
        <button
          className={personalButton}
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
          className={personalButton}
          disabled={busy || !complete || !data.tee.ready || !autosave.online || ['offline', 'conflict', 'blocked', 'session', 'invalid', 'storageError'].includes(autosave.state.status)}
          onClick={() =>
            void run(async () => {
              const v = await save()
              personalResult(
                await supabase.rpc("request_personal_validation", {
                  p_round: data.round.id,
                  p_expected_version: v,
                  p_validator: validator || null,
                }),
              )
              await onReload()
              setNotice(t(validator ? "personal.lifecycle.requested" : "personal.confirmed"))
            })
          }
        >
          {t("personal.confirm")}
        </button>
      </div>}
      {validatorReview && (
        <section className="mt-4 space-y-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={present} onChange={(e) => setPresent(e.target.checked)} />{t("personal.present")}</label>
          <button className={personalButton} disabled={busy || !present || !autosave.online} onClick={() => void run(() => review(false))}>{t("personal.approve")}</button>
          <label className="block text-sm">{t("personal.lifecycle.correctionReason")}
            <textarea className={personalInput} maxLength={500} value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} />
          </label>
          <button className={personalButton} disabled={busy || !present || !complete || !autosave.online || correctionReason.trim().length < 3} onClick={() => void run(() => review(true))}>{t("personal.lifecycle.propose")}</button>
        </section>
      )}
      {data.round.status === "pending_player_confirmation" && (
        <section className="my-5 rounded-xl border border-amber-400 p-4">
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
      {data.events.length > 0 && <details className="mt-5 text-sm"><summary>{t("personal.lifecycle.audit")}</summary><ol className="mt-2 space-y-2">{data.events.map((e) => <li key={e.id}>{displayTime(e.occurred_at)} · {t(`personal.event.${e.action}`)}{e.actor_name ? ` · ${e.actor_name}` : ""}{e.metadata.reason ? ` · ${e.metadata.reason}` : ""}</li>)}</ol></details>}
      {ownerDraft && !complete && (
        <p className="mt-2 text-xs text-primary/70">
          {t("personal.incomplete")}
        </p>
      )}
      {data.is_owner && data.round.status !== "disputed" && (ownerDraft || data.revision) && (
        <section className="mt-8">
          <h2 className="font-semibold">{t(ownerDraft ? "personal.lifecycle.draftLeagues" : "personal.submitTitle")}</h2>
          <p className="mt-2 text-sm text-primary/70">
            {t(ownerDraft ? "personal.lifecycle.bootstrap" : "personal.shareNotice")}
          </p>
          <ul className="mt-3 space-y-2">
            {data.leagues.map((g) => (
              <li
                key={g.id}
                className="rounded-2xl border border-primary/10 bg-white p-4"
              >
                <Link
                  href={`/games/${g.id}`}
                  className="font-semibold underline"
                >
                  {g.name}
                </Link>
                {g.submission_status ? (
                  <p className="mt-1 text-sm">{t(personalSubmissionStatusKey(g.submission_status, data.round.status))}</p>
                ) : g.reason ? (
                  <p className="mt-1 text-xs text-amber-800">
                    {t(`personal.reason.${g.reason}`)}
                  </p>
                ) : (
                  <>
                    <p className="my-2 text-xs">
                      {g.attestation === "peer_required"
                        ? t("personal.witnessRequired")
                        : t("personal.selfDeclared")}
                    </p>
                    <button
                      className={personalButton}
                      disabled={busy || !autosave.online}
                      onClick={() =>
                        void run(async () => {
                          const res = personalResult<{
                            success: boolean
                            reason?: string
                          }>(
                            await supabase.rpc("submit_personal_card", {
                              p_round: data.round.id,
                              p_game: g.id,
                            }),
                          )
                          if (!res.success)
                            throw new Error(t(`personal.reason.${res.reason}`))
                          await onReload()
                        })
                      }
                    >
                      {t("personal.submit")}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <Link className="mt-5 inline-block min-h-[44px] py-3 text-sm underline" href={`/games/create?tee=${data.round.tee_id}&start=${data.round.played_on}`}>{t("personal.createLeague")}</Link>
        </section>
      )}
    </main>
  )
}

"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { ValidationTimer } from "./ValidationTimer"
import { personalSubmissionStatusKey } from "@/lib/personalSubmissionStatus"
import { useT } from "@/lib/i18n"
import { supabase } from "@/lib/supabase"
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
  const [holes, setHoles] = useState<PersonalHole[]>(makeHoles)
  const [version, setVersion] = useState(data.round.draft_version)
  const [validator, setValidator] = useState("")
  const [present, setPresent] = useState(false)
  const [correctionReason, setCorrectionReason] = useState("")
  const ownerDraft = data.is_owner && data.round.status === "draft"
  const validatorReview = !data.is_owner && data.round.status === "pending_validation"
  const editable = ownerDraft || validatorReview
  const displayTime = (value: string) => new Date(value).toLocaleString(undefined, { timeZone: data.round.course_timezone })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    setHoles(
      data.reference_holes.map(
        (h) =>
          (data.round.status === "draft" ? data.holes : data.revision?.scores ?? data.holes).find((s) => s.hole_number === h.hole_number) ?? {
            hole_number: h.hole_number,
            completion: "not_played",
            strokes: null,
          },
      ),
    )
    setVersion(data.round.draft_version)
  }, [data])
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : t("personal.loadError"))
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    const res = personalResult<{ draft_version: number }>(
      await supabase.rpc("save_personal_card", {
        p_round: data.round.id,
        p_holes: holesAsJson(holes),
        p_expected_version: version,
      }),
    )
    setVersion(res.draft_version)
    return res.draft_version
  }
  const change = (n: number, patch: Partial<PersonalHole>) =>
    setHoles((prev) =>
      prev.map((h) => (h.hole_number === n ? { ...h, ...patch } : h)),
    )
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
      <p className="mt-3 text-sm">
        {t("personal.handicapSnapshot")}: {data.round.handicap_index} (
        {t(`personal.source.${data.round.handicap_source}`)})
      </p>
      <section className="my-4 rounded-xl border border-primary/20 p-4" aria-label={t("personal.lifecycle.title")}>
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
        <section className="my-4 rounded-xl border border-primary/15 bg-cream/40 p-4">
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
      <fieldset disabled={busy || !editable} className="mt-5 space-y-3">
        <legend className="mb-3 font-semibold">
          {t("personal.enterScores")}
        </legend>
        {data.reference_holes.map((ref) => {
          const h = holes.find((x) => x.hole_number === ref.hole_number)!
          return (
            <div
              key={ref.hole_number}
              className="rounded-xl border border-primary/15 p-3"
            >
              <p className="mb-2 text-sm font-semibold">
                {t("personal.hole", { n: ref.hole_number })} · Par {ref.par} ·
                Index {ref.stroke_index ?? "—"}
              </p>
              <div className="flex gap-2">
                <label className="flex-1">
                  <span className="sr-only">
                    {t("personal.holeState", { n: ref.hole_number })}
                  </span>
                  <select
                    aria-label={t("personal.holeState", { n: ref.hole_number })}
                    className={personalInput}
                    value={h.completion}
                    onChange={(e) =>
                      change(ref.hole_number, {
                        completion: e.target
                          .value as PersonalHole["completion"],
                        strokes:
                          e.target.value === "completed"
                            ? (h.strokes ?? ref.par)
                            : null,
                      })
                    }
                  >
                    <option value="not_played">
                      {t("personal.hole.not_played")}
                    </option>
                    <option value="completed">
                      {t("personal.hole.completed")}
                    </option>
                    <option value="picked_up">
                      {t("personal.hole.picked_up")}
                    </option>
                  </select>
                </label>
                {h.completion === "completed" && (
                  <label className="w-24">
                    <span className="sr-only">
                      {t("personal.holeScore", { n: ref.hole_number })}
                    </span>
                    <input
                      aria-label={t("personal.holeScore", {
                        n: ref.hole_number,
                      })}
                      className={personalInput}
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="30"
                      step="1"
                      value={h.strokes ?? ""}
                      onChange={(e) =>
                        change(ref.hole_number, {
                          strokes:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                )}
              </div>
            </div>
          )
        })}
      </fieldset>
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
          disabled={busy || !complete || !data.tee.ready}
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
          <button className={personalButton} disabled={busy || !present} onClick={() => void run(() => review(false))}>{t("personal.approve")}</button>
          <label className="block text-sm">{t("personal.lifecycle.correctionReason")}
            <textarea className={personalInput} maxLength={500} value={correctionReason} onChange={(e) => setCorrectionReason(e.target.value)} />
          </label>
          <button className={personalButton} disabled={busy || !present || !complete || correctionReason.trim().length < 3} onClick={() => void run(() => review(true))}>{t("personal.lifecycle.propose")}</button>
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
                className="rounded-xl border border-primary/15 p-3"
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
                      disabled={busy}
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

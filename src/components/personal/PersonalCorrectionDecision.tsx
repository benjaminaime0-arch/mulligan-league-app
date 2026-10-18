"use client"
import { useEffect, useRef, useState } from "react"
import { ConfirmModal } from "@/components/ConfirmModal"
import { useT } from "@/lib/i18n"
import { supabase } from "@/lib/supabase"
import { correctionComparison } from "@/lib/personalCardFlow"
import { personalButton, personalResult, type PersonalCard, type PersonalHole } from "@/lib/personalRounds"

export function PersonalCorrectionDecision({ data, online, busy, onBusyChange, onReload, onResolved }: {
  data: PersonalCard; online: boolean; busy: boolean; onBusyChange: (value: boolean) => void;
  onReload: () => Promise<void>; onResolved: (accepted: boolean) => void
}) {
  const t = useT()
  const [choice, setChoice] = useState<{ accept: boolean; revision: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const flight = useRef(false)
  const comparison = correctionComparison(data.revision, data.revisions)
  const canDecide = data.is_owner && data.round.status === "pending_player_confirmation" && !!data.revision && comparison !== null && comparison.length > 0
  useEffect(() => { setChoice(null); setError(null) }, [data.round.id, data.revision?.id, data.round.status])
  const proposedBy = data.events.filter(event => event.action === "correction_proposed").at(-1)?.actor_name
  const score = (hole: PersonalHole) => hole.completion === "completed" ? hole.strokes ?? "—" : t(`personal.hole.${hole.completion}`)
  const changes = comparison && comparison.length > 0 ? <div className="my-3 overflow-hidden rounded-xl bg-sage/20">
    <h3 className="px-3 pt-3 text-xs font-bold">{t("validation.changes", { n: comparison.length })}</h3>
    <div className="grid grid-cols-3 gap-2 px-3 py-2 text-xs text-primary/65"><span>{t("personal.ui.hole")}</span><span>{t("correction.before")}</span><span>{t("correction.after")}</span></div>
    <ul>{comparison.map(change => <li key={change.after.hole_number} className="grid grid-cols-3 items-center gap-2 border-t border-primary/10 px-3 py-2 text-sm"><span>{change.after.hole_number}</span><span>{score(change.before)}</span><strong>{score(change.after)}</strong></li>)}</ul>
  </div> : null
  const decide = async () => {
    if (!choice || !canDecide || choice.revision !== data.revision?.id || !online || busy || flight.current) return
    flight.current = true; onBusyChange(true); setError(null)
    try {
      const result = personalResult<{ success: boolean }>(await supabase.rpc("resolve_personal_correction", {
        p_round: data.round.id, p_revision: choice.revision, p_accept: choice.accept,
      }))
      if (!result.success) throw new Error("decision_failed")
      await onReload()
      onResolved(choice.accept)
      setChoice(null)
    } catch {
      setChoice(null)
      setError(t("correction.retry"))
      // A lost acknowledgement may already have settled the card. Refresh before retrying.
      await onReload().catch(() => {})
    } finally { flight.current = false; onBusyChange(false) }
  }
  const choose = (accept: boolean) => {
    if (canDecide && online && !busy && data.revision) setChoice({ accept, revision: data.revision.id })
  }
  return <section id="player-correction" className="app-surface my-4 scroll-mt-20 p-4" aria-labelledby="player-correction-title">
    <h2 id="player-correction-title" className="font-bold">{t(data.is_owner ? "correction.title" : "correction.sentTitle")}</h2>
    {proposedBy && <p className="mt-1 break-words text-xs text-primary/65">{t("correction.proposedBy", { name: proposedBy })}</p>}
    {data.revision?.correction_reason && <div className="mt-3"><p className="text-xs text-primary/60">{t("correction.reason")}</p><p className="mt-1 break-words text-sm">{data.revision.correction_reason}</p></div>}
    {changes || <p role="status" className="my-3 text-sm text-amber-800">{t("correction.missingComparison")}</p>}
    {data.is_owner && <>
      <div className="mb-3 space-y-2 text-xs leading-relaxed text-primary/70">
        <p>{t("correction.acceptNotice")}</p>
        <p>{t("correction.refusalHint")}</p>
      </div>
      <button type="button" className={`${personalButton} mt-1 w-full`} disabled={!canDecide || busy || !online} onClick={() => choose(true)}>{t("correction.accept")}</button>
      <button type="button" className="mt-2 min-h-[48px] w-full rounded-xl border border-red-700/30 px-4 py-3 text-sm font-semibold text-red-800 disabled:opacity-50" disabled={!canDecide || busy || !online} onClick={() => choose(false)}>{t("correction.refuse")}</button>
      {!online && <p role="status" className="mt-2 text-xs text-amber-800">{t("personal.offline.confirmOnline")}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </>}
    <ConfirmModal focusTitle open={!!choice && canDecide && choice.revision === data.revision?.id} title={t(choice?.accept ? "correction.confirmAccept" : "correction.confirmRefuse")} message={t(choice?.accept ? "correction.acceptNotice" : "correction.refuseNotice")} confirmLabel={t(choice?.accept ? "correction.accept" : "correction.confirmRefuseAction")} cancelLabel={t("correction.back")} destructive={choice?.accept === false} loading={busy} confirmDisabled={!online || !canDecide || choice?.revision !== data.revision?.id} onCancel={() => setChoice(null)} onConfirm={() => void decide()}>
      <p className="mt-3 text-sm font-semibold">{data.tee.course_name} · {t("personal.picker.holeCount", { n: data.tee.hole_count })}</p>
      <p className="mt-1 text-xs text-primary/65">{data.round.played_on} · {t("personal.confirmedRevision", { n: data.revision?.revision_number ?? 0 })}</p>
      {choice?.revision === data.revision?.id && changes}
    </ConfirmModal>
  </section>
}

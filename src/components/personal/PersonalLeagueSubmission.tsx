"use client"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ConfirmModal } from "@/components/ConfirmModal"
import { AppIcon } from "@/components/ui/AppIcon"
import { useT } from "@/lib/i18n"
import { supabase } from "@/lib/supabase"
import { groupCardLeagues, selectedCardLeagues, type CardLeague } from "@/lib/personalCardFlow"
import { personalButton, personalResult, type PersonalCard } from "@/lib/personalRounds"
import { personalSubmissionStatusKey } from "@/lib/personalSubmissionStatus"
import { track } from "@/lib/analytics"

type BatchResponse = { success: boolean; reason?: string; submitted_count: number; results?: { game_id: string; reason?: string; success?: boolean; unchanged?: boolean }[] }
export function PersonalLeagueSubmission({ data, online, busy, onBusyChange, onReload }: {
  data: PersonalCard; online: boolean; busy: boolean; onBusyChange: (busy: boolean) => void; onReload: () => Promise<void>
}) {
  const t = useT()
  const [selected, setSelected] = useState<string[]>([])
  const [confirmation, setConfirmation] = useState<{ ids: string[]; revision: string; names: string[] } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const flight = useRef(false)
  const groups = groupCardLeagues(data.leagues)
  const chosen = selectedCardLeagues(data.leagues,selected)
  const draft = data.round.status === "draft"
  useEffect(() => { setSelected([]); setConfirmation(null) }, [data.round.id,data.revision?.id])
  const submit = async () => {
    if (!confirmation || flight.current || busy || !online) return
    flight.current = true; onBusyChange(true); setError(null); setMessage(null)
    try {
      const result = personalResult<BatchResponse>(await supabase.rpc("submit_personal_card_to_leagues", {
        p_round: data.round.id, p_games: confirmation.ids, p_revision: confirmation.revision,
      }))
      if (!result.success) {
        const reasons = result.results?.map(row => `${data.leagues.find(g => g.id === row.game_id)?.name ?? ""} · ${t(`personal.reason.${row.reason}`)}`) ?? []
        setError(result.reason === "card_changed" ? t("cardFlow.cardChanged") : [t("cardFlow.noneSent"),...reasons].join(" "))
      } else {
        // The RPC returns one status per league; only newly accepted writes count.
        result.results?.filter(row => row.success && row.unchanged === false).forEach(row => track("league_card_submitted", { league_id: row.game_id }))
        setSelected([])
        setMessage(t(result.submitted_count === 1 ? "cardFlow.sentOne" : result.submitted_count ? "cardFlow.sent" : "cardFlow.alreadySent", { n: result.submitted_count }))
      }
      setConfirmation(null)
      await onReload()
    } catch {
      setConfirmation(null); setError(t("cardFlow.retry"))
      // A lost response may already have committed; refresh before offering a retry.
      await onReload().catch(() => {})
    } finally { flight.current = false; onBusyChange(false) }
  }
  const title = (g: CardLeague) => <Link href={`/games/${g.id}`} className="flex min-h-[44px] items-center justify-between gap-2 text-sm font-bold"><span>{g.name}</span><AppIcon name="arrow" className="h-4 w-4 shrink-0" /></Link>
  return <section className="mt-8 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">{t(draft ? "personal.lifecycle.draftLeagues" : "personal.submitTitle")}</h2>
      {!!groups.eligible.length && !draft && <button type="button" className="min-h-[44px] text-xs font-bold underline" disabled={busy || !online} onClick={() => setSelected(chosen.length === Math.min(groups.eligible.length,50) ? [] : groups.eligible.slice(0,50).map(g => g.id))}>{t(chosen.length === Math.min(groups.eligible.length,50) ? "cardFlow.clearSelection" : "cardFlow.selectAll")}</button>}
    </div>
    {draft && <p className="text-xs text-primary/70">{t("personal.lifecycle.bootstrap")}</p>}
    {!draft && !groups.eligible.length && <p className="text-sm text-primary/65">{t("cardFlow.noEligible")}</p>}
    <ul className="space-y-2">{groups.eligible.map(g => <li key={g.id} className={`app-surface flex items-start gap-3 p-4 ${chosen.some(x => x.id === g.id) ? "!border-primary/50 !bg-sage/15" : ""}`}>
      <label className="flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center"><input type="checkbox" aria-label={t("cardFlow.selectLeague", { name: g.name })} checked={chosen.some(x => x.id === g.id)} disabled={busy || !online || draft || (chosen.length >= 50 && !chosen.some(x => x.id === g.id))} className="h-5 w-5 accent-primary" onChange={event => { const checked = event.currentTarget.checked; setMessage(null); setSelected(ids => checked ? [...ids,g.id] : ids.filter(id => id !== g.id)) }} /></label>
      <div className="min-w-0 flex-1">{title(g)}<p className="text-xs text-primary/65">{g.format && t(`personal.format.${g.format}`)} · {t(g.attestation === "peer_required" ? "personal.witnessRequired" : "personal.selfDeclared")}</p></div>
    </li>)}</ul>
    {!!groups.eligible.length && !draft && <button type="button" className={`${personalButton} w-full gap-2`} disabled={busy || !online || !chosen.length || !data.revision} onClick={() => { if (data.revision) setConfirmation({ ids: chosen.map(g => g.id),names: chosen.map(g => g.name),revision: data.revision.id }) }}><AppIcon name="check" className="h-4 w-4" />{t(chosen.length === 1 ? "cardFlow.submitOne" : "cardFlow.submitSelected", { n: chosen.length })}</button>}
    {groups.eligible.length > 50 && <p className="text-xs text-primary/65">{t("cardFlow.selectionLimit")}</p>}
    {!online && <p className="text-xs text-amber-800">{t("personal.offline.confirmOnline")}</p>}
    {message && <p role="status" className="rounded-xl bg-sage/25 p-3 text-sm font-semibold">{message}</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {!!groups.submitted.length && <details className="app-surface p-4" open={!groups.eligible.length}><summary className="cursor-pointer text-sm font-semibold">{t("cardFlow.submitted", { n: groups.submitted.length })}</summary><ul className="mt-2 space-y-2">{groups.submitted.map(g => <li key={g.id}>{title(g)}<p className="mt-1 text-sm">{t(personalSubmissionStatusKey(g.submission_status!,data.round.status))}</p></li>)}</ul></details>}
    {!!groups.incompatible.length && <details className="app-surface p-4"><summary className="cursor-pointer text-sm font-semibold text-primary/65">{t("cardFlow.incompatible", { n: groups.incompatible.length })}</summary><ul className="mt-2 space-y-3">{groups.incompatible.map(g => <li key={g.id}>{title(g)}<p className="text-xs text-amber-800">{t(`personal.reason.${g.reason}`)}</p></li>)}</ul></details>}
    <Link className="inline-flex min-h-[44px] items-center text-sm underline" href={`/games/create?tee=${data.round.tee_id}&start=${data.round.played_on}`}>{t("personal.createLeague")}</Link>
    <ConfirmModal open={!!confirmation} title={t(confirmation?.ids.length === 1 ? "cardFlow.batchOne" : "cardFlow.batchTitle", { n: confirmation?.ids.length ?? 0 })} message={t("cardFlow.batchNotice")} confirmLabel={t("personal.submit")} loading={busy} confirmDisabled={!online} onCancel={() => setConfirmation(null)} onConfirm={() => void submit()}>
      <p className="mt-3 text-sm font-bold">{data.tee.course_name} · {t("personal.picker.holeCount", { n: data.tee.hole_count })}</p><ul className="mt-2 space-y-1 text-sm text-primary/75">{confirmation?.names.map((name,i) => <li key={confirmation.ids[i]}>✓ {name}</li>)}</ul>
    </ConfirmModal>
  </section>
}

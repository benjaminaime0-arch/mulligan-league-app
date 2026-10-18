"use client"
import Link from "next/link"
import { useI18n } from "@/lib/i18n"
import { withLeagueContext } from "@/lib/personalCardFlow"
import { personalSubmissionStatusKey } from "@/lib/personalSubmissionStatus"
import { personalButton, type PersonalLeague } from "@/lib/personalRounds"
import type { leagueCardReturn } from "@/lib/leagueCardReturn"

export function LeagueCardReturnPanel({ league, state, onNew, allowNew = true }: { league: PersonalLeague; state: ReturnType<typeof leagueCardReturn>; allowNew?: boolean; onNew: () => void }) {
  const { t, locale } = useI18n()
  if (state.replacement) return <section className="app-surface my-5 p-5" aria-label={t("cardReturn.title")}>
    <p className="break-words text-sm font-bold">{league.game.name}</p>
    <h2 className="mt-3 text-xl font-bold">{t("cardReturn.replaceTitle")}</h2>
    <p className="mt-2 text-sm leading-relaxed text-primary/70">{t("cardReturn.replaceHint", { n: state.replacement.remaining })}</p>
    <p className="mt-3 text-xs font-semibold">{t("correctionResults.quota", { n: state.replacement.counted, required: state.replacement.required })}</p>
    <p className="mt-2 text-xs leading-relaxed text-primary/70">{t(league.rules.attestation === "peer_required" ? "cardReturn.replacePeer" : "cardReturn.replaceSolo")}</p>
    {state.draft && <p className="mt-3 text-xs text-primary/70">{new Date(`${state.draft.played_on}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })} · {league.tee.name}</p>}
    {state.draft ? <Link href={withLeagueContext(`/rounds/${state.draft.id}`, league.game.id)} className={`${personalButton} mt-4 w-full`}>{t("cardReturn.resume")}</Link> : <button type="button" onClick={onNew} className={`${personalButton} mt-4 w-full`}>{t("cardReturn.another")}</button>}
    {state.draft && allowNew && <button type="button" onClick={onNew} className="mt-2 min-h-[44px] w-full text-xs font-semibold underline">{t("cardReturn.new")}</button>}
  </section>
  const card = state.submission ?? state.draft
  if (!card) return null
  const id = state.submission?.round_id ?? state.draft!.id
  return <section className="app-surface my-5 p-5" aria-label={t("cardReturn.title")}>
    <p className="break-words text-sm font-bold">{league.game.name}</p>
    <h2 className="mt-3 text-xl font-bold">{t(state.submission ? "cardReturn.sentTitle" : "cardReturn.draftTitle")}</h2>
    <p className="mt-2 text-sm leading-relaxed text-primary/70">{t(state.submission ? "cardReturn.sentHint" : "cardReturn.draftHint")}</p>
    <p className="mt-3 text-xs text-primary/70">{new Date(`${card.played_on}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })} · {league.tee.name}</p>
    {state.submission && <p className="mt-2 text-xs font-semibold">{t(personalSubmissionStatusKey(state.submission.status, state.submission.card_status))}</p>}
    <Link href={withLeagueContext(`/rounds/${id}`, league.game.id)} className={`${personalButton} mt-4 w-full`}>{t(state.submission ? "personal.openCard" : "cardReturn.resume")}</Link>
    {allowNew && <button type="button" onClick={onNew} className="mt-2 min-h-[44px] w-full text-xs font-semibold underline">{t(state.submission ? "cardReturn.another" : "cardReturn.new")}</button>}
  </section>
}

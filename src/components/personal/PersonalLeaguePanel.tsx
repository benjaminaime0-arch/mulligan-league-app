"use client"
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { AppIcon } from "@/components/ui/AppIcon"
import { Avatar } from "@/components/Avatar"
import { ScoreSummary } from "./ScoreSummary"
import { leagueDays } from "@/lib/leaguePresentation"
import { useI18n } from "@/lib/i18n"
import { supabase } from "@/lib/supabase"
import { personalSubmissionStatusKey } from "@/lib/personalSubmissionStatus"
import {
  personalResult,
  personalButton,
  type PersonalLeague,
} from "@/lib/personalRounds"
import { PersonalSeasonEnd } from "./PersonalSeasonEnd"
import { PersonalLeagueFriends } from "./PersonalLeagueFriends"
import { leagueHasEnded, sourceLeagueId } from "@/lib/nextLeague"
import { PersonalStandings } from "./PersonalStandings"
import { countedLeagueCards, leagueCardContribution } from "@/lib/personalStandings"
import { GameInviteCode } from "@/app/games/[id]/components/GameInviteCode"
import { LeagueLaunchChecklist } from "./LeagueLaunchChecklist"
import { hasPreparedInvite, leagueActivation, rememberPreparedInvite } from "@/lib/leagueActivation"
import { withLeagueContext } from "@/lib/personalCardFlow"
import { AnalyticsView } from "@/components/AnalyticsView"
export function PersonalLeaguePanel({
  initial,
  userId,
  returningFrom,
}: {
  initial: PersonalLeague
  userId: string
  returningFrom?: string | null
}) {
  const { t, locale } = useI18n()
  const [data, setData] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invitePrepared, setInvitePrepared] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(initial.board.length === 1)
  const refresh = useCallback(async () => {
    const d = personalResult<PersonalLeague | null>(
      await supabase.rpc("get_personal_league", { p_game: initial.game.id }),
    )
    if (d) setData(d)
  }, [initial.game.id])
  useEffect(() => {
    setData(initial)
  }, [initial])
  useEffect(() => {
    setInvitePrepared(hasPreparedInvite(initial.game.id))
    setInviteOpen(initial.board.length === 1)
  }, [initial.game.id, initial.board.length])
  useEffect(() => {
    const target = window.location.hash.slice(1)
    if (!["league-invitation", "league-standings", "league-cards"].includes(target)) return
    if (target === "league-invitation") setInviteOpen(true)
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(target)?.scrollIntoView({ block: "start" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [initial.game.id])
  const ended = leagueHasEnded(data)
  const sourceId = sourceLeagueId(returningFrom)
  const mine = data.board.find(row => row.user_id === userId)
  const ranked = mine?.position != null && mine.rounds_counted > 0
  const remaining = leagueDays(data.game.end_date, data.rules.timezone)
  const date = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })
  const countedCards = data.board.reduce((sum, row) => sum + row.rounds_counted, 0)
  const progress = leagueActivation(data.board.length, countedCards, invitePrepared)
  const cardHref = withLeagueContext(`/rounds?tee=${data.rules.tee_id}`, data.game.id)
  const firstCard = data.board.length > 1 && (mine?.rounds_counted ?? 0) === 0
  const counted = countedLeagueCards(data)
  const currentSubmissions = data.submissions.filter(s => s.status !== "superseded")
  const submittedMine = data.submissions.find(s => s.user_id === userId)
  return (
    <main className="app-page">
      <AnalyticsView event="league_progress_viewed" viewKey={`${data.game.id}.${progress.friendJoined}.${progress.firstCard}`} params={{ league_id: data.game.id, league_stage: progress.activeGroup ? "active_group" : progress.friendJoined ? "group_no_card" : progress.firstCard ? "solo_with_card" : "solo_no_card", friend_joined: Number(progress.friendJoined), first_card_counted: Number(progress.firstCard), active_group: Number(progress.activeGroup), member_count: data.board.length }} />
      <Link href="/games" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-primary/70">← {t("nav.games")}</Link>
      <section className="mt-2 rounded-[20px] bg-primary p-5 text-white">
        <div className="mb-3 flex items-center justify-between gap-3"><AppIcon name="trophy" className="text-sage" /><span className="app-pill bg-white/10 text-sage">{t(ended ? data.closure_status === "finalized" ? "season.final" : "season.provisional" : `personal.closure.${data.closure_status}`)}</span></div>
        <h1 className="break-words text-2xl font-bold leading-tight tracking-tight">{data.game.name}</h1>
        <p className="mt-2 text-xs leading-relaxed text-sage">{data.tee.course_name} · {t("personal.picker.holeCount", { n: data.tee.hole_count })} · {data.tee.name}</p>
        <div className={`${ended ? "mt-3" : "mt-5"} flex items-end justify-between gap-3 border-t border-white/15 pt-4`}>
          <div><div className={`${ended ? "hidden" : "mb-1.5 flex"} items-center`} aria-hidden="true">{data.board.slice(0, 4).map((row, i) => <span key={row.user_id} className={`rounded-full border-2 border-primary ${i ? "-ml-2" : ""}`}><Avatar src={row.avatar_url} alt="" fallback={row.player_name} size={32} className="!bg-sage !text-primary" /></span>)}</div><p className="text-xs text-sage">{t(data.board.length === 1 ? "app.playerOne" : "app.players", { n: data.board.length })}</p></div>
          <div className="text-right"><p className="text-xs text-sage">{t("home.standings")}</p><p className={`mt-1 ${ended ? "text-[28px]" : "text-[40px]"} font-bold leading-none tabular-nums`}>{ranked ? <>{mine!.position}<span className="ml-1 text-sm font-medium text-sage">/ {data.board.length}</span></> : <span className="text-base">{t("app.unranked")}</span>}</p></div>
        </div>
        {data.closure_status === "open" && remaining != null && remaining >= 0 && <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-sage"><AppIcon name="clock" className="h-3.5 w-3.5" />{t(remaining === 0 ? "app.lastDay" : "app.daysLeft", { n: remaining + 1 })}</p>}
      </section>
      <PersonalSeasonEnd data={data} />
      <div className="my-4 flex items-center gap-2"><Link href={ended ? `/games/create?from=${data.game.id}` : cardHref} className={`${personalButton} flex-1 gap-2`}><AppIcon name="plus" className="h-4 w-4" />{t(ended ? "season.next" : firstCard && !submittedMine ? "friend.firstCard" : "personal.addOrSubmit")}</Link><button aria-label={t("personal.refresh")} title={t("personal.refresh")} className="app-surface flex h-12 w-12 shrink-0 items-center justify-center disabled:opacity-50" disabled={busy} onClick={() => { setBusy(true); setError(null); void refresh().catch(e => setError(e.message)).finally(() => setBusy(false)) }}><AppIcon name="refresh" className={busy ? "animate-spin" : ""} /></button></div>
      {(data.closure_status === "open" || data.closure_status === "upcoming") && (firstCard ? <p className="app-surface mb-4 px-4 py-3 text-sm leading-relaxed text-primary/70">{submittedMine ? t(personalSubmissionStatusKey(submittedMine.status, submittedMine.card_status)) : t("friend.cardHint")}</p> : <LeagueLaunchChecklist memberCount={data.board.length} countedCards={countedCards} invitePrepared={invitePrepared} cardHref={cardHref} onInvite={() => setInviteOpen(true)} />)}
      <div className="app-surface mb-5 px-4">
        <details><summary className="cursor-pointer py-3 text-sm font-semibold">{t("personal.ui.rules")}</summary><div className="space-y-2 pb-4 text-xs leading-relaxed text-primary/70"><p>{date(data.game.start_date)} → {date(data.game.end_date)} · {data.rules.timezone ?? "Europe/Paris"}</p><p>{t(`personal.format.${data.rules.format}`)} · {data.rules.duration_months ? t(data.rules.duration_months === 1 ? "personal.calendar.monthOne" : "personal.calendar.months", { n: data.rules.duration_months }) : t("personal.calendar.historical")}</p><p>{t("personal.leagueRules")} · {data.rules.attestation === "peer_required" ? t("personal.witnessRequired") : t("personal.selfDeclared")}</p></div></details>
        {!ended && <details id="league-invitation" open={inviteOpen} onToggle={e => setInviteOpen(e.currentTarget.open)} className="scroll-mt-20 border-t border-primary/10"><summary className="cursor-pointer py-3 text-sm font-semibold">{t("detail.invite")}</summary><div className="pb-4">{sourceId && <PersonalLeagueFriends sourceId={sourceId} gameId={data.game.id} userId={userId} memberIds={data.board.map(row => row.user_id)} onPrepared={() => { rememberPreparedInvite(data.game.id); setInvitePrepared(true) }} />}<GameInviteCode gameId={data.game.id} inviteCode={data.game.invite_code} gameName={data.game.name} variant="bottom" onInvitePrepared={() => { rememberPreparedInvite(data.game.id); setInvitePrepared(true) }} /></div></details>}
      </div>
      <nav aria-label={t("detail.leagueSections")} className="mb-4 flex flex-wrap gap-2"><a href="#league-standings" className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-primary px-4 text-xs font-semibold text-white"><AppIcon name="trophy" className="h-4 w-4" />{t("games.standings.title")}</a><a href="#league-cards" className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-primary/10 bg-white px-4 text-xs font-semibold"><AppIcon name="cards" className="h-4 w-4" />{t("personal.leagueCards")} <span className="text-primary/60">{currentSubmissions.length}</span></a></nav>
      {error && (
        <p role="alert" className="mb-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <div id="league-standings" className="scroll-mt-20"><PersonalStandings data={data} userId={userId} />
      </div><h2 id="league-cards" className="mb-3 mt-6 scroll-mt-20 font-bold">{t("personal.leagueCards")}</h2>
      {data.submissions.length === 0 && <p className="app-surface p-5 text-sm text-primary/70">{t("personal.empty")}</p>}
      <ul className="space-y-3">
        {currentSubmissions.map((s) => (
          <li key={s.id} className="app-surface p-4">
            <div className="mb-3 flex items-center gap-2"><Avatar src={data.board.find(row => row.user_id === s.user_id)?.avatar_url} alt="" fallback={s.player_name} size={36} /><div className="min-w-0"><p className="break-words text-sm font-bold">{s.player_name}</p><p className="mt-0.5 text-xs text-primary/70">{date(s.played_on)}</p></div></div>
            <p className="mb-2 text-sm font-bold">{t(`standings.contribution.${leagueCardContribution(data, s, counted)}`)}</p>
            {leagueCardContribution(data, s, counted) === "reserve" && <p className="mb-2 text-xs text-primary/70">{t("standings.reserveHint")}</p>}
            <p className="app-pill bg-sage/25">
              {t("personal.confirmedRevision", { n: s.revision_number })} ·{" "}
              {t(personalSubmissionStatusKey(s.status, s.card_status))} · {t(`personal.status.${s.card_status}`)}
            </p>
            <div className="my-4 border-y border-primary/10 py-3"><ScoreSummary gross={s.gross_total} net={s.net_total} stableford={s.stableford_points} /></div>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer py-2 text-xs font-semibold">
                {t("personal.reviewCard")}
              </summary>
              <ol className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
                {s.scores.map((h) => (
                  <li key={h.hole_number} className="rounded-xl bg-primary/5 p-2 text-center text-xs">
                    {t("personal.hole", { n: h.hole_number })}:{" "}
                    {h.completion === "picked_up"
                      ? t("personal.hole.picked_up")
                      : h.strokes}
                  </li>
                ))}
              </ol>
            </details>
            {s.reason && (
              <p className="mt-2 text-xs text-primary/70">
                {t(`personal.reason.${s.reason}`)}
              </p>
            )}
            {s.status === "pending" && s.validator_id === userId && (
              <Link href={`/rounds/${s.round_id}`} className="mt-3 inline-flex min-h-[44px] items-center text-xs font-bold underline">{t("personal.lifecycle.reviewValidation")}</Link>
            )}
            {s.user_id === userId && (
              <Link
                href={`/rounds/${s.round_id}`}
                className="mt-2 inline-flex min-h-[44px] items-center gap-2 text-xs font-bold"
              >
                {t("personal.openCard")} <AppIcon name="arrow" className="h-4 w-4" />
              </Link>
            )}
          </li>
        ))}
      </ul>
      {data.submissions.some(s => s.status === "superseded") && <details className="app-surface mt-4 p-4"><summary className="cursor-pointer text-xs font-semibold">{t("standings.history")}</summary><p className="mt-2 text-xs text-primary/70">{t("standings.historyHint")}</p><ul>{data.submissions.filter(s => s.status === "superseded").map(s => <li key={s.id} className="mt-3 break-words text-xs">{s.player_name} · {date(s.played_on)} · {t("personal.confirmedRevision", { n: s.revision_number })} · {t("personal.submission.superseded")}</li>)}</ul></details>}
    </main>
  )
}

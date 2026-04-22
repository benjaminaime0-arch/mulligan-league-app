"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { ConfirmModal } from "@/components/ConfirmModal"
import type {
  League,
  UserLeague,
  MemberWithProfile,
  LeaguePeriod,
  Match,
  LeaderboardRow,
  MatchPlayer,
} from "./types"
import { LeaderboardTable } from "./components/LeaderboardTable"
import { MatchCalendarSection } from "@/components/match/MatchCalendarSection"
import { LeagueInviteCode } from "./components/LeagueInviteCode"
import { DraftGuide } from "./components/DraftGuide"

interface LeaguePageProps {
  params: { id: string }
}

/**
 * Builds the "Stroke Play · Best 3 of 5 cards" tagline shown below
 * the league name on the detail page. Returns null when there's
 * nothing meaningful to show.
 */
function formatSubtitle(league: {
  league_type?: string | null
  scoring_cards_count?: number | null
  total_cards_count?: number | null
}): string | null {
  const parts: string[] = []
  if (league.league_type) {
    parts.push(
      league.league_type
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase()),
    )
  }
  if (league.scoring_cards_count != null) {
    parts.push(
      `Best ${league.scoring_cards_count}${
        league.total_cards_count ? ` of ${league.total_cards_count}` : ""
      } cards`,
    )
  }
  return parts.length > 0 ? parts.join(" · ") : null
}

function StatusChip({ status }: { status: string | null | undefined }) {
  const s = (status || "").toLowerCase()

  // Active is the default/expected state — showing a chip for it is noise.
  // Only surface a chip when the league is in a non-standard state (Draft
  // or Completed) that the user would want to notice at a glance.
  if (s === "active") return null

  if (s === "completed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary/50">
        Completed
      </span>
    )
  }
  // Draft / any other non-active non-completed state
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
      Draft
    </span>
  )
}

export default function LeaguePage({ params }: LeaguePageProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const leagueId = params.id
  const { user, loading: authLoading } = useAuth()

  // Reads once on mount — subsequent changes are not re-applied so
  // the user's tab taps aren't fought. The retired /matches/[id]
  // redirect forwards here with ?match=X; optional ?edit=1 asks us
  // to auto-open the score editor for that match.
  const [focusMatchId, setFocusMatchId] = useState<string | null>(() =>
    searchParams?.get("match") ?? null,
  )
  const [autoEdit, setAutoEdit] = useState<boolean>(
    () => searchParams?.get("edit") === "1",
  )

  // Strip `match` and `edit` from the URL after the child reports
  // they've been consumed so a manual refresh doesn't re-open the
  // editor mid-session. Leaves the rest of any query intact.
  const handleFocusConsumed = useCallback(() => {
    const remaining = new URLSearchParams(searchParams?.toString() ?? "")
    remaining.delete("match")
    remaining.delete("edit")
    const qs = remaining.toString()
    router.replace(`/leagues/${leagueId}${qs ? `?${qs}` : ""}`, {
      scroll: false,
    })
    setFocusMatchId(null)
    setAutoEdit(false)
  }, [leagueId, router, searchParams])

  const [league, setLeague] = useState<League | null>(null)
  const [members, setMembers] = useState<MemberWithProfile[]>([])
  const [currentPeriod, setCurrentPeriod] = useState<LeaguePeriod | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([])

  const [periodMatches, setPeriodMatches] = useState<Match[]>([])
  const [matchPlayersMap, setMatchPlayersMap] = useState<Map<string | number, MatchPlayer[]>>(new Map())
  // Set of match ids where the current user has ANY score row (pending
  // / approved / rejected). Separate from matchPlayersMap because the
  // latter only carries approved scores (those feed the leaderboard).
  // The next-step banner uses this to avoid nagging "Submit your score"
  // on a match the user has already submitted but which is still
  // awaiting approvals.
  const [mySubmittedMatchIds, setMySubmittedMatchIds] = useState<Set<string>>(new Set())

  const [userLeagues, setUserLeagues] = useState<UserLeague[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [startingLeague, setStartingLeague] = useState(false)
  const [showStartConfirm, setShowStartConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletingLeague, setDeletingLeague] = useState(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [leavingLeague, setLeavingLeague] = useState(false)

  // Join request state
  const [requestingJoin, setRequestingJoin] = useState(false)
  const [joinRequestSent, setJoinRequestSent] = useState(false)
  const [joinRequestError, setJoinRequestError] = useState<string | null>(null)

  // Extracted as a useCallback so the inline match card can trigger a
  // re-fetch after mutations (save scores, approve, leave, delete,
  // etc.). `loadData` is the single source of truth for "pull fresh
  // league + matches + players data" — the useEffect below just runs
  // it once on mount.
  const loadData = useCallback(async () => {
    if (!user) return
    const init = async () => {
      try {
        setLoading(true)
        setError(null)

        const [leagueRes, membersRes, periodRes, leaderboardRes, userLeaguesRes] = await Promise.all([
          supabase.from("leagues").select("*").eq("id", leagueId).single(),
          supabase.from("league_members").select("*, profiles(*)").eq("league_id", leagueId),
          supabase
            .from("league_periods")
            .select("*")
            .eq("league_id", leagueId)
            .eq("status", "active")
            .maybeSingle(),
          supabase.rpc("get_leaderboard", { p_league_id: leagueId }),
          supabase
            .from("league_members")
            .select("league_id, leagues(id, name)")
            .eq("user_id", user.id),
        ])

        if (leagueRes.error) throw leagueRes.error
        if (!leagueRes.data) throw new Error("League not found.")

        setLeague(leagueRes.data as League)

        if (membersRes.error) throw membersRes.error
        setMembers((membersRes.data || []) as MemberWithProfile[])

        // Check for existing pending join request
        const { data: existingRequest } = await supabase
          .from("join_requests")
          .select("id")
          .eq("requester_id", user.id)
          .eq("target_type", "league")
          .eq("target_id", leagueId)
          .eq("status", "pending")
          .maybeSingle()
        if (existingRequest) setJoinRequestSent(true)

        // Build user league list for navigation
        if (!userLeaguesRes.error && userLeaguesRes.data) {
          type UserLeagueRow = { league_id: string; leagues: { id: string; name: string } | { id: string; name: string }[] | null }
          const leagueList: UserLeague[] = []
          for (const r of userLeaguesRes.data as unknown as UserLeagueRow[]) {
            if (!r.leagues) continue
            const lg = Array.isArray(r.leagues) ? r.leagues[0] : r.leagues
            if (lg) leagueList.push({ id: lg.id, name: lg.name })
          }
          setUserLeagues(leagueList)
        }

        if (periodRes.error && periodRes.error.code !== "PGRST116") {
          throw periodRes.error
        }
        const active = (periodRes.data as LeaguePeriod | null) ?? null
        setCurrentPeriod(active)

        // Calendar shows ALL matches in this league, not just the
        // active period's. Previously we scoped to `period_id` which
        // hid older/newer matches from the day strip — users couldn't
        // see anything past the current week. Filtering by league_id
        // gives the day strip full league history + future matches;
        // the date picker can now jump to anything in the league.
        {
          const { data: matchesData, error: matchesError } = await supabase
            .from("matches")
            .select("*")
            .eq("league_id", leagueId)
            .order("match_date", { ascending: true })

          if (matchesError) throw matchesError

          const matches = (matchesData || []) as Match[]
          setPeriodMatches(matches)

          if (matches.length > 0) {
            const matchIds = matches.map((m) => m.id)
            const [mpRes, scoresRes, mySubmissionsRes] = await Promise.all([
              supabase
                .from("match_players")
                .select(
                  "match_id, user_id, approved_at, profiles(username, first_name, avatar_url)",
                )
                .in("match_id", matchIds),
              // All scores (any status) for period matches. We used to
              // filter to `approved` here, but the inline match cards
              // now surface per-player status pills (Pending /
              // Approved / Rejected / No score), so we need the full
              // set. The best-N leaderboard calc further below still
              // only consumes approved rows. Also select `holes` so
              // the inline editor can prefill the 9/18 toggle.
              supabase
                .from("scores")
                .select("match_id, user_id, score, holes, status")
                .in("match_id", matchIds),
              // My own submissions at ANY status — powers the banner's
              // "already submitted, don't nag" check.
              supabase
                .from("scores")
                .select("match_id")
                .in("match_id", matchIds)
                .eq("user_id", user.id),
            ])

            if (mySubmissionsRes.data) {
              setMySubmittedMatchIds(
                new Set(
                  (mySubmissionsRes.data as Array<{ match_id: string }>).map(
                    (r) => String(r.match_id),
                  ),
                ),
              )
            }

            // Build a score lookup: match_id+user_id → { score, holes, status }
            // (status drives the per-player pill on the inline card;
            // holes is needed so the inline editor can prefill 9/18).
            const scoreLookup = new Map<
              string,
              { score: number; holes: number | null; status: string }
            >()
            // Collect ONLY approved scores per user for best-N
            // calculation — best-N only ever counts approved cards,
            // otherwise pending submissions would wrongly steal slots.
            const userApprovedScores = new Map<string, Array<{ matchId: string | number; score: number }>>()

            if (scoresRes.data) {
              for (const s of scoresRes.data as Array<{
                match_id: string | number
                user_id: string
                score: number
                holes: number | null
                status: string
              }>) {
                scoreLookup.set(`${s.match_id}:${s.user_id}`, {
                  score: s.score,
                  holes: s.holes,
                  status: s.status,
                })
                if (s.status === "approved") {
                  const arr = userApprovedScores.get(s.user_id) || []
                  arr.push({ matchId: s.match_id, score: s.score })
                  userApprovedScores.set(s.user_id, arr)
                }
              }
            }

            // Determine which match scores are "best N" per player
            const bestMatchIds = new Set<string>() // "matchId:userId" keys
            const scoringCards = leagueRes.data.scoring_cards_count as number | null
            for (const [userId, entries] of Array.from(userApprovedScores)) {
              const sorted = [...entries].sort((a, b) => a.score - b.score)
              const counted = scoringCards ? sorted.slice(0, scoringCards) : sorted
              for (const e of counted) {
                bestMatchIds.add(`${e.matchId}:${userId}`)
              }
            }

            if (mpRes.data) {
              const map = new Map<string | number, MatchPlayer[]>()
              for (const row of mpRes.data as Array<{
                match_id: string | number
                user_id: string
                approved_at: string | null
                profiles: { username?: string | null; first_name?: string | null; avatar_url?: string | null } | null
              }>) {
                const existing = map.get(row.match_id) || []
                const key = `${row.match_id}:${row.user_id}`
                const entry = scoreLookup.get(key)
                existing.push({
                  name: row.profiles?.username || row.profiles?.first_name || "Player",
                  avatar_url: row.profiles?.avatar_url ?? null,
                  user_id: row.user_id,
                  // Score is shown for any status (so "pending 90" is
                  // visible); isBestScore only flips for approved rows.
                  score: entry?.score ?? null,
                  holes: entry?.holes ?? null,
                  status: entry?.status ?? null,
                  approved_at: row.approved_at,
                  isBestScore:
                    entry?.status === "approved" && bestMatchIds.has(key)
                      ? true
                      : undefined,
                })
                map.set(row.match_id, existing)
              }
              setMatchPlayersMap(map)
            }
          }
        }

        if (leaderboardRes.error) throw leaderboardRes.error
        setLeaderboard((leaderboardRes.data || []) as LeaderboardRow[])
      } catch (err) {
        // Supabase PostgrestErrors aren't Error instances — they're
        // plain `{ message, code, details, hint }` objects. A bare
        // `instanceof Error` check misses them and we'd render the
        // generic fallback, hiding the real failure. Dig out the
        // message however we can and log the full payload for DevTools.
        console.error("[LeaguePage] init failed", err)
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === "object" &&
                err !== null &&
                "message" in err &&
                typeof (err as { message?: unknown }).message === "string"
              ? (err as { message: string }).message
              : "Failed to load league."
        setError(msg)
      } finally {
        setLoading(false)
      }
    }

    await init()
  }, [leagueId, user])

  useEffect(() => {
    if (authLoading || !user) return
    loadData()
  }, [authLoading, user, loadData])

  const isAdmin = league && user && league.admin_id === user.id
  const isMember = user && members.some((m) => {
    const profile = m.profiles as { id?: string } | null
    return profile?.id === user.id
  })
  const isLeagueFull = league && league.max_players ? members.length >= league.max_players : false

  const handleRequestJoinLeague = async () => {
    if (!league || !user) return
    setRequestingJoin(true)
    setJoinRequestError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc("request_join_league", {
        p_league_id: league.id,
      })
      if (rpcError) throw rpcError
      const result = data as { success: boolean; error?: string }
      if (!result.success) {
        setJoinRequestError(result.error || "Failed to send request.")
        return
      }
      setJoinRequestSent(true)
    } catch (err) {
      setJoinRequestError(err instanceof Error ? err.message : "Failed to send request.")
    } finally {
      setRequestingJoin(false)
    }
  }

  // League navigation
  const currentLeagueIndex = userLeagues.findIndex((l) => String(l.id) === String(leagueId))
  const prevLeague = currentLeagueIndex > 0 ? userLeagues[currentLeagueIndex - 1] : null
  const nextLeague = currentLeagueIndex >= 0 && currentLeagueIndex < userLeagues.length - 1 ? userLeagues[currentLeagueIndex + 1] : null

  const handleStartLeague = async () => {
    if (!league) return
    setShowStartConfirm(false)
    setStartingLeague(true)
    setError(null)
    try {
      const { error: rpcError } = await supabase.rpc("generate_league_periods", {
        p_league_id: league.id,
      })
      if (rpcError) throw rpcError
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start league.")
    } finally {
      setStartingLeague(false)
    }
  }

  const handleDeleteLeague = async () => {
    if (!league) return
    setShowDeleteConfirm(false)
    setDeletingLeague(true)
    setError(null)
    try {
      const { error: deleteError } = await supabase
        .from("leagues")
        .delete()
        .eq("id", league.id)
      if (deleteError) throw deleteError
      router.push("/leagues")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete league.")
    } finally {
      setDeletingLeague(false)
    }
  }

  const handleLeaveLeague = async () => {
    if (!league || !user) return
    setShowLeaveConfirm(false)
    setLeavingLeague(true)
    setError(null)
    try {
      const { error: leaveError } = await supabase
        .from("league_members")
        .delete()
        .eq("league_id", league.id)
        .eq("user_id", user.id)
      if (leaveError) throw leaveError
      router.push("/leagues")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to leave league.")
    } finally {
      setLeavingLeague(false)
    }
  }

  // --- Rendering ---

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream">
        <p className="text-primary/70">Checking your session…</p>
      </main>
    )
  }

  if (!user) return null

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream">
        <p className="text-primary/70">Loading league…</p>
      </main>
    )
  }

  if (error || !league) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream px-4">
        <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-red-700">
            {error || "We couldn\u2019t find this league."}
          </p>
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="mt-4 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream"
          >
            Back to dashboard
          </button>
        </div>
      </main>
    )
  }

  const isDraft = league.status !== "active" && league.status !== "completed"

  return (
    <main className="min-h-screen bg-cream px-4 pb-6 pt-4">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        {/* Header */}
        <header>
          {/* Title row: prev chevron · title + status chip · next chevron
              The chevrons flank the title so they don't collide with the
              fixed notification bell at top-right on mobile. */}
          <div className="flex items-center justify-center gap-2">
            {prevLeague ? (
              <button
                type="button"
                onClick={() => router.push(`/leagues/${prevLeague.id}`)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-white text-primary hover:bg-primary/5"
                aria-label={`Previous: ${prevLeague.name}`}
                title={prevLeague.name}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
            ) : userLeagues.length > 1 ? (
              <div className="h-8 w-8 shrink-0" />
            ) : null}

            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-2xl font-bold text-primary sm:text-3xl">
                {league.name}
              </h1>
              <StatusChip status={league.status} />
            </div>

            {nextLeague ? (
              <button
                type="button"
                onClick={() => router.push(`/leagues/${nextLeague.id}`)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-white text-primary hover:bg-primary/5"
                aria-label={`Next: ${nextLeague.name}`}
                title={nextLeague.name}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 6 15 12 9 18" /></svg>
              </button>
            ) : userLeagues.length > 1 ? (
              <div className="h-8 w-8 shrink-0" />
            ) : null}
          </div>

          {/* Format line: sits right under the title — e.g. "Stroke Play · Best 3 of 5 cards" */}
          {formatSubtitle(league) && (
            <p className="mt-1 text-center text-[10px] font-semibold uppercase tracking-[0.15em] text-primary/50">
              {formatSubtitle(league)}
            </p>
          )}

          {/* Meta line: course + dates */}
          <div className="mt-1.5 flex items-center justify-center gap-1.5 text-xs text-primary/70">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
            <span>{league.course_name || "Course TBA"}</span>
            {league.start_date && league.end_date && (
              <>
                <span className="text-primary/30">·</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                <span>
                  {new Date(league.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {new Date(league.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </>
            )}
          </div>

          {/* Period progress bar — only when the league is actively
              running and we have both start/end dates. Gives every
              visit a narrative ("Day 6 of 15, 60% through"). */}
          {league.status === "active" && (
            <PeriodProgress
              startDate={league.start_date}
              endDate={league.end_date}
            />
          )}
        </header>

        {/* Draft guide for admins */}
        {isDraft && isAdmin && <DraftGuide />}

        {isDraft && (
          <>
            <div className="flex justify-start">
              <button
                type="button"
                onClick={() => setShowStartConfirm(true)}
                disabled={startingLeague}
                className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {startingLeague ? "Starting…" : "Start League"}
              </button>
            </div>
            <ConfirmModal
              open={showStartConfirm}
              title="Start your league?"
              message="This will generate weekly match periods for your league. Make sure all players have joined before starting."
              confirmLabel="Start League"
              loading={startingLeague}
              onConfirm={handleStartLeague}
              onCancel={() => setShowStartConfirm(false)}
            />
          </>
        )}

        {isAdmin ? (
          <ConfirmModal
            open={showDeleteConfirm}
            title="Delete this league?"
            message="This will permanently delete the league, all matches, scores, and member data. This action cannot be undone."
            confirmLabel="Delete League"
            loading={deletingLeague}
            destructive
            onConfirm={handleDeleteLeague}
            onCancel={() => setShowDeleteConfirm(false)}
          />
        ) : (
          <ConfirmModal
            open={showLeaveConfirm}
            title="Leave this league?"
            message="You will be removed from the league and your scores will remain on record. You can rejoin later with an invite code."
            confirmLabel="Leave League"
            loading={leavingLeague}
            destructive
            onConfirm={handleLeaveLeague}
            onCancel={() => setShowLeaveConfirm(false)}
          />
        )}

        {/* Next-step banner — tells the viewer what the page wants from
            them right now (play a round, submit a score, etc.). Only
            shows up for members; skipped for draft leagues since the
            Start-League CTA already covers that state. */}
        {isMember && league.status === "active" && (
          <NextStepBanner
            userId={user.id}
            leagueId={leagueId}
            periodMatches={periodMatches}
            matchPlayersMap={matchPlayersMap}
            mySubmittedMatchIds={mySubmittedMatchIds}
          />
        )}

        {/* Leaderboard + Matches */}
        <section className="flex flex-col gap-6">
          {/* Format info (Stroke Play · Best 3 of 5 cards) moved to the
              page header, so the Leaderboard card doesn't duplicate it. */}
          <LeaderboardTable
            leaderboard={leaderboard}
            currentUserId={user.id}
            scoringCardsCount={league.scoring_cards_count ?? null}
          />

          {/* Always render when there are any matches in the league,
              even if the active period has ended or isn't set yet.
              Empty draft leagues skip this entirely. */}
          {periodMatches.length > 0 && (
            <MatchCalendarSection
              matches={periodMatches}
              matchPlayersMap={matchPlayersMap}
              currentUserId={user.id}
              // All matches on this page belong to this league.
              resolveLeague={() => league}
              onRefresh={loadData}
              focusMatchId={focusMatchId}
              autoEdit={autoEdit}
              onFocusConsumed={handleFocusConsumed}
              context="league"
            />
          )}
        </section>

        {/* Request to Join (non-member) */}
        {!isMember && !isAdmin && (
          <section className="rounded-xl border border-primary/15 bg-white p-5 text-center shadow-sm">
            {joinRequestSent ? (
              <div className="inline-flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Request pending — waiting for admin approval
              </div>
            ) : isLeagueFull ? (
              <p className="text-sm text-primary/50">This league is full ({members.length}/{league.max_players} players)</p>
            ) : (
              <>
                <p className="mb-3 text-sm text-primary/60">Want to join this league?</p>
                <button
                  type="button"
                  onClick={handleRequestJoinLeague}
                  disabled={requestingJoin}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-cream transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  {requestingJoin ? "Sending request…" : "Request to Join League"}
                </button>
                {joinRequestError && (
                  <p className="mt-2 text-xs text-red-600">{joinRequestError}</p>
                )}
              </>
            )}
          </section>
        )}

        {/* League settings — mirrors the match card pattern: the
            destructive action is a small icon button on the right of
            the action row, not a full-width button inside a Danger
            zone disclosure. The existing ConfirmModal (higher up in
            this file) still handles the "are you sure?" step, so the
            safety check is preserved even though the button itself
            is tiny. Admins see Delete, members see Leave. */}
        {(league.invite_code || isMember || isAdmin) && (
          <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-primary">League settings</h2>

            <div className="flex items-center justify-between gap-3">
              {league.invite_code ? (
                <>
                  <span className="text-xs text-primary/60">Invite code</span>
                  <div className="flex items-center gap-2">
                    <LeagueInviteCode
                      inviteCode={league.invite_code}
                      leagueName={league.name}
                      variant="bottom"
                    />
                    {isAdmin ? (
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(true)}
                        disabled={deletingLeague}
                        aria-label="Delete this league"
                        title="Delete this league"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-60"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /></svg>
                      </button>
                    ) : isMember ? (
                      <button
                        type="button"
                        onClick={() => setShowLeaveConfirm(true)}
                        disabled={leavingLeague}
                        aria-label="Leave this league"
                        title="Leave this league"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-60"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                      </button>
                    ) : null}
                  </div>
                </>
              ) : (isAdmin || isMember) ? (
                <>
                  {/* Fallback: no invite code on this league, but the
                      viewer can still leave / delete. Right-align the
                      icon against a subtle label so it doesn't float
                      alone on the row. */}
                  <span className="text-xs text-primary/60">
                    {isAdmin ? "Admin" : "Member"}
                  </span>
                  {isAdmin ? (
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={deletingLeague}
                      aria-label="Delete this league"
                      title="Delete this league"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-60"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /></svg>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowLeaveConfirm(true)}
                      disabled={leavingLeague}
                      aria-label="Leave this league"
                      title="Leave this league"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-60"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                    </button>
                  )}
                </>
              ) : null}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

/* ── PeriodProgress ────────────────────────────────────── */
/**
 * A thin horizontal progress bar shown under the league header that
 * visualises elapsed time in the league's current period (e.g. Day 6
 * of 15). Nothing fancy — just enough to turn a static header into
 * something that changes every time you open it.
 *
 * Hides itself when either date is missing, or when the period
 * already ended (handled upstream — only rendered for status=active).
 */
function PeriodProgress({
  startDate,
  endDate,
}: {
  startDate?: string | null
  endDate?: string | null
}) {
  if (!startDate || !endDate) return null

  const start = new Date(startDate + "T00:00:00")
  const end = new Date(endDate + "T23:59:59")
  const now = new Date()

  const totalMs = end.getTime() - start.getTime()
  if (totalMs <= 0) return null

  const elapsedMs = Math.min(Math.max(now.getTime() - start.getTime(), 0), totalMs)
  const pct = (elapsedMs / totalMs) * 100

  const msPerDay = 1000 * 60 * 60 * 24
  const totalDays = Math.max(1, Math.ceil(totalMs / msPerDay))
  const dayNumber = Math.min(totalDays, Math.max(1, Math.ceil(elapsedMs / msPerDay)))
  const daysLeft = Math.max(0, totalDays - dayNumber)

  return (
    <div className="mt-3">
      <div className="h-1 w-full overflow-hidden rounded-full bg-primary/10">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-primary/50">
        <span>
          Day {dayNumber} of {totalDays}
        </span>
        <span>
          {daysLeft === 0
            ? "Last day"
            : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
        </span>
      </div>
    </div>
  )
}

/* ── NextStepBanner ────────────────────────────────────── */
/**
 * A single-row pill card that tells the viewer what they owe the
 * league *right now*. The point is to make the league page feel like
 * a to-do list, not a museum — every visit should either have a
 * prompt or a satisfying "you're caught up" confirmation.
 *
 * Priority (first match wins):
 *  1. You have a scheduled match whose date has passed but your score
 *     isn't approved yet → "Submit your score".
 *  2. You have an upcoming match (today or future) → "Play your round".
 *  3. Nothing pending → "You're all caught up".
 *
 * Pending-score detection is approximate: we check whether your score
 * on each past match in matchPlayersMap is null (null means no
 * approved score). False negatives (you've submitted pending and are
 * waiting for others) will show up as "submit your score" — still
 * directs you to the match page where the real state is clearer.
 */
function NextStepBanner({
  userId,
  leagueId,
  periodMatches,
  matchPlayersMap,
  mySubmittedMatchIds,
}: {
  userId: string
  /** Used to build the banner's same-page navigation URL. */
  leagueId: string
  periodMatches: Match[]
  matchPlayersMap: Map<string | number, MatchPlayer[]>
  /**
   * Ids of matches where the viewer has *any* score row (pending,
   * approved, or rejected). Used to skip the "Submit your score"
   * nudge after the viewer has already submitted — otherwise the
   * banner keeps harassing them while their card is pending approval.
   */
  mySubmittedMatchIds: Set<string>
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])

  // Matches where the viewer is a participant. We read player rows
  // from matchPlayersMap since it's already keyed by match id.
  const myMatches = periodMatches.filter((m) => {
    const players = matchPlayersMap.get(m.id) || []
    return players.some((p) => p.user_id === userId)
  })

  // 1. A past match where I haven't submitted a score yet at all.
  // Critically: "haven't submitted" means no score row exists —
  // matchPlayersMap only surfaces approved scores, so we can't rely
  // on it alone (a pending card would look like "no score" and the
  // banner would nag us to re-submit what we already sent).
  const pendingPast = myMatches
    .filter((m) => m.match_date != null && m.match_date < today)
    .filter((m) => !mySubmittedMatchIds.has(String(m.id)))
    .sort((a, b) => (b.match_date || "").localeCompare(a.match_date || ""))
    .map((m) => ({ m }))[0]

  if (pendingPast) {
    const dateLabel = pendingPast.m.match_date
      ? new Date(pendingPast.m.match_date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })
      : "this match"
    return (
      <NextStepRow
        // Jump to this same league page with ?match + ?edit flags —
        // the inline MatchDetailCard picks up the autoEdit intent
        // and opens its editor on mount. We route to the *same*
        // route (just with new params) so it's a client-side nav
        // with no redirect hop.
        href={`/leagues/${leagueId}?match=${pendingPast.m.id}&edit=1`}
        tone="amber"
        icon={
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="9" y1="15" x2="15" y2="15" />
          </svg>
        }
        title="Submit your score"
        subtitle={`${dateLabel} — your card isn't approved yet`}
      />
    )
  }

  // 2. Approvals pending — the viewer is a player in a match that
  // has scores submitted, and their approved_at is still null.
  // Teammates are literally waiting on them; this outranks "play
  // your round" (a softer, forward-looking nudge) but sits below
  // "submit your score" which blocks the match entirely.
  const pendingApproval = myMatches
    .map((m) => {
      if (m.status === "completed" || m.status === "cancelled") return null
      const players = matchPlayersMap.get(m.id) || []
      const me = players.find((p) => p.user_id === userId)
      if (!me) return null
      // Need at least one submitted score on the match — otherwise
      // there's nothing to approve.
      const hasScores = players.some((p) => p.status != null)
      if (!hasScores) return null
      // Already approved? nothing to do.
      if (me.approved_at != null) return null
      return m
    })
    .filter((m): m is Match => m != null)
    // Most recent first so the nudge tracks the latest submission.
    .sort((a, b) => (b.match_date || "").localeCompare(a.match_date || ""))[0]

  if (pendingApproval) {
    const dateLabel = pendingApproval.match_date
      ? new Date(pendingApproval.match_date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })
      : "this match"
    const others = (matchPlayersMap.get(pendingApproval.id) || []).filter(
      (p) => p.user_id !== userId && p.status != null,
    ).length
    return (
      <NextStepRow
        href={`/leagues/${leagueId}?match=${pendingApproval.id}`}
        tone="primary"
        icon={
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        }
        title="Approve scores"
        subtitle={`${dateLabel} — ${others} teammate${others === 1 ? "" : "s"} waiting on you`}
      />
    )
  }

  // 3. Upcoming match I haven't submitted yet. Same rationale as
  // pendingPast: if I've already sent a score for my next scheduled
  // match (it can happen on the match day itself), don't keep telling
  // me to "play" it.
  const upcoming = myMatches
    .filter((m) => m.status !== "completed" && (!m.match_date || m.match_date >= today))
    .filter((m) => !mySubmittedMatchIds.has(String(m.id)))
    .sort((a, b) => (a.match_date || "").localeCompare(b.match_date || ""))[0]

  if (upcoming) {
    const dateLabel = upcoming.match_date
      ? new Date(upcoming.match_date).toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        })
      : "TBA"
    return (
      <NextStepRow
        // Jump in place: league URL with ?match so the carousel
        // seeks to the right card. No ?edit because "Play your
        // round" isn't a score-entry action — it's a reminder.
        href={`/leagues/${leagueId}?match=${upcoming.id}`}
        tone="primary"
        icon={
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 22V6l6-4 6 4v16" />
            <path d="M4 22h16" />
          </svg>
        }
        title="Play your round"
        subtitle={`${dateLabel}${upcoming.match_time ? ` · ${upcoming.match_time.slice(0, 5)}` : ""}${upcoming.course_name ? ` · ${upcoming.course_name}` : ""}`}
      />
    )
  }

  // 3. Caught up
  return (
    <NextStepRow
      tone="emerald"
      icon={
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      }
      title="You're all caught up"
      subtitle="No pending rounds. Check back when the next match is scheduled."
    />
  )
}

function NextStepRow({
  href,
  tone,
  icon,
  title,
  subtitle,
}: {
  href?: string
  tone: "primary" | "amber" | "emerald"
  icon: React.ReactNode
  title: string
  subtitle: string
}) {
  const toneClasses = {
    primary: "border-primary/15 bg-white",
    amber: "border-amber-200 bg-amber-50",
    emerald: "border-emerald-200 bg-emerald-50/50",
  }[tone]
  const iconToneClasses = {
    primary: "bg-primary/10 text-primary",
    amber: "bg-amber-100 text-amber-700",
    emerald: "bg-emerald-100 text-emerald-700",
  }[tone]

  const body = (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 shadow-sm ${toneClasses}`}>
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconToneClasses}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-primary">{title}</p>
        <p className="mt-0.5 truncate text-[11px] text-primary/60">{subtitle}</p>
      </div>
      {href && (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-primary/40" aria-hidden="true">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      )}
    </div>
  )

  if (href) {
    // Hard <a> (not <Link>) so the CTA bypasses the modal-preview
    // interception and takes the user to the full match page —
    // appropriate for "Submit your score" / "Play your round" where
    // they expect to act, not preview. When the banner's target is a
    // pending-past match we append `?edit=1` so the full page auto-
    // opens the score editor on mount.
    return (
      <a href={href} className="block transition-transform active:scale-[0.99]">
        {body}
      </a>
    )
  }
  return body
}

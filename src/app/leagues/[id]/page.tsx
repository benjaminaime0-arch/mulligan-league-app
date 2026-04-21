"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
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
import { ScheduledMatches } from "./components/ScheduledMatches"
import { LeagueInviteCode } from "./components/LeagueInviteCode"
import { DraftGuide } from "./components/DraftGuide"

interface LeaguePageProps {
  params: { id: string }
}

function StatusChip({ status }: { status: string | null | undefined }) {
  const s = (status || "").toLowerCase()
  if (s === "active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Active
      </span>
    )
  }
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
  const leagueId = params.id
  const { user, loading: authLoading } = useAuth()

  const [league, setLeague] = useState<League | null>(null)
  const [members, setMembers] = useState<MemberWithProfile[]>([])
  const [currentPeriod, setCurrentPeriod] = useState<LeaguePeriod | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([])

  const [periodMatches, setPeriodMatches] = useState<Match[]>([])
  const [matchPlayersMap, setMatchPlayersMap] = useState<Map<string | number, MatchPlayer[]>>(new Map())

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

  useEffect(() => {
    if (authLoading || !user) return

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

        if (active) {
          const { data: matchesData, error: matchesError } = await supabase
            .from("matches")
            .select("*")
            .eq("period_id", active.id)
            .order("match_date", { ascending: true })

          if (matchesError) throw matchesError

          const matches = (matchesData || []) as Match[]
          setPeriodMatches(matches)

          if (matches.length > 0) {
            const matchIds = matches.map((m) => m.id)
            const [mpRes, scoresRes] = await Promise.all([
              supabase
                .from("match_players")
                .select("match_id, user_id, profiles(username, first_name, avatar_url)")
                .in("match_id", matchIds),
              supabase
                .from("scores")
                .select("match_id, user_id, score, status")
                .in("match_id", matchIds)
                .eq("status", "approved"),
            ])

            // Build a score lookup: match_id+user_id → score
            const scoreLookup = new Map<string, number>()
            // Also collect all approved scores per user to determine best-N
            const userScores = new Map<string, Array<{ matchId: string | number; score: number }>>()

            if (scoresRes.data) {
              for (const s of scoresRes.data as Array<{
                match_id: string | number
                user_id: string
                score: number
                status: string
              }>) {
                scoreLookup.set(`${s.match_id}:${s.user_id}`, s.score)
                const arr = userScores.get(s.user_id) || []
                arr.push({ matchId: s.match_id, score: s.score })
                userScores.set(s.user_id, arr)
              }
            }

            // Determine which match scores are "best N" per player
            const bestMatchIds = new Set<string>() // "matchId:userId" keys
            const scoringCards = leagueRes.data.scoring_cards_count as number | null
            for (const [userId, entries] of Array.from(userScores)) {
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
                profiles: { username?: string | null; first_name?: string | null; avatar_url?: string | null } | null
              }>) {
                const existing = map.get(row.match_id) || []
                const key = `${row.match_id}:${row.user_id}`
                const score = scoreLookup.get(key) ?? null
                existing.push({
                  name: row.profiles?.username || row.profiles?.first_name || "Player",
                  avatar_url: row.profiles?.avatar_url ?? null,
                  user_id: row.user_id,
                  score,
                  isBestScore: score != null ? bestMatchIds.has(key) : undefined,
                })
                map.set(row.match_id, existing)
              }
              setMatchPlayersMap(map)
            }
          }
        } else {
          setPeriodMatches([])
        }

        if (leaderboardRes.error) throw leaderboardRes.error
        setLeaderboard((leaderboardRes.data || []) as LeaderboardRow[])
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load league.")
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [leagueId, authLoading, user])

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

          {/* Meta line */}
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

        {/* Leaderboard + Matches */}
        <section className="flex flex-col gap-6">
          <LeaderboardTable
            leaderboard={leaderboard}
            subtitle={[
              league.league_type ? league.league_type.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) : null,
              league.scoring_cards_count != null
                ? `Best ${league.scoring_cards_count}${league.total_cards_count ? ` of ${league.total_cards_count}` : ""} cards`
                : null,
            ].filter(Boolean).join(" · ") || null}
          />

          {currentPeriod && (
            <ScheduledMatches
              matches={periodMatches}
              league={league}
              matchPlayersMap={matchPlayersMap}
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

        {/* League settings */}
        {(league.invite_code || isMember || isAdmin) && (
          <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-primary">League settings</h2>

            {league.invite_code && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-primary/60">Invite code</span>
                <LeagueInviteCode inviteCode={league.invite_code} leagueName={league.name} variant="bottom" />
              </div>
            )}

            {(isAdmin || isMember) && (
              <div className={`${league.invite_code ? "mt-4 border-t border-primary/10 pt-4" : ""}`}>
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={deletingLeague}
                    className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-red-500 hover:bg-red-50 disabled:opacity-60"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /></svg>
                    {deletingLeague ? "Deleting\u2026" : "Delete this league"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowLeaveConfirm(true)}
                    disabled={leavingLeague}
                    className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-red-500 hover:bg-red-50 disabled:opacity-60"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                    {leavingLeague ? "Leaving\u2026" : "Leave this league"}
                  </button>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  )
}

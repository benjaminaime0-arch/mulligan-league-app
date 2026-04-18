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
      router.push("/leagues/list")
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
      router.push("/leagues/list")
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
        <header className="text-center">
          <div className="flex items-center justify-center gap-3">
            {prevLeague ? (
              <button
                type="button"
                onClick={() => router.push(`/leagues/${prevLeague.id}`)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/20 bg-white text-primary hover:bg-primary/5"
                title={prevLeague.name}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
            ) : userLeagues.length > 1 ? (
              <div className="h-8 w-8" />
            ) : null}
            <h1 className="text-2xl font-bold text-primary">{league.name}</h1>
            {nextLeague ? (
              <button
                type="button"
                onClick={() => router.push(`/leagues/${nextLeague.id}`)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/20 bg-white text-primary hover:bg-primary/5"
                title={nextLeague.name}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 6 15 12 9 18" /></svg>
              </button>
            ) : userLeagues.length > 1 ? (
              <div className="h-8 w-8" />
            ) : null}
          </div>
          <p className="mt-1 text-sm text-primary/70">
            {league.course_name || "Course TBA"}
            {currentPeriod?.start_date && currentPeriod?.end_date
              ? ` · ${new Date(currentPeriod.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(currentPeriod.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
              : ""}
          </p>
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

        {/* Invite code */}
        {league.invite_code && (
          <LeagueInviteCode inviteCode={league.invite_code} leagueName={league.name} variant="bottom" />
        )}

        {/* Delete / Leave */}
        <div className="pt-4 text-center">
          {isAdmin ? (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deletingLeague}
              className="text-xs text-red-400 underline-offset-4 hover:text-red-600 hover:underline disabled:opacity-60"
            >
              {deletingLeague ? "Deleting\u2026" : "Delete this league"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowLeaveConfirm(true)}
              disabled={leavingLeague}
              className="text-xs text-red-400 underline-offset-4 hover:text-red-600 hover:underline disabled:opacity-60"
            >
              {leavingLeague ? "Leaving\u2026" : "Leave this league"}
            </button>
          )}
        </div>
      </div>
    </main>
  )
}

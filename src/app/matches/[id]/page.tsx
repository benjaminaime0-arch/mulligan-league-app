"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import type { Match, MatchPlayerWithProfile, Score, MatchApproval } from "./types"
import { PlayersTable } from "./components/PlayersTable"
import { ScoreSubmitForm } from "./components/ScoreSubmitForm"
import { InviteCodeSection } from "./components/InviteCodeSection"

interface MatchPageProps {
  params: { id: string }
}

export default function MatchPage({ params }: MatchPageProps) {
  const router = useRouter()
  const matchId = params.id
  const { user, loading: authLoading } = useAuth()

  const [match, setMatch] = useState<Match | null>(null)
  const [players, setPlayers] = useState<MatchPlayerWithProfile[]>([])
  const [scores, setScores] = useState<Score[]>([])
  const [approvals, setApprovals] = useState<MatchApproval[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingMatch, setDeletingMatch] = useState(false)
  const [joiningMatch, setJoiningMatch] = useState(false)
  const [isLeagueMember, setIsLeagueMember] = useState(false)
  const [approvingScores, setApprovingScores] = useState(false)

  useEffect(() => {
    if (authLoading || !user) return

    const init = async () => {
      try {
        setLoading(true)
        setError(null)

        const [matchRes, playersRes, scoresRes] = await Promise.all([
          supabase
            .from("matches")
            .select("*, leagues(*)")
            .eq("id", matchId)
            .single(),
          supabase
            .from("match_players")
            .select("*, profiles(*)")
            .eq("match_id", matchId),
          supabase.from("scores").select("*").eq("match_id", matchId),
        ])

        if (matchRes.error) throw matchRes.error
        if (!matchRes.data) throw new Error("Match not found.")

        setMatch(matchRes.data as Match)

        if (playersRes.error) throw playersRes.error
        setPlayers((playersRes.data || []) as MatchPlayerWithProfile[])

        if (scoresRes.error) throw scoresRes.error
        setScores((scoresRes.data || []) as Score[])

        // Fetch approvals
        const { data: approvalsData } = await supabase
          .from("match_approvals")
          .select("*")
          .eq("match_id", matchId)
        setApprovals((approvalsData || []) as MatchApproval[])

        // Check if current user is a member of this match's league
        if (matchRes.data.league_id) {
          const { data: membership } = await supabase
            .from("league_members")
            .select("id")
            .eq("league_id", matchRes.data.league_id)
            .eq("user_id", user.id)
            .maybeSingle()
          setIsLeagueMember(!!membership)
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load match details.",
        )
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [matchId, authLoading, user])

  const memberDisplayName = (player: MatchPlayerWithProfile) => {
    const profile = player.profiles
    return (
      profile?.username ||
      profile?.full_name ||
      [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
      "Player"
    )
  }

  const scoresByUserId = useMemo(() => {
    const map = new Map<string, Score>()
    for (const s of scores) {
      map.set(s.user_id, s)
    }
    return map
  }, [scores])

  // Existing scores as a simple user_id → score number map for the form
  const existingScoresMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of scores) {
      map.set(s.user_id, s.score)
    }
    return map
  }, [scores])

  const currentUserIsPlayer =
    !!user && players.some((p) => p.user_id === user.id)

  const currentUserHasApproved =
    !!user && approvals.some((a) => a.user_id === user.id)

  const allPlayersHaveScores =
    players.length > 0 && players.every((p) => scoresByUserId.has(p.user_id))

  const allScoresApproved =
    allPlayersHaveScores &&
    players.every((p) => {
      const score = scoresByUserId.get(p.user_id)
      return score?.status === "approved"
    })

  const refreshMatchData = async () => {
    const [scoresRes, approvalsRes] = await Promise.all([
      supabase.from("scores").select("*").eq("match_id", matchId),
      supabase.from("match_approvals").select("*").eq("match_id", matchId),
    ])
    if (!scoresRes.error) setScores((scoresRes.data || []) as Score[])
    if (!approvalsRes.error) setApprovals((approvalsRes.data || []) as MatchApproval[])
  }

  const handleSubmitAllScores = async (
    scoreEntries: Array<{ user_id: string; score: number; holes: number }>
  ) => {
    if (!user || !match) return

    const { data, error: rpcError } = await supabase.rpc("submit_match_scores", {
      p_match_id: match.id,
      p_scores: JSON.stringify(scoreEntries),
    })

    if (rpcError) throw rpcError

    const result = data as { success: boolean; error?: string }
    if (!result.success) {
      throw new Error(result.error || "Failed to submit scores")
    }

    await refreshMatchData()
  }

  const handleApproveMatchScores = async () => {
    if (!user || !match) return
    setApprovingScores(true)
    setError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc("approve_match_scores", {
        p_match_id: match.id,
      })

      if (rpcError) throw rpcError

      const result = data as { success: boolean; error?: string }
      if (!result.success) {
        setError(result.error || "Could not approve scores.")
        return
      }

      await refreshMatchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve scores.")
    } finally {
      setApprovingScores(false)
    }
  }

  const MAX_MATCH_PLAYERS = 4
  const canJoinMatch =
    !!user &&
    !currentUserIsPlayer &&
    isLeagueMember &&
    players.length < MAX_MATCH_PLAYERS &&
    match?.status !== "completed" &&
    match?.status !== "cancelled"

  const handleJoinMatch = async () => {
    if (!user || !match) return
    setJoiningMatch(true)
    setError(null)
    try {
      const { error: joinError } = await supabase
        .from("match_players")
        .insert({ match_id: match.id, user_id: user.id })

      if (joinError) throw joinError

      // Refresh players list
      const { data: updatedPlayers } = await supabase
        .from("match_players")
        .select("*, profiles(*)")
        .eq("match_id", matchId)

      if (updatedPlayers) setPlayers(updatedPlayers as MatchPlayerWithProfile[])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join match.")
    } finally {
      setJoiningMatch(false)
    }
  }

  const isLeagueAdmin = !!user && !!match?.leagues?.admin_id && match.leagues.admin_id === user.id

  const handleDeleteMatch = async () => {
    if (!match || !isLeagueAdmin) return
    if (!window.confirm("Delete this match and all its scores? This cannot be undone.")) return

    setDeletingMatch(true)
    try {
      const { error: delError } = await supabase
        .from("matches")
        .delete()
        .eq("id", match.id)

      if (delError) throw delError

      router.push(`/leagues/${match.league_id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete match.")
      setDeletingMatch(false)
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
        <p className="text-primary/70">Loading match…</p>
      </main>
    )
  }

  if (error && !match) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream px-4">
        <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-red-700">
            {error || "We couldn&apos;t find this match."}
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

  if (!match) return null

  const formatMatchDate = (iso?: string | null) => {
    if (!iso) return "Date TBA"
    const d = new Date(iso)
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    })
  }

  const formatMatchTime = (value?: string | null) => {
    if (!value) return null
    try {
      const [hStr, mStr] = value.split(":")
      const d = new Date()
      d.setHours(Number(hStr), Number(mStr), 0, 0)
      return d.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    } catch {
      return value
    }
  }

  const timeLabel = formatMatchTime(match.match_time || null)
  const isCasual = match.match_type === "casual" || !match.league_id

  return (
    <main className="min-h-screen bg-cream px-4 py-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {/* Header */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary/60">
              {isCasual ? "Casual Match" : match.leagues?.name || "League match"}
            </p>
            <h1 className="mt-1 text-2xl font-bold text-primary">
              {match.course_name || "Course TBA"}
            </h1>
            <p className="mt-1 text-sm text-primary/70">
              {formatMatchDate(match.match_date || null)}
              {timeLabel ? ` · ${timeLabel}` : ""}
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
              <span
                className={`h-2 w-2 rounded-full ${
                  match.status === "completed"
                    ? "bg-emerald-500"
                    : match.status === "cancelled"
                    ? "bg-red-500"
                    : "bg-amber-400"
                }`}
              />
              <span className="uppercase tracking-[0.2em]">
                {(match.status || "scheduled").toString()}
              </span>
            </div>
            <button
              type="button"
              onClick={() => isCasual ? router.push("/dashboard") : router.push(`/leagues/${match.league_id}`)}
              className="text-xs font-medium text-primary/70 underline-offset-4 hover:text-primary hover:underline"
            >
              {isCasual ? "Back to Home" : "Back to League"}
            </button>
          </div>
        </header>

        {/* Invite code for casual matches */}
        {isCasual && match.invite_code && (
          <InviteCodeSection inviteCode={match.invite_code} courseName={match.course_name} />
        )}

        {/* Error banner */}
        {error && (
          <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Players table */}
        <PlayersTable
          players={players}
          scoresByUserId={scoresByUserId}
          approvals={approvals}
          currentUserId={user.id}
          memberDisplayName={memberDisplayName}
        />

        {/* Join match — for league members when there's room */}
        {canJoinMatch && (
          <div className="rounded-xl border border-dashed border-primary/20 bg-white p-5 text-center shadow-sm">
            <p className="mb-3 text-sm text-primary/70">
              This match has open spots ({players.length}/{MAX_MATCH_PLAYERS} players).
            </p>
            <button
              type="button"
              onClick={handleJoinMatch}
              disabled={joiningMatch}
              className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-cream transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60"
            >
              {joiningMatch ? "Joining…" : "Join this Match"}
            </button>
          </div>
        )}

        {/* Score submission / editing — visible to match players */}
        {currentUserIsPlayer && !allScoresApproved && (
          <ScoreSubmitForm
            players={players}
            existingScores={existingScoresMap}
            onSubmit={handleSubmitAllScores}
            memberDisplayName={memberDisplayName}
          />
        )}

        {/* Approve scores — visible when scores exist and user hasn't approved yet */}
        {currentUserIsPlayer && allPlayersHaveScores && !allScoresApproved && !currentUserHasApproved && (
          <section className="rounded-xl border border-primary/15 bg-white p-4 shadow-sm">
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-primary/70">
                Review the scores above. If they look correct, approve them.
              </p>
              <p className="text-xs text-primary/50">
                Scores become official once all {players.length} players approve.
                Unapproved scores are auto-approved after 24 hours.
              </p>
              <button
                type="button"
                onClick={handleApproveMatchScores}
                disabled={approvingScores}
                className="rounded-lg bg-emerald-500 px-6 py-2.5 text-sm font-medium text-white transition-all hover:bg-emerald-600 active:scale-[0.98] disabled:opacity-60"
              >
                {approvingScores ? "Approving…" : "Approve Scores"}
              </button>
            </div>
          </section>
        )}

        {/* Confirmation when user has already approved */}
        {currentUserIsPlayer && allPlayersHaveScores && !allScoresApproved && currentUserHasApproved && (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 text-center shadow-sm">
            <p className="text-sm font-medium text-emerald-700">
              You&apos;ve approved these scores.
            </p>
            <p className="mt-1 text-xs text-emerald-600/70">
              Waiting for {players.length - approvals.length} more player{players.length - approvals.length !== 1 ? "s" : ""} to approve.
            </p>
          </div>
        )}

        {/* All scores approved celebration */}
        {allScoresApproved && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center shadow-sm">
            <p className="text-sm font-semibold text-emerald-800">
              All scores approved and finalized!
            </p>
          </div>
        )}

        {/* Delete match — league admins only */}
        {isLeagueAdmin && (
          <div className="pt-4 text-center">
            <button
              type="button"
              onClick={handleDeleteMatch}
              disabled={deletingMatch}
              className="text-xs text-red-400 underline-offset-4 hover:text-red-600 hover:underline disabled:opacity-60"
            >
              {deletingMatch ? "Deleting…" : "Delete this match"}
            </button>
          </div>
        )}
      </div>
    </main>
  )
}

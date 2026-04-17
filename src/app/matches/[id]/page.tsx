"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import type { Match, MatchPlayerWithProfile, Score } from "./types"
import { PlayersTable } from "./components/PlayersTable"
import { CelebrationCard } from "./components/CelebrationCard"
import { ScoreSubmitForm } from "./components/ScoreSubmitForm"
import { ScoreEditSection } from "./components/ScoreEditSection"
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

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deletingMatch, setDeletingMatch] = useState(false)

  // Celebration state
  const [showCelebration, setShowCelebration] = useState(false)
  const [celebrationScore, setCelebrationScore] = useState<number | null>(null)
  const [celebrationHoles, setCelebrationHoles] = useState<9 | 18>(18)
  const [userAverage, setUserAverage] = useState<number | null>(null)

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

  const currentUserIsPlayer =
    !!user && players.some((p) => p.user_id === user.id)

  const currentUserScore = user ? scoresByUserId.get(user.id) : undefined

  const refreshScores = async () => {
    const { data, error: fetchError } = await supabase
      .from("scores")
      .select("*")
      .eq("match_id", matchId)
    if (!fetchError) setScores((data || []) as Score[])
  }

  const handleSubmitScore = async (numericScore: number, holes: 9 | 18) => {
    if (!user || !match) return

    const { error: insertError } = await supabase.from("scores").insert({
      match_id: match.id,
      user_id: user.id,
      score: numericScore,
      holes,
      status: "pending",
    })

    if (insertError) throw insertError

    await refreshScores()

    // Fetch user's overall average for celebration context
    const { data: allUserScores } = await supabase
      .from("scores")
      .select("score")
      .eq("user_id", user.id)
    if (allUserScores && allUserScores.length > 1) {
      const total = allUserScores.reduce((sum: number, s: { score: number }) => sum + s.score, 0)
      setUserAverage(total / allUserScores.length)
    }

    // Show celebration
    setCelebrationScore(numericScore)
    setCelebrationHoles(holes)
    setShowCelebration(true)
  }

  const handleUpdateScore = async (numericScore: number, holes: 9 | 18) => {
    if (!user || !match || !currentUserScore) return

    const { error: updateError } = await supabase
      .from("scores")
      .update({ score: numericScore, holes, status: "pending", approved_by: null, approved_at: null })
      .eq("id", currentUserScore.id)

    if (updateError) throw updateError

    await refreshScores()
  }

  const handleApproveScore = async (scoreId: string | number) => {
    if (!user) return
    try {
      const { data, error: rpcError } = await supabase.rpc("approve_score", {
        p_score_id: scoreId,
      })

      if (rpcError) throw rpcError

      const result = data as { success: boolean; error?: string }
      if (!result.success) {
        setError(result.error || "Could not approve score.")
        return
      }

      await refreshScores()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve score.")
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

  if (error || !match) {
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

        {/* Players table */}
        <PlayersTable
          players={players}
          scoresByUserId={scoresByUserId}
          currentUserId={user.id}
          currentUserIsPlayer={currentUserIsPlayer}
          approvingScoreId={null}
          onApproveScore={handleApproveScore}
          memberDisplayName={memberDisplayName}
        />

        {/* Celebration after score submission */}
        {showCelebration && celebrationScore != null && (
          <CelebrationCard
            score={celebrationScore}
            holes={celebrationHoles}
            userAverage={userAverage}
            leagueId={match.league_id}
            onDismiss={() => setShowCelebration(false)}
          />
        )}

        {/* Submit score (no existing score) */}
        {currentUserIsPlayer && !currentUserScore && (
          <ScoreSubmitForm onSubmit={handleSubmitScore} />
        )}

        {/* Edit existing score */}
        {currentUserIsPlayer && currentUserScore && !showCelebration && (
          <ScoreEditSection
            currentUserScore={currentUserScore}
            onUpdate={handleUpdateScore}
          />
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

"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"

type Match = {
  id: string | number
  league_id?: string | number | null
  period_id?: string | number | null
  course_name?: string | null
  match_date?: string | null
  match_time?: string | null
  created_by?: string | null
  status?: string | null
  match_type?: string | null
  invite_code?: string | null
  leagues?: {
    id: string | number
    name: string
  } | null
}

type MatchPlayerWithProfile = {
  id: string | number
  match_id: string | number
  user_id: string
  profiles?: {
    id: string
    first_name?: string | null
    last_name?: string | null
    full_name?: string | null
    avatar_url?: string | null
  } | null
}

type Score = {
  id: string | number
  match_id: string | number
  user_id: string
  score: number
  holes: number
  status?: string | null
  approved_by?: string | null
  created_at?: string
}

interface MatchPageProps {
  params: { id: string }
}

export default function MatchPage({ params }: MatchPageProps) {
  const router = useRouter()
  const matchId = params.id

  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  const [match, setMatch] = useState<Match | null>(null)
  const [players, setPlayers] = useState<MatchPlayerWithProfile[]>([])
  const [scores, setScores] = useState<Score[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showScoreForm, setShowScoreForm] = useState(false)
  const [scoreValue, setScoreValue] = useState<string>("")
  const [holes, setHoles] = useState<9 | 18>(18)
  const [submittingScore, setSubmittingScore] = useState(false)
  const [scoreError, setScoreError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [editingScore, setEditingScore] = useState(false)
  const [approvingScoreId, setApprovingScoreId] = useState<string | number | null>(null)

  // Celebration state
  const [showCelebration, setShowCelebration] = useState(false)
  const [celebrationScore, setCelebrationScore] = useState<number | null>(null)
  const [celebrationHoles, setCelebrationHoles] = useState<9 | 18>(18)
  const [userAverage, setUserAverage] = useState<number | null>(null)

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession()
      const session = data.session

      if (!session) {
        router.push("/login")
        return
      }

      setUser(session.user)
      setAuthLoading(false)

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
  }, [matchId, router])

  const memberDisplayName = (player: MatchPlayerWithProfile) => {
    const profile = player.profiles
    const nameFromProfile =
      profile?.full_name ||
      [profile?.first_name, profile?.last_name].filter(Boolean).join(" ")
    return nameFromProfile || "Player"
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

  const handleSubmitScore = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user || !match) return

    setScoreError(null)

    const trimmed = scoreValue.trim()
    const numericScore = Number(trimmed)
    if (!trimmed || Number.isNaN(numericScore) || numericScore <= 0) {
      setScoreError("Enter a valid score.")
      return
    }

    setSubmittingScore(true)
    try {
      const scorePromise = supabase.from("scores").insert({
        match_id: match.id,
        user_id: user.id,
        score: numericScore,
        holes,
        status: "pending",
      })

      await Promise.race([
        scorePromise.then(({ error }) => {
          if (error) throw error
        }),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("Score submission timed out.")), 10000),
        ),
      ])

      const [scoresRes] = await Promise.all([
        supabase.from("scores").select("*").eq("match_id", match.id),
      ])

      if (scoresRes.error) {
        throw scoresRes.error
      }

      setScores((scoresRes.data || []) as Score[])
      setShowScoreForm(false)
      setScoreValue("")

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
    } catch (err) {
      setScoreError(
        err instanceof Error ? err.message : "Failed to submit score. Please try again.",
      )
    } finally {
      setSubmittingScore(false)
    }
  }

  const handleUpdateScore = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user || !match || !currentUserScore) return

    setScoreError(null)
    const trimmed = scoreValue.trim()
    const numericScore = Number(trimmed)
    if (!trimmed || Number.isNaN(numericScore) || numericScore <= 0) {
      setScoreError("Enter a valid score.")
      return
    }

    setSubmittingScore(true)
    try {
      const { error: updateError } = await supabase
        .from("scores")
        .update({ score: numericScore, holes, status: "pending", approved_by: null, approved_at: null })
        .eq("id", currentUserScore.id)

      if (updateError) throw updateError

      const { data: scoresRes, error: fetchError } = await supabase
        .from("scores")
        .select("*")
        .eq("match_id", match.id)
      if (fetchError) throw fetchError

      setScores((scoresRes || []) as Score[])
      setEditingScore(false)
      setScoreValue("")
      setScoreError(null)
    } catch (err) {
      setScoreError(
        err instanceof Error ? err.message : "Failed to update score. Please try again.",
      )
    } finally {
      setSubmittingScore(false)
    }
  }

  const handleApproveScore = async (scoreId: string | number) => {
    if (!user) return
    setApprovingScoreId(scoreId)
    try {
      const { data, error: rpcError } = await supabase.rpc("approve_score", {
        p_score_id: scoreId,
      })

      if (rpcError) throw rpcError

      const result = data as { success: boolean; error?: string }
      if (!result.success) {
        setError(result.error || "Could not approve score.")
        setApprovingScoreId(null)
        return
      }

      // Refresh scores
      const { data: scoresRes, error: fetchError } = await supabase
        .from("scores")
        .select("*")
        .eq("match_id", matchId)
      if (fetchError) throw fetchError

      setScores((scoresRes || []) as Score[])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve score.")
    } finally {
      setApprovingScoreId(null)
    }
  }

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream">
        <p className="text-primary/70">Checking your session…</p>
      </main>
    )
  }

  if (!user) {
    return null
  }

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

  const timeLabel = formatMatchTime(match.match_time || null)
  const isCasual = match.match_type === "casual" || !match.league_id

  const handleCopyCode = async () => {
    if (!match.invite_code) return
    if (typeof navigator === "undefined" || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(match.invite_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <main className="min-h-screen bg-cream px-4 py-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
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

        {/* Invite code section for casual matches */}
        {isCasual && match.invite_code && (
          <section className="rounded-xl border border-primary/15 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary/60">Invite Code</p>
                <p className="mt-1 font-mono text-xl tracking-[0.2em] text-primary">{match.invite_code}</p>
                <p className="mt-1 text-xs text-primary/60">Send this to your playing partners so they can join.</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-cream hover:bg-primary/90"
                >
                  {copied ? "Copied!" : "Copy Code"}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!match.invite_code) return
                    const message = `Join my match at ${match.course_name || "the course"} on Mulligan League! Code: ${match.invite_code}`
                    if (typeof navigator !== "undefined" && navigator.share) {
                      try {
                        await navigator.share({ text: message })
                      } catch {
                        // user cancelled
                      }
                    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
                      try {
                        await navigator.clipboard.writeText(message)
                      } catch {
                        // ignore
                      }
                    }
                  }}
                  className="rounded-lg border border-primary/30 bg-white px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5"
                >
                  Share Invite
                </button>
              </div>
            </div>
          </section>
        )}

        <section className="rounded-xl border border-primary/15 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-primary">Players</h2>
          {players.length === 0 ? (
            <p className="text-sm text-primary/70">No players in this match.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-primary/10 text-xs uppercase tracking-wide text-primary/60">
                    <th className="py-2 pr-4">Player</th>
                    <th className="py-2 pr-4">Score</th>
                    <th className="py-2 pr-4">Holes</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((player) => {
                    const playerScore = scoresByUserId.get(player.user_id)
                    const isOwnScore = user && player.user_id === user.id
                    const isPending = playerScore?.status === "pending"
                    const isApproved = playerScore?.status === "approved"
                    const canApprove = currentUserIsPlayer && !isOwnScore && isPending

                    let statusLabel = "No score"
                    let statusClass = "bg-gray-50 text-gray-500"
                    if (playerScore && isApproved) {
                      statusLabel = "Approved"
                      statusClass = "bg-emerald-50 text-emerald-700"
                    } else if (playerScore && isPending) {
                      statusLabel = "Pending approval"
                      statusClass = "bg-amber-50 text-amber-700"
                    }

                    return (
                      <tr
                        key={player.id}
                        className="border-b border-primary/5 last:border-0"
                      >
                        <td className="py-2 pr-4 text-primary">
                          <div className="flex items-center gap-2">
                            {player.profiles?.avatar_url ? (
                              <img src={player.profiles.avatar_url} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
                            ) : (
                              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary/60">
                                {memberDisplayName(player).charAt(0).toUpperCase()}
                              </div>
                            )}
                            <span>{memberDisplayName(player)}</span>
                          </div>
                        </td>
                        <td className="py-2 pr-4 text-primary">
                          {playerScore ? playerScore.score : "–"}
                        </td>
                        <td className="py-2 pr-4 text-primary">
                          {playerScore ? playerScore.holes : "–"}
                        </td>
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}
                            >
                              {statusLabel}
                            </span>
                            {canApprove && (
                              <button
                                type="button"
                                onClick={() => handleApproveScore(playerScore.id)}
                                disabled={approvingScoreId === playerScore.id}
                                className="rounded-lg bg-emerald-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-60"
                              >
                                {approvingScoreId === playerScore.id ? "Approving…" : "Approve"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Score submission celebration */}
        {showCelebration && celebrationScore != null && (
          <section className="rounded-2xl border border-emerald-200 bg-white p-6 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <svg className="h-8 w-8 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-primary">Score Posted!</h2>
            <p className="mt-1 text-sm text-primary/60">Waiting for another player to approve your score.</p>
            <div className="mt-4 rounded-xl bg-cream p-5">
              <p className="text-4xl font-bold text-primary">{celebrationScore}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.2em] text-primary/60">
                {celebrationHoles} holes
              </p>
            </div>
            {userAverage != null && (
              <p className="mt-3 text-sm text-primary/70">
                {celebrationScore < userAverage
                  ? `${(userAverage - celebrationScore).toFixed(1)} strokes better than your average!`
                  : celebrationScore > userAverage
                  ? `Your average is ${userAverage.toFixed(1)} — keep grinding.`
                  : `Right on your average of ${userAverage.toFixed(1)}.`}
              </p>
            )}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
              {match.league_id && (
                <button
                  type="button"
                  onClick={() => router.push(`/leagues/${match.league_id}`)}
                  className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-cream hover:bg-primary/90"
                >
                  View Leaderboard
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowCelebration(false)}
                className="rounded-lg border border-primary/20 bg-white px-5 py-2.5 text-sm font-medium text-primary hover:bg-primary/5"
              >
                Done
              </button>
            </div>
          </section>
        )}

        {currentUserIsPlayer && !currentUserScore && (
          <section className="rounded-xl border border-primary/15 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-primary">Submit your score</h2>
              {!showScoreForm && (
                <button
                  type="button"
                  onClick={() => setShowScoreForm(true)}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-cream hover:bg-primary/90"
                >
                  Submit Score
                </button>
              )}
            </div>

            {showScoreForm && (
              <form onSubmit={handleSubmitScore} className="space-y-4">
                {scoreError && (
                  <div
                    role="alert"
                    className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
                  >
                    {scoreError}
                  </div>
                )}

                <div>
                  <label
                    htmlFor="score"
                    className="mb-1 block text-sm font-medium text-primary"
                  >
                    Score
                  </label>
                  <input
                    id="score"
                    type="number"
                    min={1}
                    value={scoreValue}
                    onChange={(e) => setScoreValue(e.target.value)}
                    className="w-full rounded-lg border border-primary/30 bg-cream px-4 py-2.5 text-center text-2xl font-semibold text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="72"
                    disabled={submittingScore}
                  />
                </div>

                <div>
                  <p className="mb-1 text-sm font-medium text-primary">Holes</p>
                  <div className="inline-flex rounded-full bg-cream p-1">
                    {[9, 18].map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setHoles(value as 9 | 18)}
                        className={`min-w-[3rem] rounded-full px-3 py-1.5 text-xs font-medium ${
                          holes === value
                            ? "bg-primary text-cream"
                            : "text-primary hover:bg-primary/10"
                        }`}
                        disabled={submittingScore}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={submittingScore}
                    className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submittingScore ? "Submitting…" : "Submit Score"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!submittingScore) {
                        setShowScoreForm(false)
                        setScoreError(null)
                      }
                    }}
                    className="rounded-lg border border-primary/20 bg-white px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {!showScoreForm && (
              <p className="mt-1 text-xs text-primary/60">
                How&apos;d you play? Submit your score below.
              </p>
            )}
          </section>
        )}

        {/* Edit existing score */}
        {currentUserIsPlayer && currentUserScore && !showCelebration && (
          <section className="rounded-xl border border-primary/15 bg-white p-4 shadow-sm">
            {editingScore ? (
              <form onSubmit={handleUpdateScore} className="space-y-4">
                <h2 className="text-sm font-semibold text-primary">Edit your score</h2>
                <p className="text-xs text-primary/60">Editing will reset approval — another player will need to re-approve.</p>
                {scoreError && (
                  <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                    {scoreError}
                  </div>
                )}
                <div>
                  <label htmlFor="edit-score" className="mb-1 block text-sm font-medium text-primary">Score</label>
                  <input
                    id="edit-score" type="number" min={1} value={scoreValue}
                    onChange={(e) => setScoreValue(e.target.value)}
                    className="w-full rounded-lg border border-primary/30 bg-cream px-4 py-2.5 text-center text-2xl font-semibold text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    disabled={submittingScore}
                  />
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium text-primary">Holes</p>
                  <div className="inline-flex rounded-full bg-cream p-1">
                    {[9, 18].map((value) => (
                      <button key={value} type="button" onClick={() => setHoles(value as 9 | 18)}
                        className={`min-w-[3rem] rounded-full px-3 py-1.5 text-xs font-medium ${holes === value ? "bg-primary text-cream" : "text-primary hover:bg-primary/10"}`}
                        disabled={submittingScore}>{value}</button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="submit" disabled={submittingScore}
                    className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream hover:bg-primary/90 disabled:opacity-60">
                    {submittingScore ? "Saving…" : "Save Changes"}
                  </button>
                  <button type="button" onClick={() => { if (!submittingScore) { setEditingScore(false); setScoreError(null) } }}
                    className="rounded-lg border border-primary/20 bg-white px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5">
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/60">Your Score</p>
                  <p className="mt-1 text-lg font-bold text-primary">
                    {currentUserScore.score} <span className="text-sm font-normal text-primary/60">({currentUserScore.holes} holes)</span>
                  </p>
                  <p className="mt-0.5 text-xs text-primary/50">
                    {currentUserScore.status === "approved" ? "Approved" : "Pending approval from another player"}
                  </p>
                </div>
                <button type="button" onClick={() => {
                  setScoreValue(String(currentUserScore.score))
                  setHoles(currentUserScore.holes as 9 | 18)
                  setEditingScore(true)
                }}
                  className="rounded-lg border border-primary/20 bg-white px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5">
                  Edit Score
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  )
}

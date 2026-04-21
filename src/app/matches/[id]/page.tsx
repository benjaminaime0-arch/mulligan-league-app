"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { Avatar } from "@/components/Avatar"
import { ConfirmModal } from "@/components/ConfirmModal"
import { JoinRequestsList, type JoinRequest } from "./components/JoinRequestsList"
import { AdminTransferModal } from "./components/AdminTransferModal"
import { ScoreEditForm } from "./components/ScoreEditForm"
import { ScoreTable } from "./components/ScoreTable"

type Match = {
  id: string | number
  league_id?: string | number | null
  period_id?: string | number | null
  course_name?: string | null
  match_date?: string | null
  match_time?: string | null
  created_by?: string | null
  status?: string | null
  leagues?: {
    id: string | number
    name: string
  } | null
}

type MatchPlayer = {
  id: string | number
  match_id: string | number
  user_id: string
  approved_at?: string | null
  profiles?: {
    id: string
    username?: string | null
    first_name?: string | null
    last_name?: string | null
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
  const [players, setPlayers] = useState<MatchPlayer[]>([])
  const [scores, setScores] = useState<Score[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Score form state
  const [editingAllScores, setEditingAllScores] = useState(false)
  const [allScoreEdits, setAllScoreEdits] = useState<
    Record<string, { score: string; holes: 9 | 18 }>
  >({})
  const [savingAllScores, setSavingAllScores] = useState(false)
  const [scoreError, setScoreError] = useState<string | null>(null)

  const [approvingScores, setApprovingScores] = useState(false)
  const [inviteShared, setInviteShared] = useState(false)

  // Celebration state
  const [showCelebration, setShowCelebration] = useState(false)

  // Leave match state
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [leavingMatch, setLeavingMatch] = useState(false)
  const [showAdminTransfer, setShowAdminTransfer] = useState(false)
  const [selectedNewAdmin, setSelectedNewAdmin] = useState<string | null>(null)

  // Delete match state
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deletingMatch, setDeletingMatch] = useState(false)

  // Join request state
  const [requestingJoin, setRequestingJoin] = useState(false)
  const [joinRequestSent, setJoinRequestSent] = useState(false)
  const [joinRequestError, setJoinRequestError] = useState<string | null>(null)
  const [isLeagueMember, setIsLeagueMember] = useState(false)

  // Pending join requests (admin view)
  const [pendingRequests, setPendingRequests] = useState<JoinRequest[]>([])
  const [approvingRequestId, setApprovingRequestId] = useState<string | null>(null)
  const [rejectingRequestId, setRejectingRequestId] = useState<string | null>(null)

  // ── Data fetching ─────────────────────────────────────────────
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
            .select("*, profiles(id, username, first_name, last_name, avatar_url)")
            .eq("match_id", matchId),
          supabase.from("scores").select("*").eq("match_id", matchId),
        ])

        if (matchRes.error) throw matchRes.error
        if (!matchRes.data) throw new Error("Match not found.")

        setMatch(matchRes.data as Match)

        if (playersRes.error) throw playersRes.error
        setPlayers((playersRes.data || []) as MatchPlayer[])

        if (scoresRes.error) throw scoresRes.error
        setScores((scoresRes.data || []) as Score[])

        // Check if user is a league member (for showing Join Match button)
        const matchData = matchRes.data as Match
        if (matchData.league_id) {
          const { data: membership } = await supabase
            .from("league_members")
            .select("id")
            .eq("league_id", matchData.league_id)
            .eq("user_id", session.user.id)
            .maybeSingle()
          setIsLeagueMember(!!membership)
        }

        // Check if user already has a pending join request
        const { data: existingRequest } = await supabase
          .from("join_requests")
          .select("id")
          .eq("requester_id", session.user.id)
          .eq("target_type", "match")
          .eq("target_id", matchId)
          .eq("status", "pending")
          .maybeSingle()
        if (existingRequest) setJoinRequestSent(true)

        // If user is the match creator, fetch pending join requests
        if ((matchRes.data as Match).created_by === session.user.id) {
          const { data: pendingReqs } = await supabase
            .from("join_requests")
            .select("id, requester_id, created_at")
            .eq("target_type", "match")
            .eq("target_id", matchId)
            .eq("status", "pending")
            .order("created_at", { ascending: true })

          if (pendingReqs && pendingReqs.length > 0) {
            const requesterIds = pendingReqs.map((r: { requester_id: string }) => r.requester_id)
            const { data: profiles } = await supabase
              .from("profiles")
              .select("id, username, first_name, avatar_url")
              .in("id", requesterIds)

            const profileMap = new Map(
              (profiles || []).map((p: { id: string; username?: string | null; first_name?: string | null; avatar_url?: string | null }) => [p.id, p])
            )

            setPendingRequests(
              pendingReqs.map((r: { id: string; requester_id: string; created_at: string }) => {
                const prof = profileMap.get(r.requester_id) as { username?: string | null; first_name?: string | null; avatar_url?: string | null } | undefined
                return {
                  id: r.id,
                  requester_id: r.requester_id,
                  requester_name: prof?.username || prof?.first_name || "Someone",
                  requester_avatar: prof?.avatar_url || null,
                  created_at: r.created_at,
                }
              })
            )
          }
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
  }, [matchId, router])

  // ── Derived state ─────────────────────────────────────────────
  const memberDisplayName = (player: MatchPlayer) => {
    const profile = player.profiles
    return profile?.username || "Player"
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

  const isMatchCreator = !!user && !!match && match.created_by === user.id
  const MAX_MATCH_PLAYERS = 4
  const isMatchFull = players.length >= MAX_MATCH_PLAYERS
  const isScheduled = match?.status === "scheduled" || (!match?.status)

  // Approval counter: counts PLAYERS who have approved, not individual scores
  const approvalCount = useMemo(() => {
    const total = players.length
    const approved = players.filter((p) => p.approved_at != null).length
    return { approved, total }
  }, [players])

  // Has the current user already approved?
  const currentUserHasApproved = useMemo(() => {
    if (!user) return false
    const myPlayer = players.find((p) => p.user_id === user.id)
    return myPlayer?.approved_at != null
  }, [user, players])

  // Are there any scores submitted yet?
  const hasScores = scores.length > 0

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

  // ── Refresh helpers ───────────────────────────────────────────
  const refreshData = async () => {
    if (!match) return
    const [playersRes, scoresRes] = await Promise.all([
      supabase
        .from("match_players")
        .select("*, profiles(id, username, first_name, last_name, avatar_url)")
        .eq("match_id", match.id),
      supabase.from("scores").select("*").eq("match_id", match.id),
    ])
    if (!playersRes.error && playersRes.data) {
      setPlayers(playersRes.data as MatchPlayer[])
    }
    if (!scoresRes.error && scoresRes.data) {
      setScores(scoresRes.data as Score[])
    }
  }

  // ── Submit / edit ALL scores (via RPC) ────────────────────────
  const handleSaveAllScores = async () => {
    if (!user || !match) return

    // Validate all scores. DB constraint: score > 0 AND score <= 200 AND holes IN (9, 18).
    // Client guards are tighter (realistic floor per hole count) for better UX;
    // the DB is the final authority either way.
    let validationError: string | null = null
    const scoreEntries = players.map((player) => {
      const edit = allScoreEdits[player.user_id]
      if (!edit || !edit.score.trim()) return null
      const numericScore = Number(edit.score)
      if (!Number.isFinite(numericScore) || !Number.isInteger(numericScore)) return null
      const minScore = edit.holes === 9 ? 9 : 18
      const maxScore = 200 // matches DB constraint scores_score_check
      if (numericScore < minScore || numericScore > maxScore) {
        validationError = `Score for ${memberDisplayName(player)} must be between ${minScore} and ${maxScore}.`
        return null
      }
      return {
        user_id: player.user_id,
        score: numericScore,
        holes: edit.holes,
      }
    })

    if (validationError) {
      setScoreError(validationError)
      return
    }

    if (scoreEntries.some((e) => e === null)) {
      setScoreError("Enter a valid score for all players.")
      return
    }

    setSavingAllScores(true)
    setScoreError(null)

    try {
      const { data, error: rpcError } = await supabase.rpc(
        "submit_match_scores",
        {
          p_match_id: match.id,
          p_scores: scoreEntries,
        },
      )

      if (rpcError) throw rpcError

      const result = data as { success: boolean; error?: string }
      if (!result.success) {
        setScoreError(result.error || "Failed to save scores.")
        return
      }

      await refreshData()
      setEditingAllScores(false)
      setAllScoreEdits({})
      setShowCelebration(true)
    } catch (err) {
      setScoreError(
        err instanceof Error ? err.message : "Failed to save scores.",
      )
    } finally {
      setSavingAllScores(false)
    }
  }

  // ── Open batch edit mode ──────────────────────────────────────
  const openEditAllScores = () => {
    const edits: Record<string, { score: string; holes: 9 | 18 }> = {}
    for (const player of players) {
      const existing = scoresByUserId.get(player.user_id)
      edits[player.user_id] = {
        score: existing ? String(existing.score) : "",
        holes: existing ? (existing.holes as 9 | 18) : 18,
      }
    }
    setAllScoreEdits(edits)
    setEditingAllScores(true)
    setScoreError(null)
  }

  // ── Approve scores (current user clicks "Approve Scores") ─────
  const handleApproveScores = async () => {
    if (!user || !match) return
    setApprovingScores(true)

    try {
      const { data, error: rpcError } = await supabase.rpc(
        "approve_match_scores",
        { p_match_id: match.id },
      )

      if (rpcError) throw rpcError

      const result = data as {
        success: boolean
        error?: string
        approved_count?: number
        player_count?: number
      }
      if (!result.success) {
        setError(result.error || "Could not approve scores.")
        return
      }

      await refreshData()

      // Re-fetch match in case it was marked completed
      const { data: matchData } = await supabase
        .from("matches")
        .select("*, leagues(*)")
        .eq("id", match.id)
        .single()
      if (matchData) setMatch(matchData as Match)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve scores.")
    } finally {
      setApprovingScores(false)
    }
  }

  // ── Delete match ──────────────────────────────────────────────
  const handleDeleteMatch = async () => {
    if (!match) return
    setDeletingMatch(true)
    try {
      const { error: delError } = await supabase
        .from("matches")
        .delete()
        .eq("id", match.id)
      if (delError) throw delError
      router.push(
        match.league_id ? `/leagues/${match.league_id}` : "/dashboard",
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete match.")
      setDeletingMatch(false)
      setConfirmingDelete(false)
    }
  }

  // ── Leave match ─────────────────────────────────────────────────
  const handleLeaveMatch = async () => {
    if (!match || !user) return

    // If admin and other players exist, need to transfer admin first
    if (isMatchCreator && players.length > 1) {
      setShowLeaveConfirm(false)
      setShowAdminTransfer(true)
      return
    }

    await performLeave()
  }

  const performLeave = async (newAdminId?: string) => {
    if (!match || !user) return
    setLeavingMatch(true)
    try {
      // If transferring admin role
      if (newAdminId) {
        const { error: transferError } = await supabase
          .from("matches")
          .update({ created_by: newAdminId })
          .eq("id", match.id)
        if (transferError) throw transferError
      }

      // Remove from match_players
      const { error: leaveError } = await supabase
        .from("match_players")
        .delete()
        .eq("match_id", match.id)
        .eq("user_id", user.id)

      if (leaveError) throw leaveError

      router.push(match.league_id ? `/leagues/${match.league_id}` : "/dashboard")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to leave match.")
      setLeavingMatch(false)
      setShowAdminTransfer(false)
      setShowLeaveConfirm(false)
    }
  }

  // ── Request to join match ──────────────────────────────────────
  const handleRequestJoinMatch = async () => {
    if (!match || !user) return
    setRequestingJoin(true)
    setJoinRequestError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc("request_join_match", {
        p_match_id: match.id,
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

  // ── Approve / reject join request (admin) ───────────────────
  // Note: the RPCs mark any matching join_request notifications as read
  // server-side, so no client-side cleanup is needed.
  const handleApproveRequest = async (requestId: string) => {
    setApprovingRequestId(requestId)
    try {
      const { data, error: rpcError } = await supabase.rpc("approve_join_request", {
        p_request_id: requestId,
      })
      if (rpcError) throw rpcError
      const result = data as { success: boolean; error?: string }
      if (!result.success) {
        setError(result.error || "Failed to approve request.")
        return
      }
      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId))
      await refreshData()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve request.")
    } finally {
      setApprovingRequestId(null)
    }
  }

  const handleRejectRequest = async (requestId: string) => {
    setRejectingRequestId(requestId)
    try {
      const { data, error: rpcError } = await supabase.rpc("reject_join_request", {
        p_request_id: requestId,
      })
      if (rpcError) throw rpcError
      const result = data as { success: boolean; error?: string }
      if (!result.success) {
        setError(result.error || "Failed to reject request.")
        return
      }
      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject request.")
    } finally {
      setRejectingRequestId(null)
    }
  }

  // Can show "Request to Join" if: user is league member, not in match, match not full, match is scheduled
  const canRequestJoin = !currentUserIsPlayer && isLeagueMember && !isMatchFull && isScheduled && !joinRequestSent

  // ── Share match invite link ────────────────────────────────────
  const handleShareMatchInvite = async () => {
    if (!match) return
    const joinUrl = `${window.location.origin}/matches/${match.id}/join`
    const courseName = match.course_name || "the course"
    const leagueName = match.leagues?.name || ""
    const message = leagueName
      ? `Join my match at ${courseName} in "${leagueName}" on Mulligan League!\n${joinUrl}`
      : `Join my match at ${courseName} on Mulligan League!\n${joinUrl}`

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text: message, url: joinUrl })
      } catch {
        // user cancelled
      }
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(message)
        setInviteShared(true)
        setTimeout(() => setInviteShared(false), 2000)
      } catch {
        // ignore
      }
    }
  }

  // ── Loading / error states ────────────────────────────────────
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

  const timeLabel = formatMatchTime(match.match_time || null)

  return (
    <main className="min-h-screen bg-cream px-4 py-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {/* ── Header ─────────────────────────────────────────────── */}
        <header className="flex flex-col items-center gap-3 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary/60">
            {match.leagues?.name || "League match"}
          </p>
          <h1 className="text-2xl font-bold text-primary">
            {match.course_name || "Course TBA"}
          </h1>
          <p className="text-sm text-primary/70">
            {formatMatchDate(match.match_date || null)}
            {timeLabel ? ` · ${timeLabel}` : ""}
          </p>
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
          {match.league_id && (
            <button
              type="button"
              onClick={() => router.push(`/leagues/${match.league_id}`)}
              className="text-xs font-medium text-primary/70 underline-offset-4 hover:text-primary hover:underline"
            >
              Back to League
            </button>
          )}
        </header>

        {/* ── Players table ──────────────────────────────────────── */}
        <section className="rounded-xl border border-primary/15 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-primary">Players</h2>
            {hasScores && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  approvalCount.approved === approvalCount.total &&
                  approvalCount.total > 0
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    approvalCount.approved === approvalCount.total &&
                    approvalCount.total > 0
                      ? "bg-emerald-500"
                      : "bg-amber-400"
                  }`}
                />
                Approval {approvalCount.approved}/{approvalCount.total}
              </span>
            )}
          </div>

          <ScoreTable
            players={players}
            scoresByUserId={scoresByUserId}
            matchStatus={match.status}
          />

          {/* Request to join (non-player, league member) */}
          {!currentUserIsPlayer && isLeagueMember && isScheduled && (
            <div className="mt-3 flex flex-col items-center gap-2">
              {joinRequestSent ? (
                <div className="inline-flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Request pending — waiting for admin approval
                </div>
              ) : isMatchFull ? (
                <p className="text-xs text-primary/50">This match is full (4/4 players)</p>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleRequestJoinMatch}
                    disabled={requestingJoin}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-cream transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                    </svg>
                    {requestingJoin ? "Sending request…" : "Request to Join"}
                  </button>
                  {joinRequestError && (
                    <p className="text-xs text-red-600">{joinRequestError}</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Action buttons row */}
          {currentUserIsPlayer && (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              {/* Enter/Edit Scores */}
              {!showCelebration && !editingAllScores && (
                <button
                  type="button"
                  onClick={openEditAllScores}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream transition-all hover:bg-primary/90 active:scale-[0.98]"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                  {hasScores ? "Edit Scores" : "Enter Scores"}
                </button>
              )}
              {/* Invite Player */}
              {isScheduled && !isMatchFull && (
                <button
                  type="button"
                  onClick={handleShareMatchInvite}
                  className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-white px-4 py-2.5 text-sm font-medium text-primary transition-all hover:bg-primary/5 active:scale-[0.98]"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  {inviteShared ? "Link Copied!" : `Invite Player (${players.length}/${MAX_MATCH_PLAYERS})`}
                </button>
              )}
              {/* Share round card (completed matches) */}
              {match.status === "completed" && (
                <Link
                  href={`/share/round/${match.id}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-white px-4 py-2.5 text-sm font-medium text-primary transition-all hover:bg-primary/5 active:scale-[0.98]"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
                  </svg>
                  Share round
                </Link>
              )}
            </div>
          )}
        </section>

        {/* ── Pending join requests (admin only) ─────────────────── */}
        {isMatchCreator && (
          <JoinRequestsList
            requests={pendingRequests}
            approvingId={approvingRequestId}
            rejectingId={rejectingRequestId}
            onApprove={handleApproveRequest}
            onReject={handleRejectRequest}
          />
        )}

        {/* ── Celebration after submitting ────────────────────────── */}
        {showCelebration && (
          <section className="rounded-2xl border border-emerald-200 bg-white p-6 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <svg
                className="h-8 w-8 text-emerald-600"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.5 12.75l6 6 9-13.5"
                />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-primary">
              Scores Submitted!
            </h2>
            <p className="mt-1 text-sm text-primary/60">
              Waiting for the other{" "}
              {players.length - 1 === 1
                ? "player"
                : `${players.length - 1} players`}{" "}
              to approve.
            </p>
            <button
              type="button"
              onClick={() => setShowCelebration(false)}
              className="mt-4 rounded-lg border border-primary/20 bg-white px-5 py-2.5 text-sm font-medium text-primary hover:bg-primary/5"
            >
              Done
            </button>
          </section>
        )}

        {/* ── Inline score editing (expands inside Players section) ── */}
        {currentUserIsPlayer && !showCelebration && editingAllScores && (
          <ScoreEditForm
            players={players}
            edits={allScoreEdits}
            hasScores={hasScores}
            saving={savingAllScores}
            error={scoreError}
            onChange={(userId, patch) =>
              setAllScoreEdits((prev) => ({
                ...prev,
                [userId]: { ...prev[userId], ...patch },
              }))
            }
            onSave={handleSaveAllScores}
            onCancel={() => {
              if (!savingAllScores) {
                setEditingAllScores(false)
                setScoreError(null)
              }
            }}
          />
        )}

        {/* ── Approve scores ─────────────────────────────────────── */}
        {currentUserIsPlayer &&
          hasScores &&
          !currentUserHasApproved &&
          !showCelebration &&
          !editingAllScores && (
            <section className="rounded-xl border border-primary/15 bg-white p-6 text-center shadow-sm">
              <p className="text-sm font-medium text-primary">
                Review the scores above. If they look correct, approve them.
              </p>
              <p className="mt-1 text-xs text-primary/60">
                Scores become official once all {players.length} players
                approve. Unapproved scores are auto-approved after 24 hours.
              </p>
              <button
                type="button"
                onClick={handleApproveScores}
                disabled={approvingScores}
                className="mt-4 rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {approvingScores ? "Approving…" : "Approve Scores"}
              </button>
            </section>
          )}

        {/* ── Leave / Delete match ─────────────────────────────────── */}
        {currentUserIsPlayer && (
          <div className="flex flex-col items-center gap-4">
            <button
              type="button"
              onClick={() => setShowLeaveConfirm(true)}
              disabled={leavingMatch}
              className="text-sm font-medium text-red-500 hover:text-red-600 disabled:opacity-60"
            >
              {leavingMatch ? "Leaving…" : "Leave this match"}
            </button>
            {isMatchCreator && (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={deletingMatch}
                className="text-sm font-medium text-red-500 hover:text-red-600 disabled:opacity-60"
              >
                {deletingMatch ? "Deleting…" : "Delete this match"}
              </button>
            )}
          </div>
        )}

        {/* Leave match confirmation */}
        <ConfirmModal
          open={showLeaveConfirm}
          title="Leave this match?"
          message={
            isMatchCreator && players.length > 1
              ? "You created this match. You'll need to pick a new admin before leaving."
              : "You will be removed from this match."
          }
          confirmLabel="Leave Match"
          loading={leavingMatch}
          destructive
          onConfirm={handleLeaveMatch}
          onCancel={() => setShowLeaveConfirm(false)}
        />

        {/* Admin transfer modal */}
        <AdminTransferModal
          open={showAdminTransfer}
          candidates={players.filter((p) => p.user_id !== user?.id)}
          selected={selectedNewAdmin}
          onSelect={setSelectedNewAdmin}
          onConfirm={performLeave}
          onCancel={() => { setShowAdminTransfer(false); setSelectedNewAdmin(null) }}
          loading={leavingMatch}
        />

        {/* Delete match confirmation */}
        <ConfirmModal
          open={confirmingDelete}
          title="Delete this match?"
          message="This will permanently delete the match and all associated scores. This action cannot be undone."
          confirmLabel="Delete Match"
          loading={deletingMatch}
          destructive
          onConfirm={handleDeleteMatch}
          onCancel={() => setConfirmingDelete(false)}
        />
      </div>
    </main>
  )
}

"use client"

/**
 * Fully-inline match detail card — renders inside the game page's
 * Past / Scheduled carousel so users never need to navigate to
 * `/matches/[id]` for day-to-day interactions. Hosts:
 *
 *   - Roster with per-player score + status pill + "you" highlight
 *   - Batch score editor (inline, Save / Cancel)
 *   - Approve-scores CTA (when the viewer has reviewing to do)
 *   - Invite-player action (navigator.share or clipboard fallback)
 *   - Share-round action (for completed matches; link-copies the OG card URL)
 *   - Danger-zone disclosure: Leave / Delete
 *
 * Not ported inline yet (fall back to `/matches/[id]`):
 *   - Admin-transfer-on-leave (complex modal) — we show a hint instead
 *   - Join-request approval UI (admin only, low volume)
 *
 * All mutations call `onRefresh()` on success so the card reflects the
 * new state immediately. The header is still tappable — routes to the
 * full page for edge cases we haven't inlined yet.
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { track } from "@/lib/analytics"
import { useT } from "@/lib/i18n"
import { Avatar } from "@/components/Avatar"
import type { Game, Match, MatchPlayer } from "./types"
import {
  compareByTotal,
  formatCopy,
  formatScoreVsPar,
  gapAhead,
  resolveFormat,
} from "@/lib/gameFormat"
import { ScorecardEditor } from "./ScorecardEditor"

export const MAX_MATCH_PLAYERS = 4

interface MatchDetailCardProps {
  match: Match
  game: Game
  matchPlayers?: MatchPlayer[]
  currentUserId?: string | null
  variant: "scheduled" | "past"
  /**
   * Par of the course this match is played on, when known (course_id set and
   * referential carries it). Enables the "88 (+16)" display; null = plain.
   */
  coursePar?: number | null
  /** Called after any mutation so the parent re-pulls fresh data. */
  onRefresh: () => Promise<void> | void
  /**
   * When true, auto-open the score editor on mount. Set by the
   * parent in response to `?match=X&edit=1` URL params (banner
   * click, redirect from the old /matches/[id]?edit=1 surface, etc.).
   * The card clears this intent after consuming it once so manual
   * refresh doesn't re-open editing mid-session.
   */
  autoEdit?: boolean
  /** Called once after `autoEdit` has been consumed. */
  onAutoEditConsumed?: () => void
  /**
   * Which page surface this card is rendered on. Drives a few
   * presentation-only differences:
   *
   *  - "game": title is the match's date+time (the course is already
   *    in the game page header, so showing it per card is redundant).
   *    Per-player status pills are dropped in favour of a single
   *    match-level "Approved N/M" badge next to the title.
   *
   *  - "profile" (default): title is the course name and the subtitle
   *    carries date + approval count. Per-player pills stay so the
   *    viewer can tell which of their teammates in OTHER games has
   *    approved/submitted without extra taps.
   */
  context?: "game" | "profile"
  /**
   * Game-wide "best moment" pointers. When this card's match is the
   * one holding the lowest approved round in the game, we render a
   * "Lowest of game" flame chip next to that score. Optional so the
   * profile / cross-game usage of this card doesn't have to supply
   * it — chip simply won't show.
   */
  gameHighlights?: {
    lowestRound?: {
      matchId: string
      userId: string
      score: number
    } | null
  } | null
}

/* ── Sub-bits ──────────────────────────────────────────── */

/**
 * Single match-level approval indicator — "Approved 1/3" amber until
 * every player signs off, then "Completed" emerald. Replaces the
 * per-player status pills on the game-page variant of the card.
 */
function MatchApprovalBadge({
  approvedCount,
  total,
}: {
  approvedCount: number
  total: number
}) {
  const t = useT()
  if (total === 0) return null
  const allApproved = approvedCount >= total
  if (allApproved) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        {t("games.match.completed")}
      </span>
    )
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      {t("games.match.approvedcount", { n: approvedCount, total })}
    </span>
  )
}

/* ── Editor ────────────────────────────────────────────── */

function ScoreEditor({
  players,
  initial,
  saving,
  error,
  onCancel,
  onSave,
  gameFormat = "stroke_play",
}: {
  players: MatchPlayer[]
  initial: Record<string, { score: string; holes: 9 | 18 }>
  saving: boolean
  error: string | null
  onCancel: () => void
  onSave: (edits: Record<string, { score: string; holes: 9 | 18 }>) => void
  gameFormat?: import("@/components/match/types").GameFormat
}) {
  const t = useT()
  const [edits, setEdits] = useState(initial)
  // Input validation range widens for stableford (0 is a legal total
  // — means every hole was a blob) and tightens on the top end.
  // Stroke play stays as-is. Placeholder also nudges users toward
  // the right unit so first-time Stableford users don't type their
  // stroke count by accident.
  const inputMin = gameFormat === "stableford" ? 0 : 1
  // Stableford ceiling intentionally loose (150) — enhanced rulesets
  // and 36-hole events can comfortably push past a strict 90-point
  // cap; we'd rather accept odd-but-valid totals than block valid
  // submissions outright. Stroke play stays at 200 which covers any
  // plausible 18-hole round even for beginners.
  const inputMax = gameFormat === "stableford" ? 150 : 200
  const inputPlaceholder = gameFormat === "stableford" ? "pts" : "–"

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-primary/60">
        {gameFormat === "stableford"
          ? t("games.match.editor.hint.stableford")
          : t("games.match.editor.hint")}
      </p>

      <div className="flex flex-col gap-2">
        {players.map((p) => {
          if (!p.user_id) return null
          const e = edits[p.user_id] || { score: "", holes: 18 as const }
          return (
            <div
              key={p.user_id}
              className="flex items-center gap-2 rounded-md bg-cream/50 p-2"
            >
              <Avatar src={p.avatar_url} size={28} fallback={p.name} />
              <span className="min-w-0 flex-1 truncate text-sm text-primary">
                {p.name}
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={inputMin}
                max={inputMax}
                value={e.score}
                onChange={(ev) =>
                  setEdits((prev) => ({
                    ...prev,
                    [p.user_id!]: { ...e, score: ev.target.value },
                  }))
                }
                disabled={saving}
                placeholder={inputPlaceholder}
                aria-label={
                  gameFormat === "stableford"
                    ? t("games.match.aria.points", { name: p.name })
                    : t("games.match.aria.strokes", { name: p.name })
                }
                className="w-16 rounded-md border border-primary/20 bg-white px-2 py-1 text-center text-sm tabular-nums text-primary focus:border-primary focus:outline-none"
              />
              <div className="inline-flex overflow-hidden rounded-md border border-primary/20 text-xs">
                {([9, 18] as const).map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() =>
                      setEdits((prev) => ({
                        ...prev,
                        [p.user_id!]: { ...e, holes: h },
                      }))
                    }
                    disabled={saving}
                    className={`px-2 py-1 tabular-nums ${
                      e.holes === h
                        ? "bg-primary text-cream"
                        : "bg-white text-primary/60"
                    }`}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSave(edits)}
          disabled={saving}
          className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-cream hover:bg-primary/90 disabled:opacity-60"
        >
          {saving ? t("games.match.saving") : t("games.match.saveall")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg border border-primary/20 bg-white px-3 py-2 text-sm font-medium text-primary hover:bg-primary/5 disabled:opacity-60"
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  )
}

/* ── Main card ─────────────────────────────────────────── */

export function MatchDetailCard({
  match,
  game,
  matchPlayers,
  currentUserId,
  variant,
  coursePar = null,
  onRefresh,
  autoEdit = false,
  onAutoEditConsumed,
  context = "profile",
  gameHighlights,
}: MatchDetailCardProps) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [holeEditing, setHoleEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [scoreError, setScoreError] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState<"leave" | "delete" | null>(null)
  // Request-to-join state for non-player viewers (game members who
  // aren't in this specific match). States:
  //   idle:   show "Request to Join" button
  //   sending: disabled + spinner
  //   sent:    button replaced with "Request sent — waiting for admin"
  const [joinRequestState, setJoinRequestState] = useState<
    "idle" | "sending" | "sent"
  >("idle")
  const [joinRequestError, setJoinRequestError] = useState<string | null>(null)
  // Admin-side: pending join requests for this match that the viewer
  // (as match creator) needs to approve or reject. Fetched on mount
  // for creators only.
  type PendingRequest = {
    id: string
    requester_id: string
    name: string
    avatar_url: string | null
  }
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([])
  const [requestActionId, setRequestActionId] = useState<string | null>(null)

  // Reset "Copied!" feedback after a moment so the button goes back
  // to its normal label.
  useEffect(() => {
    if (!inviteCopied) return
    const t = setTimeout(() => setInviteCopied(false), 1800)
    return () => clearTimeout(t)
  }, [inviteCopied])
  useEffect(() => {
    if (!shareCopied) return
    const t = setTimeout(() => setShareCopied(false), 1800)
    return () => clearTimeout(t)
  }, [shareCopied])

  const dateLabel = match.match_date
    ? new Date(match.match_date).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : t("games.match.datetba")
  const timeLabel = match.match_time ? match.match_time.slice(0, 5) : null
  const courseLabel = match.course_name || game.course_name

  const players = matchPlayers ?? []
  // Scoring direction comes from the parent game's format. Stroke
  // play sorts lowest-first; Stableford sorts highest-first. Unknown
  // formats fall back to stroke.
  const gameFormat = resolveFormat(game)
  const fmtCopy = formatCopy(gameFormat)
  const sorted =
    variant === "past"
      ? [...players].sort((a, b) =>
          compareByTotal(a.score, b.score, gameFormat),
        )
      : players

  const viewerIsPlayer =
    !!currentUserId && players.some((p) => p.user_id === currentUserId)
  const viewerIsCreator =
    !!currentUserId && match.created_by === currentUserId
  const viewerApproved = players.some(
    (p) => p.user_id === currentUserId && p.approved_at != null,
  )
  const hasAnyScore = players.some((p) => p.status != null)
  const approvedCount = players.filter((p) => p.approved_at != null).length

  // Score editing gate is driven by match STATUS, not by past/future
  // `variant`. A match whose date has already passed can still be in
  // status "scheduled" or "in_progress" (e.g. you played yesterday
  // and haven't posted a card yet, or approvals aren't all in) — in
  // those cases the player absolutely needs the Edit button. Only
  // lock editing once the match is "completed" (all approvals done,
  // leaderboard finalized) or "cancelled".
  const canEnterScores =
    viewerIsPlayer &&
    match.status !== "completed" &&
    match.status !== "cancelled"

  // Consume autoEdit once: flips the editor open the first time the
  // prop turns true AND the viewer can actually edit. Guarded so a
  // re-render with the same prop doesn't reopen the editor after the
  // user cancels out.
  const [autoEditConsumed, setAutoEditConsumed] = useState(false)
  useEffect(() => {
    if (autoEdit && !autoEditConsumed && canEnterScores) {
      setEditing(true)
      setAutoEditConsumed(true)
      onAutoEditConsumed?.()
    }
  }, [autoEdit, autoEditConsumed, canEnterScores, onAutoEditConsumed])
  // Viewer has "review work" when at least one score exists on the match
  // and they're a player who hasn't yet approved. Edit mode hides this
  // to avoid competing CTAs.
  const canApprove =
    viewerIsPlayer && hasAnyScore && !viewerApproved && !editing
  // Invite: only shown to viewers who are ALREADY in the match.
  // Non-members see "Request to Join" instead (see canRequestJoin).
  // Any non-finalized match with an open slot.
  const canInvite =
    viewerIsPlayer &&
    match.status !== "completed" &&
    match.status !== "cancelled" &&
    players.length < MAX_MATCH_PLAYERS
  // Request-to-join: viewer is a game member (guaranteed by
  // privatize_games RLS — if they can see this card, they can see
  // the game), but NOT a player in this match, AND the match has
  // an open slot, AND hasn't been finalized.
  const canRequestJoin =
    !viewerIsPlayer &&
    match.status !== "completed" &&
    match.status !== "cancelled" &&
    players.length < MAX_MATCH_PLAYERS
  // Share: show as soon as at least one score exists — in_progress
  // matches are shareable (users want to brag before full approval).
  // Only hide for cancelled or no-score-yet matches.
  const canShareRound = hasAnyScore && match.status !== "cancelled"

  // If the viewer already has a pending request for this match,
  // flip the button to "Request sent" on mount. Keeps the state
  // correct across refreshes without a server-side idempotency
  // dance. Only runs for non-players to avoid wasted queries.
  useEffect(() => {
    if (!currentUserId || viewerIsPlayer) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from("join_requests")
        .select("id")
        .eq("requester_id", currentUserId)
        .eq("target_type", "match")
        .eq("target_id", match.id)
        .eq("status", "pending")
        .maybeSingle()
      if (!cancelled && data) setJoinRequestState("sent")
    })()
    return () => {
      cancelled = true
    }
  }, [currentUserId, viewerIsPlayer, match.id])

  // Admin-side fetch: pending join requests for this match. Runs
  // only for the match creator (who can approve/reject). Two-query
  // shape because join_requests.requester_id FKs to auth.users, so
  // we can't embed `profiles(...)` directly through PostgREST.
  useEffect(() => {
    if (!viewerIsCreator) return
    let cancelled = false
    ;(async () => {
      const { data: requests } = await supabase
        .from("join_requests")
        .select("id, requester_id")
        .eq("target_type", "match")
        .eq("target_id", match.id)
        .eq("status", "pending")
      if (cancelled) return
      if (!requests || requests.length === 0) {
        setPendingRequests([])
        return
      }
      const requesterIds = requests.map((r) => r.requester_id as string)
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, username, first_name, avatar_url")
        .in("id", requesterIds)
      if (cancelled) return
      type Req = { id: string; requester_id: string }
      type Prof = {
        id: string
        username: string | null
        first_name: string | null
        avatar_url: string | null
      }
      const byId = new Map<string, Prof>()
      for (const p of (profiles || []) as Prof[]) byId.set(p.id, p)
      setPendingRequests(
        (requests as Req[]).map((r) => {
          const p = byId.get(r.requester_id)
          return {
            id: r.id,
            requester_id: r.requester_id,
            name:
              p?.username || p?.first_name || t("games.match.player"),
            avatar_url: p?.avatar_url ?? null,
          }
        }),
      )
    })()
    return () => {
      cancelled = true
    }
  }, [viewerIsCreator, match.id, matchPlayers, t])
  // ^ matchPlayers in deps so that after parent onRefresh() the
  //   list re-pulls (new player row → one fewer pending request).

  /* ── Mutations ──────────────────────────────────────── */

  const handleOpenEditor = () => {
    setScoreError(null)
    setEditing(true)
  }

  const handleSave = async (
    edits: Record<string, { score: string; holes: 9 | 18 }>,
  ) => {
    setSaving(true)
    setScoreError(null)
    try {
      const entries = Object.entries(edits)
        .filter(([, v]) => v.score.trim() !== "")
        .map(([userId, v]) => ({
          user_id: userId,
          score: parseInt(v.score, 10),
          holes: v.holes,
        }))
      for (const e of entries) {
        if (Number.isNaN(e.score) || e.score < 1 || e.score > 200) {
          setScoreError(t("games.match.error.range"))
          setSaving(false)
          return
        }
      }

      // No-op guard: if every entry matches what's already in the DB
      // (same score + same holes for every player), don't call the
      // RPC at all. Otherwise submit_match_scores would rewrite rows
      // and the server-side approval-reset logic would fire, yanking
      // everyone's approvals even though the viewer opened the editor
      // just to *look* at the scores. Rule: approvals only reset when
      // an actual value changed.
      const hasChange = entries.some((e) => {
        const original = players.find((p) => p.user_id === e.user_id)
        if (!original) return true // brand-new score row for this player
        const origScore = original.score ?? null
        const origHoles = original.holes ?? 18
        return e.score !== origScore || e.holes !== origHoles
      })
      if (!hasChange) {
        setEditing(false)
        setSaving(false)
        return
      }

      const { data, error: rpcError } = await supabase.rpc(
        "submit_match_scores",
        { p_match_id: match.id, p_scores: entries },
      )
      if (rpcError) throw rpcError
      const result = data as { success: boolean; error?: string }
      if (!result.success) {
        setScoreError(result.error || t("games.match.error.save"))
        return
      }
      track("score_entered", { players: entries.length })
      setEditing(false)
      await onRefresh()
    } catch (err) {
      setScoreError(
        err instanceof Error ? err.message : t("games.match.error.save"),
      )
    } finally {
      setSaving(false)
    }
  }

  const handleApprove = async () => {
    setApproving(true)
    setActionError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc(
        "approve_match_scores",
        { p_match_id: match.id },
      )
      if (rpcError) throw rpcError
      const result = data as { success: boolean; error?: string }
      if (!result.success) {
        setActionError(result.error || t("games.match.error.approve"))
        return
      }
      track("score_confirmed", {})
      await onRefresh()
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : t("games.match.error.approvefail"),
      )
    } finally {
      setApproving(false)
    }
  }

  const handleInvite = async () => {
    // Same URL + message shape the full match page uses.
    const joinUrl = `${window.location.origin}/matches/${match.id}/join`
    const courseName = courseLabel || t("games.match.share.course")
    const message = game.name
      ? `${t("games.match.invite.msg.game", {
          course: courseName,
          game: game.name,
        })}\n${joinUrl}`
      : `${t("games.match.invite.msg", { course: courseName })}\n${joinUrl}`
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ text: message, url: joinUrl })
      } else if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(joinUrl)
        setInviteCopied(true)
      }
    } catch {
      // AbortError when user cancels the share sheet — no-op.
    }
  }

  const handleShareRound = async () => {
    const url = `${window.location.origin}/share/round/${match.id}`
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ url })
      } else if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(url)
        setShareCopied(true)
      }
    } catch {
      // user cancelled
    }
  }

  const handleRequestJoin = async () => {
    setJoinRequestState("sending")
    setJoinRequestError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc(
        "request_join_match",
        { p_match_id: match.id },
      )
      if (rpcError) throw rpcError
      const result = data as { success: boolean; error?: string }
      if (!result.success) {
        // "already requested" → treat as sent. Any other reason →
        // bubble the message up.
        if (result.error && /already/i.test(result.error)) {
          setJoinRequestState("sent")
          return
        }
        setJoinRequestError(result.error || t("games.match.error.request"))
        setJoinRequestState("idle")
        return
      }
      setJoinRequestState("sent")
    } catch (err) {
      setJoinRequestError(
        err instanceof Error ? err.message : t("games.match.error.request"),
      )
      setJoinRequestState("idle")
    }
  }

  const handleApproveRequest = async (requestId: string) => {
    setRequestActionId(requestId)
    setActionError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc(
        "approve_join_request",
        { p_request_id: requestId },
      )
      if (rpcError) throw rpcError
      const result = data as { success: boolean; error?: string }
      if (!result.success) {
        setActionError(result.error || t("games.match.error.reqapprove"))
        return
      }
      // Optimistic: drop from the local list so the UI updates before
      // the parent's onRefresh round-trips back.
      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId))
      await onRefresh()
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : t("games.match.error.reqapprove"),
      )
    } finally {
      setRequestActionId(null)
    }
  }

  const handleRejectRequest = async (requestId: string) => {
    setRequestActionId(requestId)
    setActionError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc(
        "reject_join_request",
        { p_request_id: requestId },
      )
      if (rpcError) throw rpcError
      const result = data as { success: boolean; error?: string }
      if (!result.success) {
        setActionError(result.error || t("games.match.error.reqreject"))
        return
      }
      setPendingRequests((prev) => prev.filter((r) => r.id !== requestId))
      // No onRefresh needed — rejecting doesn't change match state.
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : t("games.match.error.reqreject"),
      )
    } finally {
      setRequestActionId(null)
    }
  }

  const handleLeave = async () => {
    if (!currentUserId) return
    // Admin-with-others scenario is still punted to the full match
    // page — the transfer-admin modal isn't inlined yet.
    if (viewerIsCreator && players.length > 1) {
      setActionError(t("games.match.error.adminleave"))
      setShowConfirm(null)
      return
    }
    setLeaving(true)
    setActionError(null)
    try {
      const { error: delError } = await supabase
        .from("match_players")
        .delete()
        .eq("match_id", match.id)
        .eq("user_id", currentUserId)
      if (delError) throw delError
      await onRefresh()
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : t("games.match.error.leave"),
      )
    } finally {
      setLeaving(false)
      setShowConfirm(null)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    setActionError(null)
    try {
      const { error: delError } = await supabase
        .from("matches")
        .delete()
        .eq("id", match.id)
      if (delError) throw delError
      await onRefresh()
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : t("games.match.error.delete"),
      )
    } finally {
      setDeleting(false)
      setShowConfirm(null)
    }
  }

  /* ── Render ─────────────────────────────────────────── */

  return (
    <div className="rounded-lg bg-white p-4 text-primary shadow-sm ring-1 ring-primary/5">
      {holeEditing && (
        <ScorecardEditor
          matchId={String(match.id)}
          onClose={() => {
            setHoleEditing(false)
            // Hole writes hit the DB one by one — the card's aggregate view
            // is stale by definition once the editor closes.
            void onRefresh()
          }}
        />
      )}
      {/* Header. The `/matches/[id]` standalone page has been retired
          — this card is the only surface. Both contexts carry the
          match-level approval badge top-right so per-player status
          pills aren't repeated on every row.
           - game: title is date+time (course is already in the page
             header, so showing it per card would be redundant)
           - profile: title is course name + date subtitle (courses
             vary across games; seeing them matters here) */}
      <div className="flex items-start justify-between gap-2">
        {context === "game" ? (
          <p className="min-w-0 truncate text-sm font-semibold">
            {dateLabel}
            {timeLabel ? ` · ${timeLabel}` : ""}
          </p>
        ) : (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {courseLabel || t("games.card.nocourse")}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-primary/60">
              {dateLabel}
              {timeLabel ? ` · ${timeLabel}` : ""}
            </p>
          </div>
        )}
        {hasAnyScore && (
          <MatchApprovalBadge
            approvedCount={approvedCount}
            total={players.length}
          />
        )}
      </div>

      {/* Editor OR roster */}
      <div className="mt-3">
        {editing ? (
          <ScoreEditor
            players={players}
            initial={Object.fromEntries(
              players
                .filter((p) => !!p.user_id)
                .map((p) => [
                  p.user_id!,
                  {
                    score: p.score != null ? String(p.score) : "",
                    holes: (p.holes as 9 | 18) || 18,
                  },
                ]),
            )}
            saving={saving}
            error={scoreError}
            onCancel={() => setEditing(false)}
            onSave={handleSave}
            gameFormat={gameFormat}
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            {sorted.length === 0 ? (
              <p className="py-2 text-center text-xs text-primary/40">
                {t("games.match.noplayers")}
              </p>
            ) : (
              sorted.map((p, i) => {
                const isMe = !!currentUserId && p.user_id === currentUserId
                // Winner treatment inlines the former standalone banner:
                // emerald bg + trophy badge + recap subline ("+M ahead ·
                // course"). Only fires when the match is fully completed
                // and this row has a score. Runner-up margin derived from
                // sorted[1] (next-best score), falling back silently when
                // it's a solo round or a tie.
                const isWinner =
                  match.status === "completed" &&
                  i === 0 &&
                  p.score != null
                // Format-aware margin. `gapAhead` returns a positive
                // number when the winner is actually ahead (works for
                // both stroke and stableford) so the rendering below
                // doesn't need a direction branch.
                const margin = isWinner
                  ? gapAhead(p.score, sorted[1]?.score, gameFormat)
                  : null
                // Recap text is now inline next to the name (not a
                // subline), so keep it minimal — just the margin. The
                // course is already shown in the card header, so
                // repeating it per row was noise.
                const winnerRecap = isWinner
                  ? margin != null && margin > 0
                    ? t("games.match.ahead", { n: margin })
                    : margin === 0
                      ? t("games.match.countback")
                      : null
                  : null
                const rowClass = `flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors ${
                  isWinner
                    ? "bg-emerald-50/70 ring-1 ring-emerald-200/60"
                    : isMe
                      ? "bg-cream/50"
                      : "hover:bg-cream/40"
                }`
                const body = (
                  <>
                    <div className="relative shrink-0">
                      <Avatar src={p.avatar_url} size={28} fallback={p.name} />
                      {p.isBestScore && !isWinner && (
                        <span
                          className="absolute -right-0.5 -top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-emerald-500 text-white"
                          aria-label={t("games.match.counts")}
                          title={t("games.match.counts")}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="7"
                            height="7"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </span>
                      )}
                    </div>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
                      <span className="truncate">{p.name}</span>
                      {isMe && (
                        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary/60">
                          {t("games.match.you")}
                        </span>
                      )}
                      {winnerRecap && (
                        <span className="shrink-0 text-[11px] font-medium text-emerald-700/80">
                          {winnerRecap}
                        </span>
                      )}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      {/* "Lowest of game" flame chip — appears on
                          whoever holds the best approved round in the
                          whole game, wherever that round happened.
                          Computed upstream (game page) and threaded
                          in via `gameHighlights` so we don't have to
                          re-scan every match's roster from inside the
                          card. */}
                      {gameHighlights?.lowestRound &&
                        p.user_id === gameHighlights.lowestRound.userId &&
                        String(match.id) ===
                          gameHighlights.lowestRound.matchId &&
                        p.score === gameHighlights.lowestRound.score && (
                          <span
                            className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-300 to-red-500 text-white shadow-[0_1px_3px_rgba(239,68,68,0.35)] ring-[1.5px] ring-white"
                            aria-label={t("games.match.lowest")}
                            title={t("games.match.lowest")}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              aria-hidden="true"
                            >
                              <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
                            </svg>
                          </span>
                        )}
                      {isWinner && (
                        <span
                          className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-200 via-amber-400 to-amber-600 shadow-[0_1px_3px_rgba(180,83,9,0.35)] ring-[1.5px] ring-white"
                          aria-label={t("games.match.winner")}
                          title={t("games.match.winner")}
                        >
                          {/* Modern gold medal — solid amber disc with a
                              filled 5-point star. Sits just left of the
                              score so the medal and the winning number
                              read as a single "trophy + stat" unit. */}
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="#fff"
                            aria-hidden="true"
                          >
                            <path d="M12 3.2l2.47 5.01 5.53.8-4 3.9.94 5.5L12 15.8l-4.94 2.6.94-5.5-4-3.9 5.53-.8L12 3.2z" />
                          </svg>
                        </span>
                      )}
                      <span
                        className={`text-sm tabular-nums ${
                          p.score == null
                            ? "text-primary/30"
                            : isWinner || p.isBestScore
                              ? "font-bold text-emerald-600"
                              : "font-semibold text-primary/80"
                        }`}
                      >
                        {p.score != null
                          ? formatScoreVsPar(p.score, coursePar, gameFormat)
                          : "–"}
                      </span>
                      {/* Per-player status pill dropped on both
                          contexts — the match-level approval badge in
                          the header already tells the story, and
                          repeating "Pending" per row read as noise. */}
                    </div>
                  </>
                )
                // Whole-row tap target → player profile. `/players/[id]`
                // redirects to `/profile` when id matches the viewer,
                // so tapping your own row just opens your own profile.
                // Fall back to a plain div if we somehow don't have a
                // user_id (defensive; shouldn't normally happen).
                if (p.user_id) {
                  return (
                    <Link
                      key={`${p.user_id}-${i}`}
                      href={`/players/${p.user_id}`}
                      className={rowClass}
                    >
                      {body}
                    </Link>
                  )
                }
                return (
                  <div key={`${p.user_id ?? i}`} className={rowClass}>
                    {body}
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* "Waiting on…" footer — surfaces the specific blocker for
          any past or in-progress match. Shows a compact amber line
          listing players pending submission or approval. Hidden for
          editor mode, completed matches (no one waiting), and
          future matches (too early to nag). */}
      {!editing && match.status !== "completed" && match.status !== "cancelled" && (
        <WaitingOnFooter
          players={players}
          match={match}
          currentUserId={currentUserId}
        />
      )}

      {/* Approve CTA — only when viewer has reviewing work. Emerald to
          distinguish from primary Edit action. */}
      {canApprove && (
        <button
          type="button"
          onClick={handleApprove}
          disabled={approving}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {approving ? t("games.match.approving") : t("games.match.approve")}
        </button>
      )}

      {/* Action grid. Up to two rows; each pairs a primary action
          (flex-1) with destructive icon button(s) on the right.
          `items-stretch` lets icon buttons auto-match the row height.

          Row 1 (only when Edit is available) = Edit scores + Leave.
          Row 2 = Invite / Share + [Leave when not on row 1] + Delete.

          When Edit is unavailable (completed match, etc.), Leave
          collapses down into row 2 so the whole action block stays
          on a single line. Share label shortens to "Share card" when
          both Leave and Delete sit on the same row, to keep it from
          truncating at 400px. */}
      {!editing &&
        (canEnterScores ||
          canInvite ||
          canShareRound ||
          viewerIsPlayer ||
          viewerIsCreator) && (
          <div className="mt-3 flex flex-col gap-2">
            {/* Row 1: Edit scores + Leave icon — only rendered when
                Edit is actually available. If not, Leave drops down
                into row 2 instead of floating on its own line. */}
            {canEnterScores && (
              <div className="flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={handleOpenEditor}
                  className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-cream hover:bg-primary/90"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                  {hasAnyScore
                    ? t("games.match.editscores")
                    : t("games.match.enterscores")}
                </button>
                {/* Hole-by-hole entry (Phase B). The aggregate editor stays —
                    courses without hole data, or players who only have their
                    final total, still need it. */}
                <button
                  type="button"
                  onClick={() => setHoleEditing(true)}
                  aria-label={t("scorecard.open")}
                  title={t("scorecard.open")}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-white text-primary hover:bg-cream/40"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                    <line x1="15" y1="3" x2="15" y2="21" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="3" y1="15" x2="21" y2="15" />
                  </svg>
                </button>
                {viewerIsPlayer && (
                  <button
                    type="button"
                    onClick={() => setShowConfirm("leave")}
                    aria-label={t("games.match.leave")}
                    title={t("games.match.leave")}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-50"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                  </button>
                )}
              </div>
            )}

            {/* Row 2: Share / Invite then destructive icons clustered
                on the right — Leave sits immediately to the right of
                the primary button, Delete last. Leave only appears
                here when Edit didn't render on row 1; otherwise it
                stays up there next to Edit. */}
            {(() => {
              const leaveOnThisRow = viewerIsPlayer && !canEnterScores
              if (
                !canInvite &&
                !canShareRound &&
                !viewerIsCreator &&
                !leaveOnThisRow
              ) {
                return null
              }
              // Trim the share label when this row carries two icons —
              // "Share score card" + Leave + Delete flirts with 400px
              // truncation otherwise.
              const compactShare = leaveOnThisRow && viewerIsCreator
              return (
                <div className="flex items-stretch gap-2">
                  {canInvite ? (
                    <button
                      type="button"
                      onClick={handleInvite}
                      className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-primary/20 bg-white px-2.5 text-xs font-medium text-primary hover:bg-cream/40"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <line x1="19" y1="8" x2="19" y2="14" />
                        <line x1="22" y1="11" x2="16" y2="11" />
                      </svg>
                      {inviteCopied
                        ? t("games.match.linkcopied")
                        : t("games.match.invite", {
                            n: players.length,
                            max: MAX_MATCH_PLAYERS,
                          })}
                    </button>
                  ) : canShareRound ? (
                    <button
                      type="button"
                      onClick={handleShareRound}
                      className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-primary/20 bg-white px-2.5 text-xs font-medium text-primary hover:bg-cream/40"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
                      </svg>
                      {shareCopied
                        ? t("games.match.linkcopied")
                        : compactShare
                          ? t("games.match.sharecard.short")
                          : t("games.match.sharecard")}
                    </button>
                  ) : (
                    <div className="flex-1" />
                  )}
                  {leaveOnThisRow && (
                    <button
                      type="button"
                      onClick={() => setShowConfirm("leave")}
                      aria-label={t("games.match.leave")}
                      title={t("games.match.leave")}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-50"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                    </button>
                  )}
                  {viewerIsCreator && (
                    <button
                      type="button"
                      onClick={() => setShowConfirm("delete")}
                      aria-label={t("games.match.delete")}
                      title={t("games.match.delete")}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-50"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                        <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  )}
                </div>
              )
            })()}
          </div>
        )}

      {/* Pending join requests — admin-only section. Shown to the
          match creator when at least one game member has tapped
          Request to Join. Approve adds them to match_players and
          closes the request; Reject leaves the match untouched. */}
      {!editing && viewerIsCreator && pendingRequests.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-700">
            {pendingRequests.length === 1
              ? t("games.match.pending.one")
              : t("games.match.pending", { n: pendingRequests.length })}
          </p>
          <div className="flex flex-col gap-2">
            {pendingRequests.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-2 rounded-md bg-white p-2"
              >
                <Avatar
                  src={r.avatar_url}
                  size={28}
                  fallback={r.name}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-primary">
                  {r.name}
                </span>
                <button
                  type="button"
                  onClick={() => handleApproveRequest(r.id)}
                  disabled={requestActionId === r.id}
                  className="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {requestActionId === r.id
                    ? "\u2026"
                    : t("games.match.request.approve")}
                </button>
                <button
                  type="button"
                  onClick={() => handleRejectRequest(r.id)}
                  disabled={requestActionId === r.id}
                  className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                >
                  {t("games.match.request.reject")}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Request to Join — renders for game members who AREN'T in
          this match. Sent via `request_join_match` RPC; admin gets a
          notification and approves/rejects from the section above.
          Request becomes "pending" UI while awaiting. Rendered
          OUTSIDE the action grid so it stands alone without an
          icon column. */}
      {!editing && canRequestJoin && joinRequestState !== "sent" && (
        <button
          type="button"
          onClick={handleRequestJoin}
          disabled={joinRequestState === "sending"}
          className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-cream hover:bg-primary/90 disabled:opacity-60"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" y1="8" x2="19" y2="14" />
            <line x1="22" y1="11" x2="16" y2="11" />
          </svg>
          {joinRequestState === "sending"
            ? t("games.match.sending")
            : t("games.match.requestjoin", {
                n: players.length,
                max: MAX_MATCH_PLAYERS,
              })}
        </button>
      )}
      {!editing && joinRequestState === "sent" && !viewerIsPlayer && (
        <div className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          {t("games.match.requestpending")}
        </div>
      )}
      {!editing && joinRequestError && (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {joinRequestError}
        </p>
      )}

      {/* Confirm row — pops below the action grid when a destructive
          icon is tapped. Spans full width so the Yes/Cancel buttons
          have real affordance. */}
      {!editing && showConfirm === "leave" && (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-red-50 p-2 text-[11px] text-red-700">
          <span className="flex-1">{t("games.match.leave.confirm")}</span>
          <button
            type="button"
            onClick={handleLeave}
            disabled={leaving}
            className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-60"
          >
            {leaving ? t("games.match.leaving") : t("games.match.leave.yes")}
          </button>
          <button
            type="button"
            onClick={() => setShowConfirm(null)}
            className="rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] font-medium text-red-600"
          >
            {t("common.cancel")}
          </button>
        </div>
      )}
      {!editing && showConfirm === "delete" && (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-red-50 p-2 text-[11px] text-red-700">
          <span className="flex-1">{t("games.match.delete.confirm")}</span>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-60"
          >
            {deleting ? t("games.match.deleting") : t("games.match.delete.yes")}
          </button>
          <button
            type="button"
            onClick={() => setShowConfirm(null)}
            className="rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] font-medium text-red-600"
          >
            {t("common.cancel")}
          </button>
        </div>
      )}

      {/* Action-level error messages (approve / leave / delete) */}
      {actionError && (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {actionError}
        </p>
      )}
    </div>
  )
}

/* ── Phase 2 helpers ──────────────────────────────────── */

/**
 * Compact amber footer line under the roster when a past (or
 * in-progress) match has players blocking its completion. We
 * distinguish two states — "to submit" and "to approve" — because
 * they each need a different action from the listed players:
 *
 *   No score row yet        → waiting on them to submit.
 *   Score row but approved_at is null for any player → waiting
 *                             on those players to approve.
 *
 * Submission blockers outrank approval blockers: if anyone still
 * owes a score, we say "to submit" (the match literally can't be
 * fully approved until those scores exist). Only when every
 * player has submitted do we flip to "to approve".
 *
 * Name list is truncated to the first two names + "+N" suffix so
 * the line stays on one row at 400px.
 */
function WaitingOnFooter({
  players,
  match,
  currentUserId,
}: {
  players: MatchPlayer[]
  match: Match
  currentUserId?: string | null
}) {
  const t = useT()
  const todayIso = useLocalTodayIso()
  if (players.length === 0) return null

  // Filter out the viewer themselves. If they're the one blocking,
  // the primary CTA (Approve Scores / Edit scores) is already
  // surfaced above — a redundant "Waiting on [you]" line is noise,
  // not a nudge.
  const others = currentUserId
    ? players.filter((p) => p.user_id !== currentUserId)
    : players
  const pendingSubmitters = others.filter((p) => p.status == null)
  const pendingApprovers = others.filter(
    (p) => p.status != null && p.approved_at == null,
  )

  // Suppress "to submit" for matches that haven't happened yet — too
  // early to nag about scores that can't exist yet. "To approve" is
  // always surfaced when present: if a score has been entered and
  // is awaiting sign-off, that's real pending work for someone
  // regardless of match date.
  const matchInFuture =
    match.status !== "in_progress" &&
    match.match_date != null &&
    match.match_date > todayIso

  // Pick which set to surface. Submitters first because their
  // scores must exist before approval can even begin — but only once
  // the match date has arrived.
  const which =
    !matchInFuture && pendingSubmitters.length > 0
      ? { bucket: "submit" as const, list: pendingSubmitters }
      : pendingApprovers.length > 0
        ? { bucket: "approve" as const, list: pendingApprovers }
        : null
  if (!which) return null

  const names = which.list.map((p) => p.name)
  const displayed = names.slice(0, 2)
  const extra = names.length - displayed.length
  const nameStr =
    extra > 0 ? `${displayed.join(", ")} +${extra}` : displayed.join(", ")
  const verb =
    which.bucket === "submit"
      ? t("games.match.waiting.submit")
      : t("games.match.waiting.approve")

  return (
    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-700">
      <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      {t("games.match.waiting")}{" "}
      <span className="font-semibold">{nameStr}</span> {verb}
    </p>
  )
}

// Local-date ISO string — same helper the calendar section uses.
// Inlined here to keep WaitingOnFooter pure/self-contained. Memoized
// so many re-renders during the same mount don't reconstruct Dates.
function useLocalTodayIso(): string {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [iso] = useState(() => {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${y}-${m}-${day}`
  })
  return iso
}

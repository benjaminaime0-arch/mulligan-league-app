"use client"

/**
 * Fully-inline match detail card — renders inside the league page's
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
import { supabase } from "@/lib/supabase"
import { Avatar } from "@/components/Avatar"
import type { League, Match, MatchPlayer } from "./types"

export const MAX_MATCH_PLAYERS = 4

interface MatchDetailCardProps {
  match: Match
  league: League
  matchPlayers?: MatchPlayer[]
  currentUserId?: string | null
  variant: "scheduled" | "past"
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
   *  - "league": title is the match's date+time (the course is already
   *    in the league page header, so showing it per card is redundant).
   *    Per-player status pills are dropped in favour of a single
   *    match-level "Approved N/M" badge next to the title.
   *
   *  - "profile" (default): title is the course name and the subtitle
   *    carries date + approval count. Per-player pills stay so the
   *    viewer can tell which of their teammates in OTHER leagues has
   *    approved/submitted without extra taps.
   */
  context?: "league" | "profile"
}

/* ── Sub-bits ──────────────────────────────────────────── */

/**
 * Single match-level approval indicator — "Approved 1/3" amber until
 * every player signs off, then "Completed" emerald. Replaces the
 * per-player status pills on the league-page variant of the card.
 */
function MatchApprovalBadge({
  approvedCount,
  total,
}: {
  approvedCount: number
  total: number
}) {
  if (total === 0) return null
  const allApproved = approvedCount >= total
  if (allApproved) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Completed
      </span>
    )
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Approved {approvedCount}/{total}
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
}: {
  players: MatchPlayer[]
  initial: Record<string, { score: string; holes: 9 | 18 }>
  saving: boolean
  error: string | null
  onCancel: () => void
  onSave: (edits: Record<string, { score: string; holes: 9 | 18 }>) => void
}) {
  const [edits, setEdits] = useState(initial)

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-primary/60">
        Saving resets other players&apos; approvals — they&apos;ll need to
        re-approve.
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
                min={1}
                max={200}
                value={e.score}
                onChange={(ev) =>
                  setEdits((prev) => ({
                    ...prev,
                    [p.user_id!]: { ...e, score: ev.target.value },
                  }))
                }
                disabled={saving}
                placeholder="–"
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
          {saving ? "Saving\u2026" : "Save All Scores"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg border border-primary/20 bg-white px-3 py-2 text-sm font-medium text-primary hover:bg-primary/5 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/* ── Main card ─────────────────────────────────────────── */

export function MatchDetailCard({
  match,
  league,
  matchPlayers,
  currentUserId,
  variant,
  onRefresh,
  autoEdit = false,
  onAutoEditConsumed,
  context = "profile",
}: MatchDetailCardProps) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [scoreError, setScoreError] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState<"leave" | "delete" | null>(null)

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
    : "Date TBA"
  const timeLabel = match.match_time ? match.match_time.slice(0, 5) : null
  const courseLabel = match.course_name || league.course_name

  const players = matchPlayers ?? []
  const sorted =
    variant === "past"
      ? [...players].sort((a, b) => {
          if (a.score == null && b.score == null) return 0
          if (a.score == null) return 1
          if (b.score == null) return -1
          return a.score - b.score
        })
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
  // Invite: any non-finalized match with an open slot, irrespective
  // of match_date. Users still iterate on rosters after the nominal
  // date (reschedules, late joiners).
  const canInvite =
    match.status !== "completed" &&
    match.status !== "cancelled" &&
    players.length < MAX_MATCH_PLAYERS
  // Share: show as soon as at least one score exists — in_progress
  // matches are shareable (users want to brag before full approval).
  // Only hide for cancelled or no-score-yet matches.
  const canShareRound = hasAnyScore && match.status !== "cancelled"

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
          setScoreError("Scores must be whole numbers between 1 and 200.")
          setSaving(false)
          return
        }
      }
      const { data, error: rpcError } = await supabase.rpc(
        "submit_match_scores",
        { p_match_id: match.id, p_scores: entries },
      )
      if (rpcError) throw rpcError
      const result = data as { success: boolean; error?: string }
      if (!result.success) {
        setScoreError(result.error || "Failed to save scores.")
        return
      }
      setEditing(false)
      await onRefresh()
    } catch (err) {
      setScoreError(err instanceof Error ? err.message : "Failed to save scores.")
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
        setActionError(result.error || "Could not approve scores.")
        return
      }
      await onRefresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to approve.")
    } finally {
      setApproving(false)
    }
  }

  const handleInvite = async () => {
    // Same URL + message shape the full match page uses.
    const joinUrl = `${window.location.origin}/matches/${match.id}/join`
    const courseName = courseLabel || "the course"
    const message = league.name
      ? `Join my match at ${courseName} in "${league.name}" on Mulligan League!\n${joinUrl}`
      : `Join my match at ${courseName} on Mulligan League!\n${joinUrl}`
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

  const handleLeave = async () => {
    if (!currentUserId) return
    // Admin-with-others scenario is still punted to the full match
    // page — the transfer-admin modal isn't inlined yet.
    if (viewerIsCreator && players.length > 1) {
      setActionError(
        "You're the match admin. Open the full match to transfer admin before leaving.",
      )
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
      setActionError(err instanceof Error ? err.message : "Failed to leave match.")
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
      setActionError(err instanceof Error ? err.message : "Failed to delete match.")
    } finally {
      setDeleting(false)
      setShowConfirm(null)
    }
  }

  /* ── Render ─────────────────────────────────────────── */

  return (
    <div className="rounded-lg bg-white p-4 text-primary shadow-sm ring-1 ring-primary/5">
      {/* Header. The `/matches/[id]` standalone page has been retired
          — this card is the only surface. Both contexts carry the
          match-level approval badge top-right so per-player status
          pills aren't repeated on every row.
           - league: title is date+time (course is already in the page
             header, so showing it per card would be redundant)
           - profile: title is course name + date subtitle (courses
             vary across leagues; seeing them matters here) */}
      <div className="flex items-start justify-between gap-2">
        {context === "league" ? (
          <p className="min-w-0 truncate text-sm font-semibold">
            {dateLabel}
            {timeLabel ? ` · ${timeLabel}` : ""}
          </p>
        ) : (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {courseLabel || "Course TBA"}
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
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            {sorted.length === 0 ? (
              <p className="py-2 text-center text-xs text-primary/40">
                No players yet.
              </p>
            ) : (
              sorted.map((p, i) => {
                const isMe = !!currentUserId && p.user_id === currentUserId
                return (
                  <div
                    key={`${p.user_id ?? i}`}
                    className={`flex items-center gap-2 rounded-md px-1.5 py-1 ${
                      isMe ? "bg-cream/50" : ""
                    }`}
                  >
                    <div className="relative shrink-0">
                      <Avatar src={p.avatar_url} size={28} fallback={p.name} />
                      {p.isBestScore && (
                        <span
                          className="absolute -right-0.5 -top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-emerald-500 text-white"
                          aria-label="Counts toward leaderboard"
                          title="Counts toward leaderboard"
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
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {p.name}
                      {isMe && (
                        <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary/60">
                          you
                        </span>
                      )}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`text-sm tabular-nums ${
                          p.score == null
                            ? "text-primary/30"
                            : p.isBestScore
                              ? "font-bold text-emerald-600"
                              : "font-semibold text-primary/80"
                        }`}
                      >
                        {p.score ?? "–"}
                      </span>
                      {/* Per-player status pill dropped on both
                          contexts — the match-level approval badge in
                          the header already tells the story, and
                          repeating "Pending" per row read as noise. */}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

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
          {approving ? "Approving\u2026" : "Approve Scores"}
        </button>
      )}

      {/* Action grid. Two rows, each pairs a primary action (flex-1)
          with an optional destructive icon button on the right. Using
          `items-stretch` so each icon button auto-grows to match its
          row's primary button height — Leave is tall (matches Edit
          scores), Delete is shorter (matches Invite/Share). Keeps
          everything visually flush without committing to a single
          uniform button height.
          Row 1 = Edit scores + Leave. Row 2 = Invite / Share + Delete.
          When a row has no primary action but still has an icon, we
          render a flex-1 placeholder so the icon doesn't snap
          left-aligned. */}
      {!editing &&
        (canEnterScores ||
          canInvite ||
          canShareRound ||
          viewerIsPlayer ||
          viewerIsCreator) && (
          <div className="mt-3 flex flex-col gap-2">
            {/* Row 1: Edit scores + Leave icon */}
            {(canEnterScores || viewerIsPlayer) && (
              <div className="flex items-stretch gap-2">
                {canEnterScores ? (
                  <button
                    type="button"
                    onClick={handleOpenEditor}
                    // Height matches the row 2 buttons (Invite / Share)
                    // so the two-row action block reads as a paired
                    // unit. text-sm keeps the primary visual weight.
                    className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-cream hover:bg-primary/90"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                    {hasAnyScore ? "Edit scores" : "Enter scores"}
                  </button>
                ) : (
                  <div className="flex-1" />
                )}
                {viewerIsPlayer && (
                  <button
                    type="button"
                    onClick={() => setShowConfirm("leave")}
                    aria-label="Leave this match"
                    title="Leave this match"
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

            {/* Row 2: Invite (or Share) + Delete icon */}
            {(canInvite || canShareRound || viewerIsCreator) && (
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
                      ? "Link copied!"
                      : `Invite (${players.length}/${MAX_MATCH_PLAYERS})`}
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
                    {shareCopied ? "Link copied!" : "Share score card"}
                  </button>
                ) : (
                  <div className="flex-1" />
                )}
                {viewerIsCreator && (
                  <button
                    type="button"
                    onClick={() => setShowConfirm("delete")}
                    aria-label="Delete this match"
                    title="Delete this match"
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
            )}
          </div>
        )}

      {/* Confirm row — pops below the action grid when a destructive
          icon is tapped. Spans full width so the Yes/Cancel buttons
          have real affordance. */}
      {!editing && showConfirm === "leave" && (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-red-50 p-2 text-[11px] text-red-700">
          <span className="flex-1">Leave this match?</span>
          <button
            type="button"
            onClick={handleLeave}
            disabled={leaving}
            className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-60"
          >
            {leaving ? "Leaving\u2026" : "Yes, leave"}
          </button>
          <button
            type="button"
            onClick={() => setShowConfirm(null)}
            className="rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] font-medium text-red-600"
          >
            Cancel
          </button>
        </div>
      )}
      {!editing && showConfirm === "delete" && (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-red-50 p-2 text-[11px] text-red-700">
          <span className="flex-1">Delete match + all scores?</span>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-60"
          >
            {deleting ? "Deleting\u2026" : "Yes, delete"}
          </button>
          <button
            type="button"
            onClick={() => setShowConfirm(null)}
            className="rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] font-medium text-red-600"
          >
            Cancel
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

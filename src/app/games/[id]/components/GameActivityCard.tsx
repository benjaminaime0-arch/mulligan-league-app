"use client"

/**
 * Game-scoped activity feed. Shows recent events for THIS game
 * only (matches created, scores approved, members joining). Powered
 * by the `get_game_activity_feed` RPC which is SECURITY DEFINER
 * and gated on viewer-is-member so non-members can't peek.
 *
 * Layout: the card stays compact at rest (top 2 rows). The title
 * doubles as a tap target — chevron opens a modal listing every
 * recent event so users don't scroll long feeds inline.
 */

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { Avatar } from "@/components/Avatar"

interface ActivityEvent {
  id: string
  event_type: string
  game_id: string | null
  actor_id: string
  match_id: string | null
  metadata: Record<string, string | number | null>
  created_at: string
  actor_name: string
  actor_avatar_url: string | null
}

interface GameActivityCardProps {
  gameId: string
  /** Signal to refetch the feed after a mutation somewhere on the page. */
  refreshKey?: number
}

const COLLAPSED_COUNT = 2
const FETCH_LIMIT = 20

export function GameActivityCard({ gameId, refreshKey }: GameActivityCardProps) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.rpc("get_game_activity_feed", {
        p_game_id: gameId,
        p_limit: FETCH_LIMIT,
      })
      if (cancelled) return
      if (error) {
        console.error("[GameActivityCard] fetch failed", error)
        setEvents([])
        return
      }
      const mapped: ActivityEvent[] = (
        (data as Array<Record<string, unknown>>) || []
      ).map((r) => ({
        id: r.out_id as string,
        event_type: r.out_event_type as string,
        game_id: (r.out_game_id as string) || null,
        actor_id: r.out_actor_id as string,
        match_id: (r.out_match_id as string) || null,
        metadata:
          (r.out_metadata as Record<string, string | number | null>) || {},
        created_at: r.out_created_at as string,
        actor_name: r.out_actor_name as string,
        actor_avatar_url: (r.out_actor_avatar_url as string) || null,
      }))
      setEvents(mapped)
    })()
    return () => {
      cancelled = true
    }
  }, [gameId, refreshKey])

  const hasMore = events !== null && events.length > COLLAPSED_COUNT

  const handleNavigate = useCallback(
    (href: string) => {
      setModalOpen(false)
      router.push(href)
    },
    [router],
  )

  return (
    <>
      <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
        {/* Header: plain title if nothing to expand to; otherwise the
            title itself is a tap target with a chevron that opens the
            full feed modal. Mirrors the "My calendar →" pattern used
            on MatchCalendarSection. */}
        <div className="mb-3">
          {hasMore ? (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary/70"
              aria-label="See all activity"
            >
              Activity feed
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-primary/40"
                aria-hidden="true"
              >
                <polyline points="9 6 15 12 9 18" />
              </svg>
            </button>
          ) : (
            <h2 className="text-sm font-semibold text-primary">Activity feed</h2>
          )}
        </div>

        {events === null ? (
          // Loading skeleton — 2 ghost rows matching the collapsed count.
          <div className="flex flex-col gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-8 w-8 shrink-0 rounded-full bg-primary/5" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-3/4 rounded bg-primary/5" />
                  <div className="h-2.5 w-1/2 rounded bg-primary/5" />
                </div>
              </div>
            ))}
          </div>
        ) : events.length === 0 ? (
          <p className="py-2 text-center text-xs text-primary/50">
            No recent activity. Schedule a match or post a score to get things rolling.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {events.slice(0, COLLAPSED_COUNT).map((ev) => (
              <ActivityRow
                key={ev.id}
                event={ev}
                onNavigate={handleNavigate}
              />
            ))}
          </ul>
        )}
      </section>

      {modalOpen && events && (
        <ActivityFeedModal
          events={events}
          onClose={() => setModalOpen(false)}
          onNavigate={handleNavigate}
        />
      )}
    </>
  )
}

/* ── Row ──────────────────────────────────────────────── */

function ActivityRow({
  event,
  onNavigate,
}: {
  event: ActivityEvent
  onNavigate: (href: string) => void
}) {
  /* ── Announcement rows ──────────────────────────────
   * Two special events don't follow the "{actor} verbed X" shape —
   * they read as standalone banners:
   *   game_winner    → "Congrats {name} for the win"
   *   game_completed → "All rounds completed"
   * Rendered with a distinct emerald/amber tint so they pop in the
   * feed. Non-navigable; they're celebrations, not drill-ins.
   */
  if (event.event_type === "game_winner") {
    const total = event.metadata?.total_score as number | undefined
    return (
      <li>
        {/* Gold-tinted celebration row. Winner's avatar is the
            primary visual — a trophy badge overlaid on the corner
            celebrates without overshadowing who won. */}
        <div className="flex items-center gap-3 rounded-lg bg-gradient-to-r from-amber-50 to-amber-50/30 p-2.5 ring-1 ring-amber-200/70">
          <div className="relative shrink-0">
            <div className="ring-2 ring-amber-300 ring-offset-1 ring-offset-amber-50 rounded-full">
              <Avatar
                src={event.actor_avatar_url}
                size={36}
                fallback={event.actor_name}
              />
            </div>
            {/* Trophy badge — small, anchored to the avatar so it's
                clear which player the trophy belongs to. */}
            <span className="absolute -right-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-white ring-2 ring-amber-50 shadow-sm">
              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18 2H6v7a6 6 0 0 0 5 5.91V17H8.5a2.5 2.5 0 0 0-2.5 2.5V22h12v-2.5a2.5 2.5 0 0 0-2.5-2.5H13v-2.09A6 6 0 0 0 18 9V2zm-2.2 5.7A3.98 3.98 0 0 1 12 13a4 4 0 0 1-3.8-5.3H8V5h8v2.7h-.2zM4.5 4h1.2v5A2.5 2.5 0 0 1 3 6.5V5.5A1.5 1.5 0 0 1 4.5 4zm15 0a1.5 1.5 0 0 1 1.5 1.5v1A2.5 2.5 0 0 1 18.3 9h-.05V4h1.25z" />
              </svg>
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-primary">
              Congrats{" "}
              <span className="font-bold">{event.actor_name}</span> for the win
            </p>
            {total != null && (
              <p className="mt-0.5 truncate text-[11px] text-amber-700/80">
                Final total · {total}
              </p>
            )}
          </div>
          <span className="shrink-0 text-[10px] tabular-nums text-primary/40">
            {timeAgo(event.created_at)}
          </span>
        </div>
      </li>
    )
  }

  if (event.event_type === "game_completed") {
    return (
      <li>
        {/* Emerald confirmation row — softer than the winner, reads
            as the closing caption rather than another headline. */}
        <div className="flex items-center gap-3 rounded-lg bg-emerald-50/70 p-2.5 ring-1 ring-emerald-200/60">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-sm shadow-emerald-200">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-primary">
            All rounds completed
          </p>
          <span className="shrink-0 text-[10px] tabular-nums text-primary/40">
            {timeAgo(event.created_at)}
          </span>
        </div>
      </li>
    )
  }

  /* ── Default "{actor} verbed X" row ─────────────── */
  const msg = formatMessage(event)
  const href = eventHref(event)

  const body = (
    <div className="flex items-center gap-3 rounded-md px-1 py-1.5 transition-colors hover:bg-cream/40">
      <Avatar
        src={event.actor_avatar_url}
        size={28}
        fallback={event.actor_name}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-primary">
          <span className="font-semibold">{event.actor_name}</span>{" "}
          <span className="text-primary/70">{msg}</span>
        </p>
      </div>
      <span className="shrink-0 text-[10px] tabular-nums text-primary/40">
        {timeAgo(event.created_at)}
      </span>
    </div>
  )

  if (href) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onNavigate(href)}
          className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 rounded-md"
        >
          {body}
        </button>
      </li>
    )
  }
  return <li>{body}</li>
}

/* ── Full-feed modal ──────────────────────────────────── */

/**
 * Bottom sheet on mobile / centered modal on larger screens. Same
 * UX shape as DatePickerModal / MatchPreviewModal for consistency.
 * Shows every event we fetched (up to FETCH_LIMIT = 20), scrollable
 * if the body overflows.
 */
function ActivityFeedModal({
  events,
  onClose,
  onNavigate,
}: {
  events: ActivityEvent[]
  onClose: () => void
  onNavigate: (href: string) => void
}) {
  // Lock body scroll + close on Esc while open.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Game activity"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-primary/10 px-5 py-4">
          <h3 className="text-sm font-semibold text-primary">Activity feed</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/60 text-primary/60 hover:bg-cream/50 hover:text-primary"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <ul className="flex flex-col gap-1 overflow-y-auto px-5 py-3">
          {events.map((ev) => (
            <ActivityRow key={ev.id} event={ev} onNavigate={onNavigate} />
          ))}
        </ul>
      </div>
    </div>
  )
}

/* ── Copy helpers ──────────────────────────────────────── */

function formatMessage(event: ActivityEvent): string {
  const meta = event.metadata || {}
  switch (event.event_type) {
    case "player_joined_game":
      return "joined the game"
    case "match_created": {
      const date = meta.match_date
        ? new Date(String(meta.match_date)).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          })
        : null
      return date
        ? `scheduled a match for ${date}`
        : "scheduled a new match"
    }
    case "score_approved":
      return meta.score != null
        ? `submitted a ${meta.score}`
        : "posted a score"
    default:
      return event.event_type.replace(/_/g, " ")
  }
}

function eventHref(event: ActivityEvent): string | null {
  if (event.match_id && (event.event_type === "match_created" || event.event_type === "score_approved")) {
    return `/matches/${event.match_id}`
  }
  if (event.event_type === "player_joined_game") {
    return `/players/${event.actor_id}`
  }
  return null
}

function timeAgo(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diffSec = Math.floor((now - then) / 1000)
  if (diffSec < 60) return "just now"
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d`
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
}

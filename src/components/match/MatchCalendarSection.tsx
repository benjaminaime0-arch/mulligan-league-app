"use client"

/**
 * Shared calendar-style match surface, used on both the league page
 * and the profile page. Renders:
 *
 *   [ horizontal day strip (±15 days, scrollable, with date-picker) ]
 *   [ MatchDetailCard for the selected day's match, if any ]
 *   [ "My calendar →" link to /profile/matches for the full tabbed list ]
 *
 * Data model: caller passes `matches` (ALL matches to surface on the
 * strip — e.g. a league's period matches, or a viewer's matches across
 * leagues), plus `matchPlayersMap` keyed by match id, plus a
 * `resolveLeague` callback that returns the matching League for a
 * given match (league page: same league for all; profile page: per
 * match from an embedded leagues map).
 *
 * Design notes:
 *   - Strip auto-centers on today.
 *   - Days with a match show an emerald dot under the date number.
 *   - Multiple matches on the same day stack vertically below the strip.
 *   - "Show full list" link ALWAYS goes to /profile/matches since
 *     that's the cross-league Past/Scheduled list page.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { MatchDetailCard } from "./MatchDetailCard"
import { DatePickerModal } from "./DatePickerModal"
import type { League, Match, MatchPlayer } from "./types"

export interface MatchCalendarSectionProps {
  matches: Match[]
  matchPlayersMap: Map<string | number, MatchPlayer[]>
  currentUserId: string
  /**
   * Returns the League that contextualizes a given match. Called per
   * rendered MatchDetailCard. On the league page this always returns
   * the same league object; on profile it looks up by match.league_id.
   */
  resolveLeague: (match: Match) => League | null
  onRefresh: () => Promise<void> | void
  /**
   * Optional URL-driven focus (league page forwards this from
   * `?match=X&edit=1`). When set, strip defaults to that match's date
   * and the card auto-opens its score editor if `autoEdit`.
   */
  focusMatchId?: string | null
  autoEdit?: boolean
  onFocusConsumed?: () => void
  /**
   * Number of days to show on either side of today. Default 15
   * (a 31-day viewport). Narrow the range for league periods that
   * don't span that long if you want — the strip is scrollable either way.
   */
  daysBefore?: number
  daysAfter?: number
  /** Forwarded to the inline MatchDetailCard — see its docstring. */
  context?: "league" | "profile"
  /**
   * League id used only by the empty-day CTA to deep-link into the
   * match-create form with a pre-selected league. On league page this
   * is the current league's id; on profile page leave unset and the
   * CTA will open the create page without pre-selecting a league
   * (user picks one there).
   */
  defaultLeagueId?: string | number | null
  /**
   * Forwarded to each rendered MatchDetailCard. Lets the "Lowest of
   * league" flame chip show up on the specific card/row that holds
   * the league-wide best approved round. Computed once upstream so
   * per-card rendering doesn't re-scan the full match set.
   */
  leagueHighlights?: {
    lowestRound?: {
      matchId: string
      userId: string
      score: number
    } | null
  } | null
}

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"]

// Local-date → `yyyy-mm-dd`. See DatePickerModal's note for the
// same-reason rationale: `toISOString()` is UTC-based and shifts by
// the viewer's offset, which is wrong when comparing with server
// `match_date` strings that are calendar-day values.
function toIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function MatchCalendarSection({
  matches,
  matchPlayersMap,
  currentUserId,
  resolveLeague,
  onRefresh,
  focusMatchId,
  autoEdit,
  onFocusConsumed,
  daysBefore = 15,
  daysAfter = 15,
  context = "profile",
  defaultLeagueId = null,
  leagueHighlights = null,
}: MatchCalendarSectionProps) {
  const todayIso = useMemo(() => toIso(new Date()), [])

  // Build the list of calendar days (iso strings) for the strip.
  // Balanced around today so the strip reveals equal past+future on
  // first load; auto-center effect pins today to the middle.
  const days = useMemo(() => {
    const out: string[] = []
    const start = new Date()
    start.setDate(start.getDate() - daysBefore)
    for (let i = 0; i <= daysBefore + daysAfter; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      out.push(toIso(d))
    }
    return out
  }, [daysBefore, daysAfter])

  // Group matches by date so we can show multiple per day, flag days,
  // and find a match by id quickly.
  const matchesByDate = useMemo(() => {
    const map = new Map<string, Match[]>()
    for (const m of matches) {
      if (!m.match_date) continue
      const arr = map.get(m.match_date) ?? []
      arr.push(m)
      map.set(m.match_date, arr)
    }
    // Sort each day's matches by time (earliest first, nulls last).
    for (const arr of Array.from(map.values())) {
      arr.sort((a, b) => {
        const ta = a.match_time ?? "99:99"
        const tb = b.match_time ?? "99:99"
        return ta.localeCompare(tb)
      })
    }
    return map
  }, [matches])

  // Initial selected date: focusMatchId's date if it exists in `days`;
  // else today if there are matches today; else the nearest upcoming
  // day with matches; else the nearest past day with matches; else today.
  const initialDate = useMemo<string>(() => {
    if (focusMatchId) {
      const m = matches.find((x) => String(x.id) === focusMatchId)
      if (m?.match_date) return m.match_date
    }
    if (matchesByDate.has(todayIso)) return todayIso
    const futureWithMatch = days.find(
      (d) => d >= todayIso && matchesByDate.has(d),
    )
    if (futureWithMatch) return futureWithMatch
    const pastWithMatch = [...days]
      .reverse()
      .find((d) => d < todayIso && matchesByDate.has(d))
    return pastWithMatch ?? todayIso
  }, [focusMatchId, matches, matchesByDate, todayIso, days])

  const [selectedDate, setSelectedDate] = useState<string>(initialDate)

  // Re-seek when URL focus changes mid-session (banner click).
  useEffect(() => {
    if (focusMatchId) setSelectedDate(initialDate)
  }, [focusMatchId, initialDate])

  // When the banner click drives a focus seek, scroll the detail
  // body into view so the user sees the roster + Approve button
  // immediately — otherwise the banner is at the top of the page and
  // the match card lives below the leaderboard, requiring manual
  // scroll to find. Skip scrolling on plain mount (no focus intent)
  // so the initial page load respects the user's current scroll.
  const detailRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focusMatchId) return
    // Defer one frame so the detail card has already mounted at
    // the new selectedDate.
    const raf = requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [focusMatchId, selectedDate])

  // Auto-center today on mount — same approach as the old
  // WeekCalendarCard: two rAF nests for layout-settled measurements.
  const scrollRef = useRef<HTMLDivElement>(null)
  const centerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const container = scrollRef.current
        const center = centerRef.current
        if (!container || !center) return
        const cRect = container.getBoundingClientRect()
        const tRect = center.getBoundingClientRect()
        const offset = tRect.left - cRect.left + container.scrollLeft
        container.scrollLeft = Math.max(0, offset - cRect.width / 2 + tRect.width / 2)
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
    }
  }, [days])

  // Date-picker escape hatch for dates outside the ±15 window.
  // Uses our own styled `DatePickerModal` instead of the native
  // `<input type="date">` — more consistent with the app palette and
  // lets us surface dots on days that already have matches.
  const [datePickerOpen, setDatePickerOpen] = useState(false)

  const matchesOnSelected = matchesByDate.get(selectedDate) ?? []

  return (
    <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
      {/* Heading = link to the full tabbed Past/Scheduled list.
          On the league page we pass `?league=<id>` so the list is
          scoped to that league only (and relabels itself "League
          calendar" there). On /profile we send the bare path so the
          list stays cross-league ("My calendar"). */}
      <h2 className="mb-3">
        <Link
          href={
            context === "league" && defaultLeagueId != null
              ? `/profile/matches?league=${encodeURIComponent(String(defaultLeagueId))}`
              : "/profile/matches"
          }
          className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary/70"
          aria-label={
            context === "league"
              ? "League calendar — see all matches"
              : "My calendar — see all matches"
          }
        >
          {context === "league" ? "League calendar" : "My calendar"}
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary/40" aria-hidden="true">
            <polyline points="9 6 15 12 9 18" />
          </svg>
        </Link>
      </h2>

      {/* Day strip */}
      <div className="flex items-end gap-2">
        <div
          ref={scrollRef}
          className="no-scrollbar -ml-5 min-w-0 flex-1 overflow-x-auto pl-5 pb-1"
        >
          <div className="flex gap-2">
            {days.map((iso) => {
              const d = new Date(iso)
              const letter = WEEKDAY_LETTERS[d.getDay()]
              const num = d.getDate()
              const isToday = iso === todayIso
              const isSelected = iso === selectedDate
              const isPast = iso < todayIso
              const matchesOnDay = matchesByDate.get(iso) ?? []

              // Is the viewer rostered on at least one of today's
              // matches? Drives the "joinable" status — when the
              // answer is no and the day is today/future, we surface
              // the opportunity in a distinct color. We check against
              // `matchPlayersMap` (approved roster only is fine here;
              // if you're approved you're already "in it"; if you
              // still have a pending request the day will stay
              // "joinable" which is the right nudge).
              const viewerIsInAnyMatch = matchesOnDay.some((m) =>
                (matchPlayersMap.get(m.id) ?? []).some(
                  (p) => p.user_id === currentUserId,
                ),
              )

              // Compute a semantic status per day. Six buckets:
              //   empty      — no match scheduled
              //   future     — match in a future date, viewer is in it
              //   today      — match today (calls attention), viewer is in it
              //   joinable   — today/future match viewer isn't in yet
              //   completed  — past match, all scores approved
              //   awaiting   — past match, some scores still missing
              //                / pending (the "what happened?" state)
              const dayStatus = computeDayStatus(
                matchesOnDay,
                isToday,
                isPast,
                viewerIsInAnyMatch,
              )

              // Map status → Tailwind classes. Selected overrides with
              // a ring. "empty" past days get a dimmer wash so the eye
              // skips over them quickly.
              const circleClass = dayCircleClasses({
                status: dayStatus,
                isSelected,
                isPast,
                isToday,
              })

              const labelClass = `text-[10px] font-medium uppercase tracking-wide ${
                isToday ? "text-primary" : "text-primary/40"
              }`

              return (
                <div
                  key={iso}
                  ref={isToday ? centerRef : undefined}
                  className="flex min-w-[42px] shrink-0 flex-col items-center gap-1"
                >
                  <span className={labelClass}>{letter}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedDate(iso)}
                    className={`relative ${circleClass} focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`}
                    aria-label={`${d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}${dayStatus !== "empty" ? ` — ${dayStatusLabel(dayStatus)}` : ""}`}
                    aria-pressed={isSelected}
                  >
                    {num}
                    {/* Tiny check overlay on completed past matches —
                        distinguishes them from future matches at a
                        glance without needing to read the color. */}
                    {dayStatus === "completed" && !isSelected && (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="9"
                        height="9"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="absolute -bottom-0.5 -right-0.5 rounded-full bg-white p-0.5 text-emerald-600"
                        aria-hidden="true"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        {/* Date picker escape hatch */}
        <div className="flex shrink-0 flex-col items-center gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-primary/40">&nbsp;</span>
          <button
            type="button"
            onClick={() => setDatePickerOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/20 bg-white text-primary/60 transition-colors hover:bg-primary/5 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            aria-label="Jump to a specific date"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </button>
        </div>
      </div>

      {/* Custom-styled date picker. Opens when the calendar icon on
          the right of the day strip is tapped. Highlights days that
          already have matches in the current data set. */}
      <DatePickerModal
        open={datePickerOpen}
        selected={selectedDate}
        onSelect={setSelectedDate}
        onClose={() => setDatePickerOpen(false)}
        matchDates={new Set(matchesByDate.keys())}
      />

      {/* Selected-day detail(s). One match → render the card bare.
          Multiple → horizontal carousel (arrows + dots) so the page
          height stays bounded regardless of how many matches are on
          the same day. `detailRef` is the scroll target used when
          the banner drives a focus seek — brings the roster + action
          buttons into view without requiring the user to scroll. */}
      <div ref={detailRef} className="mt-4">
        {matchesOnSelected.length === 0 ? (
          <EmptyTile
            iso={selectedDate}
            todayIso={todayIso}
            defaultLeagueId={defaultLeagueId}
          />
        ) : (
          <DayMatchesCarousel
            key={selectedDate /* reset index when date changes */}
            matches={matchesOnSelected}
            matchPlayersMap={matchPlayersMap}
            resolveLeague={resolveLeague}
            currentUserId={currentUserId}
            onRefresh={onRefresh}
            focusMatchId={focusMatchId}
            autoEdit={autoEdit}
            onFocusConsumed={onFocusConsumed}
            todayIso={todayIso}
            context={context}
            leagueHighlights={leagueHighlights}
          />
        )}
      </div>
    </section>
  )
}

/* ── Day-status helpers ──────────────────────────────── */

type DayStatus =
  | "empty"
  | "future"
  | "today"
  | "completed"
  | "awaiting"
  | "joinable"

/**
 * Translate a day's matches + where the day sits on the timeline
 * into a single status enum that drives the circle's visual style.
 *
 *   empty      — no match on this day
 *   today      — at least one match scheduled for today (gets a
 *                special ring to pull the eye). If the viewer isn't
 *                in today's match yet, `joinable` still wins so they
 *                notice the open seat.
 *   future     — match on a future date, viewer is already in it
 *   joinable   — match today/future, viewer is NOT in ANY of the
 *                day's matches. Surfaces open rounds they could ask
 *                to join with a distinct color.
 *   completed  — past date, every match status === 'completed'
 *   awaiting   — past date, at least one match not completed
 *                (scores missing, pending approval, or overdue)
 *
 * Doesn't use match_date vs today internally — the caller already
 * computed isToday / isPast and passes them in. Keeps this function
 * pure and easy to unit-test.
 */
function computeDayStatus(
  matches: Match[],
  isToday: boolean,
  isPast: boolean,
  viewerIsInAnyMatch: boolean,
): DayStatus {
  if (matches.length === 0) return "empty"
  if (isPast) {
    return matches.every((m) => m.status === "completed")
      ? "completed"
      : "awaiting"
  }
  // Today/future. If the viewer has no seat in any of the day's
  // matches, this is a joining opportunity — highlight it even on
  // today, so the "open seat" signal isn't swallowed by the today
  // ring.
  if (!viewerIsInAnyMatch) return "joinable"
  if (isToday) return "today"
  return "future"
}

function dayStatusLabel(status: DayStatus): string {
  switch (status) {
    case "today":
      return "match today"
    case "future":
      return "match scheduled"
    case "joinable":
      return "open match — tap to view"
    case "completed":
      return "completed"
    case "awaiting":
      return "awaiting scores"
    default:
      return ""
  }
}

/**
 * Tailwind class string for the day circle, driven by status +
 * selection/past/today context. Kept verbose rather than clever so
 * the mapping between status and color is obvious to a future reader.
 */
function dayCircleClasses({
  status,
  isSelected,
  isPast,
  isToday,
}: {
  status: DayStatus
  isSelected: boolean
  isPast: boolean
  isToday: boolean
}): string {
  const base =
    "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-all"

  // Selection ring color tracks the status — emerald for match
  // days, primary for empty days.
  const ringMatch = "ring-2 ring-emerald-400/60 ring-offset-2"
  const ringEmpty = "ring-2 ring-primary/20 ring-offset-2"

  if (status === "today") {
    // Today always stands out — filled emerald + a subtler ring
    // even when not selected so the eye finds it.
    return `${base} bg-emerald-600 text-white ${isSelected ? ringMatch : "ring-2 ring-emerald-300"}`
  }
  if (status === "future") {
    return `${base} bg-emerald-500 text-white hover:bg-emerald-600 ${isSelected ? ringMatch : ""}`
  }
  if (status === "joinable") {
    // Outlined, not filled — distinguishes "match exists but not
    // yours" from "your match" without stealing the emerald accent.
    // Amber-adjacent so it reads as an opportunity / call-to-action
    // instead of an error (which awaiting's amber-500 owns).
    return `${base} border-2 border-emerald-500 bg-white text-emerald-600 hover:bg-emerald-50 ${isSelected ? ringMatch : ""}`
  }
  if (status === "completed") {
    return `${base} bg-emerald-500/70 text-white hover:bg-emerald-500 ${isSelected ? ringMatch : ""}`
  }
  if (status === "awaiting") {
    return `${base} bg-amber-500 text-white hover:bg-amber-600 ${isSelected ? "ring-2 ring-amber-400/60 ring-offset-2" : ""}`
  }
  // empty — dimmer for past, slightly more present for today/future
  const emptyBg = isSelected
    ? `border border-primary/40 bg-white text-primary ${ringEmpty}`
    : isToday
      ? "border border-primary/30 bg-white text-primary"
      : isPast
        ? "bg-primary/[0.03] text-primary/30"
        : "bg-primary/5 text-primary/40"
  return `${base} ${emptyBg}`
}

/* ── Same-day match carousel ──────────────────────────── */
/**
 * When a day has 2+ matches (possible when a player is booked for
 * multiple courses on one date), we swap the vertical stack for a
 * carousel so the section height stays compact. Arrows are absolutely
 * positioned over the card edges; dots below signal swipeability.
 *
 * When there's a focusMatchId that belongs to this day's set, seek
 * the carousel to that match's index so the URL-driven auto-edit
 * flow lands on the right card.
 */
function DayMatchesCarousel({
  matches,
  matchPlayersMap,
  resolveLeague,
  currentUserId,
  onRefresh,
  focusMatchId,
  autoEdit,
  onFocusConsumed,
  todayIso,
  context,
  leagueHighlights,
}: {
  matches: Match[]
  matchPlayersMap: Map<string | number, MatchPlayer[]>
  resolveLeague: (m: Match) => League | null
  currentUserId: string
  onRefresh: () => Promise<void> | void
  focusMatchId?: string | null
  autoEdit?: boolean
  onFocusConsumed?: () => void
  todayIso: string
  context: "league" | "profile"
  leagueHighlights?: {
    lowestRound?: {
      matchId: string
      userId: string
      score: number
    } | null
  } | null
}) {
  const initialIndex = focusMatchId
    ? Math.max(
        0,
        matches.findIndex((m) => String(m.id) === focusMatchId),
      )
    : 0

  const [index, setIndex] = useState(initialIndex)
  const safeIndex = Math.min(index, Math.max(matches.length - 1, 0))
  const current = matches[safeIndex]
  // Pointer-drag state for swipe-to-paginate. We only care about
  // the gesture's start + end; no live drag offset to keep render
  // cheap. Threshold is 50px horizontal — below that, it's a tap
  // and any button inside the card still gets the click (pointer
  // events do not preventDefault on <button> by default).
  // Axis check (|dx| > |dy|) prevents accidental swipe when the
  // user is trying to scroll the page vertically.
  const startX = useRef(0)
  const startY = useRef(0)
  const tracking = useRef(false)
  const SWIPE_THRESHOLD = 50

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.isPrimary === false) return
    startX.current = e.clientX
    startY.current = e.clientY
    tracking.current = true
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (!tracking.current) return
    tracking.current = false
    const dx = e.clientX - startX.current
    const dy = e.clientY - startY.current
    if (Math.abs(dx) < SWIPE_THRESHOLD) return
    if (Math.abs(dx) < Math.abs(dy)) return
    if (dx < 0 && safeIndex < matches.length - 1) {
      setIndex((i) => Math.min(matches.length - 1, i + 1))
    } else if (dx > 0 && safeIndex > 0) {
      setIndex((i) => Math.max(0, i - 1))
    }
  }
  const onPointerCancel = () => {
    tracking.current = false
  }

  if (!current) return null

  const league = resolveLeague(current)
  const hasPrev = safeIndex > 0
  const hasNext = safeIndex < matches.length - 1

  return (
    <div className="flex flex-col gap-2">
      {/* touch-action: pan-y tells the browser that vertical
          scrolling is still fine here, but horizontal gestures are
          ours to claim. Without it, some mobile browsers eat the
          horizontal motion as a back-swipe or text selection. */}
      <div
        className="relative touch-pan-y"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerCancel}
      >
        {league && (
          <MatchDetailCard
            match={current}
            league={league}
            matchPlayers={matchPlayersMap.get(current.id)}
            currentUserId={currentUserId}
            variant={
              current.status === "completed" ||
              (current.match_date != null && current.match_date < todayIso)
                ? "past"
                : "scheduled"
            }
            onRefresh={onRefresh}
            autoEdit={
              !!focusMatchId &&
              String(current.id) === focusMatchId &&
              !!autoEdit
            }
            onAutoEditConsumed={onFocusConsumed}
            context={context}
            leagueHighlights={leagueHighlights}
          />
        )}

        {matches.length > 1 && hasPrev && (
          <button
            type="button"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            className="absolute left-1 top-5 flex h-7 w-7 items-center justify-center rounded-full bg-white/80 text-primary shadow ring-1 ring-primary/10 backdrop-blur hover:bg-white"
            aria-label="Previous match on this day"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}
        {matches.length > 1 && hasNext && (
          <button
            type="button"
            onClick={() =>
              setIndex((i) => Math.min(matches.length - 1, i + 1))
            }
            className="absolute right-1 top-5 flex h-7 w-7 items-center justify-center rounded-full bg-white/80 text-primary shadow ring-1 ring-primary/10 backdrop-blur hover:bg-white"
            aria-label="Next match on this day"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </button>
        )}
      </div>

      {matches.length > 1 && (
        <div className="flex items-center justify-center gap-1.5">
          {matches.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === safeIndex
                  ? "w-5 bg-primary"
                  : "w-1.5 bg-primary/20 hover:bg-primary/40"
              }`}
              aria-label={`Go to match ${i + 1} of ${matches.length}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyTile({
  iso,
  todayIso,
  defaultLeagueId,
}: {
  iso: string
  todayIso: string
  defaultLeagueId: string | number | null
}) {
  const d = new Date(iso)
  const isToday = iso === todayIso
  const isPast = iso < todayIso
  const dayLabel = d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  })

  // Past empty days are read-only — you can't retroactively create a
  // round that never happened. Fall back to a quiet "nothing here"
  // tile so the day is still explorable from the strip without
  // dangling a misleading CTA.
  if (isPast) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-primary/15 bg-cream/20 px-4 py-4 text-center">
        <p className="text-xs text-primary/50">No match on {dayLabel}</p>
      </div>
    )
  }

  // Today / future → active CTA that deep-links into the match-create
  // form with date + league pre-filled.
  const params = new URLSearchParams({ date: iso })
  if (defaultLeagueId != null) params.set("league", String(defaultLeagueId))
  const href = `/matches/create?${params.toString()}`

  return (
    <Link
      href={href}
      className="group flex items-center justify-center gap-3 rounded-lg border border-dashed border-primary/20 bg-cream/20 px-4 py-5 text-center transition-colors hover:border-primary/40 hover:bg-cream/40"
      aria-label={`Create a match for ${isToday ? "today" : dayLabel}`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-cream shadow-sm transition-transform group-hover:scale-105">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </span>
      <span className="flex flex-col text-left">
        <span className="text-sm font-semibold text-primary">
          Create match
        </span>
        <span className="text-[11px] text-primary/60">
          {isToday ? "today" : `on ${dayLabel}`}
        </span>
      </span>
    </Link>
  )
}

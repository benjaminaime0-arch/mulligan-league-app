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
      {/* Heading = link. Tapping it jumps to /profile/matches — the
          viewer's full tabbed Past/Scheduled list across leagues.
          Label flips by context so the section identity reads right:
          - league page → "League calendar" (scoped strip + details)
          - profile page → "My calendar" (cross-league)
          Destination is the same full-list page either way. */}
      <h2 className="mb-3">
        <Link
          href="/profile/matches"
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
              const hasMatch = matchesByDate.has(iso)

              // Circle style: green for has-match, different tints for
              // past vs upcoming, ring when selected.
              const circleClass = [
                "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-all",
                hasMatch
                  ? isSelected
                    ? "bg-emerald-500 text-white ring-2 ring-emerald-500/40 ring-offset-2"
                    : isPast
                      ? "bg-emerald-500/70 text-white hover:bg-emerald-500"
                      : "bg-emerald-500 text-white hover:bg-emerald-600"
                  : isSelected
                    ? "border border-primary/40 bg-white text-primary ring-2 ring-primary/20 ring-offset-2"
                    : isToday
                      ? "border border-primary/30 bg-white text-primary"
                      : isPast
                        ? "bg-primary/[0.03] text-primary/30"
                        : "bg-primary/5 text-primary/40",
              ].join(" ")

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
                    className={`${circleClass} focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`}
                    aria-label={`${d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}${hasMatch ? " — match" : ""}`}
                    aria-pressed={isSelected}
                  >
                    {num}
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
          <EmptyTile iso={selectedDate} todayIso={todayIso} />
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
          />
        )}
      </div>
    </section>
  )
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

function EmptyTile({ iso, todayIso }: { iso: string; todayIso: string }) {
  const d = new Date(iso)
  const isToday = iso === todayIso
  const label = isToday
    ? "No match today"
    : `No match on ${d.toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      })}`
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-primary/15 bg-cream/30 px-4 py-4 text-center">
      <p className="text-xs text-primary/50">{label}</p>
    </div>
  )
}

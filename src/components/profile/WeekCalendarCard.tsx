"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"

export interface CalendarDay {
  date: string // ISO yyyy-mm-dd
  has_match: boolean
  /** First match on that day (earliest match_time), or null when no match. */
  match_id?: string | null
  /** HH:MM:SS time string or null. */
  match_time?: string | null
  /** 'scheduled' | 'in_progress' | 'completed' — for past vs future styling. */
  match_status?: string | null
  course_name?: string | null
  league_name?: string | null
}

export interface WeekStatsData {
  current_streak_weeks: number
  calendar: CalendarDay[]
  /** Kept in response for back-compat. The component uses `calendar` now. */
  next_match?: unknown
}

interface WeekCalendarCardProps {
  week: WeekStatsData | null
  loading?: boolean
}

/** One-letter weekday labels keyed by JS getDay() (0=Sun .. 6=Sat). */
const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"]

export function WeekCalendarCard({
  week,
  loading = false,
}: WeekCalendarCardProps) {
  const router = useRouter()
  const { user } = useAuth()
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [dateJumpMessage, setDateJumpMessage] = useState<string | null>(null)
  const dateInputRef = useRef<HTMLInputElement>(null)

  /**
   * Calendar-icon flow: user taps the icon → native date picker opens →
   * onChange fires. We query get_user_match_on_date; if there's a match
   * for the user on that date we navigate to it, otherwise we set a brief
   * message under the strip.
   */
  const handleDatePicked = async (iso: string) => {
    if (!user) return
    setDateJumpMessage("Looking up…")
    const { data, error } = await supabase.rpc("get_user_match_on_date", {
      p_user_id: user.id,
      p_date: iso,
    })
    if (error) {
      setDateJumpMessage("Couldn't load that date.")
      return
    }
    if (data) {
      router.push(`/matches/${data as string}`)
    } else {
      const d = new Date(iso).toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      })
      setDateJumpMessage(`No match on ${d}`)
      // Clear after a moment so the strip looks clean again
      setTimeout(() => setDateJumpMessage(null), 2500)
    }
  }

  const handleCalendarIconClick = () => {
    const input = dateInputRef.current
    if (!input) return
    // showPicker() is the modern API; fall back to .click() for older browsers
    if (typeof input.showPicker === "function") {
      try {
        input.showPicker()
        return
      } catch {
        // fall through
      }
    }
    input.click()
  }

  // Track which calendar day is selected. Default: today (if it has a match),
  // else the first future day that has a match, else null.
  const defaultSelected = useMemo<string | null>(() => {
    if (!week) return null
    const todayDay = week.calendar.find((d) => d.date === todayIso)
    if (todayDay?.has_match) return todayIso
    const firstWith = week.calendar.find((d) => d.has_match)
    return firstWith?.date ?? null
  }, [week, todayIso])

  const [selectedDate, setSelectedDate] = useState<string | null>(defaultSelected)

  // Reset selection when week data changes (e.g. after a refresh).
  useEffect(() => {
    setSelectedDate(defaultSelected)
  }, [defaultSelected])

  const selectedDay =
    (selectedDate && week?.calendar.find((d) => d.date === selectedDate)) || null

  // Auto-center today's dot in the horizontal scroll strip whenever
  // the week data loads. Using getBoundingClientRect for positioning
  // is the most reliable approach — scrollIntoView and offsetLeft
  // both have edge cases (offsetParent semantics, page-level scroll
  // bleed) that broke this in previous attempts. We defer two
  // requestAnimationFrames so layout is fully settled.
  const scrollRef = useRef<HTMLDivElement>(null)
  const todayRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!week) return
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const container = scrollRef.current
        const today = todayRef.current
        if (!container || !today) return
        const cRect = container.getBoundingClientRect()
        const tRect = today.getBoundingClientRect()
        const todayOffset =
          tRect.left - cRect.left + container.scrollLeft
        const target = todayOffset - cRect.width / 2 + tRect.width / 2
        container.scrollLeft = Math.max(0, target)
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
    }
  }, [week])

  return (
    <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-primary">This week</h2>
        {week && week.current_streak_weeks > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-600">
            <FlameIcon />
            {week.current_streak_weeks}-week streak
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        </div>
      ) : (
        <>
          {/* Horizontal scrollable calendar strip + calendar icon for the
              date-picker escape hatch. */}
          <div className="flex items-end gap-2">
            <div
              ref={scrollRef}
              className="no-scrollbar -ml-5 min-w-0 flex-1 overflow-x-auto pl-5 pb-1"
            >
            <div className="flex gap-2">
              {(week?.calendar ?? []).map((day) => {
                const dateObj = new Date(day.date)
                const letter = WEEKDAY_LETTERS[dateObj.getDay()]
                const dayNum = dateObj.getDate()
                const isToday = day.date === todayIso
                const isSelected = day.date === selectedDate
                const isPast = day.date < todayIso
                const dateLabel = dateObj.toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })

                // Dot styling differs for match-on-that-day vs empty,
                // and for past (already played/completed) vs future.
                const circleClass = [
                  "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-all",
                  day.has_match
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
                    key={day.date}
                    ref={isToday ? todayRef : undefined}
                    className="flex min-w-[42px] shrink-0 flex-col items-center gap-1"
                  >
                    <span className={labelClass}>{letter}</span>
                    <button
                      type="button"
                      onClick={() => setSelectedDate(day.date)}
                      className={`${circleClass} focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`}
                      aria-label={`${dateLabel}${day.has_match ? " — match" : ""}`}
                      aria-pressed={isSelected}
                    >
                      {dayNum}
                    </button>
                  </div>
                )
              })}
            </div>
            </div>

            {/* Calendar icon — opens native date picker to jump to any date */}
            <div className="flex shrink-0 flex-col items-center gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-primary/40">
                &nbsp;
              </span>
              <button
                type="button"
                onClick={handleCalendarIconClick}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/20 bg-white text-primary/60 transition-colors hover:bg-primary/5 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                aria-label="Jump to a specific date"
              >
                <CalendarIcon />
              </button>
              {/* Hidden native date input, triggered by the button above */}
              <input
                ref={dateInputRef}
                type="date"
                className="sr-only"
                onChange={(e) => {
                  if (e.target.value) handleDatePicked(e.target.value)
                  // Reset so selecting the same date again re-fires
                  e.target.value = ""
                }}
                tabIndex={-1}
                aria-hidden="true"
              />
            </div>
          </div>

          {/* Date-jump feedback */}
          {dateJumpMessage && (
            <p className="mt-2 text-center text-[11px] text-primary/50">
              {dateJumpMessage}
            </p>
          )}


          {/* Tile reflects the selected day */}
          <div className="mt-4">
            {selectedDay?.has_match && selectedDay.match_id ? (
              <SelectedMatchTile day={selectedDay} todayIso={todayIso} />
            ) : (
              <NoMatchTile selectedDate={selectedDate} todayIso={todayIso} />
            )}
          </div>
        </>
      )}
    </section>
  )
}

function SelectedMatchTile({
  day,
  todayIso,
}: {
  day: CalendarDay
  todayIso: string
}) {
  const dateObj = new Date(day.date)
  const isToday = day.date === todayIso
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const isTomorrow = day.date === tomorrow.toISOString().slice(0, 10)

  const weekdayLabel = isToday
    ? "Today"
    : isTomorrow
    ? "Tomorrow"
    : dateObj.toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      })

  return (
    <Link
      href={`/matches/${day.match_id}`}
      className="flex items-center gap-3 rounded-lg border border-primary/15 bg-cream/40 px-4 py-3 transition-colors hover:bg-cream/70"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <CalendarIcon />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-primary/50">
          {isToday ? "Today" : "Upcoming"}
        </p>
        <p className="truncate text-sm font-semibold text-primary">
          {weekdayLabel}
          {day.match_time ? ` · ${day.match_time.slice(0, 5)}` : ""}
        </p>
        <p className="truncate text-[11px] text-primary/50">
          {day.course_name || "Course TBA"}
          {day.league_name ? ` · ${day.league_name}` : ""}
        </p>
      </div>
      <ChevronRightIcon />
    </Link>
  )
}

function NoMatchTile({
  selectedDate,
  todayIso,
}: {
  selectedDate: string | null
  todayIso: string
}) {
  // Friendly copy based on which day is selected
  let label = "No match scheduled this week"
  if (selectedDate) {
    if (selectedDate === todayIso) {
      label = "No match today"
    } else {
      const d = new Date(selectedDate)
      label = `No match on ${d.toLocaleDateString("en-US", {
        weekday: "long",
      })}`
    }
  }

  return (
    <Link
      href="/matches/create"
      className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-primary/90"
    >
      <PlusIcon />
      {label === "No match scheduled this week" ? "Create a match" : `${label} — create one`}
    </Link>
  )
}

/* ── Icons ────────────────────────────────────────────── */

function FlameIcon() {
  return (
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
  )
}

function PlusIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-primary/30"
      aria-hidden="true"
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  )
}

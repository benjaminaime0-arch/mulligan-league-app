"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

export interface CalendarDay {
  date: string // ISO yyyy-mm-dd
  has_match: boolean
  /** First match on that day (earliest match_time), or null when no match. */
  match_id?: string | null
  /** HH:MM:SS time string or null. */
  match_time?: string | null
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
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), [])

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
          {/* 7-day calendar — selectable */}
          <div className="flex justify-between gap-1">
            {(week?.calendar ?? []).map((day) => {
              const dateObj = new Date(day.date)
              const letter = WEEKDAY_LETTERS[dateObj.getDay()]
              const dayNum = dateObj.getDate()
              const isToday = day.date === todayIso
              const isSelected = day.date === selectedDate
              const dateLabel = dateObj.toLocaleDateString("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
              })

              const circleClass = [
                "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-all",
                day.has_match
                  ? isSelected
                    ? "bg-emerald-500 text-white ring-2 ring-emerald-500/40 ring-offset-2"
                    : "bg-emerald-500 text-white hover:bg-emerald-600"
                  : isSelected
                  ? "border border-primary/40 bg-white text-primary ring-2 ring-primary/20 ring-offset-2"
                  : isToday
                  ? "border border-primary/30 bg-white text-primary"
                  : "bg-primary/5 text-primary/40",
              ].join(" ")

              const labelClass = `text-[10px] font-medium uppercase tracking-wide ${
                isToday ? "text-primary" : "text-primary/40"
              }`

              return (
                <div
                  key={day.date}
                  className="flex min-w-0 flex-1 flex-col items-center gap-1"
                >
                  <span className={labelClass}>{letter}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedDate(day.date)}
                    className={`${circleClass} focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`}
                    aria-label={`${dateLabel}${day.has_match ? " — match scheduled" : ""}`}
                    aria-pressed={isSelected}
                  >
                    {dayNum}
                  </button>
                </div>
              )
            })}
          </div>

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

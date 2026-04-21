"use client"

import Link from "next/link"

export interface CalendarDay {
  date: string // ISO yyyy-mm-dd
  has_match: boolean
}

export interface NextMatch {
  match_id: string
  match_date: string
  match_time: string | null
  course_name: string | null
  league_name: string | null
}

export interface WeekStatsData {
  current_streak_weeks: number
  calendar: CalendarDay[]
  next_match: NextMatch | null
}

interface WeekCalendarCardProps {
  week: WeekStatsData | null
  loading?: boolean
}

/** One-letter weekday labels keyed by JS getDay() (0=Sun .. 6=Sat). */
const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"]

export function WeekCalendarCard({ week, loading = false }: WeekCalendarCardProps) {
  const todayIso = new Date().toISOString().slice(0, 10)

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
          {/* 7-day calendar */}
          <div className="flex justify-between gap-1">
            {(week?.calendar ?? []).map((day) => {
              const dateObj = new Date(day.date)
              const letter = WEEKDAY_LETTERS[dateObj.getDay()]
              const dayNum = dateObj.getDate()
              const isToday = day.date === todayIso

              return (
                <div
                  key={day.date}
                  className="flex min-w-0 flex-1 flex-col items-center gap-1"
                >
                  <span
                    className={`text-[10px] font-medium uppercase tracking-wide ${
                      isToday ? "text-primary" : "text-primary/40"
                    }`}
                  >
                    {letter}
                  </span>
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                      day.has_match
                        ? "bg-emerald-500 text-white"
                        : isToday
                        ? "border border-primary/30 bg-white text-primary"
                        : "bg-primary/5 text-primary/40"
                    }`}
                    aria-label={`${dateObj.toLocaleDateString("en-US", {
                      weekday: "long",
                      month: "short",
                      day: "numeric",
                    })}${day.has_match ? " — match played" : ""}`}
                  >
                    {dayNum}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Contextual CTA */}
          <div className="mt-4">
            {week?.next_match ? (
              <NextMatchCTA match={week.next_match} />
            ) : (
              <Link
                href="/matches/create"
                className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream transition-colors hover:bg-primary/90"
              >
                <PlusIcon />
                Create a match
              </Link>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function NextMatchCTA({ match }: { match: NextMatch }) {
  const dateObj = new Date(match.match_date)
  const todayIso = new Date().toISOString().slice(0, 10)
  const isToday = match.match_date === todayIso

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowIso = tomorrow.toISOString().slice(0, 10)
  const isTomorrow = match.match_date === tomorrowIso

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
      href={`/matches/${match.match_id}`}
      className="flex items-center gap-3 rounded-lg border border-primary/15 bg-cream/40 px-4 py-3 transition-colors hover:bg-cream/70"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <CalendarIcon />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-primary/50">
          Next up
        </p>
        <p className="truncate text-sm font-semibold text-primary">
          {weekdayLabel}
          {match.match_time ? ` · ${match.match_time.slice(0, 5)}` : ""}
        </p>
        <p className="truncate text-[11px] text-primary/50">
          {match.course_name || "Course TBA"}
          {match.league_name ? ` · ${match.league_name}` : ""}
        </p>
      </div>
      <ChevronRightIcon />
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

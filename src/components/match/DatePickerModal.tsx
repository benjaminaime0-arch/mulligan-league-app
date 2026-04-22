"use client"

/**
 * Styled date-picker modal replacing the native `<input type="date">`
 * used to jump outside the day-strip window.
 *
 *   - Bottom sheet on mobile, centered modal on wider screens.
 *   - Full month grid with prev/next navigation.
 *   - Today highlighted with a ring, selected day with primary bg.
 *   - Days that have matches in the parent's data set get an emerald
 *     dot below the number so users can scan future/past months for
 *     matches without tapping every date.
 *   - Palette sticks to the app's `primary` + `cream` tokens.
 */

import { useCallback, useEffect, useMemo, useState } from "react"

interface DatePickerModalProps {
  open: boolean
  /** ISO `yyyy-mm-dd` of the currently-selected day (used to seed the view). */
  selected: string
  onSelect: (iso: string) => void
  onClose: () => void
  /** Days with matches; each gets an emerald dot. */
  matchDates?: Set<string>
}

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"]
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

// Local-date → `yyyy-mm-dd`. We deliberately do NOT use
// `Date#toISOString()` here because that uses UTC, and a Date object
// at local midnight in any positive-UTC zone serialises to the
// *previous* calendar day — which caused cells labelled "24" to map
// to the 23rd's match data.
function toIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function startOfMonth(d: Date): Date {
  const r = new Date(d)
  r.setDate(1)
  r.setHours(0, 0, 0, 0)
  return r
}

export function DatePickerModal({
  open,
  selected,
  onSelect,
  onClose,
  matchDates,
}: DatePickerModalProps) {
  // The month currently being browsed. Starts at the selected day's
  // month, updated as the user taps prev/next. Resets when the modal
  // opens fresh (not on every re-render, just on open → selected change).
  const [viewDate, setViewDate] = useState<Date>(() =>
    startOfMonth(new Date(selected)),
  )

  useEffect(() => {
    if (open) setViewDate(startOfMonth(new Date(selected)))
  }, [open, selected])

  // Lock body scroll + close on Esc, mirroring the old MatchPreviewModal
  // UX so the picker feels like a modal rather than an inline control.
  useEffect(() => {
    if (!open) return
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
  }, [open, onClose])

  const prevMonth = useCallback(() => {
    setViewDate((d) => {
      const r = new Date(d)
      r.setMonth(r.getMonth() - 1)
      return r
    })
  }, [])
  const nextMonth = useCallback(() => {
    setViewDate((d) => {
      const r = new Date(d)
      r.setMonth(r.getMonth() + 1)
      return r
    })
  }, [])

  // Build the 6×7 calendar grid. JS getDay() returns 0=Sun..6=Sat, so
  // leading blanks = getDay() of the first of the month.
  const cells = useMemo(() => {
    const first = startOfMonth(viewDate)
    const leading = first.getDay()
    const start = new Date(first)
    start.setDate(first.getDate() - leading)
    const out: Date[] = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      out.push(d)
    }
    return out
  }, [viewDate])

  const todayIso = useMemo(() => toIso(new Date()), [])

  if (!open) return null

  const handlePick = (iso: string) => {
    onSelect(iso)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Pick a date"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-primary">
            {MONTH_NAMES[viewDate.getMonth()]} {viewDate.getFullYear()}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={prevMonth}
              aria-label="Previous month"
              className="flex h-8 w-8 items-center justify-center rounded-full text-primary/60 hover:bg-primary/5 hover:text-primary"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={nextMonth}
              aria-label="Next month"
              className="flex h-8 w-8 items-center justify-center rounded-full text-primary/60 hover:bg-primary/5 hover:text-primary"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 6 15 12 9 18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Weekday row */}
        <div className="mt-4 grid grid-cols-7 gap-1 px-1 text-center">
          {WEEKDAY_LETTERS.map((l, i) => (
            <span
              key={`${l}-${i}`}
              className="text-[10px] font-medium uppercase tracking-wide text-primary/40"
            >
              {l}
            </span>
          ))}
        </div>

        {/* Day grid */}
        <div className="mt-1 grid grid-cols-7 gap-1 px-1">
          {cells.map((d) => {
            const iso = toIso(d)
            const inMonth = d.getMonth() === viewDate.getMonth()
            const isToday = iso === todayIso
            const isSelected = iso === selected
            const hasMatch = matchDates?.has(iso) ?? false

            const base =
              "relative flex h-9 w-full items-center justify-center rounded-full text-sm tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            const state = isSelected
              ? "bg-primary text-cream font-semibold"
              : isToday
                ? "ring-1 ring-primary/40 text-primary font-semibold"
                : inMonth
                  ? "text-primary hover:bg-primary/5"
                  : "text-primary/25 hover:bg-primary/5"

            return (
              <button
                key={iso}
                type="button"
                onClick={() => handlePick(iso)}
                className={`${base} ${state}`}
                aria-label={d.toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
                aria-pressed={isSelected}
              >
                {d.getDate()}
                {hasMatch && (
                  <span
                    className={`absolute bottom-1 h-1 w-1 rounded-full ${
                      isSelected ? "bg-cream" : "bg-emerald-500"
                    }`}
                    aria-hidden="true"
                  />
                )}
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => handlePick(todayIso)}
            className="text-xs font-medium text-primary/70 hover:text-primary"
          >
            Today
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium text-primary/50 hover:text-primary"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

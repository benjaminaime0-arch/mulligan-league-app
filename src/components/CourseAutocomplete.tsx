"use client"

import { useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"

/**
 * Type-ahead over the Île-de-France course base (T1.6).
 *
 * Free text stays first-class: whatever the user types IS the value, and a
 * course that isn't in the base can still be submitted (flagged `unverified`
 * by the caller). Picking a suggestion additionally surfaces par / holes /
 * location so the game carries verified data.
 *
 * Debounced at 200ms, fires from 2 characters, and never blocks typing.
 */

export type CourseSuggestion = {
  id: string
  name: string
  city: string | null
  department: string | null
  dept_no: string | null
  holes: number | null
  par: number | null
  course_type: string | null
}

export function CourseAutocomplete({
  value,
  onChange,
  onSelect,
  id = "course",
  placeholder = "Start typing a course name…",
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  /** Called when a suggestion is picked (null when the user free-types). */
  onSelect?: (course: CourseSuggestion | null) => void
  id?: string
  placeholder?: string
  disabled?: boolean
}) {
  const [suggestions, setSuggestions] = useState<CourseSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<CourseSuggestion | null>(null)
  const [highlight, setHighlight] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  // Ignore the search that fires immediately after a pick (the input value
  // becomes the course name, which would otherwise re-open the list).
  const skipNextSearch = useRef(false)

  useEffect(() => {
    if (skipNextSearch.current) {
      skipNextSearch.current = false
      return
    }
    const q = value.trim()
    if (q.length < 2) {
      setSuggestions([])
      setOpen(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc("search_courses", {
        p_query: q,
        p_limit: 8,
      })
      if (cancelled) return
      setLoading(false)
      if (error) {
        // Search is an enhancement — never block the form on it.
        setSuggestions([])
        setOpen(false)
        return
      }
      const rows = (data || []) as CourseSuggestion[]
      setSuggestions(rows)
      setHighlight(0)
      setOpen(rows.length > 0)
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [value])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  const pick = (c: CourseSuggestion) => {
    skipNextSearch.current = true
    onChange(c.name)
    setPicked(c)
    onSelect?.(c)
    setOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setHighlight((h) => (h + 1) % suggestions.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length)
    } else if (e.key === "Enter") {
      e.preventDefault()
      pick(suggestions[highlight])
    } else if (e.key === "Escape") {
      setOpen(false)
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          if (picked) {
            setPicked(null)
            onSelect?.(null)
          }
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-autocomplete="list"
        aria-activedescendant={open && suggestions[highlight] ? `${id}-opt-${highlight}` : undefined}
        disabled={disabled}
      />

      {/* Verified badge once a real course is picked */}
      {picked && (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-primary/60">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Verified
          </span>
          {picked.city && <span>{picked.city}{picked.dept_no ? ` (${picked.dept_no})` : ""}</span>}
          {picked.holes != null && <span>{picked.holes} holes</span>}
          {picked.par != null && <span>Par {picked.par}</span>}
        </p>
      )}
      {!picked && value.trim().length >= 2 && !loading && !open && (
        <p className="mt-1 text-xs text-primary/40">
          Not in our course list — we&apos;ll save it as typed.
        </p>
      )}

      {open && suggestions.length > 0 && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-primary/10 bg-white py-1 shadow-xl"
        >
          {suggestions.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === highlight}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(c)}
                className={`flex w-full flex-col items-start px-3 py-2 text-left ${
                  i === highlight ? "bg-cream" : ""
                }`}
              >
                <span className="text-sm font-medium text-primary">{c.name}</span>
                <span className="text-[11px] text-primary/50">
                  {[
                    c.city,
                    c.dept_no ? `(${c.dept_no})` : null,
                    c.holes != null ? `${c.holes} holes` : c.course_type,
                    c.par != null ? `Par ${c.par}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

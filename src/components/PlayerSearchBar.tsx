"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { Avatar } from "@/components/Avatar"

export type PlayerResult = {
  id: string
  first_name: string
  last_name: string | null
  avatar_url: string | null
  club: string | null
  town: string | null
  handicap: number | null
}

interface PlayerSearchBarProps {
  /** Called when user clicks a player result */
  onSelect?: (player: PlayerResult) => void
  /** Placeholder text */
  placeholder?: string
  /** Auto-focus the input on mount */
  autoFocus?: boolean
}

export function PlayerSearchBar({
  onSelect,
  placeholder = "Search players by name\u2026",
  autoFocus = false,
}: PlayerSearchBarProps) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<PlayerResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const search = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (trimmed.length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase.rpc("search_players", {
      p_query: trimmed,
      p_limit: 10,
    })
    setLoading(false)
    if (!error && data) {
      setResults(data as PlayerResult[])
      setOpen(true)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(query), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, search])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        {/* Search icon */}
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/40"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="w-full rounded-xl border border-primary/20 bg-white py-3 pl-10 pr-4 text-sm text-primary placeholder:text-primary/40 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
          </div>
        )}
      </div>

      {/* Results dropdown */}
      {open && results.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-primary/10 bg-white shadow-lg">
          {results.map((player) => (
            <li key={player.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect?.(player)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-cream"
              >
                <Avatar
                  src={player.avatar_url}
                  alt={player.first_name}
                  size={36}
                  fallback={player.first_name}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-primary">
                    {player.first_name} {player.last_name || ""}
                  </p>
                  <p className="truncate text-xs text-primary/50">
                    {[player.club, player.town, player.handicap != null ? `Hcp ${player.handicap}` : null]
                      .filter(Boolean)
                      .join(" · ") || "No details yet"}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* No results message */}
      {open && results.length === 0 && query.trim().length >= 2 && !loading && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-primary/10 bg-white px-4 py-6 text-center text-sm text-primary/50 shadow-lg">
          No players found for &ldquo;{query.trim()}&rdquo;
        </div>
      )}
    </div>
  )
}

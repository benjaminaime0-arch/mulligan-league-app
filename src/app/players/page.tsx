"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { PlayerSearchBar, type PlayerResult } from "@/components/PlayerSearchBar"
import { Avatar } from "@/components/Avatar"

type RecentPlayer = {
  id: string
  username: string | null
  first_name: string
  last_name: string | null
  avatar_url: string | null
  club: string | null
  town: string | null
  handicap: number | null
}

export default function PlayersPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [recentPlayers, setRecentPlayers] = useState<RecentPlayer[]>([])
  const [loadingRecent, setLoadingRecent] = useState(true)

  // Load players from the user's leagues (people they play with)
  useEffect(() => {
    if (authLoading || !user) return

    const fetchLeagueMates = async () => {
      setLoadingRecent(true)

      // Get all league IDs the user is in
      const { data: memberships } = await supabase
        .from("league_members")
        .select("league_id")
        .eq("user_id", user.id)

      if (!memberships || memberships.length === 0) {
        setLoadingRecent(false)
        return
      }

      const leagueIds = memberships.map((m) => m.league_id)

      // Get unique fellow members from those leagues
      const { data: fellows } = await supabase
        .from("league_members")
        .select("user_id, profiles!inner(id, username, first_name, last_name, avatar_url, club, town, handicap)")
        .in("league_id", leagueIds)
        .neq("user_id", user.id)

      if (fellows) {
        // Deduplicate by user_id
        const seen = new Set<string>()
        const unique: RecentPlayer[] = []
        for (const f of fellows) {
          const p = f.profiles as unknown as RecentPlayer
          if (p && !seen.has(p.id)) {
            seen.add(p.id)
            unique.push(p)
          }
        }
        setRecentPlayers(unique)
      }
      setLoadingRecent(false)
    }

    fetchLeagueMates()
  }, [authLoading, user])

  const handleSelect = (player: PlayerResult) => {
    router.push(`/players/${player.id}`)
  }

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
      </div>
    )
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-6 pt-6 md:pt-8">
      <h1 className="mb-1 text-xl font-bold text-primary">Players</h1>
      <p className="mb-5 text-sm text-primary/60">
        Find golfers and see their profiles.
      </p>

      <PlayerSearchBar onSelect={handleSelect} autoFocus />

      {/* Fellow league members */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-primary/50">
          From your leagues
        </h2>

        {loadingRecent ? (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
          </div>
        ) : recentPlayers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-primary/15 px-4 py-8 text-center text-sm text-primary/40">
            Join a league to see other players here.
          </p>
        ) : (
          <ul className="divide-y divide-primary/5">
            {recentPlayers.map((player) => (
              <li key={player.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/players/${player.id}`)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-cream"
                >
                  <Avatar
                    src={player.avatar_url}
                    alt={player.username || player.first_name}
                    size={40}
                    fallback={player.username || player.first_name}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-primary">
                      {player.username || `${player.first_name} ${player.last_name || ""}`.trim()}
                    </p>
                    <p className="truncate text-xs text-primary/50">
                      {[player.club, player.town, player.handicap != null ? `Hcp ${player.handicap}` : null]
                        .filter(Boolean)
                        .join(" · ") || "No details yet"}
                    </p>
                  </div>
                  <svg className="h-4 w-4 shrink-0 text-primary/30" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import type { User } from "@supabase/supabase-js"

type LeagueMemberWithLeague = {
  id: string | number
  league_id: string | number
  leagues: {
    id: string | number
    name: string
    course_name?: string | null
    max_players?: number | null
  } | null
}

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [leaguesLoading, setLeaguesLoading] = useState(true)
  const [leaguesError, setLeaguesError] = useState<string | null>(null)
  const [memberships, setMemberships] = useState<LeagueMemberWithLeague[]>([])

  useEffect(() => {
    const checkSession = async () => {
      const { data, error } = await supabase.auth.getSession()
      const session = data.session

      if (!session) {
        router.push("/login")
        return
      }

      setUser(session.user)

      try {
        setLeaguesLoading(true)
        setLeaguesError(null)

        const { data, error } = await supabase
          .from("league_members")
          .select("*, leagues(*)")
          .eq("user_id", session.user.id)

        if (error) throw error

        setMemberships((data || []) as LeagueMemberWithLeague[])
      } catch (err) {
        setLeaguesError(
          err instanceof Error ? err.message : "Failed to load your leagues."
        )
      } finally {
        setLeaguesLoading(false)
        setLoading(false)
      }
    }

    checkSession()
  }, [router])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-primary/70">Loading…</p>
      </main>
    )
  }

  const firstName = (user?.user_metadata?.first_name as string) || "there"

  return (
    <main className="min-h-screen bg-cream px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-primary">
              Welcome back, {firstName}!
            </h1>
            <p className="mt-1 text-sm text-primary/70">
              Manage your leagues and upcoming matches.
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="rounded-lg border border-primary/30 bg-white px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
          >
            Log Out
          </button>
        </header>

        <section className="space-y-8">
          <div className="rounded-xl border border-primary/20 bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-primary">
                  My Leagues
                </h2>
                <p className="text-sm text-primary/60">
                  Jump into your active golf leagues or create a new one.
                </p>
              </div>
              <div className="flex gap-2">
                <Link
                  href="/leagues/create"
                  className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-cream hover:bg-primary/90"
                >
                  Create League
                </Link>
                <Link
                  href="/leagues/join"
                  className="inline-flex items-center justify-center rounded-lg border border-primary/30 bg-cream px-3 py-2 text-sm font-medium text-primary hover:bg-primary/5"
                >
                  Join League
                </Link>
              </div>
            </div>

            {leaguesLoading ? (
              <p className="text-sm text-primary/70">Loading your leagues…</p>
            ) : leaguesError ? (
              <p className="text-sm text-red-600">{leaguesError}</p>
            ) : memberships.length === 0 ? (
              <p className="text-sm text-primary/70">
                You&apos;re not in any leagues yet. Create a league or join with an invite code to get started.
              </p>
            ) : (
              <ul className="space-y-3">
                {memberships.map((membership) => {
                  const league = membership.leagues
                  if (!league) return null
                  return (
                    <li key={membership.id}>
                      <Link
                        href={`/leagues/${league.id}`}
                        className="block rounded-lg border border-primary/15 bg-cream px-4 py-3 transition-colors hover:bg-cream/80"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-primary">
                              {league.name}
                            </p>
                            <p className="text-xs text-primary/70">
                              {league.course_name || "Course TBA"}
                            </p>
                          </div>
                          {typeof league.max_players === "number" && (
                            <p className="text-xs text-primary/60">
                              Up to {league.max_players} players
                            </p>
                          )}
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-primary/20 bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold text-primary">
              Upcoming Matches
            </h2>
            <p className="text-sm text-primary/60">
              Your scheduled matches will appear here.
            </p>
          </div>

          <div className="rounded-xl border border-primary/20 bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold text-primary">
              Leaderboard
            </h2>
            <p className="text-sm text-primary/60">
              Standings and rankings will appear here.
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}

"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import type { User } from "@supabase/supabase-js"
import { LoadingSpinner } from "@/components/LoadingSpinner"

type LeagueMemberWithLeague = {
  id: string | number
  league_id: string | number
  leagues: {
    id: string | number
    name: string
    course_name?: string | null
    max_players?: number | null
    status?: string | null
  } | null
}

type CasualMatch = {
  id: string | number
  course_name?: string | null
  match_date?: string | null
  status?: string | null
  invite_code?: string | null
}

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [memberships, setMemberships] = useState<LeagueMemberWithLeague[]>([])
  const [casualMatches, setCasualMatches] = useState<CasualMatch[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession()
      const session = data.session

      if (!session) {
        router.push("/login")
        return
      }

      setUser(session.user)

      try {
        // Fetch leagues
        const { data: membershipData, error: membershipError } = await supabase
          .from("league_members")
          .select("*, leagues(*)")
          .eq("user_id", session.user.id)

        if (membershipError) throw membershipError
        setMemberships((membershipData || []) as LeagueMemberWithLeague[])

        // Fetch casual matches (where user is a player and match_type is casual)
        const { data: matchPlayerData, error: mpError } = await supabase
          .from("match_players")
          .select("match_id, matches(*)")
          .eq("user_id", session.user.id)

        if (!mpError && matchPlayerData) {
          const casual: CasualMatch[] = []
          for (const mp of matchPlayerData as Array<{ match_id: unknown; matches: Record<string, unknown> | Record<string, unknown>[] | null }>) {
            const m = Array.isArray(mp.matches) ? mp.matches[0] : mp.matches
            if (m && (m as Record<string, unknown>).match_type === "casual") {
              casual.push(m as unknown as CasualMatch)
            }
          }
          setCasualMatches(casual.slice(0, 5))
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load your dashboard.")
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [router])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push("/login")
  }

  if (loading) return <LoadingSpinner message="Loading dashboard…" />

  const firstName = (user?.user_metadata?.first_name as string) || "there"
  const hasLeagues = memberships.length > 0
  const hasCasualMatches = casualMatches.length > 0

  return (
    <main className="min-h-screen bg-cream px-4 pb-24 pt-6 md:pb-8">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-primary">
              Welcome back, {firstName}!
            </h1>
            <p className="mt-1 text-sm text-primary/70">
              Manage your leagues and matches.
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="rounded-lg border border-primary/30 bg-white px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
          >
            Log Out
          </button>
        </header>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="space-y-6">
          {/* Onboarding card for new users */}
          {!hasLeagues && !hasCasualMatches && (
            <div className="rounded-2xl border-2 border-dashed border-primary/20 bg-white p-6 text-center shadow-sm">
              <h2 className="text-lg font-bold text-primary">Get started with Mulligan League</h2>
              <p className="mt-2 text-sm text-primary/60">
                Create a league for your golf group, join one with an invite code, or log a casual match.
              </p>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-center">
                <Link
                  href="/leagues/create"
                  className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-cream hover:bg-primary/90"
                >
                  Create a League
                </Link>
                <Link
                  href="/leagues/join"
                  className="rounded-lg border border-primary/20 bg-white px-5 py-2.5 text-sm font-medium text-primary hover:bg-primary/5"
                >
                  Join with Code
                </Link>
              </div>
              <Link
                href="/matches/create"
                className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                Or create a casual match
              </Link>
            </div>
          )}

          {/* My Leagues */}
          <div className="rounded-xl border border-primary/20 bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-primary">My Leagues</h2>
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

            {!hasLeagues ? (
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
                            <p className="text-sm font-semibold text-primary">{league.name}</p>
                            <p className="text-xs text-primary/70">{league.course_name || "Course TBA"}</p>
                          </div>
                          <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-primary/60">
                            {league.status || "active"}
                          </span>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Casual Matches */}
          <div className="rounded-xl border border-primary/20 bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-primary">Recent Matches</h2>
                <p className="text-sm text-primary/60">
                  Your casual matches outside of league play.
                </p>
              </div>
              <div className="flex gap-2">
                <Link
                  href="/matches/create"
                  className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-cream hover:bg-primary/90"
                >
                  Create Match
                </Link>
                <Link
                  href="/matches/join"
                  className="inline-flex items-center justify-center rounded-lg border border-primary/30 bg-cream px-3 py-2 text-sm font-medium text-primary hover:bg-primary/5"
                >
                  Join Match
                </Link>
              </div>
            </div>

            {!hasCasualMatches ? (
              <p className="text-sm text-primary/70">
                No casual matches yet. Create a match to start tracking rounds with friends.
              </p>
            ) : (
              <ul className="space-y-3">
                {casualMatches.map((match) => (
                  <li key={match.id}>
                    <Link
                      href={`/matches/${match.id}`}
                      className="block rounded-lg border border-primary/15 bg-cream px-4 py-3 transition-colors hover:bg-cream/80"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-primary">{match.course_name || "Course TBA"}</p>
                          <p className="text-xs text-primary/70">{match.match_date || "Date TBA"}</p>
                        </div>
                        <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-amber-700">
                          casual
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

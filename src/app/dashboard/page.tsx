"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { fetchMatchPlayerNames } from "@/lib/matchPlayers"
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

type UpcomingMatch = {
  id: string | number
  course_name?: string | null
  match_date?: string | null
  match_type?: string | null
  status?: string | null
}

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [memberships, setMemberships] = useState<LeagueMemberWithLeague[]>([])
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({})
  const [casualMatches, setCasualMatches] = useState<CasualMatch[]>([])
  const [upcomingMatches, setUpcomingMatches] = useState<UpcomingMatch[]>([])
  const [upcomingMatchPlayers, setUpcomingMatchPlayers] = useState<Map<string | number, string[]>>(new Map())
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
        const typedMemberships = (membershipData || []) as LeagueMemberWithLeague[]
        setMemberships(typedMemberships)

        // Fetch member counts per league
        const leagueIds = typedMemberships
          .filter((m) => m.leagues)
          .map((m) => m.league_id)
        if (leagueIds.length > 0) {
          const { data: allMembers } = await supabase
            .from("league_members")
            .select("league_id")
            .in("league_id", leagueIds)

          if (allMembers) {
            const counts: Record<string, number> = {}
            for (const m of allMembers) {
              const key = String(m.league_id)
              counts[key] = (counts[key] || 0) + 1
            }
            setMemberCounts(counts)
          }
        }

        // Fetch casual matches (where user is a player and match_type is casual)
        const { data: matchPlayerData, error: mpError } = await supabase
          .from("match_players")
          .select("match_id, matches(*)")
          .eq("user_id", session.user.id)

        if (!mpError && matchPlayerData) {
          const casual: CasualMatch[] = []
          const upcoming: UpcomingMatch[] = []
          const today = new Date().toISOString().split("T")[0]

          for (const mp of matchPlayerData as Array<{ match_id: unknown; matches: Record<string, unknown> | Record<string, unknown>[] | null }>) {
            const m = Array.isArray(mp.matches) ? mp.matches[0] : mp.matches
            if (!m) continue
            const match = m as Record<string, unknown>

            if (match.match_type === "casual") {
              casual.push(match as unknown as CasualMatch)
            }

            // Collect upcoming matches (any type, future date, not completed)
            if (
              match.match_date &&
              String(match.match_date) >= today &&
              match.status !== "completed"
            ) {
              upcoming.push(match as unknown as UpcomingMatch)
            }
          }

          setCasualMatches(casual.slice(0, 5))
          // Sort upcoming by date ascending, take first 3
          upcoming.sort((a, b) =>
            (a.match_date || "").localeCompare(b.match_date || "")
          )
          const upcomingSlice = upcoming.slice(0, 3)
          setUpcomingMatches(upcomingSlice)

          // Fetch player names for upcoming matches
          if (upcomingSlice.length > 0) {
            const upcomingIds = upcomingSlice.map((m) => m.id)
            const playerNames = await fetchMatchPlayerNames(supabase, upcomingIds, session.user.id)
            setUpcomingMatchPlayers(playerNames)
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load your dashboard.")
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [router])

  if (loading) return <LoadingSpinner message="Loading dashboard…" />

  const firstName = (user?.user_metadata?.first_name as string) || "there"
  const hasLeagues = memberships.length > 0
  const hasCasualMatches = casualMatches.length > 0

  return (
    <main className="min-h-screen bg-cream px-4 pb-24 pt-6 md:pb-8">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-primary">
            Welcome back, {firstName}!
          </h1>
          <p className="mt-1 text-sm text-primary/70">
            Here&apos;s what&apos;s happening in your leagues.
          </p>
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
              <h2 className="text-lg font-semibold text-primary">Ready to tee it up?</h2>
              <p className="mt-2 text-sm text-primary/60">
                Start a league for your group, or jump into one a friend already created.
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

          {/* Next Up — upcoming matches */}
          {upcomingMatches.length > 0 && (
            <div className="rounded-xl border border-primary/20 bg-white p-6 shadow-sm">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-primary">Next Up</h2>
                <p className="text-sm text-primary/60">Your upcoming rounds.</p>
              </div>
              <ul className="space-y-3">
                {upcomingMatches.map((match) => {
                  const dateStr = match.match_date
                    ? new Date(match.match_date + "T00:00:00").toLocaleDateString(
                        "en-US",
                        { weekday: "short", month: "short", day: "numeric" }
                      )
                    : "Date TBA"
                  const isLeague = match.match_type === "league"
                  const names = upcomingMatchPlayers.get(match.id)
                  const playersLabel = names && names.length > 0 ? names.join(", ") : null
                  return (
                    <li key={match.id}>
                      <Link
                        href={`/matches/${match.id}`}
                        className="block rounded-lg border border-primary/15 bg-cream px-4 py-3 transition-all hover:-translate-y-0.5 hover:bg-cream/80 hover:shadow-md"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-primary">
                              {match.course_name || "Course TBA"}
                            </p>
                            {playersLabel && (
                              <p className="text-xs text-primary/50">with {playersLabel}</p>
                            )}
                            <p className="text-xs text-primary/70">{dateStr}</p>
                          </div>
                          <span
                            className={`rounded-full px-2 py-1 text-[10px] font-medium uppercase tracking-wide ${
                              isLeague
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {isLeague ? "league" : "casual"}
                          </span>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* My Leagues */}
          <div className="rounded-xl border border-primary/20 bg-white p-6 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-primary">My Leagues</h2>
                <p className="text-sm text-primary/60">
                  Your active leagues and competitions.
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
                No leagues yet.{" "}
                <Link href="/leagues/create" className="font-medium text-primary underline-offset-4 hover:underline">Create one</Link>
                {" "}for your crew, or{" "}
                <Link href="/leagues/join" className="font-medium text-primary underline-offset-4 hover:underline">join with a code</Link>.
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
                        className="block rounded-lg border border-primary/15 bg-cream px-4 py-3 transition-all hover:-translate-y-0.5 hover:bg-cream/80 hover:shadow-md"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-primary">{league.name}</p>
                            <p className="text-xs text-primary/70">
                              {league.course_name || "Course TBA"}
                              {" · "}
                              {(() => {
                                const count = memberCounts[String(league.id)] || 0
                                return league.max_players != null
                                  ? `${count}/${league.max_players} players`
                                  : `${count} player${count !== 1 ? "s" : ""}`
                              })()}
                            </p>
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
                  Rounds outside of league play.
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
                No rounds logged yet. Played recently?{" "}
                <Link href="/matches/create" className="font-medium text-primary underline-offset-4 hover:underline">Log a round</Link>.
              </p>
            ) : (
              <ul className="space-y-3">
                {casualMatches.map((match) => (
                  <li key={match.id}>
                    <Link
                      href={`/matches/${match.id}`}
                      className="block rounded-lg border border-primary/15 bg-cream px-4 py-3 transition-all hover:-translate-y-0.5 hover:bg-cream/80 hover:shadow-md"
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

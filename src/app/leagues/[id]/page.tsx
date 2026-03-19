"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"

type League = {
  id: string | number
  name: string
  course_name?: string | null
  invite_code?: string | null
  max_players?: number | null
  created_by?: string | null
  status?: string | null
}

type MemberWithProfile = {
  id: string | number
  league_id: string | number
  user_id: string
  profiles?: {
    id: string
    first_name?: string | null
    last_name?: string | null
    full_name?: string | null
  } | null
}

type LeaguePeriod = {
  id: string | number
  league_id: string | number
  name?: string | null
  start_date?: string | null
  end_date?: string | null
  status?: string | null
}

type Match = {
  id: string | number
  league_id: string | number
  period_id: string | number
  course_name?: string | null
  match_date?: string | null
  status?: string | null
}

type LeaderboardRow = {
  position?: number | null
  player_name?: string | null
  best_score?: number | null
  rounds?: number | null
}

interface LeaguePageProps {
  params: { id: string }
}

export default function LeaguePage({ params }: LeaguePageProps) {
  const router = useRouter()
  const leagueId = params.id

  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  const [league, setLeague] = useState<League | null>(null)
  const [members, setMembers] = useState<MemberWithProfile[]>([])
  const [currentPeriod, setCurrentPeriod] = useState<LeaguePeriod | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([])

  const [periodMatches, setPeriodMatches] = useState<Match[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [startingLeague, setStartingLeague] = useState(false)

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession()
      const session = data.session

      if (!session) {
        router.push("/login")
        return
      }

      setUser(session.user)
      setAuthLoading(false)

      try {
        setLoading(true)
        setError(null)

        const [leagueRes, membersRes, periodRes, leaderboardRes] = await Promise.all([
          supabase.from("leagues").select("*").eq("id", leagueId).single(),
          supabase.from("league_members").select("*, profiles(*)").eq("league_id", leagueId),
          supabase
            .from("league_periods")
            .select("*")
            .eq("league_id", leagueId)
            .eq("status", "active")
            .maybeSingle(),
          supabase.rpc("get_leaderboard", { p_league_id: leagueId }),
        ])

        if (leagueRes.error) throw leagueRes.error
        if (!leagueRes.data) throw new Error("League not found.")

        setLeague(leagueRes.data as League)

        if (membersRes.error) throw membersRes.error
        setMembers((membersRes.data || []) as MemberWithProfile[])

        if (periodRes.error && periodRes.error.code !== "PGRST116") {
          throw periodRes.error
        }
        const active = (periodRes.data as LeaguePeriod | null) ?? null
        setCurrentPeriod(active)

        if (active) {
          const { data: matchesData, error: matchesError } = await supabase
            .from("matches")
            .select("*")
            .eq("period_id", active.id)
            .order("match_date", { ascending: true })

          if (matchesError) {
            throw matchesError
          }

          setPeriodMatches((matchesData || []) as Match[])
        } else {
          setPeriodMatches([])
        }

        if (leaderboardRes.error) throw leaderboardRes.error
        setLeaderboard((leaderboardRes.data || []) as LeaderboardRow[])
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load league.")
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [leagueId, router])

  const isAdmin = league && user && league.created_by === user.id

  const formatDateRange = (start?: string | null, end?: string | null) => {
    if (!start || !end) return null
    const startDate = new Date(start)
    const endDate = new Date(end)
    const startStr = startDate.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    })
    const endStr = endDate.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    })
    return `${startStr} – ${endStr}`
  }

  const handleStartLeague = async () => {
    if (!league) return

    const confirmed = window.confirm(
      "This will generate weekly match periods for your league. Make sure all players have joined before starting. Continue?"
    )
    if (!confirmed) return

    setStartingLeague(true)
    setError(null)
    try {
      const { error: rpcError } = await supabase.rpc("generate_league_periods", {
        p_league_id: league.id,
      })
      if (rpcError) {
        throw rpcError
      }

      // Re-run the full page data fetch instead of router.refresh()
      // which doesn't re-run client-side useEffect
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start league.")
    } finally {
      setStartingLeague(false)
    }
  }

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream">
        <p className="text-primary/70">Checking your session…</p>
      </main>
    )
  }

  if (!user) {
    return null
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream">
        <p className="text-primary/70">Loading league…</p>
      </main>
    )
  }

  if (error || !league) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream px-4">
        <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-red-700">
            {error || "We couldn&apos;t find this league."}
          </p>
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="mt-4 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream"
          >
            Back to dashboard
          </button>
        </div>
      </main>
    )
  }

  const memberCount = members.length
  const periodLabel =
    currentPeriod?.name ||
    (currentPeriod ? "Current period" : null)

  const periodRange = currentPeriod
    ? formatDateRange(currentPeriod.start_date || null, currentPeriod.end_date || null)
    : null

  return (
    <main className="min-h-screen bg-cream px-4 py-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-primary">{league.name}</h1>
            <p className="text-sm text-primary/70">
              {league.course_name || "Course TBA"} ·{" "}
              {memberCount} player{memberCount === 1 ? "" : "s"}
              {league.max_players ? ` · Max ${league.max_players}` : null}
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href={`/matches/create?league=${league.id}`}
              className="inline-flex items-center justify-center rounded-lg border border-primary/30 bg-white px-3 py-2 text-sm font-medium text-primary hover:bg-primary/5"
            >
              Create Match
            </Link>
          </div>
        </header>

        {/* Draft guide for admins */}
        {league.status !== "active" && league.status !== "completed" && isAdmin && (
          <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-emerald-800">Getting started</h2>
            <ol className="mt-3 space-y-2 text-sm text-emerald-700">
              <li className="flex items-start gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-200 text-xs font-semibold text-emerald-800">1</span>
                <span>Invite players — share the invite code below with your group.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-200 text-xs font-semibold text-emerald-800">2</span>
                <span>Start the league — this generates weekly match periods.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-200 text-xs font-semibold text-emerald-800">3</span>
                <span>Create matches and submit scores to build the leaderboard.</span>
              </li>
            </ol>
          </section>
        )}

        {league.invite_code && (
          <section className="rounded-xl border border-primary/15 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold tracking-[0.25em] text-primary/60">
                  INVITE CODE
                </p>
                <p className="mt-1 text-2xl font-mono tracking-[0.25em] text-primary">
                  {league.invite_code}
                </p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!league.invite_code) return
                  if (typeof navigator === "undefined" || !navigator.clipboard) return
                  try {
                    await navigator.clipboard.writeText(league.invite_code)
                  } catch {
                    // ignore
                  }
                }}
                className="mt-2 inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-cream hover:bg-primary/90 sm:mt-0"
              >
                Copy Code
              </button>
            </div>
          </section>
        )}

        <section className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="space-y-4">
              <div className="rounded-xl border border-primary/15 bg-white p-4 shadow-sm">
                <h2 className="mb-2 text-sm font-semibold text-primary">Current Period</h2>
                {currentPeriod ? (
                  <div>
                    <p className="text-base font-medium text-primary">
                      {periodLabel}
                    </p>
                    {periodRange && (
                      <p className="mt-1 text-sm text-primary/70">{periodRange}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-primary/70">
                    League not started yet. Once the league is started, weeks will appear here.
                  </p>
                )}
              </div>

              {league.status !== "active" && league.status !== "completed" && (
                <div className="flex justify-start">
                  <button
                    type="button"
                    onClick={handleStartLeague}
                    disabled={startingLeague}
                    className="mt-2 inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {startingLeague ? "Starting…" : "Start League"}
                  </button>
                </div>
              )}

              {currentPeriod && (
                <div className="rounded-xl border border-primary/15 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-primary">
                      Matches this period
                    </h2>
                  </div>
                  {periodMatches.length === 0 ? (
                    <p className="text-sm text-primary/70">
                      No matches yet for this period.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {periodMatches.map((match) => {
                        const dateLabel = match.match_date
                          ? new Date(match.match_date).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })
                          : "Date TBA"
                        return (
                          <Link
                            key={match.id}
                            href={`/matches/${match.id}`}
                            className="flex items-center justify-between rounded-lg bg-cream px-3 py-2 text-sm text-primary hover:bg-primary/5"
                          >
                            <div>
                              <p className="font-medium">
                                {match.course_name || league.course_name || "Course TBA"}
                              </p>
                              <p className="text-xs text-primary/70">
                                {dateLabel} · {(match.status || "scheduled").toString()}
                              </p>
                            </div>
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-primary/15 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-primary">Leaderboard</h2>
              {leaderboard.length === 0 ? (
                <p className="text-sm text-primary/70">
                  No scores yet. Once players start posting rounds, standings will appear here.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-primary/10 text-xs uppercase tracking-wide text-primary/60">
                        <th className="py-2 pr-4">Pos</th>
                        <th className="py-2 pr-4">Player</th>
                        <th className="py-2 pr-4">Best</th>
                        <th className="py-2">Rounds</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.map((row, idx) => (
                        <tr key={idx} className="border-b border-primary/5 last:border-0">
                          <td className="py-2 pr-4 text-primary">
                            {row.position ?? idx + 1}
                          </td>
                          <td className="py-2 pr-4 text-primary">
                            {row.player_name || "Player"}
                          </td>
                          <td className="py-2 pr-4 text-primary">
                            {row.best_score ?? "–"}
                          </td>
                          <td className="py-2 text-primary">
                            {row.rounds ?? 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-primary/15 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-primary">Members</h2>
            {members.length === 0 ? (
              <p className="text-sm text-primary/70">No members yet.</p>
            ) : (
              <ul className="space-y-2">
                {members.map((member) => {
                  const profile = member.profiles
                  const nameFromProfile =
                    profile?.full_name ||
                    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ")
                  const displayName = nameFromProfile || "Player"
                  return (
                    <li
                      key={member.id}
                      className="flex items-center justify-between rounded-lg bg-cream px-3 py-2 text-sm text-primary"
                    >
                      <span>{displayName}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}


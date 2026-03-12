"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"

type League = {
  id: string | number
  name: string
}

type MemberWithLeague = {
  id: string | number
  league_id: string | number
  user_id: string
  leagues?: League | null
}

type LeaderboardRow = {
  position?: number | null
  player_name?: string | null
  best_score?: number | null
  average?: number | null
  rounds?: number | null
  user_id?: string | null
}

export default function LeaderboardPage() {
  const router = useRouter()

  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  const [leagues, setLeagues] = useState<League[]>([])
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | number | null>(null)

  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)
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
      setAuthLoading(false)

      try {
        setLoading(true)
        setError(null)

        const { data: memberRows, error: memberError } = await supabase
          .from("league_members")
          .select("*, leagues(*)")
          .eq("user_id", session.user.id)

        if (memberError) {
          throw memberError
        }

        const typedMembers = (memberRows || []) as MemberWithLeague[]
        const leagueMap = new Map<string | number, League>()
        for (const m of typedMembers) {
          if (m.leagues && !leagueMap.has(m.leagues.id)) {
            leagueMap.set(m.leagues.id, m.leagues)
          }
        }

        const userLeagues = Array.from(leagueMap.values())
        setLeagues(userLeagues)

        const initialLeagueId =
          userLeagues.length === 1 ? userLeagues[0].id : userLeagues[0]?.id ?? null
        setSelectedLeagueId(initialLeagueId ?? null)

        if (initialLeagueId != null) {
          await loadLeaderboard(initialLeagueId)
        } else {
          setRows([])
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load leaderboard.")
      } finally {
        setLoading(false)
      }
    }

    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  const loadLeaderboard = async (leagueId: string | number) => {
    setLoading(true)
    setError(null)
    try {
      const { data, error } = await supabase.rpc("get_leaderboard", {
        p_league_id: leagueId,
      })

      if (error) {
        throw error
      }

      setRows((data || []) as LeaderboardRow[])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load leaderboard.")
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  const handleLeagueChange = async (value: string) => {
    if (!value) {
      setSelectedLeagueId(null)
      setRows([])
      return
    }
    const numeric = Number.isNaN(Number(value)) ? value : Number(value)
    setSelectedLeagueId(numeric)
    await loadLeaderboard(numeric)
  }

  const highlightUserRow = (row: LeaderboardRow) =>
    !!user && row.user_id != null && row.user_id === user.id

  const sortedRows = useMemo(
    () =>
      rows.map((row, index) => ({
        ...row,
        position: row.position ?? index + 1,
      })),
    [rows],
  )

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

  if (loading && !selectedLeagueId) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream">
        <p className="text-primary/70">Loading leaderboard…</p>
      </main>
    )
  }

  const selectedLeagueName =
    leagues.find((l) => l.id === selectedLeagueId)?.name || "League leaderboard"

  return (
    <main className="min-h-screen bg-cream px-4 pb-24 pt-4 md:pb-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-primary">Leaderboard</h1>
            <p className="mt-1 text-sm text-primary/70">
              Compare rounds across your leagues.
            </p>
          </div>
          {leagues.length > 1 && (
            <div className="flex items-center gap-2">
              <label
                htmlFor="league-select"
                className="text-xs font-medium uppercase tracking-[0.2em] text-primary/60"
              >
                League
              </label>
              <select
                id="league-select"
                value={selectedLeagueId?.toString() ?? ""}
                onChange={(e) => handleLeagueChange(e.target.value)}
                className="rounded-lg border border-primary/30 bg-white px-3 py-1.5 text-sm text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {leagues.map((league) => (
                  <option key={league.id} value={league.id.toString()}>
                    {league.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </header>

        {leagues.length === 0 && !error ? (
          <section className="rounded-xl border border-dashed border-primary/20 bg-white p-6 text-center shadow-sm">
            <h2 className="text-base font-semibold text-primary">No leagues yet</h2>
            <p className="mt-2 text-sm text-primary/70">
              Join or create a league first, then leaderboard standings will appear here.
            </p>
          </section>
        ) : null}

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {selectedLeagueId && (
          <section className="rounded-xl border border-primary/15 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-primary">
                  {selectedLeagueName}
                </h2>
                <p className="text-xs text-primary/60">
                  Best rounds and scoring averages for this league.
                </p>
              </div>
            </div>

            {loading ? (
              <p className="py-8 text-center text-sm text-primary/70">
                Loading leaderboard…
              </p>
            ) : sortedRows.length === 0 ? (
              <p className="py-4 text-sm text-primary/70">
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
                      <th className="py-2 pr-4">Average</th>
                      <th className="py-2">Rounds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((row, idx) => {
                      const isCurrentUser = highlightUserRow(row)
                      return (
                        <tr
                          key={idx}
                          className={`border-b border-primary/5 last:border-0 ${
                            isCurrentUser ? "bg-emerald-50/60" : ""
                          }`}
                        >
                          <td className="py-2 pr-4 text-primary">
                            {row.position ?? idx + 1}
                          </td>
                          <td className="py-2 pr-4 text-primary">
                            {row.player_name || "Player"}
                            {isCurrentUser && (
                              <span className="ml-1 text-[10px] font-semibold uppercase text-emerald-700">
                                You
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-primary">
                            {row.best_score ?? "–"}
                          </td>
                          <td className="py-2 pr-4 text-primary">
                            {row.average != null
                              ? row.average.toFixed(1)
                              : "–"}
                          </td>
                          <td className="py-2 text-primary">
                            {row.rounds ?? 0}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  )
}


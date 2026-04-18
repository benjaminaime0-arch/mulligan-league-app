"use client"

import { useEffect, useMemo, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { Avatar } from "@/components/Avatar"

type League = {
  id: string | number
  name: string
  course_name?: string | null
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
  avatar_url?: string | null
  best_score?: number | null
  total_score?: number | null
  rounds_counted?: number | null
  rounds_played?: number | null
  user_id?: string | null
}

export default function LeaderboardPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [leagues, setLeagues] = useState<League[]>([])
  const [leagueIndex, setLeagueIndex] = useState(0)

  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadLeaderboard = useCallback(async (leagueId: string | number) => {
    setLoading(true)
    setError(null)
    try {
      const { data, error } = await supabase.rpc("get_leaderboard", {
        p_league_id: leagueId,
      })

      if (error) throw error
      setRows((data || []) as LeaderboardRow[])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load leaderboard.")
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authLoading || !user) return

    const init = async () => {
      try {
        setLoading(true)
        setError(null)

        const { data: memberRows, error: memberError } = await supabase
          .from("league_members")
          .select("*, leagues(*)")
          .eq("user_id", user.id)

        if (memberError) throw memberError

        const typedMembers = (memberRows || []) as MemberWithLeague[]
        const leagueMap = new Map<string | number, League>()
        for (const m of typedMembers) {
          if (m.leagues && !leagueMap.has(m.leagues.id)) {
            leagueMap.set(m.leagues.id, m.leagues)
          }
        }

        const userLeagues = Array.from(leagueMap.values())
        setLeagues(userLeagues)

        if (userLeagues.length > 0) {
          await loadLeaderboard(userLeagues[0].id)
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
  }, [authLoading, user, loadLeaderboard])

  const goNext = useCallback(async () => {
    const next = (leagueIndex + 1) % leagues.length
    setLeagueIndex(next)
    await loadLeaderboard(leagues[next].id)
  }, [leagueIndex, leagues, loadLeaderboard])

  const goPrev = useCallback(async () => {
    const prev = (leagueIndex - 1 + leagues.length) % leagues.length
    setLeagueIndex(prev)
    await loadLeaderboard(leagues[prev].id)
  }, [leagueIndex, leagues, loadLeaderboard])

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

  if (loading && leagues.length === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream">
        <p className="text-primary/70">Loading leaderboard…</p>
      </main>
    )
  }

  const currentLeague = leagues[leagueIndex]

  return (
    <main className="min-h-screen bg-cream px-4 pb-6 pt-4">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-bold text-primary">Leaderboard</h1>
          <p className="mt-1 text-sm text-primary/70">
            Who&apos;s on top this season?
          </p>
        </header>

        {leagues.length === 0 && !error ? (
          <section className="rounded-xl border border-dashed border-primary/20 bg-white p-6 text-center shadow-sm">
            <h2 className="text-base font-semibold text-primary">No leagues yet</h2>
            <p className="mt-2 text-sm text-primary/70">
              Join a league to see where you rank.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Link
                href="/leagues/create"
                className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream hover:bg-primary/90"
              >
                Create League
              </Link>
              <Link
                href="/leagues/join"
                className="inline-flex items-center justify-center rounded-lg border border-primary/30 bg-cream px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5"
              >
                Join League
              </Link>
            </div>
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

        {currentLeague && (
          <section className="rounded-xl border border-primary/15 bg-white p-4 shadow-sm">
            {/* League switcher header */}
            <div className="mb-3 flex items-center justify-between gap-2">
              {leagues.length > 1 && (
                <button
                  type="button"
                  onClick={goPrev}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-primary/40 transition-colors hover:bg-primary/5 hover:text-primary active:scale-95"
                  aria-label="Previous league"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
              )}
              <div
                className="min-w-0 flex-1 cursor-pointer text-center"
                onClick={() => router.push(`/leagues/${currentLeague.id}`)}
              >
                <h2 className="text-lg font-bold text-primary">
                  {currentLeague.name}
                </h2>
                <p className="text-xs uppercase tracking-[0.2em] text-primary/50">
                  {currentLeague.course_name || "Course TBA"}
                </p>
              </div>
              {leagues.length > 1 && (
                <button
                  type="button"
                  onClick={goNext}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-primary/40 transition-colors hover:bg-primary/5 hover:text-primary active:scale-95"
                  aria-label="Next league"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              )}
            </div>

            {/* Dot indicators */}
            {leagues.length > 1 && (
              <div className="mb-3 flex items-center justify-center gap-1.5">
                {leagues.map((l, idx) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={async () => {
                      setLeagueIndex(idx)
                      await loadLeaderboard(l.id)
                    }}
                    className={`h-1.5 rounded-full transition-all ${
                      idx === leagueIndex
                        ? "w-5 bg-primary"
                        : "w-1.5 bg-primary/20 hover:bg-primary/40"
                    }`}
                    aria-label={`View ${l.name}`}
                  />
                ))}
              </div>
            )}

            {loading ? (
              <p className="py-8 text-center text-sm text-primary/70">
                Loading leaderboard…
              </p>
            ) : sortedRows.length === 0 ? (
              <p className="py-4 text-sm text-primary/70">
                The board is empty — be the first to post a score and claim the top spot.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-primary/10 text-xs uppercase tracking-wide text-primary/60">
                      <th className="py-2 pr-3">Pos</th>
                      <th className="py-2 pr-3">Player</th>
                      <th className="py-2 pr-3">Total</th>
                      <th className="py-2 pr-3">Best</th>
                      <th className="py-2">Cards</th>
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
                          <td className="py-2 pr-3 text-primary">
                            {row.position ?? idx + 1}
                          </td>
                          <td className="py-2 pr-3 text-primary">
                            <div
                              className={`flex items-center gap-2 ${row.user_id ? "cursor-pointer hover:underline" : ""}`}
                              onClick={() => row.user_id && router.push(`/players/${row.user_id}`)}
                            >
                              <Avatar src={row.avatar_url} size={24} fallback={row.player_name || "P"} />
                              <span>
                                {row.player_name || "Player"}
                                {isCurrentUser && (
                                  <span className="ml-1 text-[10px] font-semibold uppercase text-emerald-700">
                                    You
                                  </span>
                                )}
                              </span>
                            </div>
                          </td>
                          <td className="py-2 pr-3 text-primary">
                            {row.total_score ?? "–"}
                          </td>
                          <td className="py-2 pr-3 text-primary">
                            {row.best_score ?? "–"}
                          </td>
                          <td className="py-2 text-primary">
                            {row.rounds_counted ?? 0}/{row.rounds_played ?? 0}
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


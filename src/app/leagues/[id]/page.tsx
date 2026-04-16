"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { fetchMatchPlayerNames } from "@/lib/matchPlayers"
import { ConfirmModal } from "@/components/ConfirmModal"

type League = {
  id: string | number
  name: string
  course_name?: string | null
  invite_code?: string | null
  max_players?: number | null
  admin_id?: string | null
  status?: string | null
  league_type?: string | null
  scoring_cards_count?: number | null
  total_cards_count?: number | null
}

type UserLeague = {
  id: string | number
  name: string
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
  total_score?: number | null
  rounds_counted?: number | null
  rounds_played?: number | null
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
  const [matchPlayerNames, setMatchPlayerNames] = useState<Map<string | number, string[]>>(new Map())

  const [userLeagues, setUserLeagues] = useState<UserLeague[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [startingLeague, setStartingLeague] = useState(false)
  const [showStartConfirm, setShowStartConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletingLeague, setDeletingLeague] = useState(false)

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

        const [leagueRes, membersRes, periodRes, leaderboardRes, userLeaguesRes] = await Promise.all([
          supabase.from("leagues").select("*").eq("id", leagueId).single(),
          supabase.from("league_members").select("*, profiles(*)").eq("league_id", leagueId),
          supabase
            .from("league_periods")
            .select("*")
            .eq("league_id", leagueId)
            .eq("status", "active")
            .maybeSingle(),
          supabase.rpc("get_leaderboard", { p_league_id: leagueId }),
          supabase
            .from("league_members")
            .select("league_id, leagues(id, name)")
            .eq("user_id", session.user.id),
        ])

        if (leagueRes.error) throw leagueRes.error
        if (!leagueRes.data) throw new Error("League not found.")

        setLeague(leagueRes.data as League)

        if (membersRes.error) throw membersRes.error
        setMembers((membersRes.data || []) as MemberWithProfile[])

        // Build user league list for navigation
        if (!userLeaguesRes.error && userLeaguesRes.data) {
          type UserLeagueRow = { league_id: string; leagues: { id: string; name: string } | { id: string; name: string }[] | null }
          const leagueList: UserLeague[] = []
          for (const r of userLeaguesRes.data as unknown as UserLeagueRow[]) {
            if (!r.leagues) continue
            const lg = Array.isArray(r.leagues) ? r.leagues[0] : r.leagues
            if (lg) leagueList.push({ id: lg.id, name: lg.name })
          }
          setUserLeagues(leagueList)
        }

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

          const matches = (matchesData || []) as Match[]
          setPeriodMatches(matches)

          // Fetch player names for these matches
          if (matches.length > 0) {
            const matchIds = matches.map((m) => m.id)
            const playerNames = await fetchMatchPlayerNames(supabase, matchIds)
            setMatchPlayerNames(playerNames)
          }
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

  const isAdmin = league && user && league.admin_id === user.id

  // League navigation
  const currentLeagueIndex = userLeagues.findIndex((l) => String(l.id) === String(leagueId))
  const prevLeague = currentLeagueIndex > 0 ? userLeagues[currentLeagueIndex - 1] : null
  const nextLeague = currentLeagueIndex >= 0 && currentLeagueIndex < userLeagues.length - 1 ? userLeagues[currentLeagueIndex + 1] : null

  const handleStartLeague = async () => {
    if (!league) return

    setShowStartConfirm(false)
    setStartingLeague(true)
    setError(null)
    try {
      const { error: rpcError } = await supabase.rpc("generate_league_periods", {
        p_league_id: league.id,
      })
      if (rpcError) {
        throw rpcError
      }

      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start league.")
    } finally {
      setStartingLeague(false)
    }
  }

  const handleDeleteLeague = async () => {
    if (!league) return

    setShowDeleteConfirm(false)
    setDeletingLeague(true)
    setError(null)
    try {
      const { error: deleteError } = await supabase
        .from("leagues")
        .delete()
        .eq("id", league.id)

      if (deleteError) throw deleteError

      router.push("/leagues/list")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete league.")
    } finally {
      setDeletingLeague(false)
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
            {error || "We couldn\u2019t find this league."}
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

  return (
    <main className="min-h-screen bg-cream px-4 py-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-3">
                {prevLeague ? (
                  <button
                    type="button"
                    onClick={() => router.push(`/leagues/${prevLeague.id}`)}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/20 bg-white text-primary hover:bg-primary/5"
                    title={prevLeague.name}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                  </button>
                ) : userLeagues.length > 1 ? (
                  <div className="h-8 w-8" />
                ) : null}
                <h1 className="text-2xl font-bold text-primary">{league.name}</h1>
                {nextLeague ? (
                  <button
                    type="button"
                    onClick={() => router.push(`/leagues/${nextLeague.id}`)}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/20 bg-white text-primary hover:bg-primary/5"
                    title={nextLeague.name}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 6 15 12 9 18" /></svg>
                  </button>
                ) : userLeagues.length > 1 ? (
                  <div className="h-8 w-8" />
                ) : null}
                {/* Compact invite code next to title — desktop */}
                {league.invite_code && (
                  <div className="ml-2 hidden items-center gap-2 sm:flex">
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
                      className="rounded-md bg-primary/10 px-2.5 py-1 font-mono text-sm tracking-[0.15em] text-primary hover:bg-primary/15"
                      title="Click to copy invite code"
                    >
                      {league.invite_code}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!league.invite_code) return
                        const joinUrl = `${window.location.origin}/leagues/join?code=${league.invite_code}`
                        const message = `Join my golf league "${league.name}" on Mulligan League!\n${joinUrl}`
                        if (typeof navigator !== "undefined" && navigator.share) {
                          try {
                            await navigator.share({ text: message, url: joinUrl })
                          } catch {
                            // user cancelled or share failed
                          }
                        } else if (typeof navigator !== "undefined" && navigator.clipboard) {
                          try {
                            await navigator.clipboard.writeText(message)
                          } catch {
                            // ignore
                          }
                        }
                      }}
                      className="inline-flex items-center justify-center rounded-lg border border-primary/30 bg-white px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5"
                    >
                      Share Invite
                    </button>
                  </div>
                )}
              </div>
              <p className="mt-1 text-sm text-primary/70">
                {league.course_name || "Course TBA"} &middot;{" "}
                {memberCount} player{memberCount === 1 ? "" : "s"}
                {league.league_type ? ` · ${league.league_type.replace(/_/g, " ")}` : null}
                {league.scoring_cards_count ? ` · ${league.scoring_cards_count} best cards counted` : null}
              </p>
            </div>
            <div className="flex gap-2">
              <Link
                href={`/matches/create?league=${league.id}`}
                className="inline-flex items-center justify-center rounded-lg border border-primary/30 bg-white px-3 py-2 text-sm font-medium text-primary hover:bg-primary/5"
              >
                Create Match
              </Link>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={deletingLeague}
                  className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                >
                  {deletingLeague ? "Deleting…" : "Delete"}
                </button>
              )}
            </div>
          </div>

          {/* Mobile invite code — shown below header on small screens */}
          {league.invite_code && (
            <div className="flex items-center gap-2 sm:hidden">
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
                className="rounded-md bg-primary/10 px-2.5 py-1 font-mono text-sm tracking-[0.15em] text-primary hover:bg-primary/15"
                title="Tap to copy invite code"
              >
                {league.invite_code}
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!league.invite_code) return
                  const joinUrl = `${window.location.origin}/leagues/join?code=${league.invite_code}`
                  const message = `Join my golf league "${league.name}" on Mulligan League!\n${joinUrl}`
                  if (typeof navigator !== "undefined" && navigator.share) {
                    try {
                      await navigator.share({ text: message, url: joinUrl })
                    } catch {
                      // user cancelled or share failed
                    }
                  } else if (typeof navigator !== "undefined" && navigator.clipboard) {
                    try {
                      await navigator.clipboard.writeText(message)
                    } catch {
                      // ignore
                    }
                  }
                }}
                className="inline-flex items-center justify-center rounded-lg border border-primary/30 bg-white px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5"
              >
                Share Invite
              </button>
            </div>
          )}
        </header>

        {/* Draft guide for admins */}
        {league.status !== "active" && league.status !== "completed" && isAdmin && (
          <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-emerald-800">Getting started</h2>
            <ol className="mt-3 space-y-2 text-sm text-emerald-700">
              <li className="flex items-start gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-200 text-xs font-semibold text-emerald-800">1</span>
                <span>Invite players — share the invite code with your group.</span>
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

        {league.status !== "active" && league.status !== "completed" && (
          <>
            <div className="flex justify-start">
              <button
                type="button"
                onClick={() => setShowStartConfirm(true)}
                disabled={startingLeague}
                className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {startingLeague ? "Starting…" : "Start League"}
              </button>
            </div>
            <ConfirmModal
              open={showStartConfirm}
              title="Start your league?"
              message="This will generate weekly match periods for your league. Make sure all players have joined before starting."
              confirmLabel="Start League"
              loading={startingLeague}
              onConfirm={handleStartLeague}
              onCancel={() => setShowStartConfirm(false)}
            />
          </>
        )}

        {isAdmin && (
          <ConfirmModal
            open={showDeleteConfirm}
            title="Delete this league?"
            message="This will permanently delete the league, all matches, scores, and member data. This action cannot be undone."
            confirmLabel="Delete League"
            loading={deletingLeague}
            destructive
            onConfirm={handleDeleteLeague}
            onCancel={() => setShowDeleteConfirm(false)}
          />
        )}

        {/* Mobile: Leaderboard first, then Matches. Desktop: two-column layout */}
        <section className="flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          {/* Leaderboard — shows first on mobile (order-1), right column on desktop */}
          <div className="order-1 md:order-2 md:sticky md:top-6 md:self-start">
            <div className="rounded-xl border border-primary/15 bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-primary">Leaderboard</h2>
              {leaderboard.length === 0 ? (
                <p className="text-sm text-primary/70">
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
                      {leaderboard.map((row, idx) => (
                        <tr key={idx} className="border-b border-primary/5 last:border-0">
                          <td className="py-2 pr-3 text-primary">
                            {row.position ?? idx + 1}
                          </td>
                          <td className="py-2 pr-3 text-primary">
                            {row.player_name || "Player"}
                          </td>
                          <td className="py-2 pr-3 font-bold text-primary">
                            {row.total_score ?? "–"}
                          </td>
                          <td className="py-2 pr-3 text-primary">
                            {row.best_score ?? "–"}
                          </td>
                          <td className="py-2 text-primary">
                            {row.rounds_counted ?? 0}/{row.rounds_played ?? 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Scheduled Matches — shows second on mobile (order-2), left column on desktop */}
          <div className="order-2 md:order-1 space-y-4">
            {currentPeriod && (
              <div className="rounded-xl border border-primary/15 bg-white p-4 shadow-sm">
                <h2 className="mb-2 text-sm font-semibold text-primary">
                  Scheduled Matches
                </h2>
                {periodMatches.length === 0 ? (
                  <p className="text-sm text-primary/70">
                    No matches scheduled yet. Create one to get the week rolling.
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
                      const names = matchPlayerNames.get(match.id)
                      const playerLabel = names && names.length > 0
                        ? names.join(", ")
                        : match.course_name || league.course_name || "Course TBA"
                      return (
                        <Link
                          key={match.id}
                          href={`/matches/${match.id}`}
                          className="flex items-center justify-between rounded-lg bg-cream px-3 py-2 text-sm text-primary hover:bg-primary/5"
                        >
                          <div>
                            <p className="font-medium">
                              {playerLabel}
                            </p>
                            <p className="text-xs text-primary/70">
                              {dateLabel} &middot; {(match.status || "scheduled").toString()}
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
        </section>
      </div>
    </main>
  )
}

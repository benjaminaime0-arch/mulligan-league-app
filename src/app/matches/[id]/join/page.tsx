"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { Logo } from "@/components/Logo"
import Link from "next/link"

const MAX_MATCH_PLAYERS = 4

type MatchInfo = {
  id: string | number
  course_name?: string | null
  match_date?: string | null
  match_time?: string | null
  status?: string | null
  league_id?: string | number | null
  created_by?: string | null
  leagues?: {
    id: string | number
    name: string
    max_players?: number | null
  } | null
}

interface JoinMatchPageProps {
  params: { id: string }
}

export default function JoinMatchPage({ params }: JoinMatchPageProps) {
  const router = useRouter()
  const matchId = params.id
  const { user, loading: authLoading } = useAuth()

  const [match, setMatch] = useState<MatchInfo | null>(null)
  const [playerCount, setPlayerCount] = useState(0)
  const [leagueMemberCount, setLeagueMemberCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [success, setSuccess] = useState(false)

  // Whether the user needs to join the league first
  const [needsLeagueJoin, setNeedsLeagueJoin] = useState(false)
  const [alreadyInMatch, setAlreadyInMatch] = useState(false)

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      // Redirect to login, then come back here
      router.push(`/login?redirect=/matches/${matchId}/join`)
      return
    }

    const loadMatch = async () => {
      try {
        setLoading(true)
        setError(null)

        // Fetch match info
        const { data: matchData, error: matchError } = await supabase
          .from("matches")
          .select("*, leagues(id, name, max_players)")
          .eq("id", matchId)
          .single()

        if (matchError || !matchData) {
          setError("Match not found.")
          return
        }

        const m = matchData as MatchInfo
        setMatch(m)

        // Fetch player count
        const { data: playersData } = await supabase
          .from("match_players")
          .select("user_id")
          .eq("match_id", matchId)

        const players = playersData || []
        setPlayerCount(players.length)

        // Check if already in match
        if (players.some((p: { user_id: string }) => p.user_id === user.id)) {
          setAlreadyInMatch(true)
          return
        }

        // Check if match is full
        if (players.length >= MAX_MATCH_PLAYERS) {
          setError("This match is already full.")
          return
        }

        // Check if match is still scheduled
        if (m.status && m.status !== "scheduled") {
          setError("This match is no longer accepting players.")
          return
        }

        // If league match, check league membership
        if (m.league_id) {
          const { data: membership } = await supabase
            .from("league_members")
            .select("id")
            .eq("league_id", m.league_id)
            .eq("user_id", user.id)
            .maybeSingle()

          if (!membership) {
            // Check if league is full
            const { data: leagueMembers } = await supabase
              .from("league_members")
              .select("id")
              .eq("league_id", m.league_id)

            const memberCount = leagueMembers?.length || 0
            setLeagueMemberCount(memberCount)
            const maxPlayers = m.leagues?.max_players

            if (maxPlayers && memberCount >= maxPlayers) {
              setError("The league for this match is full. You cannot join.")
              return
            }

            setNeedsLeagueJoin(true)
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.")
      } finally {
        setLoading(false)
      }
    }

    loadMatch()
  }, [authLoading, user, matchId, router])

  const handleJoin = async () => {
    if (!user || !match) return
    setJoining(true)
    setError(null)

    try {
      // If user needs to join the league first
      if (needsLeagueJoin && match.league_id) {
        const { error: leagueError } = await supabase
          .from("league_members")
          .insert({ league_id: match.league_id, user_id: user.id })

        if (leagueError) {
          if (leagueError.message?.includes("duplicate") || leagueError.message?.includes("already")) {
            // Already a member, continue
          } else {
            throw leagueError
          }
        }
      }

      // Join the match
      const { error: matchError } = await supabase
        .from("match_players")
        .insert({ match_id: match.id, user_id: user.id })

      if (matchError) {
        if (matchError.message?.includes("duplicate") || matchError.message?.includes("already")) {
          setAlreadyInMatch(true)
          return
        }
        throw matchError
      }

      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join. Please try again.")
    } finally {
      setJoining(false)
    }
  }

  const formatDate = (iso?: string | null) => {
    if (!iso) return "Date TBA"
    const d = new Date(iso)
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
  }

  const formatTime = (t?: string | null) => {
    if (!t) return null
    const [h, m] = t.split(":")
    const hour = parseInt(h, 10)
    const ampm = hour >= 12 ? "PM" : "AM"
    const h12 = hour % 12 || 12
    return `${h12}:${m} ${ampm}`
  }

  // ── Loading ──
  if (authLoading || loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream">
        <p className="text-primary/70">Loading match details…</p>
      </main>
    )
  }

  // ── Already in match ──
  if (alreadyInMatch) {
    return (
      <main className="min-h-screen bg-cream px-4 py-8">
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6">
          <Link href="/" aria-label="Home">
            <Logo size={100} priority />
          </Link>
          <div className="w-full rounded-2xl border border-primary/15 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <svg className="h-7 w-7 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <h2 className="text-lg font-bold text-primary">You&apos;re already in this match</h2>
            <p className="mt-2 text-sm text-primary/60">
              {match?.course_name || "Course TBA"} · {formatDate(match?.match_date)}
            </p>
            <button
              type="button"
              onClick={() => router.push(`/matches/${matchId}`)}
              className="mt-6 w-full rounded-lg bg-primary px-4 py-3 font-medium text-cream transition-all hover:bg-primary/90 active:scale-[0.98]"
            >
              Go to Match
            </button>
          </div>
        </div>
      </main>
    )
  }

  // ── Success ──
  if (success) {
    return (
      <main className="min-h-screen bg-cream px-4 py-8">
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6">
          <Link href="/" aria-label="Home">
            <Logo size={100} priority />
          </Link>
          <div className="w-full rounded-2xl border border-primary/15 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <svg className="h-8 w-8 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-primary">You&apos;re in!</h2>
            <p className="mt-2 text-sm text-primary/60">
              {match?.course_name || "Course TBA"} · {formatDate(match?.match_date)}
            </p>
            {needsLeagueJoin && match?.leagues?.name && (
              <p className="mt-1 text-sm text-emerald-600">
                You also joined the league &ldquo;{match.leagues.name}&rdquo;
              </p>
            )}
            <button
              type="button"
              onClick={() => router.push(`/matches/${matchId}`)}
              className="mt-6 w-full rounded-lg bg-primary px-4 py-3 font-medium text-cream transition-all hover:bg-primary/90 active:scale-[0.98]"
            >
              Go to Match
            </button>
          </div>
        </div>
      </main>
    )
  }

  // ── Error only (no match to show) ──
  if (error && !match) {
    return (
      <main className="min-h-screen bg-cream px-4 py-8">
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6">
          <Link href="/" aria-label="Home">
            <Logo size={100} priority />
          </Link>
          <div className="w-full rounded-2xl border border-primary/15 bg-white p-8 text-center shadow-sm">
            <p className="text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="mt-6 w-full rounded-lg border border-primary/30 bg-white px-4 py-3 text-sm font-medium text-primary transition-all hover:bg-primary/5 active:scale-[0.98]"
            >
              Back to Home
            </button>
          </div>
        </div>
      </main>
    )
  }

  // ── Main join confirmation ──
  return (
    <main className="min-h-screen bg-cream px-4 py-8">
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6">
        <Link href="/" aria-label="Home">
          <Logo size={100} priority />
        </Link>

        <div className="w-full rounded-2xl border border-primary/15 bg-white p-6 shadow-sm">
          <h1 className="text-center text-xl font-bold text-primary">
            You&apos;ve been invited!
          </h1>

          <div className="mt-4 space-y-3 rounded-xl bg-cream/60 p-4">
            {match?.course_name && (
              <div className="flex items-center gap-3 text-sm text-primary">
                <svg className="h-4 w-4 shrink-0 text-primary/50" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                </svg>
                {match.course_name}
              </div>
            )}
            <div className="flex items-center gap-3 text-sm text-primary">
              <svg className="h-4 w-4 shrink-0 text-primary/50" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
              {formatDate(match?.match_date)}
              {match?.match_time && ` · ${formatTime(match.match_time)}`}
            </div>
            <div className="flex items-center gap-3 text-sm text-primary">
              <svg className="h-4 w-4 shrink-0 text-primary/50" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
              {playerCount}/{MAX_MATCH_PLAYERS} players
            </div>
            {match?.leagues?.name && (
              <div className="flex items-center gap-3 text-sm text-primary">
                <svg className="h-4 w-4 shrink-0 text-primary/50" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m3.044 0a6.726 6.726 0 002.748-1.35m-.044 0h.002a6.003 6.003 0 005.392-4.972 50.901 50.901 0 00-2.916-.52M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228" />
                </svg>
                League: {match.leagues.name}
              </div>
            )}
          </div>

          {needsLeagueJoin && match?.leagues?.name && (
            <div className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
              You&apos;ll also be joining the league &ldquo;{match.leagues.name}&rdquo; to participate in this match.
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={handleJoin}
              disabled={joining || !!error}
              className="w-full rounded-lg bg-primary px-4 py-3 font-medium text-cream transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {joining
                ? "Joining…"
                : needsLeagueJoin
                ? "Join League & Match"
                : "Join Match"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="w-full rounded-lg border border-primary/30 bg-white px-4 py-3 text-sm font-medium text-primary transition-all hover:bg-primary/5 active:scale-[0.98]"
            >
              No thanks
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}

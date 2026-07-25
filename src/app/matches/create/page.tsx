"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { track } from "@/lib/analytics"
import { LoadingSpinner } from "@/components/LoadingSpinner"

type Game = {
  id: string
  name: string
  course_name?: string | null
  // `status` surfaces so we can filter out completed games from the
  // create-match picker — you can't schedule new rounds in a game
  // whose season is already wrapped.
  status?: string | null
}

type GameMembership = {
  id: string
  game_id: string
  user_id: string
  games: Game
}

type MemberWithProfile = {
  id: string | number
  game_id: string | number
  user_id: string
  profiles?: {
    username?: string | null
    first_name?: string | null
    last_name?: string | null
  } | null
}

type GamePeriod = {
  id: string | number
  game_id: string | number
  name?: string | null
  status?: string | null
}

function CreateMatchContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedGameId = searchParams.get("game")
  // Optional date pre-fill from the calendar's empty-day CTA. Accepted
  // only if it looks like a `yyyy-mm-dd` string — anything else falls
  // back to today, so a malformed query param can't freeze the form.
  const preselectedDate = (() => {
    const raw = searchParams.get("date")
    return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null
  })()
  const { user, loading: authLoading } = useAuth()

  // User's games
  const [userGames, setUserGames] = useState<Game[]>([])
  const [gamesLoading, setGamesLoading] = useState(true)

  // Selected game
  const [selectedGameId, setSelectedGameId] = useState<string>(preselectedGameId || "")
  const [members, setMembers] = useState<MemberWithProfile[]>([])
  const [activePeriod, setActivePeriod] = useState<GamePeriod | null>(null)
  const [membersLoading, setMembersLoading] = useState(false)

  // Form — if the user came in from the calendar's empty-day CTA we
  // honor the `?date=` param; otherwise default to today. Local-date
  // formatting (not toISOString) so the default matches the viewer's
  // calendar day instead of UTC.
  const [date, setDate] = useState<string>(() => {
    if (preselectedDate) return preselectedDate
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${y}-${m}-${day}`
  })
  const [time, setTime] = useState<string>("")
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedGame = userGames.find((l) => l.id === selectedGameId) || null

  // Load user's games once auth is ready
  useEffect(() => {
    if (authLoading || !user) return

    const init = async () => {
      // Load games the user belongs to. `status` is fetched so we
      // can filter out completed ones below — a finished game can't
      // accept new matches.
      const { data: memberships, error: memErr } = await supabase
        .from("game_members")
        .select("id, game_id, user_id, games(id, name, course_name, status)")
        .eq("user_id", user.id)

      if (!memErr && memberships) {
        const games = (memberships as unknown as GameMembership[])
          .map((m) => m.games)
          .filter(Boolean)
          // Drop completed games — they're read-only from here on.
          // If the user came in via `?game=<id>` pointing at a
          // completed game, the preselected branch below will miss
          // and the picker will fall back to "Choose a game…".
          .filter((l) => l.status !== "completed")
        setUserGames(games)

        // Pre-select if only one game or if game param provided
        if (preselectedGameId && games.some((l) => l.id === preselectedGameId)) {
          setSelectedGameId(preselectedGameId)
        } else if (games.length === 1) {
          setSelectedGameId(games[0].id)
        }
      }
      setGamesLoading(false)
    }
    init()
  }, [authLoading, user, preselectedGameId])

  // Load members + period when game changes
  useEffect(() => {
    if (!selectedGameId) {
      setMembers([])
      setActivePeriod(null)
      setSelectedPlayerIds([])
      return
    }

    let cancelled = false
    const loadGameData = async () => {
      setMembersLoading(true)
      setError(null)

      try {
        const [membersRes, periodRes] = await Promise.all([
          supabase
            .from("game_members")
            .select("id, game_id, user_id, profiles(username, first_name, last_name)")
            .eq("game_id", selectedGameId),
          supabase
            .from("game_periods")
            .select("*")
            .eq("game_id", selectedGameId)
            .order("start_date", { ascending: true })
            .limit(1)
            .maybeSingle(),
        ])

        if (cancelled) return

        if (membersRes.error) throw membersRes.error
        const memberRows = (membersRes.data || []) as MemberWithProfile[]
        setMembers(memberRows)

        if (periodRes.error && periodRes.error.code !== "PGRST116") {
          throw periodRes.error
        }
        setActivePeriod((periodRes.data as GamePeriod | null) ?? null)

        // Pre-select current user
        if (user) {
          const currentUserMember = memberRows.find((m) => m.user_id === user.id)
          setSelectedPlayerIds(currentUserMember ? [currentUserMember.user_id] : [])
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load game members.")
        }
      } finally {
        if (!cancelled) setMembersLoading(false)
      }
    }

    loadGameData()
    return () => { cancelled = true }
  }, [selectedGameId, user])

  const isPlayerSelected = (userId: string) => selectedPlayerIds.includes(userId)

  const MAX_MATCH_PLAYERS = 4

  const togglePlayer = (userId: string) => {
    setSelectedPlayerIds((prev) => {
      if (prev.includes(userId)) {
        return prev.filter((id) => id !== userId)
      }
      if (prev.length >= MAX_MATCH_PLAYERS) return prev // cap at 4
      return [...prev, userId]
    })
  }

  const memberDisplayName = (member: MemberWithProfile) => {
    const profile = member.profiles
    return profile?.username || [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "Player"
  }

  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => memberDisplayName(a).localeCompare(memberDisplayName(b))),
    [members],
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    setError(null)

    if (!selectedGameId || !selectedGame) {
      setError("Please select a game.")
      return
    }
    if (!date) {
      setError("Please select a match date.")
      return
    }
    if (!activePeriod) {
      setError("No active period for this game. Start the game first.")
      return
    }
    if (selectedPlayerIds.length < 2) {
      setError("Select at least 2 players for this match.")
      return
    }
    if (selectedPlayerIds.length > MAX_MATCH_PLAYERS) {
      setError(`A match can have at most ${MAX_MATCH_PLAYERS} players.`)
      return
    }

    setSubmitting(true)
    try {
      const { data: match, error: matchError } = await supabase
        .from("matches")
        .insert({
          game_id: selectedGameId,
          period_id: activePeriod.id,
          course_name: selectedGame.course_name || null,
          match_date: date,
          match_time: time || null,
          created_by: user.id,
          status: "scheduled",
        })
        .select("id")
        .single()

      if (matchError) throw matchError

      const matchId = (match as { id: string | number }).id

      const playerRows = selectedPlayerIds.map((playerId) => ({
        match_id: matchId,
        user_id: playerId,
      }))

      const { error: playersError } = await supabase
        .from("match_players")
        .insert(playerRows)

      if (playersError) throw playersError

      track("match_created", {})
      router.push(`/matches/${matchId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create match. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading) {
    return <LoadingSpinner message="Checking your session…" />
  }
  if (!user) return null
  if (gamesLoading) {
    return <LoadingSpinner message="Loading your games…" />
  }

  // No games — show empty state
  if (userGames.length === 0) {
    return (
      <main className="min-h-screen px-4 py-8">
        <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-6 text-center">
          <h1 className="text-2xl font-bold text-primary">Create Match</h1>
          <p className="text-sm text-primary/70">
            You need to be part of a game before creating a match.
          </p>
          <div className="flex gap-3">
            <Link
              href="/games/create"
              className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream hover:bg-primary/90"
            >
              Create a Game
            </Link>
            <Link
              href="/games/join"
              className="rounded-lg border border-primary/20 bg-white px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5"
            >
              Join a Game
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen px-4 py-6">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-bold text-primary">Create Match</h1>
          <p className="mt-1 text-sm text-primary/70">
            Schedule a match within one of your games.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-xl border border-primary/15 bg-white p-5 shadow-sm"
        >
          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Game Selection */}
          <div>
            <label htmlFor="game" className="mb-1 block text-sm font-medium text-primary">
              Select your game
            </label>
            <select
              id="game"
              value={selectedGameId}
              onChange={(e) => setSelectedGameId(e.target.value)}
              className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={submitting}
            >
              <option value="">Choose a game…</option>
              {userGames.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date / Time */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="date" className="mb-1 block text-sm font-medium text-primary">
                Date
              </label>
              <input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-primary/20 bg-cream px-3 py-2.5 text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                disabled={submitting}
              />
            </div>
            <div>
              <label htmlFor="time" className="mb-1 block text-sm font-medium text-primary">
                Time (optional)
              </label>
              <input
                id="time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                step={600}
                className="w-full rounded-lg border border-primary/20 bg-cream px-3 py-2.5 text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                disabled={submitting}
              />
            </div>
          </div>

          {/* Player Selection */}
          {selectedGameId && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-primary">Players</p>
                <p className="text-xs text-primary/50">{selectedPlayerIds.length}/{MAX_MATCH_PLAYERS} selected</p>
              </div>
              {membersLoading ? (
                <p className="py-3 text-center text-sm text-primary/50">Loading members…</p>
              ) : (
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-primary/15 bg-cream px-3 py-2">
                  {sortedMembers.length === 0 ? (
                    <p className="py-2 text-sm text-primary/70">No game members yet.</p>
                  ) : (
                    sortedMembers.map((member) => {
                      const checked = isPlayerSelected(member.user_id)
                      const atCap = selectedPlayerIds.length >= MAX_MATCH_PLAYERS && !checked
                      const displayName = memberDisplayName(member)
                      return (
                        <label
                          key={String(member.id)}
                          className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-primary ${
                            atCap ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:bg-white"
                          }`}
                        >
                          <span>{displayName}</span>
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-primary/40 text-primary focus:ring-primary"
                            checked={checked}
                            onChange={() => togglePlayer(member.user_id)}
                            disabled={submitting || atCap}
                          />
                        </label>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !selectedGameId}
            className="flex w-full items-center justify-center rounded-lg bg-primary px-4 py-3 text-sm font-medium text-cream transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Creating match…" : "Create Match"}
          </button>
        </form>
      </div>
    </main>
  )
}

export default function CreateMatchPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <CreateMatchContent />
    </Suspense>
  )
}

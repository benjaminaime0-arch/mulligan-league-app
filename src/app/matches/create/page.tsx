"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { LoadingSpinner } from "@/components/LoadingSpinner"

type League = {
  id: string
  name: string
  course_name?: string | null
}

type LeagueMembership = {
  id: string
  league_id: string
  user_id: string
  leagues: League
}

type MemberWithProfile = {
  id: string | number
  league_id: string | number
  user_id: string
  profiles?: {
    first_name?: string | null
    last_name?: string | null
  } | null
}

type LeaguePeriod = {
  id: string | number
  league_id: string | number
  name?: string | null
  status?: string | null
}

function CreateMatchContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const preselectedLeagueId = searchParams.get("league")

  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  // User's leagues
  const [userLeagues, setUserLeagues] = useState<League[]>([])
  const [leaguesLoading, setLeaguesLoading] = useState(true)

  // Selected league
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>(preselectedLeagueId || "")
  const [members, setMembers] = useState<MemberWithProfile[]>([])
  const [activePeriod, setActivePeriod] = useState<LeaguePeriod | null>(null)
  const [membersLoading, setMembersLoading] = useState(false)

  // Form
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [time, setTime] = useState<string>("")
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedLeague = userLeagues.find((l) => l.id === selectedLeagueId) || null

  // Auth + load user's leagues
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

      // Load leagues the user belongs to
      const { data: memberships, error: memErr } = await supabase
        .from("league_members")
        .select("id, league_id, user_id, leagues(id, name, course_name)")
        .eq("user_id", session.user.id)

      if (!memErr && memberships) {
        const leagues = (memberships as unknown as LeagueMembership[])
          .map((m) => m.leagues)
          .filter(Boolean)
        setUserLeagues(leagues)

        // Pre-select if only one league or if league param provided
        if (preselectedLeagueId && leagues.some((l) => l.id === preselectedLeagueId)) {
          setSelectedLeagueId(preselectedLeagueId)
        } else if (leagues.length === 1) {
          setSelectedLeagueId(leagues[0].id)
        }
      }
      setLeaguesLoading(false)
    }
    init()
  }, [router, preselectedLeagueId])

  // Load members + period when league changes
  useEffect(() => {
    if (!selectedLeagueId) {
      setMembers([])
      setActivePeriod(null)
      setSelectedPlayerIds([])
      return
    }

    let cancelled = false
    const loadLeagueData = async () => {
      setMembersLoading(true)
      setError(null)

      try {
        const [membersRes, periodRes] = await Promise.all([
          supabase
            .from("league_members")
            .select("id, league_id, user_id, profiles(first_name, last_name)")
            .eq("league_id", selectedLeagueId),
          supabase
            .from("league_periods")
            .select("*")
            .eq("league_id", selectedLeagueId)
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
        setActivePeriod((periodRes.data as LeaguePeriod | null) ?? null)

        // Pre-select current user
        if (user) {
          const currentUserMember = memberRows.find((m) => m.user_id === user.id)
          setSelectedPlayerIds(currentUserMember ? [currentUserMember.user_id] : [])
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load league members.")
        }
      } finally {
        if (!cancelled) setMembersLoading(false)
      }
    }

    loadLeagueData()
    return () => { cancelled = true }
  }, [selectedLeagueId, user])

  const isPlayerSelected = (userId: string) => selectedPlayerIds.includes(userId)

  const togglePlayer = (userId: string) => {
    setSelectedPlayerIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    )
  }

  const memberDisplayName = (member: MemberWithProfile) => {
    const profile = member.profiles
    const nameFromProfile = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ")
    return nameFromProfile || "Player"
  }

  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => memberDisplayName(a).localeCompare(memberDisplayName(b))),
    [members],
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    setError(null)

    if (!selectedLeagueId || !selectedLeague) {
      setError("Please select a league.")
      return
    }
    if (!date) {
      setError("Please select a match date.")
      return
    }
    if (!activePeriod) {
      setError("No active period for this league. Start the league first.")
      return
    }
    if (selectedPlayerIds.length === 0) {
      setError("Select at least one player for this match.")
      return
    }

    setSubmitting(true)
    try {
      const { data: match, error: matchError } = await supabase
        .from("matches")
        .insert({
          league_id: selectedLeagueId,
          period_id: activePeriod.id,
          course_name: selectedLeague.course_name || null,
          match_date: date,
          match_time: time || null,
          created_by: user.id,
          status: "scheduled",
          match_type: "league",
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
  if (leaguesLoading) {
    return <LoadingSpinner message="Loading your leagues…" />
  }

  // No leagues — show empty state
  if (userLeagues.length === 0) {
    return (
      <main className="min-h-screen bg-cream px-4 py-8">
        <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-6 text-center">
          <h1 className="text-2xl font-bold text-primary">Create Match</h1>
          <p className="text-sm text-primary/70">
            You need to be part of a league before creating a match.
          </p>
          <div className="flex gap-3">
            <Link
              href="/leagues/create"
              className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream hover:bg-primary/90"
            >
              Create a League
            </Link>
            <Link
              href="/leagues/join"
              className="rounded-lg border border-primary/20 bg-white px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5"
            >
              Join a League
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-cream px-4 py-6">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-bold text-primary">Create Match</h1>
          <p className="mt-1 text-sm text-primary/70">
            Schedule a match within one of your leagues.
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

          {/* League Selection */}
          <div>
            <label htmlFor="league" className="mb-1 block text-sm font-medium text-primary">
              Select your league
            </label>
            <select
              id="league"
              value={selectedLeagueId}
              onChange={(e) => setSelectedLeagueId(e.target.value)}
              className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={submitting}
            >
              <option value="">Choose a league…</option>
              {userLeagues.map((league) => (
                <option key={league.id} value={league.id}>
                  {league.name}
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
                className="w-full rounded-lg border border-primary/20 bg-cream px-3 py-2.5 text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                disabled={submitting}
              />
            </div>
          </div>

          {/* Player Selection */}
          {selectedLeagueId && (
            <div>
              <p className="mb-2 text-sm font-medium text-primary">Players</p>
              {membersLoading ? (
                <p className="py-3 text-center text-sm text-primary/50">Loading members…</p>
              ) : (
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-primary/15 bg-cream px-3 py-2">
                  {sortedMembers.length === 0 ? (
                    <p className="py-2 text-sm text-primary/70">No league members yet.</p>
                  ) : (
                    sortedMembers.map((member) => {
                      const checked = isPlayerSelected(member.user_id)
                      const displayName = memberDisplayName(member)
                      return (
                        <label
                          key={String(member.id)}
                          className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-sm text-primary hover:bg-white"
                        >
                          <span>{displayName}</span>
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-primary/40 text-primary focus:ring-primary"
                            checked={checked}
                            onChange={() => togglePlayer(member.user_id)}
                            disabled={submitting}
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
            disabled={submitting || !selectedLeagueId}
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

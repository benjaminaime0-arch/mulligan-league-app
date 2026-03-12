"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"

type League = {
  id: string | number
  name: string
  course_name?: string | null
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
  status?: string | null
}

export default function CreateMatchPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const leagueId = searchParams.get("league")

  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  const [league, setLeague] = useState<League | null>(null)
  const [members, setMembers] = useState<MemberWithProfile[]>([])
  const [activePeriod, setActivePeriod] = useState<LeaguePeriod | null>(null)

  const [date, setDate] = useState<string>(() => {
    return new Date().toISOString().slice(0, 10)
  })
  const [time, setTime] = useState<string>("")
  const [courseName, setCourseName] = useState<string>("")
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([])

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
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

      if (!leagueId) {
        setError("Missing league information for this match.")
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)

        const [leagueRes, membersRes, periodRes] = await Promise.all([
          supabase.from("leagues").select("*").eq("id", leagueId).single(),
          supabase.from("league_members").select("*, profiles(*)").eq("league_id", leagueId),
          supabase
            .from("league_periods")
            .select("*")
            .eq("league_id", leagueId)
            .eq("status", "active")
            .maybeSingle(),
        ])

        if (leagueRes.error) throw leagueRes.error
        if (!leagueRes.data) throw new Error("League not found.")

        const leagueData = leagueRes.data as League
        setLeague(leagueData)
        setCourseName(leagueData.course_name || "")

        if (membersRes.error) throw membersRes.error
        const memberRows = (membersRes.data || []) as MemberWithProfile[]
        setMembers(memberRows)

        if (periodRes.error && periodRes.error.code !== "PGRST116") {
          throw periodRes.error
        }
        setActivePeriod((periodRes.data as LeaguePeriod | null) ?? null)

        const currentUserId = session.user.id
        const defaultSelected = memberRows
          .filter((m) => m.user_id === currentUserId)
          .map((m) => m.user_id)

        setSelectedPlayerIds(defaultSelected)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load league.")
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [leagueId, router])

  const isPlayerSelected = (userId: string) => selectedPlayerIds.includes(userId)

  const togglePlayer = (userId: string) => {
    setSelectedPlayerIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    )
  }

  const memberDisplayName = (member: MemberWithProfile) => {
    const profile = member.profiles
    const nameFromProfile =
      profile?.full_name ||
      [profile?.first_name, profile?.last_name].filter(Boolean).join(" ")
    return nameFromProfile || "Player"
  }

  const sortedMembers = useMemo(
    () =>
      [...members].sort((a, b) =>
        memberDisplayName(a).localeCompare(memberDisplayName(b)),
      ),
    [members],
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return

    setError(null)

    if (!leagueId || !league) {
      setError("Missing league information.")
      return
    }

    if (!activePeriod) {
      setError("No active period for this league. Start the league first.")
      return
    }

    if (!date) {
      setError("Please select a match date.")
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
          league_id: leagueId,
          period_id: activePeriod.id,
          course_name: courseName || league.course_name,
          match_date: date,
          match_time: time || null,
          created_by: user.id,
          status: "scheduled",
        })
        .select("id")
        .single()

      if (matchError) {
        throw matchError
      }

      const matchId = (match as { id: string | number }).id

      const playerRows = selectedPlayerIds.map((playerId) => ({
        match_id: matchId,
        user_id: playerId,
      }))

      const { error: playersError } = await supabase
        .from("match_players")
        .insert(playerRows)

      if (playersError) {
        throw playersError
      }

      router.push(`/matches/${matchId}`)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create match. Please try again.",
      )
    } finally {
      setSubmitting(false)
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

  if (error && !league) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream px-4">
        <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-red-700">{error}</p>
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

  return (
    <main className="min-h-screen bg-cream px-4 py-6">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-bold text-primary">Create Match</h1>
          {league && (
            <p className="mt-1 text-sm text-primary/70">
              {league.name} · {league.course_name || "Course TBA"}
            </p>
          )}
          {activePeriod && (
            <p className="mt-1 text-xs uppercase tracking-[0.2em] text-primary/60">
              Assigned to: {activePeriod.name || "Current period"}
            </p>
          )}
        </header>

        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-xl border border-primary/15 bg-white p-5 shadow-sm"
        >
          {error && (
            <div
              role="alert"
              className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label
                htmlFor="course"
                className="mb-1 block text-sm font-medium text-primary"
              >
                Golf course
              </label>
              <input
                id="course"
                type="text"
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
                placeholder="Course name"
                className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                disabled={submitting}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="date"
                  className="mb-1 block text-sm font-medium text-primary"
                >
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
                <label
                  htmlFor="time"
                  className="mb-1 block text-sm font-medium text-primary"
                >
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
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-primary">Players</p>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-primary/15 bg-cream px-3 py-2">
              {sortedMembers.length === 0 ? (
                <p className="py-2 text-sm text-primary/70">
                  No league members yet.
                </p>
              ) : (
                sortedMembers.map((member) => {
                  const checked = isPlayerSelected(member.user_id)
                  const displayName = memberDisplayName(member)
                  return (
                    <label
                      key={member.id}
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
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center rounded-lg bg-primary px-4 py-3 text-sm font-medium text-cream transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Creating match…" : "Create Match"}
          </button>
        </form>
      </div>
    </main>
  )
}


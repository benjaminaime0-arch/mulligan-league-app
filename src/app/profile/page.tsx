"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { LoadingSpinner } from "@/components/LoadingSpinner"

type Profile = {
  id: string
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  club?: string | null
  handicap?: number | null
}

type Score = {
  id: string | number
  match_id: string | number
  user_id: string
  score: number
  holes: number
  created_at?: string | null
}

type LeagueMember = {
  id: string | number
  league_id: string | number
  leagues?: {
    id: string | number
    name: string
    status?: string | null
  } | null
}

type RoundHistoryRow = {
  round_date: string | null
  course_name: string | null
  score: number
  holes: number
  match_type: string
  league_name: string | null
  match_id: string
  score_status: string
}

export default function ProfilePage() {
  const router = useRouter()

  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  const [profile, setProfile] = useState<Profile | null>(null)
  const [scores, setScores] = useState<Score[]>([])
  const [memberships, setMemberships] = useState<LeagueMember[]>([])
  const [roundHistory, setRoundHistory] = useState<RoundHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [logoutLoading, setLogoutLoading] = useState(false)

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

        const [profileRes, scoresRes, membershipsRes, historyRes] = await Promise.all([
          supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle(),
          supabase.from("scores").select("*").eq("user_id", session.user.id).order("created_at", { ascending: false }),
          supabase.from("league_members").select("*, leagues(*)").eq("user_id", session.user.id),
          supabase.rpc("get_player_round_history", { p_user_id: session.user.id }),
        ])

        if (profileRes.error) throw profileRes.error
        setProfile((profileRes.data || null) as Profile | null)

        if (scoresRes.error) throw scoresRes.error
        setScores((scoresRes.data || []) as Score[])

        if (membershipsRes.error) throw membershipsRes.error
        setMemberships((membershipsRes.data || []) as LeagueMember[])

        // Round history may fail if RPC doesn't exist yet — graceful fallback
        if (!historyRes.error) {
          setRoundHistory((historyRes.data || []) as RoundHistoryRow[])
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load profile.")
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [router])

  const bestScore = useMemo(
    () => (scores.length ? Math.min(...scores.map((s) => s.score)) : null),
    [scores],
  )

  const averageScore = useMemo(() => {
    if (scores.length === 0) return null
    const total = scores.reduce((sum, s) => sum + s.score, 0)
    return total / scores.length
  }, [scores])

  // Trend: compare last 5 vs previous 5
  const trend = useMemo(() => {
    if (scores.length < 5) return null
    const recent5 = scores.slice(0, 5)
    const previous5 = scores.slice(5, 10)
    if (previous5.length < 3) return null

    const recentAvg = recent5.reduce((s, r) => s + r.score, 0) / recent5.length
    const previousAvg = previous5.reduce((s, r) => s + r.score, 0) / previous5.length
    const diff = recentAvg - previousAvg

    if (diff < -1) return { label: "Improving", color: "text-emerald-600" }
    if (diff > 1) return { label: "Needs work", color: "text-amber-600" }
    return { label: "Steady", color: "text-primary/60" }
  }, [scores])

  const handleLogout = async () => {
    setLogoutLoading(true)
    try {
      await supabase.auth.signOut()
      router.push("/login")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log out.")
    } finally {
      setLogoutLoading(false)
    }
  }

  if (authLoading) return <LoadingSpinner message="Checking your session…" />
  if (!user) return null
  if (loading) return <LoadingSpinner message="Loading profile…" />

  const displayName =
    profile?.full_name ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    (user.user_metadata?.full_name as string) ||
    [user.user_metadata?.first_name, user.user_metadata?.last_name].filter(Boolean).join(" ") ||
    user.email ||
    "Player"

  return (
    <main className="min-h-screen bg-cream px-4 pb-24 pt-4 md:pb-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {/* Header */}
        <header className="rounded-2xl border border-primary/15 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-lg font-semibold text-cream">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary/60">Profile</p>
              <h1 className="mt-1 text-2xl font-bold text-primary">{displayName}</h1>
              <p className="mt-1 text-sm text-primary/70">Your golf competition identity across leagues, matches, and posted scores.</p>
            </div>
          </div>
        </header>

        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Stats cards */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-primary/15 bg-white p-4 shadow-sm">
            <p className="text-[11px] uppercase tracking-wide text-primary/50">Best Score</p>
            <p className="mt-2 text-2xl font-bold text-primary">{bestScore ?? "–"}</p>
          </div>
          <div className="rounded-2xl border border-primary/15 bg-white p-4 shadow-sm">
            <p className="text-[11px] uppercase tracking-wide text-primary/50">Average</p>
            <p className="mt-2 text-2xl font-bold text-primary">
              {averageScore != null ? averageScore.toFixed(1) : "–"}
            </p>
          </div>
          <div className="rounded-2xl border border-primary/15 bg-white p-4 shadow-sm">
            <p className="text-[11px] uppercase tracking-wide text-primary/50">Rounds Posted</p>
            <p className="mt-2 text-2xl font-bold text-primary">{scores.length}</p>
          </div>
          <div className="rounded-2xl border border-primary/15 bg-white p-4 shadow-sm">
            <p className="text-[11px] uppercase tracking-wide text-primary/50">
              {trend ? "Trend" : "Leagues"}
            </p>
            <p className={`mt-2 text-2xl font-bold ${trend ? trend.color : "text-primary"}`}>
              {trend ? trend.label : memberships.length}
            </p>
          </div>
        </section>

        {/* Two column: Leagues + Recent Rounds */}
        <section className="grid gap-4 md:grid-cols-2">
          {/* My Leagues */}
          <div className="rounded-2xl border border-primary/15 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-primary/60">My Leagues</h2>
                <p className="mt-1 text-sm text-primary/70">Where you are currently competing.</p>
              </div>
              <Link href="/leagues/list" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                See all
              </Link>
            </div>
            <div className="space-y-3">
              {memberships.length === 0 ? (
                <p className="text-sm text-primary/70">No leagues joined yet.</p>
              ) : (
                memberships.map((membership) => {
                  const league = membership.leagues
                  if (!league) return null
                  return (
                    <Link
                      key={membership.id}
                      href={`/leagues/${league.id}`}
                      className="block rounded-xl border border-primary/10 bg-cream px-4 py-3 hover:bg-primary/5"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-primary">{league.name}</p>
                        <span className="text-xs uppercase tracking-wide text-primary/50">{league.status || "active"}</span>
                      </div>
                    </Link>
                  )
                })
              )}
            </div>
          </div>

          {/* Recent Rounds */}
          <div className="rounded-2xl border border-primary/15 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-primary/60">Recent Rounds</h2>
                <p className="mt-1 text-sm text-primary/70">Your latest submitted rounds.</p>
              </div>
              <Link href="/leaderboard" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                Leaderboard
              </Link>
            </div>
            <div className="space-y-3">
              {roundHistory.length > 0 ? (
                roundHistory.slice(0, 5).map((round, i) => (
                  <Link
                    key={`${round.match_id}-${i}`}
                    href={`/matches/${round.match_id}`}
                    className="block rounded-xl border border-primary/10 bg-cream px-4 py-3 hover:bg-primary/5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-primary">
                          {round.course_name || "Course"} · {round.score}
                        </p>
                        <p className="text-xs text-primary/60">
                          {round.round_date || "Date TBA"} · {round.holes} holes
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                          round.match_type === "casual"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {round.match_type === "casual" ? "Casual" : "League"}
                      </span>
                    </div>
                  </Link>
                ))
              ) : scores.length > 0 ? (
                // Fallback if RPC not available yet
                scores.slice(0, 5).map((score) => (
                  <div key={score.id} className="rounded-xl border border-primary/10 bg-cream px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-primary">Score {score.score}</p>
                      <span className="text-xs text-primary/50">{score.holes} holes</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-primary/70">No scores posted yet.</p>
              )}
            </div>
          </div>
        </section>

        {/* Create Match CTA */}
        <section className="rounded-2xl border-2 border-dashed border-primary/20 bg-white p-5 text-center">
          <h2 className="text-sm font-semibold text-primary">Track your game</h2>
          <p className="mt-1 text-sm text-primary/60">Start a casual match to track your scores outside of league play.</p>
          <Link
            href="/matches/create"
            className="mt-4 inline-block rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-cream hover:bg-primary/90"
          >
            Create Match
          </Link>
        </section>

        {/* Profile info + actions */}
        <section className="space-y-4 rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
          <Field label="Name" value={displayName} />
          <Field label="Email" value={profile?.email || user.email || "Not set"} />
          <Field label="Home Club" value={profile?.club || "Not set"} />
          <Field
            label="Handicap"
            value={profile?.handicap != null ? profile.handicap.toFixed(1) : "Not set"}
          />
        </section>

        <section className="space-y-3">
          <button
            type="button"
            onClick={handleLogout}
            disabled={logoutLoading}
            className="w-full rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {logoutLoading ? "Logging out…" : "Log Out"}
          </button>
        </section>
      </div>
    </main>
  )
}

interface FieldProps {
  label: string
  value: string
}

function Field({ label, value }: FieldProps) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/60">
        {label}
      </p>
      <p className="mt-1 text-sm text-primary">{value}</p>
    </div>
  )
}

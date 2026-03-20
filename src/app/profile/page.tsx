"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { fetchMatchPlayerNames } from "@/lib/matchPlayers"
import { LoadingSpinner } from "@/components/LoadingSpinner"
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts"

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
  const [roundPlayerNames, setRoundPlayerNames] = useState<Map<string | number, string[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [logoutLoading, setLogoutLoading] = useState(false)

  // Profile editing
  const [editing, setEditing] = useState(false)
  const [editFirstName, setEditFirstName] = useState("")
  const [editLastName, setEditLastName] = useState("")
  const [editClub, setEditClub] = useState("")
  const [editHandicap, setEditHandicap] = useState("")
  const [saving, setSaving] = useState(false)

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
          const history = (historyRes.data || []) as RoundHistoryRow[]
          setRoundHistory(history)

          // Fetch player names for these rounds
          if (history.length > 0) {
            const matchIds = history.map((r) => r.match_id)
            const playerNames = await fetchMatchPlayerNames(supabase, matchIds, session.user.id)
            setRoundPlayerNames(playerNames)
          }
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

  // Chart data — chronological order (oldest first)
  const chartData = useMemo(() => {
    if (roundHistory.length < 2) return []
    return [...roundHistory]
      .reverse()
      .map((r) => ({
        date: r.round_date
          ? new Date(r.round_date + "T00:00:00").toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })
          : "",
        score: r.score,
      }))
  }, [roundHistory])

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

  const startEditing = () => {
    setEditFirstName(profile?.first_name || (user?.user_metadata?.first_name as string) || "")
    setEditLastName(profile?.last_name || (user?.user_metadata?.last_name as string) || "")
    setEditClub(profile?.club || "")
    setEditHandicap(profile?.handicap != null ? String(profile.handicap) : "")
    setEditing(true)
  }

  const handleSaveProfile = async () => {
    if (!user) return
    setSaving(true)
    setError(null)
    try {
      const firstName = editFirstName.trim()
      const lastName = editLastName.trim()
      const fullName = [firstName, lastName].filter(Boolean).join(" ") || null
      const handicapNum = editHandicap.trim() ? parseFloat(editHandicap.trim()) : null

      if (handicapNum != null && (Number.isNaN(handicapNum) || handicapNum < 0 || handicapNum > 54)) {
        setError("Handicap must be between 0 and 54.")
        setSaving(false)
        return
      }

      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          first_name: firstName || null,
          last_name: lastName || null,
          full_name: fullName,
          club: editClub.trim() || null,
          handicap: handicapNum,
        })
        .eq("id", user.id)

      if (updateError) throw updateError

      // Refresh profile data
      const { data: refreshed } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle()
      setProfile((refreshed || null) as Profile | null)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile.")
    } finally {
      setSaving(false)
    }
  }

  if (authLoading) return <LoadingSpinner message="Checking your session..." />
  if (!user) return null
  if (loading) return <LoadingSpinner message="Loading profile..." />

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
        {/* Header with inline stats */}
        <header className="rounded-2xl border border-primary/15 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-lg font-semibold text-cream">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/60">Profile</p>
              <h1 className="mt-1 text-2xl font-bold text-primary">{displayName}</h1>
              <p className="mt-1 text-sm text-primary/70">Your season at a glance.</p>
            </div>
          </div>

          {/* Stats row inside the header card */}
          <div className="mt-4 border-t border-primary/10 pt-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-primary/50">Best Score</p>
                <p className="mt-1 text-xl font-bold text-primary">{bestScore ?? "\u2013"}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-primary/50">Average</p>
                <p className="mt-1 text-xl font-bold text-primary">
                  {averageScore != null ? averageScore.toFixed(1) : "\u2013"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-primary/50">Rounds</p>
                <p className="mt-1 text-xl font-bold text-primary">{scores.length}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-primary/50">
                  {trend ? "Trend" : "Leagues"}
                </p>
                <p className={`mt-1 text-xl font-bold ${trend ? trend.color : "text-primary"}`}>
                  {trend ? trend.label : memberships.length}
                </p>
              </div>
            </div>
          </div>
        </header>

        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

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
                <div className="space-y-3">
                  <p className="text-sm text-primary/70">No leagues joined yet.</p>
                  <div className="flex gap-2">
                    <Link href="/leagues/create" className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-cream hover:bg-primary/90">
                      Create League
                    </Link>
                    <Link href="/leagues/join" className="rounded-lg border border-primary/20 bg-cream px-3 py-2 text-xs font-medium text-primary hover:bg-primary/5">
                      Join League
                    </Link>
                  </div>
                </div>
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

          {/* Recent Rounds — with player names */}
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
                roundHistory.slice(0, 5).map((round, i) => {
                  const names = roundPlayerNames.get(round.match_id)
                  const playerLabel = names && names.length > 0
                    ? `vs. ${names.join(", ")}`
                    : round.course_name || "Solo round"
                  return (
                    <Link
                      key={`${round.match_id}-${i}`}
                      href={`/matches/${round.match_id}`}
                      className="block rounded-xl border border-primary/10 bg-cream px-4 py-3 hover:bg-primary/5"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-primary">
                            {playerLabel} &middot; {round.score}
                          </p>
                          <p className="text-xs text-primary/60">
                            {round.round_date || "Date TBA"} &middot; {round.holes} holes
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
                  )
                })
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
                <p className="text-sm text-primary/70">Your scorecard is clean. Post your first round.</p>
              )}
            </div>
          </div>
        </section>

        {/* Score Evolution Chart */}
        <section className="rounded-2xl border border-primary/15 bg-white p-5 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-[0.2em] text-primary/60">Score Evolution</h2>
          <p className="mb-4 text-sm text-primary/70">Your scoring trend over time.</p>

          {chartData.length >= 2 ? (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#0F3D2E15" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "#0F3D2E99" }}
                    tickLine={false}
                    axisLine={{ stroke: "#0F3D2E20" }}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#0F3D2E99" }}
                    tickLine={false}
                    axisLine={{ stroke: "#0F3D2E20" }}
                    domain={["dataMin - 2", "dataMax + 2"]}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#fff",
                      border: "1px solid #0F3D2E20",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: "#0F3D2E", fontWeight: 600 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="#0F3D2E"
                    strokeWidth={2}
                    dot={{ r: 4, fill: "#0F3D2E", strokeWidth: 0 }}
                    activeDot={{ r: 6, fill: "#0F3D2E" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-primary/20 bg-cream">
              <p className="text-sm text-primary/50">Post at least 2 rounds to see your score trend.</p>
            </div>
          )}

          <Link
            href="/matches/create"
            className="mt-3 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Log a round &rarr;
          </Link>
        </section>

        {/* Profile info + actions */}
        <section className="space-y-4 rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
          {editing ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="edit-first" className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-primary/60">First Name</label>
                  <input id="edit-first" type="text" value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} disabled={saving}
                    className="w-full rounded-lg border border-primary/20 bg-cream px-3 py-2 text-sm text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" placeholder="First name" />
                </div>
                <div>
                  <label htmlFor="edit-last" className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-primary/60">Last Name</label>
                  <input id="edit-last" type="text" value={editLastName} onChange={(e) => setEditLastName(e.target.value)} disabled={saving}
                    className="w-full rounded-lg border border-primary/20 bg-cream px-3 py-2 text-sm text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" placeholder="Last name" />
                </div>
              </div>
              <div>
                <label htmlFor="edit-club" className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-primary/60">Home Club</label>
                <input id="edit-club" type="text" value={editClub} onChange={(e) => setEditClub(e.target.value)} disabled={saving}
                  className="w-full rounded-lg border border-primary/20 bg-cream px-3 py-2 text-sm text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" placeholder="Your home course" />
              </div>
              <div>
                <label htmlFor="edit-handicap" className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-primary/60">Handicap</label>
                <input id="edit-handicap" type="number" step="0.1" min="0" max="54" value={editHandicap} onChange={(e) => setEditHandicap(e.target.value)} disabled={saving}
                  className="w-32 rounded-lg border border-primary/20 bg-cream px-3 py-2 text-sm text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" placeholder="e.g. 12.5" />
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={handleSaveProfile} disabled={saving}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-cream hover:bg-primary/90 disabled:opacity-60">
                  {saving ? "Saving\u2026" : "Save"}
                </button>
                <button type="button" onClick={() => { setEditing(false); setError(null) }} disabled={saving}
                  className="rounded-lg border border-primary/20 bg-white px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/60">Details</p>
                <button type="button" onClick={startEditing}
                  className="text-xs font-medium text-primary underline-offset-4 hover:underline">
                  Edit
                </button>
              </div>
              <Field label="Name" value={displayName} />
              <Field label="Email" value={profile?.email || user.email || "Not set"} />
              <Field label="Home Club" value={profile?.club || "Not set"} />
              <Field
                label="Handicap"
                value={profile?.handicap != null ? profile.handicap.toFixed(1) : "Not set"}
              />
            </>
          )}
        </section>

        <section className="space-y-3">
          <button
            type="button"
            onClick={handleLogout}
            disabled={logoutLoading}
            className="w-full rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {logoutLoading ? "Logging out\u2026" : "Log Out"}
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

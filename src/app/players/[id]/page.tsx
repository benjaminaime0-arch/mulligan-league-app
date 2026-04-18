"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { Avatar } from "@/components/Avatar"

type Profile = {
  id: string
  username: string | null
  first_name: string
  last_name: string | null
  avatar_url: string | null
  club: string | null
  town: string | null
  handicap: number | null
}

type RoundHistory = {
  round_date: string
  course_name: string | null
  score: number
  holes: number
  match_type: string | null
  league_name: string | null
  match_id: string
  score_status: string | null
}

type SharedLeague = {
  id: string
  name: string
  course_name: string | null
}

export default function PlayerProfilePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [rounds, setRounds] = useState<RoundHistory[]>([])
  const [sharedLeagues, setSharedLeagues] = useState<SharedLeague[]>([])
  const [loading, setLoading] = useState(true)
  const [isOwnProfile, setIsOwnProfile] = useState(false)

  useEffect(() => {
    if (authLoading || !user || !id) return

    if (id === user.id) {
      setIsOwnProfile(true)
      router.replace("/profile")
      return
    }

    const fetchPlayer = async () => {
      setLoading(true)

      // Fetch profile
      const { data: prof } = await supabase
        .from("profiles")
        .select("id, username, first_name, last_name, avatar_url, club, town, handicap")
        .eq("id", id)
        .maybeSingle()

      if (!prof) {
        setLoading(false)
        return
      }
      setProfile(prof)

      // Fetch round history
      const { data: history } = await supabase.rpc("get_player_round_history", {
        p_user_id: id,
      })
      if (history) setRounds(history as RoundHistory[])

      // Find shared leagues
      const { data: myLeagues } = await supabase
        .from("league_members")
        .select("league_id")
        .eq("user_id", user.id)

      const { data: theirLeagues } = await supabase
        .from("league_members")
        .select("league_id, leagues!inner(id, name, course_name)")
        .eq("user_id", id)

      if (myLeagues && theirLeagues) {
        const myIds = new Set(myLeagues.map((m) => m.league_id))
        const shared: SharedLeague[] = []
        for (const tl of theirLeagues) {
          if (myIds.has(tl.league_id)) {
            const league = tl.leagues as unknown as SharedLeague
            if (league) shared.push(league)
          }
        }
        setSharedLeagues(shared)
      }

      setLoading(false)
    }

    fetchPlayer()
  }, [authLoading, user, id, router])

  if (authLoading || loading || isOwnProfile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
      </div>
    )
  }

  if (!profile) {
    return (
      <main className="mx-auto max-w-2xl px-4 pb-6 pt-10 text-center">
        <p className="text-primary/60">Player not found.</p>
        <button
          onClick={() => router.back()}
          className="mt-4 text-sm font-medium text-primary underline underline-offset-2"
        >
          Go back
        </button>
      </main>
    )
  }

  // Stats from rounds
  const approvedRounds = rounds.filter((r) => r.score_status === "approved")
  const totalRounds = approvedRounds.length
  const avgScore =
    totalRounds > 0
      ? (approvedRounds.reduce((sum, r) => sum + r.score, 0) / totalRounds).toFixed(1)
      : null

  return (
    <main className="mx-auto max-w-2xl px-4 pb-6 pt-6 md:pt-8">
      {/* Back button */}
      <button
        onClick={() => router.back()}
        className="mb-4 flex items-center gap-1 text-sm text-primary/60 hover:text-primary"
      >
        <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Back
      </button>

      {/* Profile header */}
      <div className="flex items-center gap-4">
        <Avatar
          src={profile.avatar_url}
          alt={profile.username || profile.first_name}
          size={64}
          fallback={profile.username || profile.first_name}
        />
        <div>
          <h1 className="text-xl font-bold text-primary">
            {profile.username || `${profile.first_name} ${profile.last_name || ""}`.trim()}
          </h1>
          {profile.username && profile.first_name && (
            <p className="text-xs text-primary/40">{profile.first_name} {profile.last_name || ""}</p>
          )}
          <p className="text-sm text-primary/50">
            {[profile.club, profile.town].filter(Boolean).join(" · ") || "No location set"}
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="mt-6 grid grid-cols-3 gap-3">
        <StatCard label="Handicap" value={profile.handicap != null ? String(profile.handicap) : "—"} />
        <StatCard label="Rounds" value={String(totalRounds)} />
        <StatCard label="Avg Score" value={avgScore || "—"} />
      </div>

      {/* Shared leagues — carousel */}
      {sharedLeagues.length > 0 && (
        <SharedLeaguesCarousel leagues={sharedLeagues} />
      )}

      {/* Recent rounds — carousel */}
      {approvedRounds.length > 0 && (
        <RecentRoundsCarousel rounds={approvedRounds.slice(0, 10)} />
      )}
    </main>
  )
}

/* ── Shared Leagues Carousel ────────────────────────────── */

function SharedLeaguesCarousel({ leagues }: { leagues: SharedLeague[] }) {
  const [idx, setIdx] = useState(0)
  const router = useRouter()
  const league = leagues[idx]
  const hasPrev = idx > 0
  const hasNext = idx < leagues.length - 1

  return (
    <section className="mt-6 rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold text-primary">Leagues in Common</h2>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIdx((i) => i - 1)}
          disabled={!hasPrev}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-white text-primary transition-opacity ${
            hasPrev ? "hover:bg-primary/5" : "opacity-0 pointer-events-none"
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>

        <div
          onClick={() => router.push(`/leagues/${league.id}`)}
          className="min-w-0 flex-1 cursor-pointer rounded-lg bg-cream px-4 py-4 text-center text-primary hover:bg-primary/5"
        >
          <p className="text-base font-semibold">{league.name}</p>
          <p className="mt-1 text-xs text-primary/60">
            {league.course_name || "Course TBA"}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIdx((i) => i + 1)}
          disabled={!hasNext}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-white text-primary transition-opacity ${
            hasNext ? "hover:bg-primary/5" : "opacity-0 pointer-events-none"
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>
    </section>
  )
}

/* ── Recent Rounds Carousel ────────────────────────────── */

function RecentRoundsCarousel({ rounds }: { rounds: RoundHistory[] }) {
  const [idx, setIdx] = useState(0)
  const router = useRouter()
  const round = rounds[idx]
  const hasPrev = idx > 0
  const hasNext = idx < rounds.length - 1

  return (
    <section className="mt-6 rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-primary">Recent Rounds</h2>
        <p className="text-[10px] text-primary/40">{rounds.length} round{rounds.length !== 1 ? "s" : ""}</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIdx((i) => i - 1)}
          disabled={!hasPrev}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-white text-primary transition-opacity ${
            hasPrev ? "hover:bg-primary/5" : "opacity-0 pointer-events-none"
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>

        <div
          onClick={() => router.push(`/matches/${round.match_id}`)}
          className="min-w-0 flex-1 cursor-pointer rounded-lg bg-cream px-4 py-4 text-center text-primary hover:bg-primary/5"
        >
          <p className="text-2xl font-bold">{round.score}</p>
          <p className="mt-1 text-xs text-primary/60">
            {round.league_name || "Casual"}
            {round.course_name ? ` · ${round.course_name}` : ""}
            {` · ${new Date(round.round_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
          </p>
          <p className="mt-0.5 text-[10px] text-primary/40">{round.holes} holes</p>
        </div>

        <button
          type="button"
          onClick={() => setIdx((i) => i + 1)}
          disabled={!hasNext}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-white text-primary transition-opacity ${
            hasNext ? "hover:bg-primary/5" : "opacity-0 pointer-events-none"
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>
    </section>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-primary/10 px-3 py-3 text-center">
      <p className="text-lg font-bold text-primary">{value}</p>
      <p className="text-xs text-primary/50">{label}</p>
    </div>
  )
}

"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Image from "next/image"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { fetchMatchPlayers, fetchMatchPlayersWithScores, type MatchPlayerInfo, type MatchPlayerWithScore } from "@/lib/matchPlayers"
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

type LeagueData = {
  id: string
  name: string
  course_name?: string | null
  max_players?: number | null
  status?: string | null
  league_type?: string | null
  scoring_cards_count?: number | null
  total_cards_count?: number | null
  start_date?: string | null
  end_date?: string | null
}

type LeagueMemberProfile = {
  user_id: string
  profiles?: {
    id: string
    first_name?: string | null
    last_name?: string | null
    username?: string | null
    avatar_url?: string | null
  } | null
}

type PeriodData = {
  id: string | number
  league_id: string | number
  name?: string | null
  start_date?: string | null
  end_date?: string | null
  status?: string | null
}

type EnrichedLeague = LeagueData & {
  members: LeagueMemberProfile[]
  memberCount: number
  activePeriod?: PeriodData | null
}

type ScheduledMatch = {
  id: string
  match_date: string | null
  match_time: string | null
  course_name: string | null
  match_type: string
  league_id: string | null
  leagues?: { name: string } | null
}

type PastMatch = {
  round_date: string
  course_name: string | null
  score: number
  holes: number
  match_type: string | null
  league_name: string | null
  match_id: string
  score_status: string | null
}

type ActivityEvent = {
  id: string
  event_type: string
  league_id: string | null
  actor_id: string
  match_id: string | null
  metadata: Record<string, string | number | null>
  created_at: string
  actor_name: string
  actor_avatar_url: string | null
}

export default function PlayerProfilePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [enrichedLeagues, setEnrichedLeagues] = useState<EnrichedLeague[]>([])
  const [scheduledMatches, setScheduledMatches] = useState<ScheduledMatch[]>([])
  const [pastMatches, setPastMatches] = useState<PastMatch[]>([])
  const [matchPlayersMap, setMatchPlayersMap] = useState<Map<string | number, MatchPlayerInfo[]>>(new Map())
  const [pastMatchPlayersMap, setPastMatchPlayersMap] = useState<Map<string | number, MatchPlayerWithScore[]>>(new Map())
  const [matchesPlayed, setMatchesPlayed] = useState(0)
  const [leagueCount, setLeagueCount] = useState(0)
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
      const todayIso = new Date().toISOString().slice(0, 10)

      // Fetch profile, memberships, scheduled matches, scores count, and past matches in parallel
      const [profileRes, membershipsRes, playerMatchesRes, scoresCountRes, pastRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, username, first_name, last_name, avatar_url, club, town, handicap")
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("league_members")
          .select("id, league_id, leagues(*)")
          .eq("user_id", id),
        supabase
          .from("match_players")
          .select(
            "match_id, matches!inner(id, match_date, match_time, course_name, match_type, league_id, status, leagues(name))",
          )
          .eq("user_id", id)
          .gte("matches.match_date", todayIso)
          .neq("matches.status", "completed"),
        supabase
          .from("scores")
          .select("id", { count: "exact", head: true })
          .eq("user_id", id),
        supabase.rpc("get_player_round_history", { p_user_id: id }),
      ])

      if (!profileRes.data) {
        setLoading(false)
        return
      }
      setProfile(profileRes.data as Profile)

      // Build enriched leagues
      type MemberRow = { id: string; league_id: string; leagues?: LeagueData | null }
      const membershipData = (membershipsRes.data as unknown as MemberRow[]) || []
      const leagueMap = new Map<string, LeagueData>()
      for (const m of membershipData) {
        const l = m.leagues as LeagueData | null
        if (l && !leagueMap.has(String(l.id))) {
          leagueMap.set(String(l.id), l)
        }
      }
      const leagueList = Array.from(leagueMap.values())
      setLeagueCount(leagueList.length)

      if (leagueList.length > 0) {
        const leagueIds = leagueList.map((l) => l.id)
        const [leagueMembersRes, periodsRes] = await Promise.all([
          supabase
            .from("league_members")
            .select("league_id, user_id, profiles(id, first_name, last_name, username, avatar_url)")
            .in("league_id", leagueIds),
          supabase
            .from("league_periods")
            .select("*")
            .in("league_id", leagueIds)
            .order("start_date", { ascending: true }),
        ])

        const membersByLeague: Record<string, LeagueMemberProfile[]> = {}
        for (const m of leagueMembersRes.data || []) {
          const key = String(m.league_id)
          if (!membersByLeague[key]) membersByLeague[key] = []
          membersByLeague[key].push(m as unknown as LeagueMemberProfile)
        }

        const periodByLeague: Record<string, PeriodData> = {}
        for (const p of (periodsRes.data || []) as PeriodData[]) {
          const key = String(p.league_id)
          if (!periodByLeague[key] || p.status === "active") {
            periodByLeague[key] = p
          }
        }

        const enriched: EnrichedLeague[] = leagueList.map((l) => {
          const key = String(l.id)
          const members = membersByLeague[key] || []
          return {
            ...l,
            members,
            memberCount: members.length,
            activePeriod: periodByLeague[key] || null,
          }
        })
        setEnrichedLeagues(enriched)
      }

      // Scheduled matches
      type PlayerMatchRow = {
        match_id: string
        matches: {
          id: string
          match_date: string | null
          match_time: string | null
          course_name: string | null
          match_type: string
          league_id: string | null
          status: string | null
          leagues: { name: string } | null
        } | null
      }
      const rows = (playerMatchesRes.data as unknown as PlayerMatchRow[]) || []
      const upcoming: ScheduledMatch[] = rows
        .filter((r) => r.matches != null)
        .map((r) => ({
          id: r.matches!.id,
          match_date: r.matches!.match_date,
          match_time: r.matches!.match_time,
          course_name: r.matches!.course_name,
          match_type: r.matches!.match_type,
          league_id: r.matches!.league_id,
          leagues: r.matches!.leagues,
        }))
        .sort((a, b) => (a.match_date || "").localeCompare(b.match_date || ""))
      setScheduledMatches(upcoming)

      if (upcoming.length > 0) {
        const matchIds = upcoming.map((m) => m.id)
        const players = await fetchMatchPlayers(supabase, matchIds)
        setMatchPlayersMap(players)
      }

      // Past matches
      if (pastRes.data) {
        const approved = (pastRes.data as PastMatch[]).filter((r) => r.score_status === "approved")
        setPastMatches(approved)

        if (approved.length > 0) {
          const pastIds = approved.map((r) => r.match_id)
          const pastPlayers = await fetchMatchPlayersWithScores(supabase, pastIds)
          setPastMatchPlayersMap(pastPlayers)
        }
      }

      setMatchesPlayed(scoresCountRes.count || 0)
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

  const displayName = profile.username || "Player"

  return (
    <main className="min-h-screen bg-cream px-4 pb-6 pt-4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {/* Back button */}
        <button
          onClick={() => router.back()}
          className="flex w-fit items-center gap-1 text-sm text-primary/60 hover:text-primary"
        >
          <svg className="h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back
        </button>

        {/* 1. Profile header — same structure as own profile */}
        <section className="rounded-2xl border border-primary/15 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-4">
            {profile.avatar_url ? (
              <Image
                src={profile.avatar_url}
                alt={displayName}
                width={48}
                height={48}
                className="h-12 w-12 rounded-full object-cover"
                unoptimized={!profile.avatar_url.includes("supabase.co")}
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-lg font-semibold text-cream">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-primary">{displayName}</h1>
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-primary/10 pt-4 sm:grid-cols-4">
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-primary/50">Town</dt>
              <dd className="mt-1 truncate text-sm font-semibold text-primary">
                {profile.town || "\u2013"}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-primary/50">Handicap</dt>
              <dd className="mt-1 text-sm font-semibold text-primary">
                {profile.handicap != null ? profile.handicap : "\u2013"}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-primary/50">Matches Played</dt>
              <dd className="mt-1 text-sm font-semibold text-primary">{matchesPlayed}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-primary/50">Leagues</dt>
              <dd className="mt-1 text-sm font-semibold text-primary">{leagueCount}</dd>
            </div>
          </dl>
        </section>

        {/* Activity Feed is only shown on the user's own profile */}

        {/* 3. Scheduled Matches — Carousel */}
        <ScheduledMatchCarousel
          matches={scheduledMatches}
          matchPlayersMap={matchPlayersMap}
        />

        {/* 4. Past Matches — Carousel */}
        <PastMatchCarousel
          matches={pastMatches}
          matchPlayersMap={pastMatchPlayersMap}
        />

        {/* 5. Leagues — Carousel */}
        <LeagueCarousel leagues={enrichedLeagues} playerName={displayName} />
      </div>
    </main>
  )
}

/* ── Scheduled Match Carousel ──────────────────────────────── */

function ScheduledMatchCarousel({
  matches,
  matchPlayersMap,
}: {
  matches: ScheduledMatch[]
  matchPlayersMap: Map<string | number, MatchPlayerInfo[]>
}) {
  const [idx, setIdx] = useState(0)
  const router = useRouter()

  if (matches.length === 0) {
    return (
      <section className="rounded-xl border border-primary/15 bg-white px-4 py-3 shadow-sm">
        <h2 className="mb-2 text-center text-sm font-semibold text-primary">Scheduled Matches</h2>
        <p className="text-center text-xs text-primary/70">No matches scheduled.</p>
      </section>
    )
  }

  const m = matches[idx]
  const players = matchPlayersMap.get(m.id)
  const hasPrev = idx > 0
  const hasNext = idx < matches.length - 1

  const dateLabel = m.match_date
    ? new Date(m.match_date + "T00:00:00").toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "Date TBA"

  return (
    <section className="rounded-xl border border-primary/15 bg-white px-4 py-3 shadow-sm">
      <h2 className="mb-2 text-center text-sm font-semibold text-primary">Scheduled Matches</h2>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setIdx((i) => i - 1)}
          disabled={!hasPrev}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-white text-primary transition-opacity ${
            hasPrev ? "hover:bg-primary/5" : "opacity-0 pointer-events-none"
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>

        <div
          onClick={() => router.push(`/matches/${m.id}`)}
          className="min-w-0 flex-1 cursor-pointer rounded-lg bg-white px-3 py-2 text-center text-primary"
        >
          {players && players.length > 0 ? (
            <div className="flex items-center justify-center gap-3">
              {players.map((p, i) => (
                <div
                  key={i}
                  className="flex flex-col items-center gap-0.5"
                  onClick={(e) => {
                    if (p.user_id) {
                      e.stopPropagation()
                      router.push(`/players/${p.user_id}`)
                    }
                  }}
                >
                  <Avatar src={p.avatar_url} size={28} fallback={p.name} />
                  <span className={`text-[11px] font-semibold ${p.user_id ? "cursor-pointer hover:underline" : ""}`}>{p.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm font-semibold">
              {m.course_name || "Course TBA"}
            </p>
          )}
          <p className="mt-1 text-[11px] text-primary/60">
            {m.leagues?.name || "Match"}
            {m.course_name ? ` · ${m.course_name}` : ""}
            {` · ${dateLabel}`}
            {m.match_time ? ` · ${m.match_time.slice(0, 5)}` : ""}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIdx((i) => i + 1)}
          disabled={!hasNext}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-white text-primary transition-opacity ${
            hasNext ? "hover:bg-primary/5" : "opacity-0 pointer-events-none"
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>
    </section>
  )
}

/* ── Activity Feed Carousel ─────────────────────────────────── */

function activityIcon(eventType: string) {
  switch (eventType) {
    case "player_joined_league":
      return (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
          </svg>
        </div>
      )
    case "match_created":
      return (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-50">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
      )
    case "score_approved":
      return (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      )
    default:
      return (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/5">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary/50">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </div>
      )
  }
}

function activityMessage(event: ActivityEvent): { primary: string; secondary: string } {
  const meta = event.metadata || {}
  const name = event.actor_name || "Someone"

  switch (event.event_type) {
    case "player_joined_league":
      return {
        primary: `${name} joined`,
        secondary: String(meta.league_name || "a league"),
      }
    case "match_created":
      return {
        primary: `${name} created a match`,
        secondary: [meta.league_name, meta.course_name, meta.match_date ? formatDateShort(String(meta.match_date)) : null]
          .filter(Boolean)
          .join(" · "),
      }
    case "score_approved":
      return {
        primary: `${name} scored ${meta.score ?? "—"}`,
        secondary: [meta.league_name, meta.course_name]
          .filter(Boolean)
          .join(" · "),
      }
    default:
      return { primary: name, secondary: event.event_type }
  }
}

function timeAgo(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diffSec = Math.floor((now - then) / 1000)
  if (diffSec < 60) return "just now"
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function ActivityFeedCarousel({ events }: { events: ActivityEvent[] }) {
  const [idx, setIdx] = useState(0)
  const router = useRouter()

  if (events.length === 0) {
    return (
      <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-center text-sm font-semibold text-primary">Activity</h2>
        <p className="text-center text-sm text-primary/70">No recent activity.</p>
      </section>
    )
  }

  const event = events[idx]
  const msg = activityMessage(event)
  const hasPrev = idx > 0
  const hasNext = idx < events.length - 1

  const handleCardClick = () => {
    if (event.event_type === "match_created" || event.event_type === "score_approved") {
      if (event.match_id) router.push(`/matches/${event.match_id}`)
    } else if (event.event_type === "player_joined_league") {
      if (event.actor_id) router.push(`/players/${event.actor_id}`)
    }
  }

  return (
    <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-center text-sm font-semibold text-primary">Activity</h2>

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
          onClick={handleCardClick}
          className="min-w-0 flex-1 cursor-pointer rounded-lg bg-white px-4 py-4 text-center text-primary"
        >
          <div className="flex items-center justify-center gap-3">
            {activityIcon(event.event_type)}
            <Avatar src={event.actor_avatar_url} size={32} fallback={event.actor_name} />
          </div>
          <p className="mt-2 text-base font-semibold">{msg.primary}</p>
          {msg.secondary && (
            <p className="mt-0.5 text-xs text-primary/60">{msg.secondary}</p>
          )}
          <p className="mt-1 text-[10px] text-primary/40">{timeAgo(event.created_at)}</p>
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

/* ── Past Match Carousel ───────────────────────────────────── */

function PastMatchCarousel({
  matches,
  matchPlayersMap,
}: {
  matches: PastMatch[]
  matchPlayersMap: Map<string | number, MatchPlayerWithScore[]>
}) {
  const [idx, setIdx] = useState(0)
  const router = useRouter()

  if (matches.length === 0) {
    return (
      <section className="rounded-xl border border-primary/15 bg-white px-4 py-3 shadow-sm">
        <h2 className="mb-2 text-center text-sm font-semibold text-primary">Past Matches</h2>
        <p className="text-center text-xs text-primary/70">No completed matches yet.</p>
      </section>
    )
  }

  const m = matches[idx]
  const players = matchPlayersMap.get(m.match_id)
  const hasPrev = idx > 0
  const hasNext = idx < matches.length - 1

  const dateLabel = m.round_date
    ? new Date(m.round_date + "T00:00:00").toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : ""

  const sorted = players
    ? [...players].sort((a, b) => {
        if (a.score == null && b.score == null) return 0
        if (a.score == null) return 1
        if (b.score == null) return -1
        return a.score - b.score
      })
    : []

  const bestScore = sorted.length > 0 && sorted[0].score != null ? sorted[0].score : null

  return (
    <section className="rounded-xl border border-primary/15 bg-white px-4 py-3 shadow-sm">
      <h2 className="mb-2 text-center text-sm font-semibold text-primary">Past Matches</h2>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setIdx((i) => i - 1)}
          disabled={!hasPrev}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-white text-primary transition-opacity ${
            hasPrev ? "hover:bg-primary/5" : "opacity-0 pointer-events-none"
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>

        <div
          onClick={() => router.push(`/matches/${m.match_id}`)}
          className="min-w-0 flex-1 cursor-pointer rounded-lg bg-white px-3 py-2 text-primary"
        >
          {sorted.length > 0 ? (
            <div className="flex items-center justify-center gap-3">
              {sorted.map((p, i) => (
                <div
                  key={i}
                  className="flex flex-col items-center gap-0.5"
                  onClick={(e) => {
                    if (p.user_id) {
                      e.stopPropagation()
                      router.push(`/players/${p.user_id}`)
                    }
                  }}
                >
                  <Avatar src={p.avatar_url} size={28} fallback={p.name} />
                  <span className={`text-[11px] font-semibold ${p.user_id ? "cursor-pointer hover:underline" : ""}`}>{p.name}</span>
                  {p.score != null && (
                    <span
                      className={`text-xs font-bold ${
                        p.score === bestScore
                          ? "text-emerald-600"
                          : "text-primary/70"
                      }`}
                    >
                      {p.score}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-sm font-bold">{m.score}</p>
          )}
          <p className="mt-1 text-center text-[11px] text-primary/60">
            {m.league_name || "Casual"}
            {m.course_name ? ` · ${m.course_name}` : ""}
            {dateLabel ? ` · ${dateLabel}` : ""}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIdx((i) => i + 1)}
          disabled={!hasNext}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-white text-primary transition-opacity ${
            hasNext ? "hover:bg-primary/5" : "opacity-0 pointer-events-none"
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>
    </section>
  )
}

/* ── League Carousel ───────────────────────────────────────── */

function formatLeagueType(type?: string | null): string {
  if (!type) return "Standard"
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatDateShort(iso?: string | null): string {
  if (!iso) return "TBD"
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function LeagueCarousel({ leagues, playerName }: { leagues: EnrichedLeague[]; playerName: string }) {
  const [idx, setIdx] = useState(0)
  const router = useRouter()

  if (leagues.length === 0) {
    return (
      <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-primary">{playerName}&apos;s Leagues</h2>
        <p className="text-sm text-primary/70">Not in any leagues yet.</p>
      </section>
    )
  }

  const league = leagues[idx]

  return (
    <section
      className="cursor-pointer rounded-xl border border-primary/15 bg-white p-5 shadow-sm"
      onClick={() => router.push(`/leagues/${league.id}`)}
    >
      {/* Header with arrows */}
      <div className="flex items-center justify-between gap-2">
        {leagues.length > 1 && (
          <button type="button" onClick={(e) => { e.stopPropagation(); setIdx((i) => (i - 1 + leagues.length) % leagues.length) }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-primary/40 transition-colors hover:bg-primary/5 hover:text-primary active:scale-95"
            aria-label="Previous league">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        )}
        <div className="min-w-0 flex-1 text-center">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-primary/40">{playerName}&apos;s Leagues</p>
          <h2 className="text-lg font-bold text-primary">{league.name}</h2>
          <p className="text-xs uppercase tracking-[0.2em] text-primary/50">
            {league.course_name || "Course TBA"}
          </p>
        </div>
        {leagues.length > 1 && (
          <button type="button" onClick={(e) => { e.stopPropagation(); setIdx((i) => (i + 1) % leagues.length) }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-primary/40 transition-colors hover:bg-primary/5 hover:text-primary active:scale-95"
            aria-label="Next league">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        )}
      </div>

      {/* Dot indicators */}
      {leagues.length > 1 && (
        <div className="mt-2 flex items-center justify-center gap-1.5">
          {leagues.map((l, i) => (
            <button key={l.id} type="button" onClick={(e) => { e.stopPropagation(); setIdx(i) }}
              className={`h-1.5 rounded-full transition-all ${i === idx ? "w-5 bg-primary" : "w-1.5 bg-primary/20 hover:bg-primary/40"}`}
              aria-label={`View ${l.name}`} />
          ))}
        </div>
      )}

      {/* Status badge */}
      <div className="mt-3">
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
          (league.status || "draft") === "active"
            ? "bg-emerald-50 text-emerald-700"
            : (league.status || "draft") === "completed"
            ? "bg-primary/10 text-primary"
            : "bg-amber-50 text-amber-700"
        }`}>
          {league.status || "draft"}
        </span>
      </div>

      {/* Info grid */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/5">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary/50">
              <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
            </svg>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-primary/40">Format</p>
            <p className="text-xs font-semibold text-primary">{formatLeagueType(league.league_type)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/5">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary/50">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 7V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v3" />
            </svg>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-primary/40">Cards</p>
            <p className="text-xs font-semibold text-primary">
              {league.scoring_cards_count != null
                ? `Best ${league.scoring_cards_count}${league.total_cards_count ? ` of ${league.total_cards_count}` : ""}`
                : "All count"}
            </p>
          </div>
        </div>

        <div className="col-span-2 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/5">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary/50">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-primary/40">Duration</p>
            <p className="text-xs font-semibold text-primary">
              {league.start_date
                ? `${formatDateShort(league.start_date)} – ${formatDateShort(league.end_date)}`
                : "No season set"}
            </p>
          </div>
        </div>
      </div>

      {/* Players preview */}
      <div className="mt-4 flex flex-col items-center gap-2">
        <div className="flex gap-2">
          {league.members.slice(0, 5).map((m) => (
            <Avatar
              key={m.user_id}
              src={m.profiles?.avatar_url}
              size={28}
              fallback={m.profiles?.username || m.profiles?.first_name || "P"}
            />
          ))}
          {league.memberCount > 5 && (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary/60">
              +{league.memberCount - 5}
            </div>
          )}
        </div>
        <span className="text-xs text-primary/60">
          {league.max_players != null
            ? `${league.memberCount}/${league.max_players} players`
            : `${league.memberCount} player${league.memberCount !== 1 ? "s" : ""}`}
        </span>
      </div>
    </section>
  )
}

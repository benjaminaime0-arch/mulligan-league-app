"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Image from "next/image"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { Avatar } from "@/components/Avatar"
import { RecordsCard, type RecordsData } from "@/components/profile/RecordsCard"
import { CoursesCard, type CoursePlay } from "@/components/profile/CoursesCard"
import { ScoreTrendCard } from "@/components/profile/ScoreTrendCard"

/**
 * Other-player profile page. Mirrors the structure of `/profile` so
 * visiting another user shows the same dashboard (identity card,
 * trajectory, records, courses, leagues). The self-only bits — avatar
 * upload, Edit, WeekCalendarCard (date picker / "My calendar" link),
 * ActivityFeed, logout — are intentionally dropped here.
 */

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

export default function PlayerProfilePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [enrichedLeagues, setEnrichedLeagues] = useState<EnrichedLeague[]>([])
  const [records, setRecords] = useState<RecordsData | null>(null)
  const [courses, setCourses] = useState<CoursePlay[] | null>(null)
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

      // Kick off everything in parallel — profile, memberships, scores
      // count, and the dashboard RPCs (records + courses).
      const [profileRes, membershipsRes, scoresCountRes, recordsRes, coursesRes] =
        await Promise.all([
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
            .from("scores")
            .select("id", { count: "exact", head: true })
            .eq("user_id", id),
          supabase.rpc("get_profile_records", { p_user_id: id }),
          supabase.rpc("get_profile_courses", { p_user_id: id }),
        ])

      if (!profileRes.data) {
        setLoading(false)
        return
      }
      setProfile(profileRes.data as Profile)

      // Build enriched leagues for the carousel
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

      if (!recordsRes.error && recordsRes.data) {
        setRecords(recordsRes.data as RecordsData)
      }
      if (!coursesRes.error && coursesRes.data) {
        setCourses(coursesRes.data as CoursePlay[])
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

        {/* 1. Identity card — mirrors /profile */}
        <section className="rounded-2xl border border-primary/15 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            {profile.avatar_url ? (
              <Image
                src={profile.avatar_url}
                alt={displayName}
                width={48}
                height={48}
                className="h-12 w-12 shrink-0 rounded-full object-cover"
                unoptimized={!profile.avatar_url.includes("supabase.co")}
              />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-semibold text-cream">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <h1 className="min-w-0 flex-1 truncate text-2xl font-bold text-primary">
              {displayName}
            </h1>
          </div>

          {/* Stats row — full-width under the identity row */}
          <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-primary/60">
            <span className="inline-flex items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {profile.town || "No town"}
            </span>
            <span className="text-primary/30">·</span>
            <span>
              HCP <strong className="text-primary/80 tabular-nums">{profile.handicap != null ? profile.handicap : "\u2013"}</strong>
            </span>
            <span className="text-primary/30">·</span>
            <span className="tabular-nums">
              {matchesPlayed} {matchesPlayed === 1 ? "match" : "matches"}
            </span>
            <span className="text-primary/30">·</span>
            <span className="tabular-nums">
              {leagueCount} {leagueCount === 1 ? "league" : "leagues"}
            </span>
          </div>
        </section>

        {/* 2. Score trajectory */}
        <ScoreTrendCard handicap={profile.handicap} userId={profile.id} />

        {/* 3. Records */}
        <RecordsCard records={records} />

        {/* 4. Courses played */}
        <CoursesCard courses={courses} />

        {/* 5. Leagues */}
        <LeagueCarousel leagues={enrichedLeagues} playerName={displayName} />
      </div>
    </main>
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

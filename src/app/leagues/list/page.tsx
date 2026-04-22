"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { Avatar } from "@/components/Avatar"

type LeagueData = {
  id: string | number
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

type MemberProfile = {
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
  members: MemberProfile[]
  memberCount: number
  activePeriod?: PeriodData | null
}

function formatLeagueType(type?: string | null): string {
  if (!type) return "Standard"
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatDate(iso?: string | null): string {
  if (!iso) return "TBD"
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatDateShort(iso?: string | null): string {
  if (!iso) return "TBD"
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

export default function LeagueListPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [leagues, setLeagues] = useState<EnrichedLeague[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)

  useEffect(() => {
    if (authLoading || !user) return

    const init = async () => {
      try {
        setLoading(true)
        setError(null)

        // Get user's leagues with full details
        const { data: memberRows, error: memberError } = await supabase
          .from("league_members")
          .select("*, leagues(*)")
          .eq("user_id", user.id)

        if (memberError) throw memberError

        const leagueMap = new Map<string, LeagueData>()
        for (const m of memberRows || []) {
          const l = m.leagues as LeagueData | null
          if (l && !leagueMap.has(String(l.id))) {
            leagueMap.set(String(l.id), l)
          }
        }

        const leagueList = Array.from(leagueMap.values())
        if (leagueList.length === 0) {
          setLeagues([])
          return
        }

        const leagueIds = leagueList.map((l) => l.id)

        // Fetch members with profiles and periods in parallel
        const [membersResult, periodsResult] = await Promise.all([
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

        // Group members by league
        const membersByLeague: Record<string, MemberProfile[]> = {}
        for (const m of membersResult.data || []) {
          const key = String(m.league_id)
          if (!membersByLeague[key]) membersByLeague[key] = []
          membersByLeague[key].push(m as unknown as MemberProfile)
        }

        // Find active or latest period per league
        const periodByLeague: Record<string, PeriodData> = {}
        for (const p of (periodsResult.data || []) as PeriodData[]) {
          const key = String(p.league_id)
          // Prefer active period, otherwise keep the latest
          if (!periodByLeague[key] || p.status === "active") {
            periodByLeague[key] = p
          }
        }

        // Build enriched leagues
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

        setLeagues(enriched)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load leagues.")
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [authLoading, user])

  const goNext = useCallback(() => {
    setCurrentIndex((i) => (i + 1) % leagues.length)
  }, [leagues.length])

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => (i - 1 + leagues.length) % leagues.length)
  }, [leagues.length])

  // Swipe support
  const [touchStartX, setTouchStartX] = useState<number | null>(null)
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX)
  }
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX === null) return
    const diff = e.changedTouches[0].clientX - touchStartX
    if (Math.abs(diff) > 50) {
      if (diff < 0) goNext()
      else goPrev()
    }
    setTouchStartX(null)
  }

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream">
        <p className="text-primary/70">Checking your session…</p>
      </main>
    )
  }

  if (!user) return null

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream">
        <p className="text-primary/70">Loading leagues…</p>
      </main>
    )
  }

  const league = leagues[currentIndex]

  return (
    <main className="min-h-screen bg-cream px-4 pb-6 pt-4">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-bold text-primary">Your Leagues</h1>
          <p className="mt-1 text-sm text-primary/70">
            {leagues.length === 0
              ? "Join or create a league to get started."
              : `${leagues.length} league${leagues.length !== 1 ? "s" : ""}`}
          </p>
        </header>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {leagues.length === 0 && !error ? (
          <section className="mt-4 rounded-xl border border-dashed border-primary/20 bg-white p-6 text-center shadow-sm">
            <h2 className="text-base font-semibold text-primary">No leagues yet</h2>
            <p className="mt-2 text-sm text-primary/70">
              Start a league for your crew, or ask a buddy for their invite code.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Link
                href="/leagues/create"
                className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream hover:bg-primary/90"
              >
                Create League
              </Link>
              <Link
                href="/leagues/join"
                className="inline-flex items-center justify-center rounded-lg border border-primary/30 bg-cream px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5"
              >
                Join League
              </Link>
            </div>
          </section>
        ) : null}

        {league && (
          <section>
            {/* League card */}
            <div
              className="cursor-pointer rounded-2xl border border-primary/15 bg-white shadow-sm transition-colors hover:bg-cream/30"
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onClick={() => router.push(`/leagues/${league.id}`)}
            >
              {/* League switcher header */}
              <div className="flex items-center justify-between gap-2 px-4 pt-4">
                {leagues.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); goPrev() }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-primary/40 transition-colors hover:bg-primary/5 hover:text-primary active:scale-95"
                    aria-label="Previous league"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                )}
                <div className="min-w-0 flex-1 text-center">
                  <h2 className="text-lg font-bold text-primary">
                    {league.name}
                  </h2>
                  <p className="text-xs uppercase tracking-[0.2em] text-primary/50">
                    {league.course_name || "Course TBA"}
                  </p>
                </div>
                {leagues.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); goNext() }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-primary/40 transition-colors hover:bg-primary/5 hover:text-primary active:scale-95"
                    aria-label="Next league"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Dot indicators */}
              {leagues.length > 1 && (
                <div className="mt-2 flex items-center justify-center gap-1.5">
                  {leagues.map((l, idx) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setCurrentIndex(idx) }}
                      className={`h-1.5 rounded-full transition-all ${
                        idx === currentIndex
                          ? "w-5 bg-primary"
                          : "w-1.5 bg-primary/20 hover:bg-primary/40"
                      }`}
                      aria-label={`View ${l.name}`}
                    />
                  ))}
                </div>
              )}

              {/* Status badge */}
              <div className="mt-3 px-5">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    (league.status || "draft") === "active"
                      ? "bg-emerald-50 text-emerald-700"
                      : (league.status || "draft") === "completed"
                      ? "bg-primary/10 text-primary"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {league.status || "draft"}
                </span>
              </div>

              {/* Info grid */}
              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 px-5">
                  {/* Format */}
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

                  {/* Cards counted */}
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

                  {/* Duration */}
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

              {/* Players preview — each avatar is a button that
                  stops propagation so tapping a member opens their
                  profile instead of the enclosing league card's
                  navigation target. */}
              <div className="flex flex-col items-center gap-2 px-5 py-4">
                <div className="flex gap-2">
                  {league.members.slice(0, 5).map((m) => (
                    <button
                      type="button"
                      key={m.user_id}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        router.push(`/players/${m.user_id}`)
                      }}
                      className="rounded-full transition-opacity hover:opacity-80"
                      aria-label={m.profiles?.username || m.profiles?.first_name || "Player"}
                    >
                      <Avatar
                        src={m.profiles?.avatar_url}
                        size={28}
                        fallback={m.profiles?.username || m.profiles?.first_name || "P"}
                      />
                    </button>
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
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

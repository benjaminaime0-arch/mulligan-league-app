"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { Avatar } from "@/components/Avatar"
import { LoadingSpinner } from "@/components/LoadingSpinner"
import {
  fetchMatchPlayers,
  fetchMatchPlayersWithScores,
  type MatchPlayerInfo,
  type MatchPlayerWithScore,
} from "@/lib/matchPlayers"

type ScheduledMatch = {
  id: string
  match_date: string | null
  match_time: string | null
  course_name: string | null
  league_id: string | null
  leagues?: { name: string } | null
}

type PastMatch = {
  round_date: string
  course_name: string | null
  score: number
  holes: number
  league_name: string | null
  match_id: string
  score_status: string | null
}

type Tab = "scheduled" | "past"

export default function AllMatchesPage() {
  const { user, loading: authLoading } = useAuth()
  const [tab, setTab] = useState<Tab>("scheduled")
  const [scheduled, setScheduled] = useState<ScheduledMatch[]>([])
  const [past, setPast] = useState<PastMatch[]>([])
  const [schedPlayers, setSchedPlayers] = useState<
    Map<string | number, MatchPlayerInfo[]>
  >(new Map())
  const [pastPlayers, setPastPlayers] = useState<
    Map<string | number, MatchPlayerWithScore[]>
  >(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (authLoading || !user) return
    const load = async () => {
      setLoading(true)
      try {
        const userId = user.id
        const todayIso = new Date().toISOString().slice(0, 10)

        const [upcomingRes, pastRes] = await Promise.all([
          supabase
            .from("match_players")
            .select(
              "match_id, matches!inner(id, match_date, match_time, course_name, league_id, status, leagues(name))",
            )
            .eq("user_id", userId)
            .gte("matches.match_date", todayIso)
            .neq("matches.status", "completed"),
          supabase.rpc("get_player_round_history", { p_user_id: userId }),
        ])

        // Scheduled
        type Row = {
          match_id: string
          matches:
            | {
                id: string
                match_date: string | null
                match_time: string | null
                course_name: string | null
                league_id: string | null
                status: string | null
                leagues: { name: string } | null
              }
            | null
        }
        const rows = (upcomingRes.data as unknown as Row[]) || []
        const upcoming: ScheduledMatch[] = rows
          .filter((r) => r.matches != null)
          .map((r) => ({
            id: r.matches!.id,
            match_date: r.matches!.match_date,
            match_time: r.matches!.match_time,
            course_name: r.matches!.course_name,
            league_id: r.matches!.league_id,
            leagues: r.matches!.leagues,
          }))
          .sort((a, b) => (a.match_date || "").localeCompare(b.match_date || ""))
        setScheduled(upcoming)

        if (upcoming.length > 0) {
          const ids = upcoming.map((m) => m.id)
          setSchedPlayers(await fetchMatchPlayers(supabase, ids))
        }

        // Past
        const approved = ((pastRes.data || []) as PastMatch[]).filter(
          (r) => r.score_status === "approved",
        )
        setPast(approved)
        if (approved.length > 0) {
          const ids = approved.map((r) => r.match_id)
          setPastPlayers(await fetchMatchPlayersWithScores(supabase, ids))
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [authLoading, user])

  if (authLoading) return <LoadingSpinner message="Checking your session..." />
  if (!user) return null

  const count = tab === "scheduled" ? scheduled.length : past.length

  return (
    <main className="min-h-screen bg-cream px-4 pb-6 pt-4">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <header className="flex items-center justify-between">
          <Link
            href="/profile"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary/60 hover:text-primary"
          >
            <ChevronLeft />
            Back
          </Link>
          <h1 className="text-sm font-semibold text-primary">My calendar</h1>
          <span className="w-[50px]" />
        </header>

        {/* Tabs — Past on the left (reads left-to-right as history → future),
            but the page lands on Scheduled so users see what's coming up first. */}
        <div className="flex gap-1 rounded-full border border-primary/15 bg-white p-1 shadow-sm">
          <TabButton active={tab === "past"} onClick={() => setTab("past")}>
            Past
            {past.length > 0 && <span className="ml-1.5 tabular-nums text-primary/50">{past.length}</span>}
          </TabButton>
          <TabButton active={tab === "scheduled"} onClick={() => setTab("scheduled")}>
            Scheduled
            {scheduled.length > 0 && <span className="ml-1.5 tabular-nums text-primary/50">{scheduled.length}</span>}
          </TabButton>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
          </div>
        ) : count === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <div className="flex flex-col gap-2">
            {tab === "scheduled"
              ? scheduled.map((m) => (
                  <ScheduledMatchRow
                    key={m.id}
                    match={m}
                    players={schedPlayers.get(m.id) ?? []}
                  />
                ))
              : past.map((m) => (
                  <PastMatchRow
                    key={m.match_id}
                    match={m}
                    players={pastPlayers.get(m.match_id) ?? []}
                  />
                ))}
          </div>
        )}
      </div>
    </main>
  )
}

/* ── Tab pill ─────────────────────────────────────────── */

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-primary text-cream"
          : "text-primary/60 hover:text-primary"
      }`}
      aria-pressed={active}
    >
      {children}
    </button>
  )
}

/* ── Scheduled row ────────────────────────────────────── */

function ScheduledMatchRow({
  match,
  players,
}: {
  match: ScheduledMatch
  players: MatchPlayerInfo[]
}) {
  const router = useRouter()
  const dateLabel = match.match_date
    ? new Date(match.match_date).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : "Date TBA"
  return (
    <Link
      href={`/matches/${match.id}`}
      className="block rounded-xl border border-primary/15 bg-white p-4 shadow-sm transition-colors hover:bg-cream/40"
    >
      <div className="flex items-center justify-between gap-4">
        {/* Left: info text */}
        <div className="min-w-0 flex-1 flex flex-col gap-0.5">
          <p className="text-xs font-medium uppercase tracking-wide text-primary/50">
            {dateLabel}
            {match.match_time ? ` · ${match.match_time.slice(0, 5)}` : ""}
          </p>
          <p className="truncate text-sm font-semibold text-primary">
            {match.course_name || "Course TBA"}
          </p>
          {match.leagues?.name && (
            <p className="truncate text-xs text-primary/60">{match.leagues.name}</p>
          )}
        </div>

        {/* Right: players (avatar + name). Each player is its own
            button so a tap on the avatar/name routes to that player's
            profile; the outer Link still handles taps on the rest of
            the card (date, course, league) → goes to the match. We
            e.preventDefault()+stopPropagation so only one navigation
            fires. Can't nest <Link> in <Link> — browsers choke on it. */}
        {players.length > 0 && (
          <div className="flex shrink-0 gap-3">
            {players.map((p) => (
              <button
                type="button"
                key={p.user_id}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  router.push(`/players/${p.user_id}`)
                }}
                className="flex flex-col items-center gap-1 rounded-md p-0.5 transition-colors hover:bg-cream/40"
              >
                <Avatar src={p.avatar_url} size={32} fallback={p.name} />
                <span className="max-w-[56px] truncate text-[10px] font-medium text-primary/70">
                  {p.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Link>
  )
}

/* ── Past row ─────────────────────────────────────────── */

function PastMatchRow({
  match,
  players,
}: {
  match: PastMatch
  players: MatchPlayerWithScore[]
}) {
  const router = useRouter()
  const dateLabel = new Date(match.round_date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })

  // Sort players by score ascending (lowest = best in golf); no-score last
  const sorted = [...players].sort((a, b) => {
    if (a.score == null && b.score == null) return 0
    if (a.score == null) return 1
    if (b.score == null) return -1
    return a.score - b.score
  })
  const winnerScore =
    sorted.length > 0 && sorted[0].score != null ? sorted[0].score : null

  return (
    <Link
      href={`/matches/${match.match_id}`}
      className="block rounded-xl border border-primary/15 bg-white p-4 shadow-sm transition-colors hover:bg-cream/40"
    >
      <div className="flex items-center justify-between gap-4">
        {/* Left: info text */}
        <div className="min-w-0 flex-1 flex flex-col gap-0.5">
          <p className="text-xs font-medium uppercase tracking-wide text-primary/50">
            {dateLabel}
          </p>
          <p className="truncate text-sm font-semibold text-primary">
            {match.course_name || "Course"}
          </p>
          {match.league_name && (
            <p className="truncate text-xs text-primary/60">{match.league_name}</p>
          )}
        </div>

        {/* Right: players (avatar + name + score). Same pattern as
            ScheduledMatchRow — each player is its own button routing
            to their profile, outer Link preserves card → match nav. */}
        {sorted.length > 0 && (
          <div className="flex shrink-0 gap-3">
            {sorted.map((p) => {
              const isWinner = winnerScore != null && p.score === winnerScore
              return (
                <button
                  type="button"
                  key={p.user_id}
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    router.push(`/players/${p.user_id}`)
                  }}
                  className="flex flex-col items-center gap-1 rounded-md p-0.5 transition-colors hover:bg-cream/40"
                >
                  <Avatar src={p.avatar_url} size={32} fallback={p.name} />
                  <span className="max-w-[56px] truncate text-[10px] font-medium text-primary/70">
                    {p.name}
                  </span>
                  <span
                    className={`text-xs font-bold tabular-nums ${
                      isWinner ? "text-emerald-600" : "text-primary/70"
                    }`}
                  >
                    {p.score ?? "\u2013"}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </Link>
  )
}

/* ── Empty state ─────────────────────────────────────── */

function EmptyState({ tab }: { tab: Tab }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-primary/15 bg-white p-10 text-center">
      <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/5">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-primary/40"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </div>
      <p className="text-sm font-medium text-primary/70">
        {tab === "scheduled" ? "No scheduled matches" : "No completed matches yet"}
      </p>
      <p className="mt-0.5 text-xs text-primary/40">
        {tab === "scheduled"
          ? "Create one from a league to get rolling."
          : "Results will appear here once scores are approved."}
      </p>
    </div>
  )
}

function ChevronLeft() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

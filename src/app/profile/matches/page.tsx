"use client"

/**
 * Cross-game match list. Shows every match the viewer is rostered
 * on — split into Past / Scheduled tabs — rendered with the same
 * `MatchDetailCard` the game page uses.
 *
 * Rendering every row as MatchDetailCard (not a compact summary row)
 * keeps interactions uniform across surfaces: the winner medal row,
 * "YOU" tag, approval state, edit/approve/share/leave/delete actions
 * you get on a game calendar card all work here too. No navigating
 * to `/matches/[id]` just to approve a score or copy the share link.
 *
 * Data model mirrors `loadCalendar` on /profile/page.tsx — a single
 * `match_players!inner` fan-out to pull the viewer's matches with
 * embedded game data, then batch rosters + scores for those
 * matches. No date window here: the whole history is in scope so the
 * tabs can split it locally.
 */

import { Suspense, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { useT } from "@/lib/i18n"
import { LoadingSpinner } from "@/components/LoadingSpinner"
import { MatchDetailCard } from "@/components/match/MatchDetailCard"
import type {
  Game as SharedGame,
  Match as SharedMatch,
  MatchPlayer as SharedMatchPlayer,
} from "@/components/match/types"

type Tab = "scheduled" | "past"

// Local-date `yyyy-mm-dd` — match_date is a calendar string, so we
// compare against the viewer's local today (not UTC) to classify
// past vs scheduled correctly across timezones.
function todayIsoLocal(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export default function AllMatchesPage() {
  const t = useT()
  // useSearchParams forces dynamic rendering and must be inside a
  // Suspense boundary per Next 14 — otherwise the page opts out of
  // static rendering silently. Wrapping an inner component keeps the
  // boundary explicit without affecting behavior on the client.
  return (
    <Suspense fallback={<LoadingSpinner message={t("match.loading.list")} />}>
      <AllMatchesInner />
    </Suspense>
  )
}

function AllMatchesInner() {
  const t = useT()
  const { user, loading: authLoading } = useAuth()
  const searchParams = useSearchParams()
  // When present, scopes the list to a single game — the "Game
  // calendar" link on the game page passes this. Absent → cross-
  // game "My calendar" mode (from /profile).
  const scopedGameId = searchParams.get("game")
  // `?match=X&card=1` deep link: auto-open the hole-by-hole scorecard
  // for that match once it renders. Set by the practice-round CTA on
  // /courses/[slug] (create_practice_match → straight into the card).
  // Consumed once so closing the editor doesn't reopen it.
  const [autoCardMatchId, setAutoCardMatchId] = useState<string | null>(
    () =>
      searchParams.get("card") === "1" ? searchParams.get("match") : null,
  )
  const [tab, setTab] = useState<Tab>("scheduled")
  const [matches, setMatches] = useState<SharedMatch[]>([])
  const [gamesById, setGamesById] = useState<
    Map<string, SharedGame>
  >(new Map())
  const [playersByMatch, setPlayersByMatch] = useState<
    Map<string | number, SharedMatchPlayer[]>
  >(new Map())
  const [loading, setLoading] = useState(true)

  /**
   * Pulls every match the viewer is rostered on plus full rosters +
   * scores. When `gameId` is set the fetch is scoped to that
   * game; otherwise the full cross-game list is returned.
   * Exposed as `onRefresh` so any MatchDetailCard mutation (score
   * edit, approval, leave, delete) re-pulls fresh data in place
   * without navigating.
   */
  const load = useCallback(async (userId: string, gameId: string | null) => {
    type GameEmbed = {
      id: string
      name: string
      course_name?: string | null
      status?: string | null
      max_players?: number | null
      scoring_cards_count?: number | null
      total_cards_count?: number | null
      invite_code?: string | null
      admin_id?: string | null
      start_date?: string | null
      end_date?: string | null
      format?: string | null
      is_practice?: boolean | null
    }
    type MineRow = {
      match_id: string
      matches:
        | {
            id: string
            course_name: string | null
            match_date: string | null
            match_time: string | null
            status: string | null
            game_id: string | null
            created_by: string | null
            games: GameEmbed | null
          }
        | null
    }

    let mineQ = supabase
      .from("match_players")
      .select(
        "match_id, matches!inner(id, course_name, match_date, match_time, status, game_id, created_by, games(id, name, course_name, status, max_players, scoring_cards_count, total_cards_count, invite_code, admin_id, start_date, end_date, format, is_practice))",
      )
      .eq("user_id", userId)
    if (gameId) {
      // Filter on the embedded `matches.game_id` so we only get
      // the viewer's match_players rows that belong to the scoped
      // game. Supabase supports dotted paths on `!inner` joins.
      mineQ = mineQ.eq("matches.game_id", gameId)
    }
    const mineRes = await mineQ

    const mineRows = ((mineRes.data as unknown) as MineRow[]) || []
    const uniqueMatches: SharedMatch[] = []
    const lMap = new Map<string, SharedGame>()
    const seen = new Set<string>()

    for (const row of mineRows) {
      const m = row.matches
      if (!m || seen.has(m.id)) continue
      seen.add(m.id)
      uniqueMatches.push({
        id: m.id,
        game_id: m.game_id ?? "",
        course_name: m.course_name,
        match_date: m.match_date,
        match_time: m.match_time,
        status: m.status,
        created_by: m.created_by,
      })
      if (m.games && !lMap.has(String(m.games.id))) {
        lMap.set(String(m.games.id), m.games as SharedGame)
      }
    }

    setMatches(uniqueMatches)
    setGamesById(lMap)

    if (uniqueMatches.length === 0) {
      setPlayersByMatch(new Map())
      return
    }

    const matchIds = uniqueMatches.map((m) => m.id)
    const [rostersRes, scoresRes] = await Promise.all([
      supabase
        .from("match_players")
        .select(
          "match_id, user_id, approved_at, profiles(username, first_name, avatar_url)",
        )
        .in("match_id", matchIds),
      supabase
        .from("scores")
        .select("match_id, user_id, score, holes, status")
        .in("match_id", matchIds),
    ])

    type ScoreRow = {
      match_id: string
      user_id: string
      score: number
      holes: number | null
      status: string
    }
    type RosterRow = {
      match_id: string
      user_id: string
      approved_at: string | null
      profiles: {
        username?: string | null
        first_name?: string | null
        avatar_url?: string | null
      } | null
    }

    const scoreLookup = new Map<
      string,
      { score: number; holes: number | null; status: string }
    >()
    for (const s of (scoresRes.data || []) as ScoreRow[]) {
      scoreLookup.set(`${s.match_id}:${s.user_id}`, {
        score: s.score,
        holes: s.holes,
        status: s.status,
      })
    }

    const map = new Map<string | number, SharedMatchPlayer[]>()
    for (const r of (rostersRes.data || []) as RosterRow[]) {
      const key = `${r.match_id}:${r.user_id}`
      const entry = scoreLookup.get(key)
      const arr = map.get(r.match_id) || []
      arr.push({
        name:
          r.profiles?.username ||
          r.profiles?.first_name ||
          t("players.unnamed"),
        avatar_url: r.profiles?.avatar_url ?? null,
        user_id: r.user_id,
        score: entry?.score ?? null,
        holes: entry?.holes ?? null,
        status: entry?.status ?? null,
        approved_at: r.approved_at,
      })
      map.set(r.match_id, arr)
    }
    setPlayersByMatch(map)
  }, [t])

  useEffect(() => {
    if (authLoading || !user) return
    let cancelled = false
    const run = async () => {
      setLoading(true)
      try {
        await load(user.id, scopedGameId)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [authLoading, user, load, scopedGameId])

  // Realtime: pick up approvals + new matches + deletions from other
  // devices / teammates without a manual reload. Debounced 400ms so a
  // burst of score-approval events collapses into one refetch.
  useEffect(() => {
    if (!user) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const bump = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        load(user.id, scopedGameId)
      }, 400)
    }

    const channel = supabase
      .channel(`profile-matches-${user.id}-live`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scores" },
        (payload) => {
          const matchId =
            (payload.new as { match_id?: string })?.match_id ??
            (payload.old as { match_id?: string })?.match_id
          if (!matchId) return bump()
          if (playersByMatch.has(matchId)) bump()
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches" },
        (payload) => {
          // Scoped mode: only bump if the event's game matches our
          // filter. Unscoped mode: gate on whether we already know
          // the game (viewer is a member).
          const gameId =
            (payload.new as { game_id?: string })?.game_id ??
            (payload.old as { game_id?: string })?.game_id
          if (!gameId) return
          if (scopedGameId && String(gameId) !== scopedGameId) return
          if (gamesById.has(String(gameId))) bump()
        },
      )
      .subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
    // Maps used in closures only for gating — intentionally omitted
    // from deps to avoid resubscribe churn. Fresh matches still get
    // picked up on the next load() cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, scopedGameId, load])

  if (authLoading)
    return <LoadingSpinner message={t("common.session.checking")} />
  if (!user) return null

  // Classify every match as past or scheduled. A match is "past" when
  // the server has marked it completed OR its calendar date is before
  // today — both checks matter because status is eventually consistent
  // (a match can be "active" with a date in the past until the last
  // approval lands and the trigger flips status → completed). Cancelled
  // matches are surfaced separately (below) — they shouldn't clutter
  // the Past tab as if they were played.
  const today = todayIsoLocal()
  const isPast = (m: SharedMatch): boolean =>
    m.status === "completed" ||
    (m.match_date != null && m.match_date < today)

  const visible = matches.filter((m) => m.status !== "cancelled")
  const scheduled = visible
    .filter((m) => !isPast(m))
    .sort((a, b) => (a.match_date || "").localeCompare(b.match_date || ""))
  const past = visible
    .filter((m) => isPast(m))
    .sort((a, b) => (b.match_date || "").localeCompare(a.match_date || ""))

  const list = tab === "scheduled" ? scheduled : past

  // When scoped to a game, Back jumps to that game's page and
  // the title relabels to the game's name (falling back to
  // "Game calendar" until the fetch lands). Cross-game default
  // stays on /profile with "My calendar".
  const backHref = scopedGameId ? `/games/${scopedGameId}` : "/profile"
  const scopedGame = scopedGameId
    ? gamesById.get(scopedGameId) ?? null
    : null
  const pageTitle = scopedGameId
    ? scopedGame?.name || t("match.calendar.game")
    : t("nav.menu.calendar")

  // Scoped mode, load completed, but the game didn't land in
  // `gamesById` — viewer isn't a member (RLS blocked the join) or
  // the game id is bogus. Either way the "no matches" empty state
  // would be misleading, so we surface an explicit access notice
  // with a path back to their own calendar.
  const scopedAccessDenied =
    !loading && scopedGameId != null && scopedGame == null

  return (
    <main className="min-h-screen px-4 pb-6 pt-4">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <header className="flex items-center justify-between">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary/60 hover:text-primary"
          >
            <ChevronLeft />
            {t("common.back")}
          </Link>
          <h1 className="text-sm font-semibold text-primary">{pageTitle}</h1>
          <span className="w-[50px]" />
        </header>

        {scopedAccessDenied && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-primary/15 bg-white p-10 text-center">
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/5">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary/40" aria-hidden="true">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <p className="text-sm font-medium text-primary/70">
              {t("match.calendar.denied.title")}
            </p>
            <p className="mb-3 mt-0.5 text-xs text-primary/40">
              {t("match.calendar.denied.body")}
            </p>
            <Link
              href="/profile/matches"
              className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-cream hover:bg-primary/90"
            >
              {t("match.calendar.mine")}
            </Link>
          </div>
        )}

        {/* Tabs + list hidden while access-denied — rendering an empty
            "No scheduled matches" state alongside a denial notice
            would be misleading. */}
        {!scopedAccessDenied && (
          <>
        <div className="flex gap-1 rounded-full border border-primary/15 bg-white p-1 shadow-sm">
          <TabButton active={tab === "past"} onClick={() => setTab("past")}>
            {t("match.tab.past")}
            {past.length > 0 && (
              <span className="ml-1.5 tabular-nums text-primary/50">
                {past.length}
              </span>
            )}
          </TabButton>
          <TabButton
            active={tab === "scheduled"}
            onClick={() => setTab("scheduled")}
          >
            {t("match.tab.scheduled")}
            {scheduled.length > 0 && (
              <span className="ml-1.5 tabular-nums text-primary/50">
                {scheduled.length}
              </span>
            )}
          </TabButton>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <div className="flex flex-col gap-3">
            {list.map((m) => {
              const game = gamesById.get(String(m.game_id)) ?? null
              if (!game) return null
              return (
                <MatchDetailCard
                  key={m.id}
                  match={m}
                  game={game}
                  matchPlayers={playersByMatch.get(m.id)}
                  currentUserId={user.id}
                  variant={tab === "scheduled" ? "scheduled" : "past"}
                  onRefresh={() => load(user.id, scopedGameId)}
                  autoCard={autoCardMatchId === String(m.id)}
                  onAutoCardConsumed={() => setAutoCardMatchId(null)}
                  context={scopedGameId ? "game" : "profile"}
                />
              )
            })}
          </div>
        )}
          </>
        )}
      </div>
    </main>
  )
}

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

function EmptyState({ tab }: { tab: Tab }) {
  const t = useT()
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
        {tab === "scheduled"
          ? t("match.empty.scheduled.title")
          : t("match.empty.past.title")}
      </p>
      <p className="mt-0.5 text-xs text-primary/40">
        {tab === "scheduled"
          ? t("match.empty.scheduled.body")
          : t("match.empty.past.body")}
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

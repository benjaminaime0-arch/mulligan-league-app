"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { ConfirmModal } from "@/components/ConfirmModal"
import type {
  Game,
  UserGame,
  MemberWithProfile,
  GamePeriod,
  Match,
  LeaderboardRow,
  MatchPlayer,
} from "./types"
import { LeaderboardTable } from "./components/LeaderboardTable"
import { MatchCalendarSection } from "@/components/match/MatchCalendarSection"
import { GameInviteCode } from "./components/GameInviteCode"
import { DraftGuide } from "./components/DraftGuide"
import { GameActivityCard } from "./components/GameActivityCard"
import { BadgesCard, type BadgeRow } from "./components/BadgesCard"
import {
  formatCopy,
  isBetter,
  resolveFormat,
} from "@/lib/gameFormat"
import { todayLocalIso } from "@/lib/date"

interface GamePageProps {
  params: { id: string }
}

/**
 * Builds the "Stroke play · Best 3 of 5 cards" tagline shown below
 * the game name on the detail page. Returns null when there's
 * nothing meaningful to show.
 *
 * Format is surfaced explicitly — "Stroke play" or "Stableford" —
 * so viewers of a Stableford game know at a glance that scores
 * higher=better without having to dig into the leaderboard rules.
 * Falls back to `game_type` when `format` is missing (legacy
 * rows), and omits the format segment entirely when neither is set.
 */
function formatSubtitle(game: {
  game_type?: string | null
  scoring_cards_count?: number | null
  total_cards_count?: number | null
  format?: string | null
}): string | null {
  const parts: string[] = []
  const fmt = game.format || game.game_type
  if (fmt) {
    parts.push(
      fmt
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase()),
    )
  }
  if (game.scoring_cards_count != null) {
    parts.push(
      `Best ${game.scoring_cards_count}${
        game.total_cards_count ? ` of ${game.total_cards_count}` : ""
      } cards`,
    )
  }
  return parts.length > 0 ? parts.join(" · ") : null
}

function StatusChip({ status }: { status: string | null | undefined }) {
  const s = (status || "").toLowerCase()

  // Active and completed are both hidden here — active is the
  // default (no signal worth a chip) and completed is already
  // announced by the emerald "Completed" progress bar below the
  // header. Only surface the chip for Draft (and any other
  // non-standard state), where the user genuinely needs the
  // heads-up that the game isn't live yet.
  if (s === "active" || s === "completed") return null

  // Draft / any other non-active non-completed state
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
      Draft
    </span>
  )
}

export default function GamePage({ params }: GamePageProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const gameId = params.id
  const { user, loading: authLoading } = useAuth()

  // Reads once on mount — subsequent changes are not re-applied so
  // the user's tab taps aren't fought. The retired /matches/[id]
  // redirect forwards here with ?match=X; optional ?edit=1 asks us
  // to auto-open the score editor for that match.
  const [focusMatchId, setFocusMatchId] = useState<string | null>(() =>
    searchParams?.get("match") ?? null,
  )
  const [autoEdit, setAutoEdit] = useState<boolean>(
    () => searchParams?.get("edit") === "1",
  )

  // Strip `match` and `edit` from the URL after the child reports
  // they've been consumed so a manual refresh doesn't re-open the
  // editor mid-session. Leaves the rest of any query intact.
  const handleFocusConsumed = useCallback(() => {
    const remaining = new URLSearchParams(searchParams?.toString() ?? "")
    remaining.delete("match")
    remaining.delete("edit")
    const qs = remaining.toString()
    router.replace(`/games/${gameId}${qs ? `?${qs}` : ""}`, {
      scroll: false,
    })
    setFocusMatchId(null)
    setAutoEdit(false)
  }, [gameId, router, searchParams])

  const [game, setGame] = useState<Game | null>(null)
  const [members, setMembers] = useState<MemberWithProfile[]>([])
  const [currentPeriod, setCurrentPeriod] = useState<GamePeriod | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([])
  // Honors / badges list. 0–3 rows depending on how much has been
  // played in the game. Computed on read by `get_game_badges` —
  // never persisted.
  const [badges, setBadges] = useState<BadgeRow[]>([])

  const [periodMatches, setPeriodMatches] = useState<Match[]>([])
  const [matchPlayersMap, setMatchPlayersMap] = useState<Map<string | number, MatchPlayer[]>>(new Map())
  // Set of match ids where the current user has ANY score row (pending
  // / approved / rejected). Separate from matchPlayersMap because the
  // latter only carries approved scores (those feed the leaderboard).
  // The next-step banner uses this to avoid nagging "Submit your score"
  // on a match the user has already submitted but which is still
  // awaiting approvals.
  const [mySubmittedMatchIds, setMySubmittedMatchIds] = useState<Set<string>>(new Set())

  const [userGames, setUserGames] = useState<UserGame[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [startingGame, setStartingGame] = useState(false)
  const [showStartConfirm, setShowStartConfirm] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletingGame, setDeletingGame] = useState(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [leavingGame, setLeavingGame] = useState(false)

  // Join request state
  const [requestingJoin, setRequestingJoin] = useState(false)
  const [joinRequestSent, setJoinRequestSent] = useState(false)
  const [joinRequestError, setJoinRequestError] = useState<string | null>(null)

  // Extracted as a useCallback so the inline match card can trigger a
  // re-fetch after mutations (save scores, approve, leave, delete,
  // etc.). `loadData` is the single source of truth for "pull fresh
  // game + matches + players data" — the useEffect below just runs
  // it once on mount.
  // Monotonic token so overlapping loadData runs (mount + realtime bumps +
  // post-mutation refreshes) can't stomp each other: a run only applies its
  // results while it is still the latest (AUD#15).
  const loadSeqRef = useRef(0)

  const loadData = useCallback(async () => {
    if (!user) return
    const myToken = ++loadSeqRef.current
    const fresh = () => myToken === loadSeqRef.current
    const init = async () => {
      try {
        // Only the first load blanks the page; refetches update in place
        // (the render gate is `loading && !game`), so realtime bumps and
        // saving a score no longer flash the full-screen spinner (AUD#13).
        setLoading(true)
        setError(null)

        const [
          gameRes,
          membersRes,
          periodRes,
          leaderboardRes,
          userGamesRes,
          badgesRes,
        ] = await Promise.all([
          supabase.from("games").select("*").eq("id", gameId).single(),
          // profiles columns listed explicitly: email is not client-readable
          // since T0.3 (column-level grant), so an embedded * would 42501.
          supabase
            .from("game_members")
            .select(
              "*, profiles(id, first_name, last_name, club, handicap, avatar_url, town, username)",
            )
            .eq("game_id", gameId),
          supabase
            .from("game_periods")
            .select("*")
            .eq("game_id", gameId)
            .eq("status", "active")
            .maybeSingle(),
          supabase.rpc("get_leaderboard", { p_game_id: gameId }),
          supabase
            .from("game_members")
            .select("game_id, games(id, name)")
            .eq("user_id", user.id),
          supabase.rpc("get_game_badges", { p_game_id: gameId }),
        ])

        if (gameRes.error) throw gameRes.error
        if (!gameRes.data) throw new Error("Game not found.")

        // A newer run superseded this one while awaiting — drop its results.
        if (!fresh()) return

        setGame(gameRes.data as Game)

        if (membersRes.error) throw membersRes.error
        setMembers((membersRes.data || []) as MemberWithProfile[])

        // Check for existing pending join request
        const { data: existingRequest } = await supabase
          .from("join_requests")
          .select("id")
          .eq("requester_id", user.id)
          .eq("target_type", "game")
          .eq("target_id", gameId)
          .eq("status", "pending")
          .maybeSingle()
        if (!fresh()) return
        if (existingRequest) setJoinRequestSent(true)

        // Build user game list for navigation
        if (!userGamesRes.error && userGamesRes.data) {
          type UserGameRow = { game_id: string; games: { id: string; name: string } | { id: string; name: string }[] | null }
          const gameList: UserGame[] = []
          for (const r of userGamesRes.data as unknown as UserGameRow[]) {
            if (!r.games) continue
            const lg = Array.isArray(r.games) ? r.games[0] : r.games
            if (lg) gameList.push({ id: lg.id, name: lg.name })
          }
          setUserGames(gameList)
        }

        if (periodRes.error && periodRes.error.code !== "PGRST116") {
          throw periodRes.error
        }
        const active = (periodRes.data as GamePeriod | null) ?? null
        setCurrentPeriod(active)

        // Calendar shows ALL matches in this game, not just the
        // active period's. Previously we scoped to `period_id` which
        // hid older/newer matches from the day strip — users couldn't
        // see anything past the current week. Filtering by game_id
        // gives the day strip full game history + future matches;
        // the date picker can now jump to anything in the game.
        {
          const { data: matchesData, error: matchesError } = await supabase
            .from("matches")
            .select("*")
            .eq("game_id", gameId)
            .order("match_date", { ascending: true })

          if (matchesError) throw matchesError
          if (!fresh()) return

          const matches = (matchesData || []) as Match[]
          setPeriodMatches(matches)

          if (matches.length > 0) {
            const matchIds = matches.map((m) => m.id)
            const [mpRes, scoresRes, mySubmissionsRes] = await Promise.all([
              supabase
                .from("match_players")
                .select(
                  "match_id, user_id, approved_at, profiles(username, first_name, avatar_url)",
                )
                .in("match_id", matchIds),
              // All scores (any status) for period matches. We used to
              // filter to `approved` here, but the inline match cards
              // now surface per-player status pills (Pending /
              // Approved / Rejected / No score), so we need the full
              // set. The best-N leaderboard calc further below still
              // only consumes approved rows. Also select `holes` so
              // the inline editor can prefill the 9/18 toggle.
              supabase
                .from("scores")
                .select("match_id, user_id, score, holes, status")
                .in("match_id", matchIds),
              // My own submissions at ANY status — powers the banner's
              // "already submitted, don't nag" check.
              supabase
                .from("scores")
                .select("match_id")
                .in("match_id", matchIds)
                .eq("user_id", user.id),
            ])

            if (mySubmissionsRes.data) {
              setMySubmittedMatchIds(
                new Set(
                  (mySubmissionsRes.data as Array<{ match_id: string }>).map(
                    (r) => String(r.match_id),
                  ),
                ),
              )
            }

            // Build a score lookup: match_id+user_id → { score, holes, status }
            // (status drives the per-player pill on the inline card;
            // holes is needed so the inline editor can prefill 9/18).
            const scoreLookup = new Map<
              string,
              { score: number; holes: number | null; status: string }
            >()
            // Collect ONLY approved scores per user for best-N
            // calculation — best-N only ever counts approved cards,
            // otherwise pending submissions would wrongly steal slots.
            const userApprovedScores = new Map<string, Array<{ matchId: string | number; score: number }>>()

            if (scoresRes.data) {
              for (const s of scoresRes.data as Array<{
                match_id: string | number
                user_id: string
                score: number
                holes: number | null
                status: string
              }>) {
                scoreLookup.set(`${s.match_id}:${s.user_id}`, {
                  score: s.score,
                  holes: s.holes,
                  status: s.status,
                })
                if (s.status === "approved") {
                  const arr = userApprovedScores.get(s.user_id) || []
                  arr.push({ matchId: s.match_id, score: s.score })
                  userApprovedScores.set(s.user_id, arr)
                }
              }
            }

            // Determine which match scores are "best N" per player
            const bestMatchIds = new Set<string>() // "matchId:userId" keys
            const scoringCards = gameRes.data.scoring_cards_count as number | null
            for (const [userId, entries] of Array.from(userApprovedScores)) {
              const sorted = [...entries].sort((a, b) => a.score - b.score)
              const counted = scoringCards ? sorted.slice(0, scoringCards) : sorted
              for (const e of counted) {
                bestMatchIds.add(`${e.matchId}:${userId}`)
              }
            }

            if (mpRes.data) {
              const map = new Map<string | number, MatchPlayer[]>()
              for (const row of mpRes.data as Array<{
                match_id: string | number
                user_id: string
                approved_at: string | null
                profiles: { username?: string | null; first_name?: string | null; avatar_url?: string | null } | null
              }>) {
                const existing = map.get(row.match_id) || []
                const key = `${row.match_id}:${row.user_id}`
                const entry = scoreLookup.get(key)
                existing.push({
                  name: row.profiles?.username || row.profiles?.first_name || "Player",
                  avatar_url: row.profiles?.avatar_url ?? null,
                  user_id: row.user_id,
                  // Score is shown for any status (so "pending 90" is
                  // visible); isBestScore only flips for approved rows.
                  score: entry?.score ?? null,
                  holes: entry?.holes ?? null,
                  status: entry?.status ?? null,
                  approved_at: row.approved_at,
                  isBestScore:
                    entry?.status === "approved" && bestMatchIds.has(key)
                      ? true
                      : undefined,
                })
                map.set(row.match_id, existing)
              }
              setMatchPlayersMap(map)
            }
          }
        }

        if (leaderboardRes.error) throw leaderboardRes.error
        setLeaderboard((leaderboardRes.data || []) as LeaderboardRow[])

        // Badges are non-critical — if the RPC errors for any reason
        // (e.g. migration not yet applied, transient DB hiccup) we
        // fall back to an empty list rather than failing the whole
        // page. The badges section renders its own empty state.
        if (badgesRes.error) {
          console.warn("get_game_badges failed", badgesRes.error)
          setBadges([])
        } else {
          setBadges((badgesRes.data || []) as BadgeRow[])
        }
      } catch (err) {
        // Supabase PostgrestErrors aren't Error instances — they're
        // plain `{ message, code, details, hint }` objects. A bare
        // `instanceof Error` check misses them and we'd render the
        // generic fallback, hiding the real failure. Dig out the
        // message however we can and log the full payload for DevTools.
        console.error("[GamePage] init failed", err)
        if (!fresh()) return
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === "object" &&
                err !== null &&
                "message" in err &&
                typeof (err as { message?: unknown }).message === "string"
              ? (err as { message: string }).message
              : "Failed to load game."
        setError(msg)
      } finally {
        // Only the latest run owns the loading flag.
        if (fresh()) setLoading(false)
      }
    }

    await init()
  }, [gameId, user])

  useEffect(() => {
    if (authLoading || !user) return
    loadData()
  }, [authLoading, user, loadData])

  // Game-wide "best moment" pointers for the match cards. Scans
  // every match's player list once to find the *best* approved score
  // (lowest in stroke play, highest in stableford). The owning match
  // card then lights up a flame chip on the exact row that holds it.
  // Computed here (not per-card) so each card doesn't re-scan the
  // full game set on every render.
  //
  // Tiebreak: earliest match_date, then user_id asc, so the chip
  // awards the *first* player to hit the mark when two scores tie.
  //
  // The result's field name stays `lowestRound` for backward
  // compatibility with the prop wiring — semantically it's now "best
  // round" regardless of format, but renaming ripples through a
  // handful of type bounds and doesn't earn its keep.
  const gameHighlights = useMemo(() => {
    type Best = { matchId: string; userId: string; score: number; date: string }
    let best: Best | null = null
    const fmt = resolveFormat(game)
    const matchById = new Map(periodMatches.map((m) => [m.id, m]))
    for (const [matchId, players] of Array.from(matchPlayersMap.entries())) {
      const match = matchById.get(matchId)
      const date = match?.match_date ?? "9999-99-99"
      for (const p of players) {
        if (!p.user_id || p.score == null) continue
        if (p.approved_at == null) continue // approved only
        const cand: Best = {
          matchId: String(matchId),
          userId: p.user_id,
          score: p.score,
          date,
        }
        // `isBetter` flips direction per format. When scores tie we
        // fall through to the date/user_id tiebreak (same as before).
        const strictlyBetter = best
          ? isBetter(cand.score, best.score, fmt)
          : true
        if (
          !best ||
          strictlyBetter ||
          (cand.score === best.score && cand.date < best.date) ||
          (cand.score === best.score &&
            cand.date === best.date &&
            cand.userId < best.userId)
        ) {
          best = cand
        }
      }
    }
    return {
      lowestRound: best
        ? {
            matchId: best.matchId,
            userId: best.userId,
            score: best.score,
          }
        : null,
    }
  }, [periodMatches, matchPlayersMap, game])

  // Live leaderboard: subscribe to score + match_player changes so
  // approvals landing in other tabs / other players' devices refresh
  // this page without a manual reload. Scoped as tightly as RLS
  // allows: postgres_changes has no server-side `WHERE match.game_id
  // = X` filter on the scores table (scores only carries match_id),
  // so we subscribe broadly and filter in JS by cross-referencing
  // `matchPlayersMap`, which is already this game's matches.
  //
  // Debounced through a 400ms timer so a burst of approvals (the
  // approve_match_scores RPC flips multiple rows in one call) only
  // triggers a single refetch.
  useEffect(() => {
    if (!user || !gameId) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const bump = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        loadData()
      }, 400)
    }

    const channel = supabase
      .channel(`game-${gameId}-live`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scores" },
        (payload) => {
          // Only refetch when the score belongs to a match we know
          // about in this game. Prevents cross-game noise. When the
          // payload carries no match_id (typical for DELETE events,
          // whose `old` only holds replica-identity columns) we cannot
          // tell which game it belongs to — so we do NOT refetch, rather
          // than blindly bumping on every unrelated game's deletes
          // (AUD#14; the previous `return bump()` did the opposite of
          // what the comment above promised).
          const matchId =
            (payload.new as { match_id?: string })?.match_id ??
            (payload.old as { match_id?: string })?.match_id
          if (!matchId) return
          if (matchPlayersMap.has(matchId)) bump()
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter: `game_id=eq.${gameId}` },
        () => bump(),
      )
      .subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
    // matchPlayersMap is read inside but we intentionally omit it
    // from deps — resubscribing on every map change would churn the
    // realtime connection. The snapshot closure is fine; new matches
    // will be picked up on the next loadData cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, gameId, loadData])

  const isAdmin = game && user && game.admin_id === user.id
  const isMember = user && members.some((m) => {
    const profile = m.profiles as { id?: string } | null
    return profile?.id === user.id
  })
  const isGameFull = game && game.max_players ? members.length >= game.max_players : false

  const handleRequestJoinGame = async () => {
    if (!game || !user) return
    setRequestingJoin(true)
    setJoinRequestError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc("request_join_game", {
        p_game_id: game.id,
      })
      if (rpcError) throw rpcError
      const result = data as { success: boolean; error?: string }
      if (!result.success) {
        setJoinRequestError(result.error || "Failed to send request.")
        return
      }
      setJoinRequestSent(true)
    } catch (err) {
      setJoinRequestError(err instanceof Error ? err.message : "Failed to send request.")
    } finally {
      setRequestingJoin(false)
    }
  }

  // Game navigation
  const currentGameIndex = userGames.findIndex((l) => String(l.id) === String(gameId))
  const prevGame = currentGameIndex > 0 ? userGames[currentGameIndex - 1] : null
  const nextGame = currentGameIndex >= 0 && currentGameIndex < userGames.length - 1 ? userGames[currentGameIndex + 1] : null

  const handleStartGame = async () => {
    if (!game) return
    setShowStartConfirm(false)
    setStartingGame(true)
    setError(null)
    try {
      const { error: rpcError } = await supabase.rpc("generate_game_periods", {
        p_game_id: game.id,
      })
      if (rpcError) throw rpcError
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start game.")
    } finally {
      setStartingGame(false)
    }
  }

  const handleDeleteGame = async () => {
    if (!game) return
    setShowDeleteConfirm(false)
    setDeletingGame(true)
    setError(null)
    try {
      const { error: deleteError } = await supabase
        .from("games")
        .delete()
        .eq("id", game.id)
      if (deleteError) throw deleteError
      router.push("/games")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete game.")
    } finally {
      setDeletingGame(false)
    }
  }

  const handleLeaveGame = async () => {
    if (!game || !user) return
    setShowLeaveConfirm(false)
    setLeavingGame(true)
    setError(null)
    try {
      const { error: leaveError } = await supabase
        .from("game_members")
        .delete()
        .eq("game_id", game.id)
        .eq("user_id", user.id)
      if (leaveError) throw leaveError
      router.push("/games")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to leave game.")
    } finally {
      setLeavingGame(false)
    }
  }

  // --- Rendering ---

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-primary/70">Checking your session…</p>
      </main>
    )
  }

  if (!user) return null

  // Full-screen spinner only on the very first load. Once `game` is set,
  // realtime bumps and post-mutation refetches update in place without
  // blanking the page and destroying child state (AUD#13).
  if (loading && !game) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-primary/70">Loading game…</p>
      </main>
    )
  }

  if (error || !game) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-red-700">
            {error || "We couldn\u2019t find this game."}
          </p>
          <button
            type="button"
            onClick={() => router.push("/games")}
            className="mt-4 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream"
          >
            Back to games
          </button>
        </div>
      </main>
    )
  }

  const isDraft = game.status !== "active" && game.status !== "completed"

  return (
    <main className="min-h-screen px-4 pb-6 pt-4">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        {/* Header */}
        <header>
          {/* Title row: prev chevron · title + status chip · next chevron
              The chevrons flank the title so they don't collide with the
              fixed notification bell at top-right on mobile. */}
          <div className="flex items-center justify-center gap-2">
            {prevGame ? (
              <button
                type="button"
                onClick={() => router.push(`/games/${prevGame.id}`)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-white text-primary hover:bg-primary/5"
                aria-label={`Previous: ${prevGame.name}`}
                title={prevGame.name}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
              </button>
            ) : userGames.length > 1 ? (
              <div className="h-8 w-8 shrink-0" />
            ) : null}

            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-2xl font-bold text-primary sm:text-3xl">
                {game.name}
              </h1>
              <StatusChip status={game.status} />
            </div>

            {nextGame ? (
              <button
                type="button"
                onClick={() => router.push(`/games/${nextGame.id}`)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-white text-primary hover:bg-primary/5"
                aria-label={`Next: ${nextGame.name}`}
                title={nextGame.name}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 6 15 12 9 18" /></svg>
              </button>
            ) : userGames.length > 1 ? (
              <div className="h-8 w-8 shrink-0" />
            ) : null}
          </div>

          {/* Format line: sits right under the title — e.g. "Stroke Play · Best 3 of 5 cards" */}
          {formatSubtitle(game) && (
            <p className="mt-1 text-center text-[10px] font-semibold uppercase tracking-[0.15em] text-primary/50">
              {formatSubtitle(game)}
            </p>
          )}

          {/* Meta line: course + dates */}
          <div className="mt-1.5 flex items-center justify-center gap-1.5 text-xs text-primary/70">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
            <span>{game.course_name || "Course TBA"}</span>
            {game.start_date && game.end_date && (
              <>
                <span className="text-primary/30">·</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                <span>
                  {new Date(game.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {new Date(game.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </>
            )}
          </div>

          {/* Period progress bar — active games show days-in /
              days-left ticking; completed games (all members hit
              cap with approved scores) show a filled emerald bar
              labelled "Completed" so the header stops pretending the
              season is still running. */}
          {game.status === "active" && (
            <PeriodProgress
              startDate={game.start_date}
              endDate={game.end_date}
            />
          )}
          {game.status === "completed" && <PeriodCompleted />}
        </header>

        {/* Draft guide for admins */}
        {isDraft && isAdmin && <DraftGuide />}

        {isDraft && (
          <>
            <div className="flex justify-start">
              <button
                type="button"
                onClick={() => setShowStartConfirm(true)}
                disabled={startingGame}
                className="inline-flex items-center justify-center rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {startingGame ? "Starting…" : "Start Game"}
              </button>
            </div>
            <ConfirmModal
              open={showStartConfirm}
              title="Start your game?"
              message="This will generate weekly match periods for your game. Make sure all players have joined before starting."
              confirmLabel="Start Game"
              loading={startingGame}
              onConfirm={handleStartGame}
              onCancel={() => setShowStartConfirm(false)}
            />
          </>
        )}

        {isAdmin ? (
          <ConfirmModal
            open={showDeleteConfirm}
            title="Delete this game?"
            message="This will permanently delete the game, all matches, scores, and member data. This action cannot be undone."
            confirmLabel="Delete Game"
            loading={deletingGame}
            destructive
            onConfirm={handleDeleteGame}
            onCancel={() => setShowDeleteConfirm(false)}
          />
        ) : (
          <ConfirmModal
            open={showLeaveConfirm}
            title="Leave this game?"
            message="You will be removed from the game and your scores will remain on record. You can rejoin later with an invite code."
            confirmLabel="Leave Game"
            loading={leavingGame}
            destructive
            onConfirm={handleLeaveGame}
            onCancel={() => setShowLeaveConfirm(false)}
          />
        )}

        {/* Next-step banner — tells the viewer what the page wants from
            them right now (play a round, submit a score, etc.). Only
            shows up for members; skipped for draft games since the
            Start-Game CTA already covers that state. */}
        {isMember &&
          (game.status === "active" || game.status === "completed") && (
          <YourStatusCard
            userId={user.id}
            gameId={gameId}
            periodMatches={periodMatches}
            matchPlayersMap={matchPlayersMap}
            mySubmittedMatchIds={mySubmittedMatchIds}
            leaderboard={leaderboard}
            game={game}
          />
        )}

        {/* Activity → Leaderboard → Matches.
            Activity sits at the TOP of the body so the page feels
            alive — members see what's happening first, then drill
            into standings and matches. */}
        <section className="flex flex-col gap-6">
          {/* Game activity feed — scoped to THIS game only via
              the get_game_activity_feed RPC. */}
          {isMember && <GameActivityCard gameId={gameId} />}

          {/* Format info (Stroke Play · Best 3 of 5 cards) moved to the
              page header, so the Leaderboard card doesn't duplicate it. */}
          <LeaderboardTable
            leaderboard={leaderboard}
            currentUserId={user.id}
            scoringCardsCount={game.scoring_cards_count ?? null}
            gameFormat={resolveFormat(game)}
          />

          {/* Honors — compact achievements strip. Hidden entirely for
              draft games (nothing has happened yet); once the
              game is active, BadgesCard renders its own empty
              state, so we don't duplicate that logic here. */}
          {game.status !== "draft" && (
            <BadgesCard
              badges={badges}
              currentUserId={user.id}
              gameFormat={resolveFormat(game)}
            />
          )}

          {/* Always render when there are any matches in the game,
              even if the active period has ended or isn't set yet.
              Empty draft games skip this entirely. */}
          {periodMatches.length > 0 && (
            <MatchCalendarSection
              matches={periodMatches}
              matchPlayersMap={matchPlayersMap}
              currentUserId={user.id}
              // All matches on this page belong to this game.
              resolveGame={() => game}
              onRefresh={loadData}
              focusMatchId={focusMatchId}
              autoEdit={autoEdit}
              onFocusConsumed={handleFocusConsumed}
              context="game"
              // Empty-day CTA deep-links into match-create with this
              // game pre-selected + the tapped day pre-filled.
              defaultGameId={game.id}
              // Forwarded to each rendered MatchDetailCard so the
              // "Lowest of game" flame chip lights up on the row
              // that holds the best approved round in this game.
              gameHighlights={gameHighlights}
            />
          )}
        </section>

        {/* Request to Join (non-member) */}
        {!isMember && !isAdmin && (
          <section className="rounded-xl border border-primary/15 bg-white p-5 text-center shadow-sm">
            {joinRequestSent ? (
              <div className="inline-flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Request pending — waiting for admin approval
              </div>
            ) : isGameFull ? (
              <p className="text-sm text-primary/50">This game is full ({members.length}/{game.max_players} players)</p>
            ) : (
              <>
                <p className="mb-3 text-sm text-primary/60">Want to join this game?</p>
                <button
                  type="button"
                  onClick={handleRequestJoinGame}
                  disabled={requestingJoin}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-cream transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  {requestingJoin ? "Sending request…" : "Request to Join Game"}
                </button>
                {joinRequestError && (
                  <p className="mt-2 text-xs text-red-600">{joinRequestError}</p>
                )}
              </>
            )}
          </section>
        )}

        {/* Game settings — mirrors the match card pattern: the
            destructive action is a small icon button on the right of
            the action row, not a full-width button inside a Danger
            zone disclosure. The existing ConfirmModal (higher up in
            this file) still handles the "are you sure?" step, so the
            safety check is preserved even though the button itself
            is tiny. Admins see Delete, members see Leave. */}
        {(game.invite_code || isMember || isAdmin) && (
          <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-primary">Game settings</h2>

            <div className="flex items-center justify-between gap-3">
              {game.invite_code ? (
                <>
                  <span className="text-xs text-primary/60">Invite code</span>
                  <div className="flex items-center gap-2">
                    <GameInviteCode
                      inviteCode={game.invite_code}
                      gameName={game.name}
                      variant="bottom"
                    />
                    {isAdmin ? (
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(true)}
                        disabled={deletingGame}
                        aria-label="Delete this game"
                        title="Delete this game"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-60"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /></svg>
                      </button>
                    ) : isMember ? (
                      <button
                        type="button"
                        onClick={() => setShowLeaveConfirm(true)}
                        disabled={leavingGame}
                        aria-label="Leave this game"
                        title="Leave this game"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-60"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                      </button>
                    ) : null}
                  </div>
                </>
              ) : (isAdmin || isMember) ? (
                <>
                  {/* Fallback: no invite code on this game, but the
                      viewer can still leave / delete. Right-align the
                      icon against a subtle label so it doesn't float
                      alone on the row. */}
                  <span className="text-xs text-primary/60">
                    {isAdmin ? "Admin" : "Member"}
                  </span>
                  {isAdmin ? (
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={deletingGame}
                      aria-label="Delete this game"
                      title="Delete this game"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-60"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /></svg>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowLeaveConfirm(true)}
                      disabled={leavingGame}
                      aria-label="Leave this game"
                      title="Leave this game"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-60"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                    </button>
                  )}
                </>
              ) : null}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

/* ── PeriodProgress ────────────────────────────────────── */
/**
 * A thin horizontal progress bar shown under the game header that
 * visualises elapsed time in the game's current period (e.g. Day 6
 * of 15). Nothing fancy — just enough to turn a static header into
 * something that changes every time you open it.
 *
 * Hides itself when either date is missing, or when the period
 * already ended (handled upstream — only rendered for status=active).
 */
function PeriodProgress({
  startDate,
  endDate,
}: {
  startDate?: string | null
  endDate?: string | null
}) {
  if (!startDate || !endDate) return null

  const start = new Date(startDate + "T00:00:00")
  const end = new Date(endDate + "T23:59:59")
  const now = new Date()

  const totalMs = end.getTime() - start.getTime()
  if (totalMs <= 0) return null

  const elapsedMs = Math.min(Math.max(now.getTime() - start.getTime(), 0), totalMs)
  const pct = (elapsedMs / totalMs) * 100

  const msPerDay = 1000 * 60 * 60 * 24
  const totalDays = Math.max(1, Math.ceil(totalMs / msPerDay))
  const dayNumber = Math.min(totalDays, Math.max(1, Math.ceil(elapsedMs / msPerDay)))
  const daysLeft = Math.max(0, totalDays - dayNumber)

  return (
    <div className="mt-3">
      <div className="h-1 w-full overflow-hidden rounded-full bg-primary/10">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-primary/50">
        <span>
          Day {dayNumber} of {totalDays}
        </span>
        <span>
          {daysLeft === 0
            ? "Last day"
            : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
        </span>
      </div>
    </div>
  )
}

/**
 * Completed-game replacement for the active-period progress bar.
 * Filled emerald bar + single caption. The "Day X of N · M days
 * left" pair stops making sense once the game is decided — every
 * member has filled their card allowance — so we swap it for a
 * single celebratory line that matches the footer badge on the
 * match cards ("Completed").
 */
function PeriodCompleted() {
  return (
    <div className="mt-3">
      <div className="h-1 w-full overflow-hidden rounded-full bg-emerald-100">
        <div className="h-full w-full rounded-full bg-emerald-500" />
      </div>
      <div className="mt-1 flex items-center justify-center gap-1 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Completed
      </div>
    </div>
  )
}

/* ── YourStatusCard ────────────────────────────────────── */
/**
 * "Your status" block under the game header. Gives the viewer an
 * instant read of where they stand and what to do next, without
 * scanning the whole page:
 *   - Rank (or "Leading" if #1)
 *   - Strokes behind the leader (omitted when #1)
 *   - Cards submitted (e.g. "3/5") + best round
 *   - Next action — priority-ordered tactical nudge that deep-links
 *     into the relevant match card
 *
 * Priority for the Next line (first match wins):
 *   1. A past match where I haven't submitted → "Submit your score"
 *   2. A match where scores are submitted but I haven't approved → "Approve scores"
 *   3. An upcoming match I haven't submitted → "Play your round"
 *   4. Counted < cap → "Submit 1 more card to stay competitive"
 *   5. else → "You're all caught up"
 */
type ActionTone = "primary" | "amber" | "emerald"
type Action = {
  tone: ActionTone
  icon: React.ReactNode
  title: string
  subtitle: string
  href?: string
}

function YourStatusCard({
  userId,
  gameId,
  periodMatches,
  matchPlayersMap,
  mySubmittedMatchIds,
  leaderboard,
  game,
}: {
  userId: string
  gameId: string
  periodMatches: Match[]
  matchPlayersMap: Map<string | number, MatchPlayer[]>
  mySubmittedMatchIds: Set<string>
  leaderboard: LeaderboardRow[]
  game: Game
}) {
  // Local date, not UTC — see AUD#17 / src/lib/date.ts. `match_date` is a
  // plain calendar date; comparing it against a UTC "today" mis-buckets
  // matches for viewers around midnight.
  const today = useMemo(() => todayLocalIso(), [])

  /* ── Status metrics ─────────────────────────────────── */
  const myRow = leaderboard.find((r) => r.user_id === userId) ?? null
  const rank = myRow?.position ?? null
  const myTotal = myRow?.total_score ?? 0
  const myBest = myRow?.best_score ?? null
  const myCounted = myRow?.rounds_counted ?? 0
  // rounds_played is the count of eligible cards (capped at
  // total_cards_count by the leaderboard RPC). When it equals cap,
  // the viewer has filled their card allowance regardless of whether
  // all of them are among the best-N — so no more submissions needed.
  const myPlayed = myRow?.rounds_played ?? 0
  const leader = leaderboard[0] ?? null
  const leaderName = leader?.player_name ?? "the leader"
  // Format-aware gap. `gap` is always a positive number when you're
  // TRAILING the leader, 0 when you are the leader (or no leader
  // exists). Stroke play: you-trail when your total is higher than
  // the leader's; Stableford: you-trail when your total is lower.
  const fmt = resolveFormat(game)
  const fmtCopy = formatCopy(fmt)
  const leaderTotal = leader?.total_score ?? null
  const gap =
    leader && rank !== null && rank > 1 && leaderTotal != null
      ? fmt === "stableford"
        ? leaderTotal - myTotal
        : myTotal - leaderTotal
      : 0
  const cap = game.total_cards_count ?? null
  // Best-of-N threshold. When set, a viewer isn't "ranked for real"
  // until their counted-round bucket hits this number. Surfaces as a
  // qualification nudge before the generic "X/N played" progress pill.
  const scoringCards = game.scoring_cards_count ?? null

  /* ── Next-action decision ───────────────────────────── */
  const action = useMemo<Action>(() => {
    // Matches where the viewer is a participant
    const myMatches = periodMatches.filter((m) => {
      const players = matchPlayersMap.get(m.id) || []
      return players.some((p) => p.user_id === userId)
    })

    // 1. Unsubmitted past match
    const pendingPast = myMatches
      .filter((m) => m.match_date != null && m.match_date < today)
      .filter((m) => !mySubmittedMatchIds.has(String(m.id)))
      .sort((a, b) => (b.match_date || "").localeCompare(a.match_date || ""))[0]
    if (pendingPast) {
      const dateLabel = pendingPast.match_date
        ? new Date(pendingPast.match_date).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })
        : "this match"
      return {
        tone: "amber",
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="9" y1="15" x2="15" y2="15" />
          </svg>
        ),
        title: "Submit your score",
        subtitle: `${dateLabel} — your card isn't submitted yet`,
        href: `/games/${gameId}?match=${pendingPast.id}&edit=1`,
      }
    }

    // 2. Pending approval
    const pendingApproval = myMatches
      .map((m) => {
        if (m.status === "completed" || m.status === "cancelled") return null
        const players = matchPlayersMap.get(m.id) || []
        const me = players.find((p) => p.user_id === userId)
        if (!me) return null
        const hasScores = players.some((p) => p.status != null)
        if (!hasScores) return null
        if (me.approved_at != null) return null
        return m
      })
      .filter((m): m is Match => m != null)
      .sort((a, b) => (b.match_date || "").localeCompare(a.match_date || ""))[0]
    if (pendingApproval) {
      const dateLabel = pendingApproval.match_date
        ? new Date(pendingApproval.match_date).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })
        : "this match"
      const others = (matchPlayersMap.get(pendingApproval.id) || []).filter(
        (p) => p.user_id !== userId && p.status != null,
      ).length
      return {
        tone: "primary",
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ),
        title: "Approve scores",
        subtitle: `${dateLabel} — ${others} teammate${others === 1 ? "" : "s"} waiting on you`,
        href: `/games/${gameId}?match=${pendingApproval.id}`,
      }
    }

    // 3. Upcoming match I haven't submitted yet
    const upcoming = myMatches
      .filter((m) => m.status !== "completed" && (!m.match_date || m.match_date >= today))
      .filter((m) => !mySubmittedMatchIds.has(String(m.id)))
      .sort((a, b) => (a.match_date || "").localeCompare(b.match_date || ""))[0]
    if (upcoming) {
      const dateLabel = upcoming.match_date
        ? new Date(upcoming.match_date).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          })
        : "TBA"
      return {
        tone: "primary",
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 22V6l6-4 6 4v16" />
            <path d="M4 22h16" />
          </svg>
        ),
        title: "Play your round",
        subtitle: `${dateLabel}${upcoming.match_time ? ` · ${upcoming.match_time.slice(0, 5)}` : ""}${upcoming.course_name ? ` · ${upcoming.course_name}` : ""}`,
        href: `/games/${gameId}?match=${upcoming.id}`,
      }
    }

    // 4a. Qualification nudge. When a `scoring_cards_count` rule is
    // in play and the viewer's counted bucket is still below it,
    // their rank on the board is PROVISIONAL — their total will
    // almost certainly drop as they swap in better rounds. "Lock
    // your rank" frames the next round as the thing that makes
    // their position real, which is a stronger motivator than just
    // counting cards. Takes precedence over the generic cap pill
    // below, since qualification is the narrower and more urgent
    // milestone.
    if (scoringCards != null && myCounted < scoringCards) {
      const toGo = scoringCards - myCounted
      return {
        tone: "amber",
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4l2 2" />
          </svg>
        ),
        title:
          toGo === 1
            ? "1 more round to lock your rank"
            : `${toGo} more rounds to lock your rank`,
        subtitle: "",
        href: `/matches/create?game=${gameId}`,
      }
    }

    // 4b. Cap progress pill. Once qualified, this is a softer nudge
    // — playing more rounds can still improve the total by replacing
    // a higher-counted score, but rank is locked. In-progress =
    // amber, filled = emerald.
    if (cap != null && myPlayed < cap) {
      return {
        tone: "amber",
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        ),
        title: `${myPlayed}/${cap} played`,
        subtitle: "",
        // Amber pill is tappable — taking the user to match-create
        // prefilled with this game is the natural next step when
        // they have rounds left in the allowance. The filled
        // counterpart stays informational (no href) since there's
        // nothing to do at cap.
        href: `/matches/create?game=${gameId}`,
      }
    }
    if (cap != null && myPlayed >= cap) {
      return {
        tone: "emerald",
        icon: (
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ),
        title: `${cap}/${cap} cards filled`,
        subtitle: "",
      }
    }

    // 5. Caught up
    return {
      tone: "emerald",
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ),
      title: "You're all caught up",
      subtitle: "No pending rounds. Check back when the next match is scheduled.",
    }
  }, [
    userId,
    gameId,
    periodMatches,
    matchPlayersMap,
    mySubmittedMatchIds,
    today,
    cap,
    myPlayed,
    myCounted,
    scoringCards,
  ])

  /* ── Tone-dependent classes for the action strip ────── */
  const toneClasses = {
    primary: "bg-primary/5",
    amber: "bg-amber-50",
    emerald: "bg-emerald-50/70",
  }[action.tone]
  const iconToneClasses = {
    primary: "bg-primary/10 text-primary",
    amber: "bg-amber-100 text-amber-700",
    emerald: "bg-emerald-100 text-emerald-700",
  }[action.tone]

  /* ── Copy helpers ───────────────────────────────────── */
  const leading = rank === 1

  // Compact action pill for the right column. Subtitle is dropped
  // here — the title + icon + chevron carry enough signal; detail
  // context lives on the destination match card. Keeps the whole
  // YourStatusCard to a single vertical band (~3 text rows).
  const compactActionBody = (
    <div className={`flex items-center gap-2 rounded-lg px-3 py-2 ${toneClasses}`}>
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${iconToneClasses}`}>
        {action.icon}
      </div>
      <p className="min-w-0 truncate text-sm font-semibold text-primary">
        {action.title}
      </p>
      {action.href && (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-primary/40" aria-hidden="true">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      )}
    </div>
  )

  return (
    <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
      {/* Horizontal layout: status block on the left, action pill on
          the right at position-row level. Shrinks the card's vertical
          footprint vs. the old stacked layout. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-primary/50">
            Your status
          </p>

          {/* Rank + Best on the primary row; strokes-behind drops to
              a subline below. Keeps the eye-catching numbers (#2,
              Best 89) close together visually and the narrative
              context ("behind will") subordinated. */}
          <div className="mt-1.5 flex items-baseline gap-3">
            {rank === null ? (
              <span className="text-2xl font-bold text-primary/40">Unranked</span>
            ) : leading ? (
              <span className="text-2xl font-bold text-primary">Leading</span>
            ) : (
              <span className="text-2xl font-bold text-primary">#{rank}</span>
            )}
            {myBest != null && (
              <span className="text-xs text-primary/60">
                Best{" "}
                <span className="font-semibold tabular-nums text-primary/80">
                  {myBest}
                  {fmtCopy.unit}
                </span>
              </span>
            )}
          </div>

          {/* Subline: narrative. For non-leaders, shows the gap;
              for leaders, a simple "the game" affirmation. Noun
              flips per format ("strokes" / "points"). */}
          {rank !== null && !leading && gap > 0 && (
            <p className="mt-1 truncate text-[11px] text-primary/60">
              {gap} {gap === 1 ? fmtCopy.nounSingular : fmtCopy.noun} behind {leaderName}
            </p>
          )}
          {leading && (
            <p className="mt-1 text-[11px] text-primary/60">the game</p>
          )}
        </div>

        {/* Action pill — right-aligned, self-centered against the
            status block. Capped so a long title doesn't steal from
            the rank column on narrow viewports. */}
        <div className="shrink-0 self-center max-w-[60%]">
          {action.href ? (
            <a
              href={action.href}
              className="block transition-transform active:scale-[0.99]"
            >
              {compactActionBody}
            </a>
          ) : (
            compactActionBody
          )}
        </div>
      </div>
    </section>
  )
}

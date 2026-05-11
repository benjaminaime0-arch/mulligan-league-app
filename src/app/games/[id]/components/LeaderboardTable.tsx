"use client"

import Link from "next/link"
import { Avatar } from "@/components/Avatar"
import type { LeaderboardRow } from "../types"
import type { GameFormat } from "@/components/match/types"
import { formatCopy, gapAhead } from "@/lib/gameFormat"

interface LeaderboardTableProps {
  leaderboard: LeaderboardRow[]
  subtitle?: string | null
  /**
   * Current viewer's id — when present we highlight their row so
   * members can locate themselves at a glance. Pass `null` on pages
   * where the viewer isn't a game member.
   */
  currentUserId?: string | null
  /**
   * When the game scores "best N of total" this is that N; used to
   * explain the "Counted" column via a title tooltip.
   */
  scoringCardsCount?: number | null
  /**
   * Game scoring model. Drives direction of "+N ahead" gap math,
   * the unit suffix on scores, and tooltip copy. Defaults to stroke
   * play if omitted.
   */
  gameFormat?: GameFormat
}

export function LeaderboardTable({
  leaderboard,
  subtitle,
  currentUserId,
  scoringCardsCount,
  gameFormat = "stroke_play",
}: LeaderboardTableProps) {
  const copy = formatCopy(gameFormat)
  // Tooltip copy flexes with game config. When a `scoring_cards_count`
  // is set, every round played may not count toward Total — we
  // explain the "best N of M" rule. Otherwise the two numbers are
  // always equal, so we label the column for what it is.
  const countedTitle = scoringCardsCount
    ? `Counted / Played — best ${scoringCardsCount} of all rounds played count toward Total`
    : "Rounds played in this game"

  // Defensive sort — the RPC already returns rows in the right order,
  // but the `+N ahead` gap calculation below reads `rows[idx + 1]`
  // directly. If some future caller ever filters or re-maps the array
  // before handing it in, we'd silently lie about margins. Sorting by
  // position here costs nothing at 8-player games and guarantees
  // the invariant rows.map() relies on.
  const rows = [...leaderboard].sort((a, b) => {
    const pa = a.position ?? Number.MAX_SAFE_INTEGER
    const pb = b.position ?? Number.MAX_SAFE_INTEGER
    return pa - pb
  })

  return (
    <div className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-primary">Leaderboard</h2>
        {subtitle && (
          <p className="shrink-0 text-[10px] text-primary/40">{subtitle}</p>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-4 text-center">
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
              <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
              <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
              <path d="M4 22h16" />
              <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
              <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
              <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
            </svg>
          </div>
          {/* This branch only fires when the game has zero members
              — after the show_all_members RPC change, every member
              appears even at zero rounds. So the copy addresses the
              "roster is empty" case, not "nobody has played yet". */}
          <p className="text-sm font-medium text-primary/70">
            No players yet
          </p>
          <p className="mt-0.5 text-xs text-primary/40">
            Invite your first players to start the board.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead>
              <tr className="border-b border-primary/10 text-[10px] uppercase tracking-wider text-primary/50">
                <th className="py-2 pr-2 font-medium">#</th>
                <th className="py-2 pr-3 font-medium">Player</th>
                <th
                  className="py-2 pr-3 text-right font-medium"
                  title={`Sum of your counted ${copy.noun} rounds`}
                >
                  Total
                </th>
                <th
                  className="py-2 pr-3 text-right font-medium"
                  title={`${copy.superlative} single round this game`}
                >
                  Best
                </th>
                <th
                  className="py-2 text-right font-medium"
                  title={countedTitle}
                >
                  Counted
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const position = row.position ?? idx + 1
                const medal = getMedal(position)
                const isMe = !!currentUserId && row.user_id === currentUserId
                const isLeader = position === 1
                // Gap to the next ACTIVE row below. Skipping inactive
                // rows (rounds_counted === 0, total_score coalesced to
                // 0 by the RPC) keeps the leader from looking unranked
                // when everyone else is still at zero — otherwise
                // `next.total - current.total` goes negative and the
                // `> 0` guard hides the chip. We only emit "+N ahead"
                // when there's a real competitor to be ahead of.
                //
                // `gapAhead` from the format helper returns a signed
                // number that's positive when `row` is ahead of
                // `nextActive` regardless of format — so the
                // `> 0` guard below works for both stroke and
                // stableford without per-format branches here.
                const hasCountedRounds = (r: LeaderboardRow | undefined) =>
                  !!r && (r.rounds_counted ?? 0) > 0
                const nextActive = hasCountedRounds(row)
                  ? rows
                      .slice(idx + 1)
                      .find((r) => hasCountedRounds(r))
                  : undefined
                const gapToNext = gapAhead(
                  row.total_score as number | null | undefined,
                  nextActive?.total_score as number | null | undefined,
                  gameFormat,
                )

                // "Race to finish" provisional chip. Only when a
                // `scoring_cards_count` rule is in play AND this row
                // has at least one counted round but not enough to
                // fill the scoring set. In that window, their total
                // is likely to *drop* (they'll replace their worst
                // counted score) so showing +N to go keeps the
                // leaderboard honest — a leader with 1 of 3 counted
                // rounds deserves a different visual cue than one
                // who's locked in. Zero-round members are signaled by
                // position alone (bottom of board); chip would be
                // noise there.
                const counted = row.rounds_counted ?? 0
                const toGoForRank =
                  scoringCardsCount != null &&
                  counted > 0 &&
                  counted < scoringCardsCount
                    ? scoringCardsCount - counted
                    : null

                // Row bg: viewer gets a cream wash + left border; leader gets
                // a subtle emerald wash so "who's winning" reads instantly.
                const rowBg = isMe
                  ? "bg-cream/50"
                  : isLeader
                    ? "bg-emerald-50/40"
                    : ""
                const rowBorder = isMe
                  ? "border-l-2 border-l-primary"
                  : "border-l-2 border-l-transparent"

                return (
                  <tr
                    key={idx}
                    className={`border-b border-primary/5 last:border-0 ${rowBg} ${rowBorder}`}
                  >
                    {/* Position */}
                    <td className="py-3 pl-1 pr-2">
                      <span
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${medal.className}`}
                        aria-label={`Position ${position}`}
                      >
                        {medal.content ?? position}
                      </span>
                    </td>

                    {/* Player */}
                    <td className="py-3 pr-3">
                      {row.user_id ? (
                        <Link
                          href={`/players/${row.user_id}`}
                          className="flex items-center gap-2 rounded text-sm text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        >
                          <Avatar src={row.avatar_url} size={24} fallback={row.player_name || "P"} />
                          <span className="flex min-w-0 flex-1 items-center gap-1.5">
                            <span className="truncate font-medium">
                              {row.player_name || "Player"}
                            </span>
                            {/* "YOU" pill dropped — the row already
                                carries a cream bg + left primary border
                                when isMe, which reads plenty on its
                                own. Redundant chip was stealing space
                                from the leader-gap text. */}
                            {gapToNext != null && gapToNext > 0 && (
                              <span className="shrink-0 text-[10px] font-medium text-emerald-700/80">
                                +{gapToNext} ahead
                              </span>
                            )}
                            {toGoForRank != null && (
                              <span
                                className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                                title={`Provisional — needs ${toGoForRank} more counted round${toGoForRank === 1 ? "" : "s"} to lock this total`}
                              >
                                +{toGoForRank} to go
                              </span>
                            )}
                          </span>
                        </Link>
                      ) : (
                        // Defensive fallback — `board CTE` in get_leaderboard
                        // anchors on `game_members.user_id` (NOT NULL) so
                        // `row.user_id` is always populated in practice.
                        // Keeping this branch in case the schema or RPC
                        // ever changes; it renders a non-tappable row
                        // instead of crashing.
                        <div className="flex items-center gap-2 text-sm text-primary">
                          <Avatar src={row.avatar_url} size={24} fallback={row.player_name || "P"} />
                          <span className="flex min-w-0 flex-1 items-center gap-1.5">
                            <span className="truncate font-medium">
                              {row.player_name || "Player"}
                            </span>
                            {gapToNext != null && gapToNext > 0 && (
                              <span className="shrink-0 text-[10px] font-medium text-emerald-700/80">
                                +{gapToNext} ahead
                              </span>
                            )}
                            {toGoForRank != null && (
                              <span
                                className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                                title={`Provisional — needs ${toGoForRank} more counted round${toGoForRank === 1 ? "" : "s"} to lock this total`}
                              >
                                +{toGoForRank} to go
                              </span>
                            )}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Total — dominant number; bump size for the leader.
                        Unit suffix is format-aware ("82" vs "37 pts"). */}
                    <td
                      className={`py-3 pr-3 text-right tabular-nums text-primary ${
                        isLeader ? "text-lg font-extrabold" : "text-base font-bold"
                      }`}
                    >
                      {row.total_score != null ? `${row.total_score}${copy.unit}` : "–"}
                    </td>

                    {/* Best — secondary. Same unit flip so stableford
                        shows "18 pts" instead of a bare 18 that reads
                        like a stroke score. */}
                    <td className="py-3 pr-3 text-right text-xs tabular-nums text-primary/60">
                      {row.best_score != null ? `${row.best_score}${copy.unit}` : "–"}
                    </td>

                    {/* Counted — secondary. Rendered as "counted / played"
                        so the "3/10" form is unambiguous on a first read. */}
                    <td
                      className="py-3 text-right text-xs tabular-nums text-primary/60"
                      title={countedTitle}
                    >
                      {row.rounds_counted ?? 0}/{row.rounds_played ?? 0}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Gold/silver/bronze treatment for the top 3 positions. */
function getMedal(position: number): { content: string | null; className: string } {
  if (position === 1) {
    return {
      content: "1",
      className: "bg-amber-400/20 text-amber-700 ring-1 ring-amber-400/40",
    }
  }
  if (position === 2) {
    return {
      content: "2",
      className: "bg-slate-300/30 text-slate-700 ring-1 ring-slate-400/40",
    }
  }
  if (position === 3) {
    return {
      content: "3",
      className: "bg-orange-400/20 text-orange-800 ring-1 ring-orange-500/40",
    }
  }
  return {
    content: null,
    className: "text-primary/60",
  }
}

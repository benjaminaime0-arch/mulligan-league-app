"use client"

import Link from "next/link"
import { Avatar } from "@/components/Avatar"
import type { LeaderboardRow } from "../types"

interface LeaderboardTableProps {
  leaderboard: LeaderboardRow[]
  subtitle?: string | null
}

export function LeaderboardTable({ leaderboard, subtitle }: LeaderboardTableProps) {
  return (
    <div className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-primary">Leaderboard</h2>
        {subtitle && (
          <p className="shrink-0 text-[10px] text-primary/40">{subtitle}</p>
        )}
      </div>
      {leaderboard.length === 0 ? (
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
          <p className="text-sm font-medium text-primary/70">
            The board is empty
          </p>
          <p className="mt-0.5 text-xs text-primary/40">
            Be the first to post a score and claim the top spot.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead>
              <tr className="border-b border-primary/10 text-[10px] uppercase tracking-wider text-primary/50">
                <th className="py-2 pr-2 font-medium">#</th>
                <th className="py-2 pr-3 font-medium">Player</th>
                <th className="py-2 pr-3 text-right font-medium">Total</th>
                <th className="py-2 pr-3 text-right font-medium">Best</th>
                <th className="py-2 text-right font-medium">Cards</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row, idx) => {
                const position = row.position ?? idx + 1
                const medal = getMedal(position)

                return (
                  <tr
                    key={idx}
                    className="border-b border-primary/5 last:border-0"
                  >
                    {/* Position */}
                    <td className="py-3 pr-2">
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
                          <span className="font-medium">{row.player_name || "Player"}</span>
                        </Link>
                      ) : (
                        <div className="flex items-center gap-2 text-sm text-primary">
                          <Avatar src={row.avatar_url} size={24} fallback={row.player_name || "P"} />
                          <span className="font-medium">{row.player_name || "Player"}</span>
                        </div>
                      )}
                    </td>

                    {/* Total — dominant number */}
                    <td className="py-3 pr-3 text-right text-base font-bold tabular-nums text-primary">
                      {row.total_score ?? "–"}
                    </td>

                    {/* Best — secondary */}
                    <td className="py-3 pr-3 text-right text-xs tabular-nums text-primary/60">
                      {row.best_score ?? "–"}
                    </td>

                    {/* Cards — secondary */}
                    <td className="py-3 text-right text-xs tabular-nums text-primary/60">
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

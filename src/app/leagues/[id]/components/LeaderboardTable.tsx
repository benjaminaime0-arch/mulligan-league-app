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
        <p className="text-sm text-primary/70">
          The board is empty — be the first to post a score and claim the top spot.
        </p>
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

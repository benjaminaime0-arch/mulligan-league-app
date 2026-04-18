"use client"

import { useRouter } from "next/navigation"
import { Avatar } from "@/components/Avatar"
import type { LeaderboardRow } from "../types"

interface LeaderboardTableProps {
  leaderboard: LeaderboardRow[]
  subtitle?: string | null
}

export function LeaderboardTable({ leaderboard, subtitle }: LeaderboardTableProps) {
  const router = useRouter()

  return (
    <div className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-primary">Leaderboard</h2>
        {subtitle && (
          <p className="text-[10px] text-primary/40">{subtitle}</p>
        )}
      </div>
      {leaderboard.length === 0 ? (
        <p className="text-sm text-primary/70">
          The board is empty — be the first to post a score and claim the top spot.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-primary/10 text-xs uppercase tracking-wide text-primary/60">
                <th className="py-2.5 pr-3">Pos</th>
                <th className="py-2.5 pr-3">Player</th>
                <th className="py-2.5 pr-3">Total</th>
                <th className="py-2.5 pr-3">Best</th>
                <th className="py-2.5">Cards</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row, idx) => (
                <tr key={idx} className="border-b border-primary/5 last:border-0">
                  <td className="py-3 pr-3 text-primary">
                    {row.position ?? idx + 1}
                  </td>
                  <td className="py-3 pr-3 text-primary">
                    <div
                      className={`flex items-center gap-2 ${row.user_id ? "cursor-pointer hover:underline" : ""}`}
                      onClick={() => row.user_id && router.push(`/players/${row.user_id}`)}
                    >
                      <Avatar src={row.avatar_url} size={24} fallback={row.player_name || "P"} />
                      <span>{row.player_name || "Player"}</span>
                    </div>
                  </td>
                  <td className="py-3 pr-3 font-bold text-primary">
                    {row.total_score ?? "–"}
                  </td>
                  <td className="py-3 pr-3 text-primary">
                    {row.best_score ?? "–"}
                  </td>
                  <td className="py-3 text-primary">
                    {row.rounds_counted ?? 0}/{row.rounds_played ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

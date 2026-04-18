"use client"

import { useRouter } from "next/navigation"
import { Avatar } from "@/components/Avatar"
import type { MatchPlayerWithProfile, Score, MatchApproval } from "../types"

interface PlayersTableProps {
  players: MatchPlayerWithProfile[]
  scoresByUserId: Map<string, Score>
  approvals: MatchApproval[]
  currentUserId: string | undefined
  memberDisplayName: (player: MatchPlayerWithProfile) => string
}

export function PlayersTable({
  players,
  scoresByUserId,
  approvals,
  currentUserId,
  memberDisplayName,
}: PlayersTableProps) {
  const router = useRouter()
  const hasAnyScores = scoresByUserId.size > 0
  const allPlayersHaveScores = players.length > 0 && players.every((p) => scoresByUserId.has(p.user_id))
  const allApproved = allPlayersHaveScores && players.every((p) => {
    const score = scoresByUserId.get(p.user_id)
    return score?.status === "approved"
  })

  const approvalCount = approvals.length
  const totalPlayers = players.length

  return (
    <section className="rounded-xl border border-primary/15 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-primary">Players</h2>
        {hasAnyScores && !allApproved && allPlayersHaveScores && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            Approval {approvalCount}/{totalPlayers}
          </span>
        )}
        {allApproved && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            All approved
          </span>
        )}
      </div>

      {players.length === 0 ? (
        <p className="text-sm text-primary/70">No players in this match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-primary/10 text-xs uppercase tracking-wide text-primary/60">
                <th className="py-2 pr-4">Player</th>
                <th className="py-2 pr-4">Score</th>
                <th className="py-2 pr-4">Holes</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => {
                const playerScore = scoresByUserId.get(player.user_id)
                const isApproved = playerScore?.status === "approved"
                const hasApprovedByUser = approvals.some((a) => a.user_id === player.user_id)

                let statusLabel = "No score"
                let statusClass = "bg-gray-50 text-gray-500"
                if (playerScore && isApproved) {
                  statusLabel = "Approved"
                  statusClass = "bg-emerald-50 text-emerald-700"
                } else if (playerScore && hasApprovedByUser) {
                  statusLabel = "Confirmed"
                  statusClass = "bg-blue-50 text-blue-700"
                } else if (playerScore) {
                  statusLabel = "Pending"
                  statusClass = "bg-amber-50 text-amber-700"
                }

                return (
                  <tr
                    key={player.id}
                    className="border-b border-primary/5 last:border-0"
                  >
                    <td className="py-2 pr-4 text-primary">
                      <div
                        className="flex cursor-pointer items-center gap-2 hover:underline"
                        onClick={() => router.push(`/players/${player.user_id}`)}
                      >
                        <Avatar src={player.profiles?.avatar_url} size={24} fallback={memberDisplayName(player)} />
                        <span>{memberDisplayName(player)}</span>
                      </div>
                    </td>
                    <td className="py-2 pr-4 text-primary">
                      {playerScore ? playerScore.score : "–"}
                    </td>
                    <td className="py-2 pr-4 text-primary">
                      {playerScore ? playerScore.holes : "–"}
                    </td>
                    <td className="py-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}
                      >
                        {statusLabel}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

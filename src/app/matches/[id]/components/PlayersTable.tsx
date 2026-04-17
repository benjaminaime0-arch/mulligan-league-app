import { Avatar } from "@/components/Avatar"
import type { MatchPlayerWithProfile, Score } from "../types"

interface PlayersTableProps {
  players: MatchPlayerWithProfile[]
  scoresByUserId: Map<string, Score>
  currentUserId: string | undefined
  currentUserIsPlayer: boolean
  approvingScoreId: string | number | null
  onApproveScore: (scoreId: string | number) => void
  memberDisplayName: (player: MatchPlayerWithProfile) => string
}

export function PlayersTable({
  players,
  scoresByUserId,
  currentUserId,
  currentUserIsPlayer,
  approvingScoreId,
  onApproveScore,
  memberDisplayName,
}: PlayersTableProps) {
  return (
    <section className="rounded-xl border border-primary/15 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-primary">Players</h2>
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
                const isOwnScore = currentUserId && player.user_id === currentUserId
                const isPending = playerScore?.status === "pending"
                const isApproved = playerScore?.status === "approved"
                const canApprove = currentUserIsPlayer && !isOwnScore && isPending

                let statusLabel = "No score"
                let statusClass = "bg-gray-50 text-gray-500"
                if (playerScore && isApproved) {
                  statusLabel = "Approved"
                  statusClass = "bg-emerald-50 text-emerald-700"
                } else if (playerScore && isPending) {
                  statusLabel = "Pending approval"
                  statusClass = "bg-amber-50 text-amber-700"
                }

                return (
                  <tr
                    key={player.id}
                    className="border-b border-primary/5 last:border-0"
                  >
                    <td className="py-2 pr-4 text-primary">
                      <div className="flex items-center gap-2">
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
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}
                        >
                          {statusLabel}
                        </span>
                        {canApprove && playerScore && (
                          <button
                            type="button"
                            onClick={() => onApproveScore(playerScore.id)}
                            disabled={approvingScoreId === playerScore.id}
                            className="rounded-lg bg-emerald-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-60"
                          >
                            {approvingScoreId === playerScore.id ? "Approving…" : "Approve"}
                          </button>
                        )}
                      </div>
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

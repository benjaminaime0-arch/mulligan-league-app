"use client"

import Link from "next/link"
import { Avatar } from "@/components/Avatar"
import { memberDisplayName, type MatchPlayer, type Score } from "../types"

interface ScoreTableProps {
  players: MatchPlayer[]
  scoresByUserId: Map<string, Score>
  matchStatus: string | null | undefined
}

type Status = "approved" | "pending" | "none"

/**
 * Tabular view of all match players, their scores/holes and whether
 * their score has been approved by everyone. Purely presentational.
 */
export function ScoreTable({ players, scoresByUserId, matchStatus }: ScoreTableProps) {
  if (players.length === 0) {
    return <p className="text-sm text-primary/70">No players in this match.</p>
  }

  return (
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
            const status = resolveStatus(playerScore, matchStatus)

            return (
              <tr
                key={player.id}
                className="border-b border-primary/5 last:border-0"
              >
                <td className="py-2.5 pr-4 text-primary">
                  <Link
                    href={`/players/${player.user_id}`}
                    className="flex items-center gap-2 rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <Avatar
                      src={player.profiles?.avatar_url}
                      alt={`${memberDisplayName(player)}'s avatar`}
                      size={28}
                      fallback={memberDisplayName(player)}
                    />
                    <span className="font-medium">
                      {memberDisplayName(player)}
                    </span>
                  </Link>
                </td>
                <td className="py-2.5 pr-4 text-primary">
                  {playerScore ? playerScore.score : "\u2013"}
                </td>
                <td className="py-2.5 pr-4 text-primary">
                  {playerScore ? playerScore.holes : "\u2013"}
                </td>
                <td className="py-2.5">
                  <StatusCell status={status} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function resolveStatus(
  score: Score | undefined,
  matchStatus: string | null | undefined,
): Status {
  if (!score) return "none"
  if (matchStatus === "completed" || score.status === "approved") return "approved"
  return "pending"
}

function StatusCell({ status }: { status: Status }) {
  if (status === "approved") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
        <CheckIcon />
        Approved
      </span>
    )
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
        <ClockIcon />
        Pending
      </span>
    )
  }
  return <span className="text-xs font-medium text-primary/40">No score</span>
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

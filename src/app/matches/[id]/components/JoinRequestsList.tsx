"use client"

import { Avatar } from "@/components/Avatar"

export type JoinRequest = {
  id: string
  requester_id: string
  requester_name: string
  requester_avatar?: string | null
  created_at: string
}

interface JoinRequestsListProps {
  requests: JoinRequest[]
  approvingId: string | null
  rejectingId: string | null
  onApprove: (id: string) => void
  onReject: (id: string) => void
}

/**
 * Admin-only list of pending join requests for a match. Each row has
 * an Approve / Reject button pair. The parent owns the loading state
 * (approvingId / rejectingId) and the RPC calls; this component is
 * presentational.
 */
export function JoinRequestsList({
  requests,
  approvingId,
  rejectingId,
  onApprove,
  onReject,
}: JoinRequestsListProps) {
  if (requests.length === 0) return null

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-primary">
        Pending Requests ({requests.length})
      </h2>
      <div className="space-y-2">
        {requests.map((req) => {
          const busy = approvingId === req.id || rejectingId === req.id
          return (
            <div
              key={req.id}
              className="flex items-center justify-between rounded-lg border border-primary/10 bg-white px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <Avatar
                  src={req.requester_avatar}
                  alt={`${req.requester_name}'s avatar`}
                  size={32}
                  fallback={req.requester_name}
                />
                <span className="text-sm font-medium text-primary">
                  {req.requester_name}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onApprove(req.id)}
                  disabled={busy}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {approvingId === req.id ? "\u2026" : "Approve"}
                </button>
                <button
                  type="button"
                  onClick={() => onReject(req.id)}
                  disabled={busy}
                  className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                >
                  {rejectingId === req.id ? "\u2026" : "Reject"}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

"use client"

import { useState } from "react"
import { supabase } from "@/lib/supabase"
import type { Notification } from "@/hooks/useNotifications"
import { formatRelativeTime } from "@/lib/notificationDisplay"

interface JoinRequestActionModalProps {
  /** Pass the notification whose `data.request_id` should be actioned. */
  notif: Notification | null
  /** Close handler. Called regardless of outcome. */
  onClose: () => void
  /** Called after a successful approve/reject so the caller can refresh its notification list. */
  onResolved?: () => void
}

type Outcome = "approved" | "rejected" | null

/**
 * Shared approve/reject modal for join_request notifications.
 * Used by both <NotificationBell> and the /notifications page.
 *
 * On success, calls both:
 *   - approve_join_request / reject_join_request (the RPC now marks
 *     all notifications for this request_id as read server-side)
 */
export function JoinRequestActionModal({
  notif,
  onClose,
  onResolved,
}: JoinRequestActionModalProps) {
  const [loading, setLoading] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>(null)
  const [error, setError] = useState<string | null>(null)

  if (!notif) return null

  const requestId = notif.data?.request_id as string | undefined
  const requesterName = (notif.data?.requester_name as string) || "The player"

  const act = async (kind: "approve" | "reject") => {
    if (!requestId) return
    setLoading(true)
    setError(null)
    try {
      const rpcName = kind === "approve" ? "approve_join_request" : "reject_join_request"
      const { data, error: rpcError } = await supabase.rpc(rpcName, {
        p_request_id: requestId,
      })
      if (rpcError) throw rpcError
      const result = data as { success: boolean; error?: string } | null
      if (!result?.success) {
        setError(result?.error || `Failed to ${kind}`)
        return
      }
      setOutcome(kind === "approve" ? "approved" : "rejected")
      onResolved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${kind}`)
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (loading) return
    setOutcome(null)
    setError(null)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/40"
        onClick={handleClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-sm rounded-2xl border border-primary/15 bg-white p-6 shadow-lg"
      >
        {outcome === "approved" ? (
          <SuccessState
            tone="emerald"
            title="Approved!"
            body={`${requesterName} has been added.`}
            onClose={handleClose}
          />
        ) : outcome === "rejected" ? (
          <SuccessState
            tone="red"
            title="Request declined"
            body={`${requesterName} has been notified.`}
            onClose={handleClose}
          />
        ) : error ? (
          <ErrorState message={error} onClose={handleClose} />
        ) : (
          <DefaultState
            notif={notif}
            loading={loading}
            onApprove={() => act("approve")}
            onReject={() => act("reject")}
          />
        )}
      </div>
    </div>
  )
}

function DefaultState({
  notif,
  loading,
  onApprove,
  onReject,
}: {
  notif: Notification
  loading: boolean
  onApprove: () => void
  onReject: () => void
}) {
  return (
    <>
      <h2 className="text-lg font-bold text-primary">{notif.title}</h2>
      {notif.body && (
        <p className="mt-1 text-sm text-primary/60">{notif.body}</p>
      )}
      <div className="mt-2 text-xs text-primary/40">
        {formatRelativeTime(notif.created_at)}
      </div>
      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={loading}
          className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-60"
        >
          {loading ? "Working\u2026" : "Approve"}
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={loading}
          className="flex-1 rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 transition-all hover:bg-red-50 active:scale-[0.98] disabled:opacity-60"
        >
          Reject
        </button>
      </div>
    </>
  )
}

function SuccessState({
  tone,
  title,
  body,
  onClose,
}: {
  tone: "emerald" | "red"
  title: string
  body: string
  onClose: () => void
}) {
  const bg = tone === "emerald" ? "bg-emerald-100" : "bg-red-100"
  const color = tone === "emerald" ? "text-emerald-600" : "text-red-600"
  const path =
    tone === "emerald"
      ? "M4.5 12.75l6 6 9-13.5"
      : "M6 18L18 6M6 6l12 12"

  return (
    <>
      <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full ${bg}`}>
        <svg className={`h-7 w-7 ${color}`} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d={path} />
        </svg>
      </div>
      <h2 className="text-center text-lg font-bold text-primary">{title}</h2>
      <p className="mt-1 text-center text-sm text-primary/60">{body}</p>
      <button
        type="button"
        onClick={onClose}
        className="mt-5 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream hover:bg-primary/90"
      >
        Done
      </button>
    </>
  )
}

function ErrorState({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <>
      <h2 className="text-lg font-bold text-primary">Something went wrong</h2>
      <p className="mt-1 text-sm text-red-600">{message}</p>
      <button
        type="button"
        onClick={onClose}
        className="mt-5 w-full rounded-lg border border-primary/20 bg-white px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5"
      >
        Close
      </button>
    </>
  )
}

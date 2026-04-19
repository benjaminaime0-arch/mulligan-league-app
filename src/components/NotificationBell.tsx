"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter, usePathname } from "next/navigation"
import { useNotifications, type Notification } from "@/hooks/useNotifications"
import { supabase } from "@/lib/supabase"

export function NotificationBell() {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead, refresh } =
    useNotifications()

  // Join request approval modal state
  const [actionNotif, setActionNotif] = useState<Notification | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionResult, setActionResult] = useState<string | null>(null)

  // Close on route change
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Close on click outside
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [open])

  const handleTap = (notif: Notification) => {
    if (!notif.read_at) markAsRead(notif.id)

    const data = notif.data || {}

    // If it's a join request notification, open the action modal
    if (notif.type === "join_request" && data.request_id) {
      setActionNotif(notif)
      setActionResult(null)
      return
    }

    setOpen(false)

    if (data.match_id) {
      router.push(`/matches/${data.match_id}`)
    } else if (data.league_id) {
      router.push(`/leagues/${data.league_id}`)
    } else if (data.new_member_id) {
      router.push(`/players/${data.new_member_id}`)
    }
  }

  const handleApprove = async () => {
    if (!actionNotif) return
    setActionLoading(true)
    try {
      const { data, error } = await supabase.rpc("approve_join_request", {
        p_request_id: actionNotif.data?.request_id as string,
      })
      if (error) throw error
      const result = data as { success: boolean; error?: string }
      if (!result.success) {
        setActionResult(result.error || "Failed to approve")
        return
      }
      setActionResult("approved")
      if (!actionNotif.read_at) markAsRead(actionNotif.id)
      refresh()
    } catch (err) {
      setActionResult(err instanceof Error ? err.message : "Failed to approve")
    } finally {
      setActionLoading(false)
    }
  }

  const handleReject = async () => {
    if (!actionNotif) return
    setActionLoading(true)
    try {
      const { data, error } = await supabase.rpc("reject_join_request", {
        p_request_id: actionNotif.data?.request_id as string,
      })
      if (error) throw error
      const result = data as { success: boolean; error?: string }
      if (!result.success) {
        setActionResult(result.error || "Failed to reject")
        return
      }
      setActionResult("rejected")
      if (!actionNotif.read_at) markAsRead(actionNotif.id)
      refresh()
    } catch (err) {
      setActionResult(err instanceof Error ? err.message : "Failed to reject")
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <div ref={panelRef} className="relative">
      {/* Bell button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-primary/70 shadow-sm ring-1 ring-primary/10 transition-colors hover:bg-white hover:text-primary active:scale-95"
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="animate-slide-up absolute right-0 top-11 z-50 w-[340px] max-w-[calc(100vw-24px)] rounded-2xl border border-primary/10 bg-white shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-primary/5 px-4 py-3">
            <h3 className="text-sm font-semibold text-primary">Notifications</h3>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllAsRead()}
                className="text-xs font-medium text-primary/50 hover:text-primary"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Notification list */}
          <div className="max-h-[400px] overflow-y-auto overscroll-contain">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/5">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary/30">
                    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                  </svg>
                </div>
                <p className="text-xs text-primary/40">No notifications yet</p>
              </div>
            ) : (
              <div className="divide-y divide-primary/5">
                {notifications.slice(0, 20).map((notif) => (
                  <NotificationRow
                    key={notif.id}
                    notification={notif}
                    onTap={handleTap}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer — link to full page if many notifications */}
          {notifications.length > 20 && (
            <div className="border-t border-primary/5 px-4 py-2 text-center">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  router.push("/notifications")
                }}
                className="text-xs font-medium text-primary/50 hover:text-primary"
              >
                View all notifications
              </button>
            </div>
          )}
        </div>
      )}

      {/* Approve/Reject modal */}
      {actionNotif && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/40"
            onClick={() => { if (!actionLoading) { setActionNotif(null); setActionResult(null) } }}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-full max-w-sm rounded-2xl border border-primary/15 bg-white p-6 shadow-lg"
          >
            {actionResult === "approved" ? (
              <>
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
                  <svg className="h-7 w-7 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <h2 className="text-center text-lg font-bold text-primary">Approved!</h2>
                <p className="mt-1 text-center text-sm text-primary/60">
                  {(actionNotif.data?.requester_name as string) || "The player"} has been added.
                </p>
                <button
                  type="button"
                  onClick={() => { setActionNotif(null); setActionResult(null) }}
                  className="mt-5 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream hover:bg-primary/90"
                >
                  Done
                </button>
              </>
            ) : actionResult === "rejected" ? (
              <>
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
                  <svg className="h-7 w-7 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <h2 className="text-center text-lg font-bold text-primary">Request declined</h2>
                <p className="mt-1 text-center text-sm text-primary/60">
                  {(actionNotif.data?.requester_name as string) || "The player"} has been notified.
                </p>
                <button
                  type="button"
                  onClick={() => { setActionNotif(null); setActionResult(null) }}
                  className="mt-5 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream hover:bg-primary/90"
                >
                  Done
                </button>
              </>
            ) : actionResult ? (
              // Error state
              <>
                <h2 className="text-lg font-bold text-primary">Something went wrong</h2>
                <p className="mt-1 text-sm text-red-600">{actionResult}</p>
                <button
                  type="button"
                  onClick={() => { setActionNotif(null); setActionResult(null) }}
                  className="mt-5 w-full rounded-lg border border-primary/20 bg-white px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5"
                >
                  Close
                </button>
              </>
            ) : (
              // Default: show approve/reject buttons
              <>
                <h2 className="text-lg font-bold text-primary">{actionNotif.title}</h2>
                {actionNotif.body && (
                  <p className="mt-1 text-sm text-primary/60">{actionNotif.body}</p>
                )}
                <div className="mt-2 text-xs text-primary/40">
                  {formatRelativeTime(actionNotif.created_at)}
                </div>
                <div className="mt-5 flex gap-2">
                  <button
                    type="button"
                    onClick={handleApprove}
                    disabled={actionLoading}
                    className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-60"
                  >
                    {actionLoading ? "Working…" : "Approve"}
                  </button>
                  <button
                    type="button"
                    onClick={handleReject}
                    disabled={actionLoading}
                    className="flex-1 rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 transition-all hover:bg-red-50 active:scale-[0.98] disabled:opacity-60"
                  >
                    Reject
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Single notification row ──────────────────────────────────── */

function NotificationRow({
  notification,
  onTap,
}: {
  notification: Notification
  onTap: (n: Notification) => void
}) {
  const isUnread = !notification.read_at
  const icon = getNotificationIcon(notification.type)
  const timeLabel = formatRelativeTime(notification.created_at)
  const isJoinRequest = notification.type === "join_request" && !!notification.data?.request_id
  const isClickable = isJoinRequest || !!(notification.data?.match_id || notification.data?.league_id)

  return (
    <button
      type="button"
      onClick={() => onTap(notification)}
      disabled={!isClickable}
      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
        isClickable ? "hover:bg-cream active:bg-cream" : "cursor-default"
      } ${isUnread ? "bg-emerald-50/40" : ""}`}
    >
      <div
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isUnread ? "bg-primary/10" : "bg-primary/5"
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p
            className={`text-[13px] leading-snug ${
              isUnread ? "font-semibold text-primary" : "font-medium text-primary/70"
            }`}
          >
            {notification.title}
          </p>
          {isUnread && (
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
          )}
        </div>
        {notification.body && (
          <p className="mt-0.5 text-[11px] leading-snug text-primary/45 line-clamp-2">
            {notification.body}
          </p>
        )}
        <p className="mt-0.5 text-[10px] text-primary/30">{timeLabel}</p>
        {isJoinRequest && isUnread && (
          <p className="mt-1 text-[11px] font-medium text-emerald-600">Tap to approve or reject</p>
        )}
      </div>
    </button>
  )
}

/* ── Helpers ──────────────────────────────────────────────────── */

function getNotificationIcon(type: string) {
  const cls = "h-3.5 w-3.5 text-primary/50"

  switch (type) {
    case "join_request":
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
        </svg>
      )
    case "join_approved":
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      )
    case "join_rejected":
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      )
    case "score_submitted":
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      )
    case "score_approved":
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      )
    case "match_completed":
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
        </svg>
      )
    case "member_joined":
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
        </svg>
      )
    case "match_scheduled":
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      )
    default:
      return (
        <svg className={cls} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
      )
  }
}

function formatRelativeTime(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diffMs = now - then
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return "Just now"
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay === 1) return "Yesterday"
  if (diffDay < 7) return `${diffDay}d ago`
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

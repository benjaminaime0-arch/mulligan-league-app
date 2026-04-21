"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter, usePathname } from "next/navigation"
import { useNotifications, type Notification } from "@/hooks/useNotifications"
import { JoinRequestActionModal } from "@/components/JoinRequestActionModal"
import { formatRelativeTime, getNotificationIcon } from "@/lib/notificationDisplay"

export function NotificationBell() {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead, refresh } =
    useNotifications()

  // Join request approval modal state — owned by the shared component now
  const [actionNotif, setActionNotif] = useState<Notification | null>(null)

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

    // Join request notification that hasn't been acted on → open action modal.
    // Already-read requests just deep-link to the match/league.
    if (notif.type === "join_request" && data.request_id && !notif.read_at) {
      setActionNotif(notif)
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

      {/* Approve/Reject modal (shared) */}
      <JoinRequestActionModal
        notif={actionNotif}
        onClose={() => setActionNotif(null)}
        onResolved={refresh}
      />
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
  const isJoinRequest =
    notification.type === "join_request" && !!notification.data?.request_id
  const isClickable =
    isJoinRequest ||
    !!(notification.data?.match_id || notification.data?.league_id)

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

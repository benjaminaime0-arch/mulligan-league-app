"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useNotifications, type Notification } from "@/hooks/useNotifications"
import { useAuth } from "@/hooks/useAuth"
import { LoadingSpinner } from "@/components/LoadingSpinner"
import { JoinRequestActionModal } from "@/components/JoinRequestActionModal"
import {
  formatRelativeTime,
  getNotificationIcon,
} from "@/lib/notificationDisplay"

export default function NotificationsPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const {
    notifications,
    unreadCount,
    loading,
    hasMore,
    loadingMore,
    loadMore,
    markAsRead,
    markAllAsRead,
    refresh,
  } = useNotifications({ paginated: true })

  const [actionNotif, setActionNotif] = useState<Notification | null>(null)

  if (authLoading) return <LoadingSpinner message="Checking your session..." />
  if (!user) return null
  if (loading) return <LoadingSpinner message="Loading notifications..." />

  const handleTap = async (notif: Notification) => {
    if (!notif.read_at) markAsRead(notif.id)

    const data = notif.data || {}

    // Open approve/reject modal for unacted join_requests
    if (notif.type === "join_request" && data.request_id && !notif.read_at) {
      setActionNotif(notif)
      return
    }

    if (data.match_id) {
      router.push(`/matches/${data.match_id}`)
    } else if (data.league_id) {
      router.push(`/leagues/${data.league_id}`)
    } else if (data.new_member_id) {
      router.push(`/players/${data.new_member_id}`)
    }
  }

  // Group by date
  const grouped = groupByDate(notifications)

  return (
    <main className="min-h-screen bg-cream px-4 pb-6 pt-4">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-primary">Notifications</h1>
            {unreadCount > 0 && (
              <p className="mt-0.5 text-sm text-primary/60">
                {unreadCount} unread
              </p>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllAsRead}
              className="rounded-lg border border-primary/20 bg-white px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5"
            >
              Mark all read
            </button>
          )}
        </header>

        {/* Empty state */}
        {notifications.length === 0 && (
          <section className="rounded-2xl border border-dashed border-primary/15 bg-white p-10 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/5">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-primary/40"
              >
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              </svg>
            </div>
            <p className="text-sm font-medium text-primary/70">
              No notifications yet
            </p>
            <p className="mt-1 text-xs text-primary/40">
              You&apos;ll see updates here when scores are submitted, players join your
              leagues, and more.
            </p>
          </section>
        )}

        {/* Notification groups */}
        {grouped.map(({ label, items }) => (
          <section key={label}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary/40">
              {label}
            </h2>
            <div className="divide-y divide-primary/5 rounded-2xl border border-primary/10 bg-white shadow-sm">
              {items.map((notif) => (
                <NotificationRow
                  key={notif.id}
                  notification={notif}
                  onTap={handleTap}
                />
              ))}
            </div>
          </section>
        ))}

        {/* Load more */}
        {hasMore && (
          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="rounded-lg border border-primary/20 bg-white px-4 py-2 text-xs font-medium text-primary hover:bg-primary/5 disabled:opacity-60"
            >
              {loadingMore ? "Loading\u2026" : "Load older notifications"}
            </button>
          </div>
        )}
      </div>

      {/* Approve/Reject modal (shared) */}
      <JoinRequestActionModal
        notif={actionNotif}
        onClose={() => setActionNotif(null)}
        onResolved={refresh}
      />
    </main>
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
  const icon = getNotificationIcon(notification.type, "h-4 w-4 text-primary/60")
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
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          isUnread ? "bg-primary/10" : "bg-primary/5"
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p
            className={`text-sm ${
              isUnread ? "font-semibold text-primary" : "font-medium text-primary/80"
            }`}
          >
            {notification.title}
          </p>
          {isUnread && (
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
          )}
        </div>
        {notification.body && (
          <p className="mt-0.5 text-xs text-primary/50 line-clamp-2">
            {notification.body}
          </p>
        )}
        <p className="mt-1 text-[10px] text-primary/35">{timeLabel}</p>
        {isJoinRequest && isUnread && (
          <p className="mt-1 text-[11px] font-medium text-emerald-600">
            Tap to approve or reject
          </p>
        )}
      </div>
    </button>
  )
}

/* ── Grouping helper ──────────────────────────────────────────── */

function groupByDate(
  notifications: Notification[],
): Array<{ label: string; items: Notification[] }> {
  const groups = new Map<string, Notification[]>()

  for (const notif of notifications) {
    const date = new Date(notif.created_at)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()

    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const isYesterday = date.toDateString() === yesterday.toDateString()

    let label: string
    if (isToday) {
      label = "Today"
    } else if (isYesterday) {
      label = "Yesterday"
    } else {
      label = date.toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      })
    }

    const existing = groups.get(label) || []
    existing.push(notif)
    groups.set(label, existing)
  }

  return Array.from(groups.entries()).map(([label, items]) => ({
    label,
    items,
  }))
}

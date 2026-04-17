"use client"

import { useRouter } from "next/navigation"
import { useNotifications, type Notification } from "@/hooks/useNotifications"
import { useAuth } from "@/hooks/useAuth"
import { LoadingSpinner } from "@/components/LoadingSpinner"

export default function NotificationsPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead } =
    useNotifications()

  if (authLoading) return <LoadingSpinner message="Checking your session..." />
  if (!user) return null
  if (loading) return <LoadingSpinner message="Loading notifications..." />

  const handleTap = async (notif: Notification) => {
    // Mark as read
    if (!notif.read_at) {
      markAsRead(notif.id)
    }

    // Navigate to relevant page
    const data = notif.data || {}
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
      </div>
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
  const icon = getNotificationIcon(notification.type)
  const timeLabel = formatRelativeTime(notification.created_at)

  const isClickable = !!(
    notification.data?.match_id || notification.data?.league_id
  )

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
      </div>
    </button>
  )
}

/* ── Helpers ──────────────────────────────────────────────────── */

function getNotificationIcon(type: string) {
  const cls = "h-4 w-4 text-primary/60"

  switch (type) {
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
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

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

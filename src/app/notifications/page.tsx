"use client"

import { notificationTarget } from "@/lib/notificationTarget"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useNotifications, type Notification } from "@/hooks/useNotifications"
import { useAuth } from "@/hooks/useAuth"
import { AppIcon } from "@/components/ui/AppIcon"
import { NotificationItem } from "@/components/NotificationItem"
import { JoinRequestActionModal } from "@/components/JoinRequestActionModal"
import { NotificationPreferences } from "@/components/NotificationPreferences"
import { PushNotificationToggle } from "@/components/PushNotificationToggle"
import { useI18n } from "@/lib/i18n"

export default function NotificationsPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const { t, locale } = useI18n()
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
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  useEffect(() => {
    const revealSettings = () => setSettingsOpen(true)
    const openSettings = () => { if (window.location.hash === "#notification-settings") setSettingsOpen(true) }
    openSettings()
    window.addEventListener("hashchange", openSettings)
    window.addEventListener("mulligan:open-notification-settings", revealSettings)
    return () => {
      window.removeEventListener("hashchange", openSettings)
      window.removeEventListener("mulligan:open-notification-settings", revealSettings)
    }
  }, [])

  if (authLoading || loading) return <main className="app-page space-y-4" role="status"><span className="sr-only">{t("nav.notifications.loading")}</span><div className="h-24 animate-pulse rounded-[20px] bg-sage/30" /><div className="app-surface h-52 animate-pulse" /></main>
  if (!user) return null

  const handleTap = async (notif: Notification) => {
    const data = notif.data || {}

    // Open approve/reject modal for unacted join_requests
    if (notif.type === "join_request" && data.request_id && !notif.read_at) {
      setActionNotif(notif)
      return
    }
    if (!notif.read_at) void markAsRead(notif.id)

    // join_rejected: the match/game is RLS-invisible to the rejected
    // requester by design — following the id would dead-end. Read-only.
    if (notif.type === "join_rejected") return

    const destination = notificationTarget(notif.type, data)
    if (destination) router.push(destination)
  }

  // Group by date
  const grouped = groupByDate(unreadOnly ? notifications.filter(n => !n.read_at) : notifications, t, locale)

  return (
    <main className="app-page">
      <div className="flex w-full flex-col gap-5">
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3"><span className="app-icon-tile"><AppIcon name="bell" /></span><div>
            <h1 className="text-2xl font-bold tracking-tight">
              {t("nav.notifications")}
            </h1>
            {unreadCount > 0 && (
              <p className="mt-0.5 text-sm text-primary/60">
                {t("nav.notifications.unreadcount", { n: unreadCount })}
              </p>
            )}
          </div></div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllAsRead}
              className="app-surface inline-flex min-h-[44px] items-center gap-2 px-3 py-2 text-xs font-semibold hover:bg-sage/20"
            >
              <AppIcon name="check" className="h-4 w-4" />
              {t("nav.notifications.markall")}
            </button>
          )}
        </header>

        {/* Settings — the account menu's "Notification settings" entry
            lands here, so the settings actually live here (they were
            previously built but mounted nowhere). */}
        <details className="app-surface scroll-mt-20 p-4" id="notification-settings" open={settingsOpen} onToggle={event => setSettingsOpen(event.currentTarget.open)}>
          <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-bold"><span className="inline-flex items-center gap-2"><AppIcon name="settings" className="h-4 w-4" />
            {t("notif.settings.title")}
          </span><AppIcon name="arrow" className="h-4 w-4 rotate-90" /></summary>
          <p className="mt-2 text-xs text-primary/65">
            {t("notif.settings.sub")}
          </p>
          <div className="mt-3 flex flex-col gap-3">
            <PushNotificationToggle />
            <NotificationPreferences />
          </div>
        </details>
        <div role="group" aria-label={t("inbox.design.filter")} className="flex gap-2">{[false,true].map(only => <button key={String(only)} type="button" aria-pressed={unreadOnly === only} onClick={() => setUnreadOnly(only)} className={`inline-flex min-h-[44px] items-center rounded-full px-4 text-sm font-semibold ${unreadOnly === only ? "bg-primary text-white" : "app-surface"}`}>{t(only ? "inbox.design.unread" : "inbox.design.all")}</button>)}</div>

        {/* Empty state */}
        {grouped.length === 0 && (
          <section className="app-surface p-8 text-center">
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
              {t(unreadOnly ? unreadCount > 0 ? "inbox.design.moreUnread" : "home.caughtup" : "nav.notifications.empty")}
            </p>
            {!unreadOnly && <p className="mt-1 text-xs text-primary/65">{t("nav.notifications.empty.sub")}</p>}
          </section>
        )}

        {/* Notification groups */}
        {grouped.map(({ label, items }) => (
          <section key={label}>
            <h2 className="mb-3 text-xs font-bold text-primary/65">
              {label}
            </h2>
            <div className="app-surface divide-y divide-primary/5 p-1">
              {items.map((notif) => (
                <NotificationItem
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
              className="app-surface min-h-[48px] px-5 py-3 text-sm font-semibold hover:bg-sage/20 disabled:opacity-60"
            >
              {loadingMore
                ? t("common.loading")
                : t("nav.notifications.loadolder")}
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

/* ── Grouping helper ──────────────────────────────────────────── */

function groupByDate(
  notifications: Notification[],
  t: (key: string, vars?: Record<string, string | number>) => string,
  locale = "fr",
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
      label = t("common.today")
    } else if (isYesterday) {
      label = t("common.yesterday")
    } else {
      label = date.toLocaleDateString(locale, {
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

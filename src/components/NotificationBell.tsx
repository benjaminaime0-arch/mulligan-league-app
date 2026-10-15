"use client"

import { notificationTarget } from "@/lib/notificationTarget"

import { useState, useEffect, useRef, useId } from "react"
import { useRouter, usePathname } from "next/navigation"
import { useNotifications, type Notification } from "@/hooks/useNotifications"
import { JoinRequestActionModal } from "@/components/JoinRequestActionModal"
import { NotificationItem } from "@/components/NotificationItem"
import { AppIcon } from "@/components/ui/AppIcon"
import { useT } from "@/lib/i18n"

export function NotificationBell() {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = `notification-panel-${useId().replace(/:/g, "")}`
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
    const data = notif.data || {}

    // Join request notification that hasn't been acted on → open action modal.
    // Already-read requests just deep-link to the match/game.
    if (notif.type === "join_request" && data.request_id && !notif.read_at) {
      setActionNotif(notif)
      return
    }
    if (!notif.read_at) void markAsRead(notif.id)

    // join_rejected: the match/game is RLS-invisible to the rejected
    // requester by design — following the id would dead-end. Read-only.
    if (notif.type === "join_rejected") return

    setOpen(false)

    const destination = notificationTarget(notif.type, data)
    if (destination) router.push(destination)
  }

  return (
    <div ref={panelRef} className="relative">
      {/* Bell button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-11 w-11 items-center justify-center rounded-full bg-white/80 text-primary/70 shadow-sm ring-1 ring-primary/10 transition-colors hover:bg-white hover:text-primary active:scale-95"
        aria-label={
          unreadCount > 0
            ? t("nav.notifications.unread", { n: unreadCount })
            : t("nav.notifications")
        }
        aria-expanded={open}
        aria-controls={panelId}
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
        <div id={panelId} role="region" aria-label={t("nav.notifications")} className="app-surface absolute right-0 top-12 z-50 w-[360px] max-w-[calc(100vw-24px)] !shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-primary/5 px-4 py-3">
            <h3 className="text-sm font-semibold text-primary">{t("nav.notifications")}</h3>
            <button type="button" onClick={() => setOpen(false)} aria-label={t("common.close")} className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/5"><AppIcon name="close" className="h-4 w-4" /></button>
          </div>

          {/* Notification list */}
          <div className="max-h-[min(400px,55dvh)] overflow-y-auto overscroll-contain p-1">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50">
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
                    className="text-emerald-500"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <p className="text-xs font-medium text-primary/60">{t("home.caughtup")}</p>
              </div>
            ) : (
              <div className="divide-y divide-primary/5">
                {notifications.slice(0, 20).map((notif) => (
                  <NotificationItem
                    key={notif.id}
                    notification={notif}
                    onTap={handleTap}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Always expose the inbox, even with fewer than 20 notifications. */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-primary/10 px-4 py-2">
              {unreadCount > 0 && <button type="button" onClick={() => void markAllAsRead()} className="min-h-[44px] text-xs font-semibold">{t("nav.notifications.markall")}</button>}
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  router.push("/notifications")
                }}
                className="ml-auto inline-flex min-h-[44px] items-center gap-1 text-xs font-bold"
              >
                {t("nav.notifications.all")}
                <AppIcon name="arrow" className="h-3 w-3" />
              </button>
            </div>
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

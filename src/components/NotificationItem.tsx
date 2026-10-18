"use client"

import { notificationTarget } from "@/lib/notificationTarget"
import type { Notification } from "@/hooks/useNotifications"
import { useI18n } from "@/lib/i18n"
import { formatRelativeTime, getNotificationIcon } from "@/lib/notificationDisplay"
import { AppIcon } from "@/components/ui/AppIcon"

/** One presentation for the inbox and bell; destinations remain owned by each screen. */
export function NotificationItem({ notification, onTap }: {
  notification: Notification
  onTap: (notification: Notification) => void
}) {
  const { t, locale } = useI18n()
  const cardNotice = notification.type === "personal_card" ? ({
    "Card awaiting your validation": "validation.notice.request",
    "Correction awaiting your decision": "validation.notice.correction",
    "Card validated": "validation.notice.validated",
  } as Record<string, string>)[notification.title] : undefined
  const title = cardNotice ? t(`${cardNotice}.title`) : notification.title
  const body = cardNotice ? t(`${cardNotice}.body`) : notification.body
  const unread = !notification.read_at
  const request = notification.type === "join_request" && !!notification.data?.request_id
  const clickable = notification.type !== "join_rejected" &&
    (request || !!notificationTarget(notification.type, notification.data ?? {}))
  return <button type="button" onClick={() => onTap(notification)} disabled={!clickable}
    className={`flex min-h-[72px] w-full items-start gap-3 rounded-[18px] p-4 text-left transition-colors ${clickable ? "hover:bg-sage/20 active:bg-sage/30" : "cursor-default"} ${unread ? "bg-sage/15" : ""}`}>
    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${unread ? "bg-primary text-white" : "bg-primary/5 text-primary/65"}`} aria-hidden="true">{notification.type === "personal_card" ? <AppIcon name="cards" className="h-4 w-4" /> : getNotificationIcon(notification.type, "h-4 w-4")}</span>
    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
      <span className={`block text-sm leading-snug ${unread ? "font-bold" : "font-medium text-primary/80"}`}>{title}</span>
      {body && <span className="mt-1 block text-xs leading-relaxed text-primary/65">{body}</span>}
      <time className="mt-2 block text-[11px] text-primary/60" dateTime={notification.created_at}>{formatRelativeTime(notification.created_at, locale)}</time>
      {request && unread && <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold">{t("nav.notifications.tap")}<AppIcon name="arrow" className="h-3 w-3" /></span>}
    </span>
    {unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary"><span className="sr-only">{t("inbox.design.unread")}</span></span>}
  </button>
}

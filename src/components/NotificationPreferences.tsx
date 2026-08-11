"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import {
  NOTIFICATION_TYPES,
  type NotificationType,
  getNotificationIcon,
} from "@/lib/notificationDisplay"
import { useT } from "@/lib/i18n"

type PrefMap = Record<string, boolean>

export function NotificationPreferences() {
  const t = useT()
  const [prefs, setPrefs] = useState<PrefMap>({})
  const [loading, setLoading] = useState(true)
  const [pendingType, setPendingType] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase.rpc("get_my_notification_preferences")
      if (!error && data) {
        const next: PrefMap = {}
        for (const row of data as Array<{ notification_type: string; push_enabled: boolean }>) {
          next[row.notification_type] = row.push_enabled
        }
        setPrefs(next)
      }
      setLoading(false)
    }
    load()
  }, [])

  const isEnabled = (type: NotificationType): boolean => {
    // Default true if no stored row
    return prefs[type] ?? true
  }

  const toggle = async (type: NotificationType) => {
    const previous = isEnabled(type)
    const next = !previous

    setPendingType(type)
    // Optimistic
    setPrefs((p) => ({ ...p, [type]: next }))

    const { error } = await supabase.rpc("set_notification_preference", {
      p_type: type,
      p_enabled: next,
    })

    if (error) {
      // Rollback
      setPrefs((p) => ({ ...p, [type]: previous }))
    }
    setPendingType(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
      </div>
    )
  }

  return (
    <div className="flex flex-col divide-y divide-primary/5">
      {NOTIFICATION_TYPES.map((type) => {
        const meta = {
          label: t(`notif.type.${type}`),
          description: t(`notif.type.${type}.desc`),
        }
        const enabled = isEnabled(type)
        const pending = pendingType === type

        return (
          <div
            key={type}
            className="flex items-center justify-between gap-3 py-2"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                  enabled ? "bg-primary/10" : "bg-primary/5"
                }`}
              >
                {getNotificationIcon(
                  type,
                  enabled ? "h-3.5 w-3.5 text-primary/60" : "h-3.5 w-3.5 text-primary/30",
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-primary">{meta.label}</p>
                <p className="text-[10px] leading-snug text-primary/50 line-clamp-1">
                  {meta.description}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => toggle(type)}
              disabled={pending}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                enabled ? "bg-emerald-500" : "bg-primary/20"
              }`}
              aria-label={
                enabled
                  ? t("notif.pref.disable", { label: meta.label })
                  : t("notif.pref.enable", { label: meta.label })
              }
              aria-pressed={enabled}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  enabled ? "translate-x-[18px]" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        )
      })}
    </div>
  )
}

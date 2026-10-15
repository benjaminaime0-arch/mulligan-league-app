"use client"

import { useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuthContext } from "@/components/AuthProvider"

/** Also mounted on /join: a push may arrive before the session is restored. */
export function NotificationReadSync() {
  const router = useRouter()
  const pathname = usePathname()
  const { user, loading } = useAuthContext()
  const userId = user?.id
  useEffect(() => {
    if (loading || !userId) return
    let active = true
    const sync = async () => {
      const params = new URLSearchParams(window.location.search)
      const notifId = params.get("n")
      if (!notifId || !/^[0-9a-f-]{36}$/i.test(notifId)) return
      const { error } = await supabase.rpc("mark_notifications_read", { p_notification_ids: [notifId] })
      // Keep the parameter on failure so reconnect/focus can retry.
      if (error || !active) return
      window.dispatchEvent(new CustomEvent("mulligan:notifications-read", { detail: { userId, ids: [notifId], readAt: new Date().toISOString() } }))
      if (window.location.pathname !== pathname) return
      params.delete("n")
      const qs = params.toString()
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false })
    }
    void sync()
    window.addEventListener("online", sync)
    window.addEventListener("focus", sync)
    return () => { active = false; window.removeEventListener("online", sync); window.removeEventListener("focus", sync) }
  }, [pathname, userId, loading, router])
  return null
}

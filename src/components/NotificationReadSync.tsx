"use client"

import { useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"

/**
 * Reads `?n=<notification_id>` from the URL on mount and marks that
 * notification as read. Strips the param from the URL so a refresh
 * doesn't re-fire. Used when the service worker opens the app via
 * an OS notification click — the SW appends `?n=` to the target URL
 * so we can close the read-state loop without any in-app tap.
 *
 * Mount once globally (inside Navbar, which is already a client
 * component rendered on every authenticated route).
 */
export function NotificationReadSync() {
  const router = useRouter()
  const pathname = usePathname()
  const { user, loading } = useAuth()

  useEffect(() => {
    if (loading || !user) return
    if (typeof window === "undefined") return

    const params = new URLSearchParams(window.location.search)
    const notifId = params.get("n")
    if (!notifId) return

    // Strip the param from the URL immediately so a refresh or
    // back-nav doesn't re-fire the mark-as-read call.
    params.delete("n")
    const qs = params.toString()
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false })

    // Fire-and-forget. The RPC is idempotent (no-op if already read).
    supabase
      .rpc("mark_notifications_read", { p_notification_ids: [notifId] })
      .then(({ error }) => {
        if (error) {
          // Non-critical; don't surface to the user
          console.warn("NotificationReadSync failed:", error.message)
        }
      })
    // Intentionally only run on pathname changes. We don't want to re-run
    // every time `user` or `router` changes identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  return null
}

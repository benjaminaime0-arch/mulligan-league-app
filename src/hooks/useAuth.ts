"use client"

import { useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { useAuthContext } from "@/components/AuthProvider"

/** Routes that render without a session (no redirect on these). */
const authFreeRoutes = ["/", "/privacy", "/terms"]

/**
 * Protected-page auth guard. Reads the shared session from AuthProvider
 * (no per-call network — see AUD#19) and redirects to "/" once the session
 * resolves to null on a protected route.
 *
 * Because the session comes from context, `loading` flips to false as soon
 * as the provider's initial check resolves — fixing the old bug where the
 * no-session path left `loading` stuck true forever.
 */
export function useAuth() {
  const router = useRouter()
  const pathname = usePathname()
  const { user, loading } = useAuthContext()

  useEffect(() => {
    if (loading) return
    if (!user && !authFreeRoutes.includes(pathname)) {
      router.replace("/")
    }
  }, [user, loading, pathname, router])

  return { user, loading }
}

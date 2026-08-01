"use client"

import { useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { useAuthContext } from "@/components/AuthProvider"

/**
 * Routes that render without a session (no redirect on these).
 *
 * PREFIX-matched (except "/", which is exact): the guard is mounted
 * globally via NotificationReadSync in the root layout, so an exact-match
 * list silently ejects logged-out visitors from every public surface —
 * which is how /share/round, /join/[code] previews and the /courses SEO
 * pages all bounced to the auth shell after hydration while their SSR
 * HTML looked perfect (Googlebot runs JS: it would have indexed the
 * login page for every course URL).
 */
const authFreePrefixes = ["/privacy", "/terms", "/courses", "/share", "/join", "/live"]

function isAuthFree(pathname: string): boolean {
  if (pathname === "/") return true
  return authFreePrefixes.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  )
}

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
    if (!user && !isAuthFree(pathname)) {
      router.replace("/")
    }
  }, [user, loading, pathname, router])

  return { user, loading }
}

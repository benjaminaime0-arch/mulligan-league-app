"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { offlineOwner, setOfflineOwner } from "@/lib/cardOffline"
import { setCardDraftOwner, stopCardDrafts } from "@/lib/cardDraftManager"

/**
 * Single source of session truth for the whole app.
 *
 * Before this, every page mounted `useAuth`, and `useAuth` fired its own
 * `getSession()` — 17 independent round-trips per navigation, none of them
 * listening for sign-out/expiry (AUD#19). This provider does the session
 * work once, subscribes to `onAuthStateChange`, and hands the result to
 * every `useAuth` consumer through context. Sign-out anywhere now
 * propagates everywhere, and the navbar no longer re-fetches identity on
 * each route change.
 */

type AuthState = {
  user: User | null
  /** true until the initial session check resolves */
  loading: boolean
}

const AuthContext = createContext<AuthState>({ user: null, loading: true })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true })

  useEffect(() => {
    let active = true

    // This identity only unlocks this device's own cached scores while offline.
    // It is never used to authorize an RPC; Supabase still validates every request.
    const restoreOffline = () => {
      const id = offlineOwner()
      if (!navigator.onLine && id) { setCardDraftOwner(id); setState({ user: { id } as User, loading: false }); return true }
      return false
    }
    restoreOffline()
    const checkSession = () => {
      void supabase.auth.getSession().then(({ data }) => {
        if (!active || (!data.session && restoreOffline())) return
        if (data.session) { setOfflineOwner(data.session.user.id); setCardDraftOwner(data.session.user.id) }
        setState({ user: data.session?.user ?? null, loading: false })
      }).catch(() => { if (active && !restoreOffline()) setState({ user: null, loading: false }) })
    }
    checkSession()
    window.addEventListener("online", checkSession)

    // Fires on SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED / USER_UPDATED.
    // Keeps the whole tree in sync with a single subscription.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      const previous = offlineOwner()
      if (!session && restoreOffline()) return
      if (previous && (!session || previous !== session.user.id)) stopCardDrafts(previous)
      if (session) { setOfflineOwner(session.user.id); setCardDraftOwner(session.user.id) }
      else if (event === "SIGNED_OUT") setOfflineOwner(null)
      setState({ user: session?.user ?? null, loading: false })
    })

    return () => {
      active = false
      subscription.unsubscribe()
      window.removeEventListener("online", checkSession)
    }
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

/** Read the shared auth state (no network per call). */
export function useAuthContext(): AuthState {
  return useContext(AuthContext)
}

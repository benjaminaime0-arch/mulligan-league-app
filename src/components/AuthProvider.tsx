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

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setState({ user: data.session?.user ?? null, loading: false })
    })

    // Fires on SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED / USER_UPDATED.
    // Keeps the whole tree in sync with a single subscription.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      setState({ user: session?.user ?? null, loading: false })
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

/** Read the shared auth state (no network per call). */
export function useAuthContext(): AuthState {
  return useContext(AuthContext)
}

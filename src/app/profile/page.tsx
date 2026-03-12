"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"

type Profile = {
  id: string
  full_name?: string | null
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  club?: string | null
  handicap?: number | null
}

export default function ProfilePage() {
  const router = useRouter()

  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [logoutLoading, setLogoutLoading] = useState(false)

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession()
      const session = data.session

      if (!session) {
        router.push("/login")
        return
      }

      setUser(session.user)
      setAuthLoading(false)

      try {
        setLoading(true)
        setError(null)

        const { data: profileRow, error: profileError } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", session.user.id)
          .maybeSingle()

        if (profileError) {
          throw profileError
        }

        setProfile((profileRow || null) as Profile | null)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load profile.")
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [router])

  const handleLogout = async () => {
    setLogoutLoading(true)
    try {
      const { error } = await supabase.auth.signOut()
      if (error) {
        throw error
      }
      router.push("/login")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log out.")
    } finally {
      setLogoutLoading(false)
    }
  }

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream">
        <p className="text-primary/70">Checking your session…</p>
      </main>
    )
  }

  if (!user) {
    return null
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream">
        <p className="text-primary/70">Loading profile…</p>
      </main>
    )
  }

  const displayName =
    profile?.full_name ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    user.email ||
    "Player"

  return (
    <main className="min-h-screen bg-cream px-4 pb-24 pt-4 md:pb-8">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-lg font-semibold text-cream">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-primary">{displayName}</h1>
            <p className="mt-1 text-sm text-primary/70">
              Manage your Mulligan League profile.
            </p>
          </div>
        </header>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        <section className="space-y-4 rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
          <Field label="Name" value={displayName} />
          <Field label="Email" value={profile?.email || user.email || "Not set"} />
          <Field label="Home Club" value={profile?.club || "Not set"} />
          <Field
            label="Handicap"
            value={
              profile?.handicap != null ? profile.handicap.toFixed(1) : "Not set"
            }
          />
        </section>

        <section className="space-y-3">
          <button
            type="button"
            className="w-full rounded-lg border border-primary/30 bg-white px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5"
          >
            Edit Profile
          </button>
          <button
            type="button"
            onClick={handleLogout}
            disabled={logoutLoading}
            className="w-full rounded-lg bg-red-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {logoutLoading ? "Logging out…" : "Log Out"}
          </button>
        </section>
      </div>
    </main>
  )
}

interface FieldProps {
  label: string
  value: string
}

function Field({ label, value }: FieldProps) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/60">
        {label}
      </p>
      <p className="mt-1 text-sm text-primary">{value}</p>
    </div>
  )
}


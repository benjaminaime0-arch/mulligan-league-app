"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { Logo } from "@/components/Logo"

/**
 * Onboarding — 3 screens, <90s (T1.2, MVP "Écran Onboarding").
 *
 *   1. Positioning — "Your Game. Your League."
 *   2. Minimal profile — username required; club + photo optional.
 *      Deliberately NO handicap/index (MVP constraint: asking for it is the
 *      single biggest drop-off for casual players).
 *   3. Join or create — the funnel's whole point is ending "in a game".
 *
 * Every field except username is skippable, and the whole flow can be left
 * via "Skip for now" on screen 3 (the user still lands on Home).
 */
export default function WelcomePage() {
  return (
    <Suspense fallback={<Loading />}>
      <WelcomeContent />
    </Suspense>
  )
}

function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
    </main>
  )
}

const TOTAL_STEPS = 3

function WelcomeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get("next")
  const { user, loading: authLoading } = useAuth()

  const [step, setStep] = useState(1)
  const [username, setUsername] = useState("")
  const [club, setClub] = useState("")
  const [town, setTown] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prefilled, setPrefilled] = useState(false)

  // Seed from whatever the provider/profile already gave us.
  useEffect(() => {
    if (!user || prefilled) return
    let active = true
    const seed = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("username, club, town, first_name")
        .eq("id", user.id)
        .maybeSingle()
      if (!active) return
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>
      setUsername(
        data?.username ||
          (meta.username as string) ||
          (meta.full_name as string)?.split(" ")[0] ||
          (meta.name as string)?.split(" ")[0] ||
          data?.first_name ||
          "",
      )
      setClub(data?.club || "")
      setTown(data?.town || "")
      setPrefilled(true)
    }
    seed()
    return () => {
      active = false
    }
  }, [user, prefilled])

  if (authLoading) return <Loading />
  if (!user) return null

  const saveProfile = async () => {
    const name = username.trim()
    if (name.length < 2) {
      setError("Pick a username (at least 2 characters).")
      return false
    }
    setSaving(true)
    setError(null)
    try {
      const { error: upErr } = await supabase
        .from("profiles")
        .update({
          username: name,
          club: club.trim() || null,
          town: town.trim() || null,
        })
        .eq("id", user.id)
      if (upErr) throw upErr
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't save your profile."
      setError(/duplicate|unique/i.test(msg) ? "That username is taken — try another." : msg)
      return false
    } finally {
      setSaving(false)
    }
  }

  const finish = () => router.replace(next || "/home")

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-8">
      {/* Progress */}
      <div className="mb-8 flex items-center gap-2">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i < step ? "bg-primary" : "bg-primary/15"
            }`}
          />
        ))}
        <span className="ml-2 shrink-0 text-xs font-medium text-primary/40">
          {step}/{TOTAL_STEPS}
        </span>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── 1. Positioning ─────────────────────────────────── */}
      {step === 1 && (
        <section className="flex flex-1 flex-col items-center justify-center text-center">
          <Logo size={120} />
          <h1 className="mt-4 text-2xl font-bold text-primary">Welcome to Mulligan</h1>
          <p className="mt-2 text-lg text-primary/80">Your Game. Your League.</p>
          <p className="mt-4 max-w-xs text-sm text-primary/60">
            Turn your regular golf crew into a real competition — schedule rounds,
            log scores, and settle who&apos;s actually best.
          </p>
          <button
            type="button"
            onClick={() => setStep(2)}
            className="mt-8 w-full rounded-lg bg-primary px-4 py-3 font-medium text-cream transition-all hover:bg-primary/90 active:scale-[0.98]"
          >
            Get started
          </button>
        </section>
      )}

      {/* ── 2. Minimal profile ─────────────────────────────── */}
      {step === 2 && (
        <section className="flex flex-1 flex-col">
          <h1 className="text-xl font-bold text-primary">What should we call you?</h1>
          <p className="mt-1 text-sm text-primary/60">
            This is the name your crew sees on the leaderboard.
          </p>

          <div className="mt-6 space-y-4">
            <div>
              <label htmlFor="ob-username" className="mb-1 block text-sm font-medium text-primary">
                Username <span className="text-primary/40">(required)</span>
              </label>
              <input
                id="ob-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="benji78"
                autoComplete="nickname"
                disabled={saving}
              />
            </div>

            <div>
              <label htmlFor="ob-club" className="mb-1 block text-sm font-medium text-primary">
                Home club <span className="text-primary/40">(optional)</span>
              </label>
              <input
                id="ob-club"
                type="text"
                value={club}
                onChange={(e) => setClub(e.target.value)}
                className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Golf National"
                disabled={saving}
              />
            </div>

            <div>
              <label htmlFor="ob-town" className="mb-1 block text-sm font-medium text-primary">
                Town <span className="text-primary/40">(optional)</span>
              </label>
              <input
                id="ob-town"
                type="text"
                value={town}
                onChange={(e) => setTown(e.target.value)}
                className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Versailles"
                disabled={saving}
              />
            </div>

            <p className="text-xs text-primary/40">
              No handicap needed — you can add a photo and details later from your profile.
            </p>
          </div>

          <div className="mt-auto pt-8">
            <button
              type="button"
              disabled={saving}
              onClick={async () => {
                if (await saveProfile()) setStep(3)
              }}
              className="w-full rounded-lg bg-primary px-4 py-3 font-medium text-cream transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60"
            >
              {saving ? "Saving…" : "Continue"}
            </button>
          </div>
        </section>
      )}

      {/* ── 3. Join or create ──────────────────────────────── */}
      {step === 3 && (
        <section className="flex flex-1 flex-col">
          <h1 className="text-xl font-bold text-primary">Get into a game</h1>
          <p className="mt-1 text-sm text-primary/60">
            Got an invite code from a friend? Use it. Otherwise start your own.
          </p>

          <div className="mt-6 space-y-3">
            <Link
              href="/games/join"
              className="flex items-center justify-between rounded-xl border border-primary/15 bg-white px-4 py-4 shadow-sm transition-colors hover:border-primary/30 hover:bg-cream/40"
            >
              <span>
                <span className="block text-sm font-semibold text-primary">Join with a code</span>
                <span className="mt-0.5 block text-xs text-primary/55">
                  Your crew already has a game going
                </span>
              </span>
              <Arrow />
            </Link>

            <Link
              href="/games/create"
              className="flex items-center justify-between rounded-xl border border-primary/15 bg-white px-4 py-4 shadow-sm transition-colors hover:border-primary/30 hover:bg-cream/40"
            >
              <span>
                <span className="block text-sm font-semibold text-primary">Create a game</span>
                <span className="mt-0.5 block text-xs text-primary/55">
                  Start a league and invite your friends
                </span>
              </span>
              <Arrow />
            </Link>
          </div>

          <div className="mt-auto pt-8">
            <button
              type="button"
              onClick={finish}
              className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-3 text-sm font-medium text-primary hover:bg-primary/5"
            >
              Skip for now
            </button>
          </div>
        </section>
      )}
    </main>
  )
}

function Arrow() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-primary/30"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  )
}

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuthContext } from "@/components/AuthProvider"
import { Logo } from "@/components/Logo"

/**
 * Invite deep link — `/join/[code]` (T1.3).
 *
 * Logged OUT: shows what you're joining BEFORE asking for a signup — game
 * name, course, format, member count — via the `get_invite_preview` RPC
 * (a narrow, anon-executable projection; see its migration).
 *
 * Logged IN: joins automatically, so the invitee never re-types the code,
 * then lands in the game. `/games/join` stays as the manual-code fallback.
 *
 * Dead-ends (bad code, full game, finished game) are friendly and always
 * offer a way onward rather than a raw error.
 */

type Preview = {
  found: boolean
  name?: string
  course_name?: string | null
  format?: string | null
  member_count?: number
  max_players?: number | null
  is_full?: boolean
  is_completed?: boolean
}

function formatLabel(f: string | null | undefined): string {
  if (!f) return "Stroke play"
  return f.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function InviteLandingPage() {
  const params = useParams<{ code: string }>()
  const router = useRouter()
  const { user, loading: authLoading } = useAuthContext()

  const code = (params?.code || "").toUpperCase().slice(0, 6)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Auto-join must fire once, even as auth state settles.
  const joinAttempted = useRef(false)

  // 1. Preview (works logged out).
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      const { data, error: rpcError } = await supabase.rpc("get_invite_preview", {
        p_code: code,
      })
      if (cancelled) return
      if (rpcError) {
        setError("We couldn't look up that invite.")
        setPreview({ found: false })
      } else {
        setPreview((data || { found: false }) as Preview)
      }
      setLoading(false)
    }
    run()
    return () => {
      cancelled = true
    }
  }, [code])

  // 2. Auto-join once we know the viewer is signed in and the game is joinable.
  const autoJoin = useCallback(async () => {
    if (joinAttempted.current) return
    joinAttempted.current = true
    setJoining(true)
    setError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc("join_game_by_code", {
        code,
      })
      if (rpcError) throw rpcError
      const res = (data || {}) as { success?: boolean; game_id?: string; error?: string }
      if (res.success && res.game_id) {
        router.replace(`/games/${res.game_id}`)
        return
      }
      // Already a member → just go there, that's a success from the user's view.
      if (res.error && /already a member/i.test(res.error)) {
        router.replace("/games")
        return
      }
      setError(res.error || "We couldn't add you to this game.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't add you to this game.")
    } finally {
      setJoining(false)
    }
  }, [code, router])

  useEffect(() => {
    if (authLoading || !user || !preview?.found) return
    if (preview.is_full || preview.is_completed) return
    autoJoin()
  }, [authLoading, user, preview, autoJoin])

  if (loading || authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
      </main>
    )
  }

  // ── Dead end: unknown code ────────────────────────────────
  if (!preview?.found) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-primary">This invite isn&apos;t valid</h1>
        <p className="mt-2 text-sm text-primary/60">
          The code <span className="font-mono font-semibold">{code}</span> doesn&apos;t match
          any game. It may have been mistyped or the game was deleted.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Link href="/games/join" className="rounded-lg bg-primary px-4 py-3 text-center text-sm font-medium text-cream hover:bg-primary/90">
            Enter a code manually
          </Link>
          <Link href={user ? "/games" : "/"} className="rounded-lg border border-primary/20 bg-cream px-4 py-3 text-center text-sm font-medium text-primary hover:bg-primary/5">
            {user ? "Browse your games" : "Go to Mulligan"}
          </Link>
        </div>
      </Shell>
    )
  }

  const spotsLeft =
    preview.max_players != null && preview.member_count != null
      ? preview.max_players - preview.member_count
      : null

  return (
    <Shell>
      <p className="text-xs font-semibold uppercase tracking-wide text-primary/40">
        You&apos;re invited to
      </p>
      <h1 className="mt-1 text-2xl font-bold text-primary">{preview.name}</h1>

      <dl className="mt-4 space-y-1.5 text-sm">
        <Row label="Course" value={preview.course_name || "Not set"} />
        <Row label="Format" value={formatLabel(preview.format)} />
        <Row
          label="Players"
          value={
            preview.max_players != null
              ? `${preview.member_count} of ${preview.max_players}`
              : `${preview.member_count}`
          }
        />
      </dl>

      {error && (
        <div role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Dead ends that still show the game details */}
      {preview.is_completed ? (
        <Note>
          This game has already finished, so it isn&apos;t taking new players.
        </Note>
      ) : preview.is_full ? (
        <Note>This game is full ({preview.max_players} players).</Note>
      ) : null}

      <div className="mt-6 flex flex-col gap-2">
        {user ? (
          preview.is_completed || preview.is_full ? (
            <Link href="/games" className="rounded-lg bg-primary px-4 py-3 text-center text-sm font-medium text-cream hover:bg-primary/90">
              Browse your games
            </Link>
          ) : (
            <button
              type="button"
              disabled={joining}
              onClick={autoJoin}
              className="rounded-lg bg-primary px-4 py-3 text-sm font-medium text-cream hover:bg-primary/90 disabled:opacity-60"
            >
              {joining ? "Joining…" : "Join this game"}
            </button>
          )
        ) : preview.is_completed || preview.is_full ? (
          <Link href="/" className="rounded-lg border border-primary/20 bg-cream px-4 py-3 text-center text-sm font-medium text-primary hover:bg-primary/5">
            Go to Mulligan
          </Link>
        ) : (
          <>
            {/* After auth the user returns here and is joined automatically —
                they never re-type the code. */}
            <Link
              href={`/?tab=signup&redirect=${encodeURIComponent(`/join/${code}`)}`}
              className="rounded-lg bg-primary px-4 py-3 text-center text-sm font-medium text-cream hover:bg-primary/90"
            >
              Sign up &amp; join
            </Link>
            <Link
              href={`/?redirect=${encodeURIComponent(`/join/${code}`)}`}
              className="rounded-lg border border-primary/20 bg-cream px-4 py-3 text-center text-sm font-medium text-primary hover:bg-primary/5"
            >
              I already have an account
            </Link>
            {spotsLeft != null && spotsLeft > 0 && (
              <p className="text-center text-xs text-primary/40">
                {spotsLeft} spot{spotsLeft === 1 ? "" : "s"} left
              </p>
            )}
          </>
        )}
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo size={80} />
        </div>
        <div className="rounded-2xl border border-primary/10 bg-white p-6 shadow-sm">{children}</div>
      </div>
    </main>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-primary/50">{label}</dt>
      <dd className="truncate font-medium text-primary">{value}</dd>
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      {children}
    </p>
  )
}

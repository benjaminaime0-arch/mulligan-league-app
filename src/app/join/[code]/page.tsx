"use client"

import { isInviteCode, normalizeInviteCode } from "@/lib/inviteCodes"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuthContext } from "@/components/AuthProvider"
import { AppIcon } from "@/components/ui/AppIcon"
import { Logo } from "@/components/Logo"
import { useI18n } from "@/lib/i18n"
import { track } from "@/lib/analytics"
import { AnalyticsView } from "@/components/AnalyticsView"

/**
 * Invite deep link — `/join/[code]` (T1.3).
 *
 * Logged OUT: shows what you're joining BEFORE asking for a signup — game
 * name, course, format, member count — via the `get_invite_preview` RPC
 * (a narrow, anon-executable projection; see its migration).
 *
 * Logged IN: confirms joining explicitly, without re-typing the code,
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
  member_game_id?: string | null
  start_date?: string | null
  end_date?: string | null
  hole_count?: number | null
  tee_name?: string | null
  attestation?: string | null
}

function formatLabel(f: string | null | undefined, t: (key: string) => string): string {
  if (f && ["stroke_gross", "stroke_net", "stableford_net"].includes(f)) return t(`personal.format.${f}`)
  if (!f) return "Stroke play"
  return f.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function InviteLandingPage() {
  const params = useParams<{ code: string }>()
  const code = normalizeInviteCode(params?.code || "")
  return <>
    {isInviteCode(code) && <AnalyticsView event="invite_link_opened" viewKey="invitation" params={{ code_len: code.length }} />}
    <InviteLandingContent />
  </>
}

function InviteLandingContent() {
  const params = useParams<{ code: string }>()
  const router = useRouter()
  const { user, loading: authLoading } = useAuthContext()
  const { t, locale } = useI18n()

  const code = normalizeInviteCode(params?.code || "")
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const joinAttempted = useRef(false)
  const [lookupAttempt, setLookupAttempt] = useState(0)

  // 1. Preview (works logged out).
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      setError(null)
      if (!isInviteCode(code)) { setPreview({ found: false }); setLoading(false); return }
      const { data, error: rpcError } = await supabase.rpc("get_invite_preview", {
        p_code: code,
      })
      if (cancelled) return
      if (rpcError) {
        setError(t("invite.lookupfailed"))
        setPreview({ found: false })
      } else {
        const p = (data || { found: false }) as Preview
        setPreview(p)
      }
      setLoading(false)
    }
    run()
    return () => {
      cancelled = true
    }
  }, [code, t, lookupAttempt, user?.id])

  // Join only after the user confirms the preview; allow retries on failure.
  const joinLeague = useCallback(async () => {
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
        track("invite_joined", { league_id: res.game_id, member_count: (preview?.member_count ?? 0) + 1 })
        router.replace(`/games/${res.game_id}`)
        return
      }
      // A stale preview or lost join acknowledgement must retain this league.
      if (res.error && /already a member/i.test(res.error)) {
        const { data: refreshed, error: refreshError } = await supabase.rpc("get_invite_preview", { p_code: code })
        if (refreshError) throw refreshError
        const memberId = (refreshed as Preview | null)?.member_game_id
        if (!memberId) throw new Error(t("invite.failed"))
        router.replace(`/games/${memberId}`)
        return
      }
      setError(res.error || t("invite.failed"))
    } catch (err) {
      setError(err instanceof Error ? err.message : t("invite.failed"))
    } finally {
      joinAttempted.current = false
      setJoining(false)
    }
  }, [code, router, t, preview?.member_count])

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
        <h1 className="text-xl font-bold text-primary">{error ? t("invite.lookup.title") : t("invite.invalid.title")}</h1>
        <p className="mt-2 text-sm text-primary/60">
          {error || t("invite.invalid.body", { code })}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          {error && <button type="button" className="min-h-[48px] rounded-xl bg-primary px-4 text-sm text-cream" onClick={() => setLookupAttempt((n) => n + 1)}>{t("invite.retry")}</button>}
          <Link href="/games/join" className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-primary px-4 py-3 text-center text-sm font-medium text-cream hover:bg-primary/90">
            {t("invite.manual")}
          </Link>
          <Link href={user ? "/games" : "/"} className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-primary/20 bg-white px-4 py-3 text-center text-sm font-medium text-primary hover:bg-primary/5">
            {user ? t("invite.browse") : t("invite.gomulligan")}
          </Link>
        </div>
      </Shell>
    )
  }

  const memberId = user ? preview.member_game_id : null
  const shortDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })
  const spotsLeft =
    preview.max_players != null && preview.member_count != null
      ? preview.max_players - preview.member_count
      : null

  return (
    <Shell>
      <AnalyticsView event="invite_preview_viewed" viewKey="invitation" />
      <p className="text-xs font-semibold uppercase tracking-wide text-primary/40">
        {t("invite.invited")}
      </p>
      <h1 className="mt-1 text-2xl font-bold text-primary">{preview.name}</h1>

      <dl className="mt-4 space-y-1.5 text-sm">
        <Row label={t("invite.course")} value={preview.course_name || t("invite.notset")} />
        <Row label={t("invite.format")} value={formatLabel(preview.format, t)} />
        {!!preview.hole_count && <Row label={t("invite.tee")} value={`${t("personal.picker.holeCount", { n: preview.hole_count })} · ${preview.tee_name ?? ""}`} />}
        {preview.start_date && preview.end_date && <Row label={t("invite.season")} value={`${shortDate(preview.start_date)} → ${shortDate(preview.end_date)}`} />}
        <Row
          label={t("invite.players")}
          value={
            preview.max_players != null
              ? `${preview.member_count} / ${preview.max_players}`
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
      {!memberId && preview.is_completed ? (
        <Note>
          {t("invite.completed")}
        </Note>
      ) : !memberId && preview.is_full ? (
        <Note>{t("invite.full", { max: preview.max_players ?? 0 })}</Note>
      ) : null}

      {memberId ? <p className="mt-5 text-sm text-primary/70">{t("invite.memberReady")}</p> : !preview.is_completed && !preview.is_full && <p className="mt-5 text-sm text-primary/70">{t(user ? "invite.readyStep" : "invite.nextStep")}</p>}
      {!!preview.hole_count && !preview.is_completed && <p className="mt-2 text-xs leading-relaxed text-primary/65">{t(preview.attestation === "peer_required" ? "invite.witnessRule" : "invite.freshRule")}</p>}
      <div className="mt-6 flex flex-col gap-2">
        {memberId ? <Link href={`/games/${memberId}`} className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-cream">{t("invite.openLeague")}</Link> : user ? (
          preview.is_completed || preview.is_full ? (
            <Link href="/games" className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-primary px-4 py-3 text-center text-sm font-medium text-cream hover:bg-primary/90">
              {t("invite.browse")}
            </Link>
          ) : (
            <button
              type="button"
              disabled={joining}
              onClick={joinLeague}
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-primary px-4 py-3 text-sm font-medium text-cream hover:bg-primary/90 disabled:opacity-60"
            >
              {joining ? t("invite.joining") : t("invite.join")}
            </button>
          )
        ) : preview.is_completed || preview.is_full ? (
          <Link href="/" className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-primary/20 bg-white px-4 py-3 text-center text-sm font-medium text-primary hover:bg-primary/5">
            {t("invite.gomulligan")}
          </Link>
        ) : (
          <>
            {/* Preserve this invitation through email and social sign-in. */}
            <Link
              href={`/?tab=signup&redirect=${encodeURIComponent(`/join/${code}`)}`}
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-primary px-4 py-3 text-center text-sm font-medium text-cream hover:bg-primary/90"
            >
              {t("invite.signup.named", { name: preview.name || "Mulligan" })}
            </Link>
            <Link
              href={`/?tab=login&redirect=${encodeURIComponent(`/join/${code}`)}`}
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-primary/20 bg-white px-4 py-3 text-center text-sm font-medium text-primary hover:bg-primary/5"
            >
              {t("invite.havelogin")}
            </Link>
            {spotsLeft != null && spotsLeft > 0 && (
              <p className="text-center text-xs text-primary/40">
                {spotsLeft === 1 ? t("invite.spots.one") : t("invite.spots", { n: spotsLeft })}
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
    <main className="mulligan-app flex min-h-screen flex-col items-center justify-center bg-bone px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo size={80} />
        </div>
        <div className="app-surface p-6"><span className="app-icon-tile mb-4"><AppIcon name="join" /></span>{children}</div>
      </div>
    </main>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-primary/50">{label}</dt>
      <dd className="min-w-0 break-words text-right font-semibold text-primary">{value}</dd>
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

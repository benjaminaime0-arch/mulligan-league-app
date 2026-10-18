"use client"
import { track } from "@/lib/analytics"

import { normalizeInviteCode, isInviteCode } from "@/lib/inviteCodes"

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { AppIcon } from "@/components/ui/AppIcon"
import { personalButton } from "@/lib/personalRounds"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { useT } from "@/lib/i18n"

export default function JoinGamePage() {
  const t = useT()

  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          <p className="text-primary/70">{t("common.loading")}</p>
        </main>
      }
    >
      <JoinGameContent />
    </Suspense>
  )
}

function JoinGameContent() {
  const searchParams = useSearchParams()
  const { user, loading: authLoading } = useAuth()
  const t = useT()

  const [code, setCode] = useState(normalizeInviteCode(searchParams.get("code") || ""))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gameId, setGameId] = useState<string | number | null>(null)
  const [successGameName, setSuccessGameName] = useState<string | null>(null)
  const [successCourseName, setSuccessCourseName] = useState<string | null>(null)
  const [successMemberCount, setSuccessMemberCount] = useState<number | null>(null)
  const showError = (message: string) => setError(
    /invalid/i.test(message) ? t("games.join.error.invalid") :
    /full/i.test(message) ? t("games.join.error.full") :
    /already/i.test(message) ? t("games.join.error.member") : message
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const trimmed = code.trim().toUpperCase()
    if (!isInviteCode(trimmed)) {
      setError(t("games.join.error.length"))
      return
    }

    setSubmitting(true)
    try {
      const { data, error: rpcError } = await supabase.rpc("join_game_by_code", {
        code: trimmed,
      })

      if (rpcError) {
        throw rpcError
      }

      const result = data as
        | { success: boolean; game_id?: string | number; game_name?: string; error?: string }
        | null

      if (!result || !result.success || !result.game_id || !result.game_name) {
        const message =
          result?.error ||
          t("games.join.error.failed")
        showError(message)
        return
      }

      setSuccessGameName(result.game_name ?? null)
      track("invite_joined", { league_id: String(result.game_id), method: "code" })

      // Fetch additional game details for the success card
      const [gameRes, membersRes] = await Promise.all([
        supabase
          .from("games")
          .select("course_name")
          .eq("id", String(result.game_id))
          .maybeSingle(),
        supabase
          .from("game_members")
          .select("id")
          .eq("game_id", String(result.game_id)),
      ])
      setSuccessCourseName(
        (gameRes.data as { course_name?: string | null } | null)?.course_name ?? null
      )
      setSuccessMemberCount(membersRes.error ? null : membersRes.data?.length ?? null)
      setGameId(result.game_id)
    } catch (err) {
      const message = err instanceof Error ? err.message : t("common.error.generic")
      showError(message)
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-primary/70">{t("auth.checking")}</p>
      </main>
    )
  }

  if (!user) {
    return null
  }

  // Success state — replace entire form with success card
  if (gameId) {
    return (
      <main className="app-page">
        <div className="mx-auto w-full max-w-md">
          <div className="app-surface p-6 text-center">
            {/* Checkmark */}
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-sage/30 text-primary">
              <AppIcon name="check" className="h-8 w-8" />
            </div>

            <h1 className="text-2xl font-bold tracking-tight">{t("games.joined.title")}</h1>

            <p className="mt-4 break-words text-lg font-semibold text-primary">
              {successGameName}
            </p>

            <p className="mt-1 text-sm text-primary/60">
              {successCourseName || t("games.card.nocourse")}
              {successMemberCount != null && <> · {successMemberCount === 1
                ? t("games.members.one")
                : t("games.members", { n: successMemberCount })}</>}
            </p>

            <div className="mt-6 flex flex-col gap-3">
              <Link href={`/games/${gameId}`} className={`${personalButton} w-full gap-2`}>{t("games.goto")}<AppIcon name="arrow" className="h-4 w-4" /></Link>
              <Link href="/home" className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-primary/5 px-4 py-3 text-sm font-semibold">
                {t("common.back.dashboard")}
              </Link>
            </div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="app-page !pt-2">
      <Link href="/games" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-primary/70">← {t("nav.games")}</Link>
      <div className="mx-auto mt-2 flex w-full max-w-md flex-col gap-5">
        <header className="rounded-[20px] bg-primary p-5 text-white">
          <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/10"><AppIcon name="join" /></span>
          <h1 className="text-2xl font-bold tracking-tight">{t("games.join.full")}</h1>
          <p className="mt-2 text-sm text-sage">
            {t("games.join.subtitle")}
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="app-surface space-y-5 p-5 text-center"
        >
          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 text-left">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="invite-code"
              className="mb-3 block text-xs font-semibold uppercase tracking-[0.2em] text-primary/60"
            >
              {t("games.join.code.label")}
            </label>
            <input
              id="invite-code"
              type="text"
              value={code}
              onChange={(e) => setCode(normalizeInviteCode(e.target.value))}
              maxLength={10}
              autoComplete="off"
              className="mx-auto block min-h-[64px] w-full min-w-0 rounded-xl border border-primary/20 bg-sage/15 px-2 py-3 text-center font-mono text-xl font-bold tracking-[0.12em] text-primary placeholder:text-primary/30 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 sm:text-2xl"
              placeholder="ABC1234567"
              autoCapitalize="characters"
              spellCheck={false}
              aria-describedby="invite-code-hint"
              aria-invalid={!!error}
              inputMode="text"
              disabled={submitting}
            />
            <p id="invite-code-hint" className="mt-2 text-xs text-primary/60">
              {t("games.join.code.hint")}
            </p>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className={`${personalButton} w-full gap-2`}
          >
            {submitting ? t("invite.joining") : t("games.join.full")}
            <AppIcon name="arrow" className="h-4 w-4" />
          </button>
        </form>
        <Link href="/games/create" className="inline-flex min-h-[44px] items-center justify-center gap-2 text-sm font-semibold"><AppIcon name="plus" className="h-4 w-4" />{t("personal.createLeague")}</Link>
      </div>
    </main>
  )
}


"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { CourseAutocomplete, type CourseSuggestion } from "@/components/CourseAutocomplete"
import { track } from "@/lib/analytics"
import { useT } from "@/lib/i18n"

// Stroke play, Stableford and (since Phase D) Match Play all have real
// calculation support in the leaderboard engine. Match play compares
// hole-by-hole nets, so it additionally requires a course whose scorecard
// exists in the referential — create_game enforces that server-side and
// this page translates the refusal. Foursome pairs ride on Ryder mode
// (one shared card per pair, entered under either partner's name).
// Labels are dictionary keys, not literals: this array lives at module scope,
// where the `useT` hook can't be called. The component resolves them at render.
const FORMATS: { value: string; labelKey: string }[] = [
  { value: "stroke_play", labelKey: "games.format.strokeplay" },
  { value: "stableford", labelKey: "games.format.stableford" },
  // Phase D: match play is live — but only on a course whose hole-by-hole
  // card exists in the referential (server enforces; client explains).
  { value: "match_play", labelKey: "games.format.matchplay" },
]

export default function CreateGamePage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const t = useT()

  const [name, setName] = useState("")
  const [course, setCourse] = useState("")
  // The verified course row behind the text, when picked from the referential.
  // Free-typing after a pick clears it (CourseAutocomplete calls onSelect(null)),
  // so course_id can never point at a course the text no longer describes.
  const [pickedCourse, setPickedCourse] = useState<CourseSuggestion | null>(null)
  const [players, setPlayers] = useState(4)
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [scoringCards, setScoringCards] = useState(1)
  const [totalCards, setTotalCards] = useState(1)
  const [format, setFormat] = useState("stroke_play")
  const [basis, setBasis] = useState<"gross" | "net" | "stableford_net">("gross")
  const [teamMode, setTeamMode] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [gameId, setGameId] = useState<string | number | null>(null)
  const [copied, setCopied] = useState(false)

  // Keep scoringCards <= totalCards
  useEffect(() => {
    if (scoringCards > totalCards) {
      setScoringCards(totalCards)
    }
  }, [totalCards, scoringCards])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setCopied(false)

    if (!name.trim() || !course.trim()) {
      setError(t("games.create.error.required"))
      return
    }
    if (!startDate || !endDate) {
      setError(t("games.create.error.dates"))
      return
    }
    if (new Date(endDate) <= new Date(startDate)) {
      setError(t("games.create.error.dateorder"))
      return
    }

    setSubmitting(true)
    try {
      const { data, error: rpcError } = await supabase.rpc("create_game", {
        p_name: name.trim(),
        p_course_name: course.trim(),
        p_max_players: players,
        p_start_date: startDate,
        p_end_date: endDate,
        p_scoring_cards: scoringCards,
        p_total_cards: totalCards,
        p_game_type: format,
        p_course_id: pickedCourse?.id ?? null,
        // Basis is a stroke-play concept; a Stableford game is always gross.
        p_scoring_basis: format === "stroke_play" ? basis : "gross",
        p_team_mode: format === "match_play" ? teamMode : false,
      })

      if (rpcError) throw rpcError

      const result = data as
        | { success: boolean; game_id?: string | number; invite_code?: string; error?: string }
        | null

      if (!result || !result.success || !result.game_id || !result.invite_code) {
        setError(
          result?.error === "match_play_needs_course_holes"
            ? t("games.create.error.matchplaycourse")
            : result?.error || t("games.create.error.failed"),
        )
        return
      }

      track("game_created", { format })
      setGameId(result.game_id)
      setInviteCode(result.invite_code)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error.generic"))
    } finally {
      setSubmitting(false)
    }
  }

  const handleCopy = async () => {
    if (!inviteCode) return
    if (typeof navigator === "undefined" || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(inviteCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore clipboard errors
    }
  }

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-primary/70">{t("common.session.checking")}</p>
      </main>
    )
  }

  if (!user) return null

  return (
    <main className="min-h-screen px-4 py-8">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
        <header>
          <h1 className="text-2xl font-bold text-primary">{t("nav.new.game")}</h1>
          <p className="mt-2 text-sm text-primary/70">
            {t("games.create.subtitle")}
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Game Name */}
          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium text-primary">
              {t("games.create.name")}
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder={t("games.create.name.placeholder")}
              disabled={submitting}
            />
          </div>

          {/* Golf Course */}
          <div>
            <label htmlFor="course" className="mb-1 block text-sm font-medium text-primary">
              {t("course.label")}
            </label>
            {/* Type-ahead over the 129-course Île-de-France base (T1.6).
                Free text still allowed — see CourseAutocomplete. */}
            <CourseAutocomplete
              id="course"
              value={course}
              onChange={setCourse}
              onSelect={setPickedCourse}
              placeholder={t("course.placeholder")}
              disabled={submitting}
            />
          </div>

          {/* Number of Players */}
          <div>
            <label htmlFor="players" className="mb-1 block text-sm font-medium text-primary">
              {t("games.create.players")}
            </label>
            <select
              id="players"
              value={players}
              onChange={(e) => setPlayers(parseInt(e.target.value, 10))}
              className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={submitting}
            >
              {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {t("games.players.count", { n })}
                </option>
              ))}
            </select>
          </div>

          {/* Game Duration */}
          <div>
            <p className="mb-1 text-sm font-medium text-primary">{t("games.create.duration")}</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="startDate" className="mb-1 block text-xs text-primary/60">
                  {t("games.create.start")}
                </label>
                <input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg border border-primary/20 bg-cream px-3 py-2.5 text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  disabled={submitting}
                />
              </div>
              <div>
                <label htmlFor="endDate" className="mb-1 block text-xs text-primary/60">
                  {t("games.create.end")}
                </label>
                <input
                  id="endDate"
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-lg border border-primary/20 bg-cream px-3 py-2.5 text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  disabled={submitting}
                />
                {startDate && endDate && new Date(endDate) <= new Date(startDate) && (
                  <p className="mt-1 text-xs text-red-600">{t("games.create.error.dateorder")}</p>
                )}
              </div>
            </div>
          </div>

          {/* Total cards possible */}
          <div>
            <label htmlFor="totalCards" className="mb-1 block text-sm font-medium text-primary">
              {t("games.create.totalcards")}
            </label>
            <select
              id="totalCards"
              value={totalCards}
              onChange={(e) => setTotalCards(parseInt(e.target.value, 10))}
              className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={submitting}
            >
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-primary/50">
              {t("games.create.totalcards.hint")}
            </p>
          </div>

          {/* Scoring cards counted */}
          <div>
            <label htmlFor="scoringCards" className="mb-1 block text-sm font-medium text-primary">
              {t("games.create.scoringcards")}
            </label>
            <select
              id="scoringCards"
              value={scoringCards}
              onChange={(e) => setScoringCards(parseInt(e.target.value, 10))}
              className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={submitting}
            >
              {Array.from({ length: 10 }, (_, i) => i + 1)
                .filter((n) => n <= totalCards)
                .map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
            </select>
            <p className="mt-1 text-xs text-primary/50">
              {t("games.create.scoringcards.hint")}
            </p>
          </div>

          {/* Game format */}
          <div>
            <label htmlFor="format" className="mb-1 block text-sm font-medium text-primary">
              {t("games.create.format")}
            </label>
            <select
              id="format"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={submitting}
            >
              {FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {t(f.labelKey)}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-primary/50">
              {format === "stableford"
                ? t("games.create.format.stableford.hint")
                : format === "match_play"
                  ? t("games.create.format.matchplay.hint")
                  : t("games.create.format.strokeplay.hint")}
            </p>
          </div>

          {/* Ryder mode (Phase D) — team container over match-play rounds. */}
          {format === "match_play" && (
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-primary/15 bg-cream px-3 py-2 text-sm text-primary">
              <input
                type="checkbox"
                checked={teamMode}
                onChange={(e) => setTeamMode(e.target.checked)}
                disabled={submitting}
                className="accent-primary"
              />
              <span className="font-medium">{t("games.create.teammode")}</span>
              <span className="ml-auto text-xs text-primary/50">
                {t("games.create.teammode.hint")}
              </span>
            </label>
          )}

          {/* Scoring basis (Phase C) — stroke play only: a Stableford game
              already is points, so the picker would be nonsense there. */}
          {format === "stroke_play" && (
            <div>
              <p className="mb-1 block text-sm font-medium text-primary">
                {t("games.create.basis")}
              </p>
              <div className="flex flex-col gap-1.5">
                {(["gross", "net", "stableford_net"] as const).map((b) => (
                  <label
                    key={b}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                      basis === b
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-primary/15 bg-cream text-primary/70"
                    }`}
                  >
                    <input
                      type="radio"
                      name="basis"
                      value={b}
                      checked={basis === b}
                      onChange={() => setBasis(b)}
                      disabled={submitting}
                      className="accent-primary"
                    />
                    <span className="font-medium">{t(`games.basis.${b}`)}</span>
                    <span className="ml-auto text-xs text-primary/50">
                      {t(`games.basis.${b}.hint`)}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center rounded-lg bg-primary px-4 py-3 font-medium text-cream transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? t("games.create.submitting") : t("games.create.full")}
          </button>
        </form>

        {inviteCode && gameId && (
          <section className="space-y-4 rounded-xl border border-primary/20 bg-primary px-5 py-6 text-cream shadow-sm">
            <h2 className="text-lg font-semibold">{t("invite.share.title")}</h2>
            <p className="text-sm text-cream/80">
              {t("invite.share.sub")}
            </p>
            <div className="flex flex-col items-center gap-4 rounded-lg bg-cream/10 p-4">
              <div className="text-3xl font-mono tracking-[0.4em]">
                {inviteCode}
              </div>
              <div className="flex w-full flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={async () => {
                    if (!inviteCode) return
                    const message = t("invite.share.message", { name, code: inviteCode })
                    if (typeof navigator !== "undefined" && navigator.share) {
                      try {
                        await navigator.share({ text: message })
                      } catch {
                        // user cancelled
                      }
                    } else {
                      handleCopy()
                    }
                  }}
                  className="flex-1 rounded-lg bg-cream px-4 py-2.5 text-sm font-medium text-primary transition-all hover:bg-cream/90 active:scale-[0.98]"
                >
                  {t("invite.share.cta")}
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex-1 rounded-lg border border-cream/50 px-4 py-2.5 text-sm font-medium text-cream transition-all hover:bg-cream/10 active:scale-[0.98]"
                >
                  {copied ? t("common.copied") : t("invite.share.copy")}
                </button>
                <button
                  type="button"
                  onClick={() => router.push(`/games/${gameId}`)}
                  className="flex-1 rounded-lg border border-cream/70 px-4 py-2.5 text-sm font-medium text-cream transition-all hover:bg-cream/10 active:scale-[0.98]"
                >
                  {t("games.goto")}
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

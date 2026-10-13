"use client"
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useT } from "@/lib/i18n"
import { supabase } from "@/lib/supabase"
import {
  personalResult,
  personalButton,
  type PersonalLeague,
} from "@/lib/personalRounds"
import { LeaderboardTable } from "@/app/games/[id]/components/LeaderboardTable"
import { GameInviteCode } from "@/app/games/[id]/components/GameInviteCode"
export function PersonalLeaguePanel({
  initial,
  userId,
}: {
  initial: PersonalLeague
  userId: string
}) {
  const t = useT()
  const [data, setData] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [present, setPresent] = useState<Record<string, boolean>>({})
  const refresh = useCallback(async () => {
    const d = personalResult<PersonalLeague | null>(
      await supabase.rpc("get_personal_league", { p_game: initial.game.id }),
    )
    if (d) setData(d)
  }, [initial.game.id])
  useEffect(() => {
    setData(initial)
  }, [initial])
  const attest = async (id: string, approve: boolean) => {
    setBusy(true)
    setError(null)
    try {
      personalResult(
        await supabase.rpc("attest_personal_card", {
          p_submission: id,
          p_approve: approve,
          p_present: !!present[id],
        }),
      )
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t("personal.loadError"))
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Link href="/games" className="text-sm underline">
        ← {t("nav.games")}
      </Link>
      <h1 className="mt-3 text-2xl font-bold">{data.game.name}</h1>
      <p className="mt-2 text-sm">
        {data.tee.course_name} · {data.tee.hole_count} · {data.tee.name}
      </p>
      <p className="mt-1 text-sm">
        {data.game.start_date} → {data.game.end_date} ·{" "}
        {t(`personal.format.${data.rules.format}`)}
      </p>
      <p className="mt-2 text-xs text-primary/70">
        {t("personal.leagueRules")} ·{" "}
        {data.rules.attestation === "peer_required"
          ? t("personal.witnessRequired")
          : t("personal.selfDeclared")}
      </p>
      <GameInviteCode
        inviteCode={data.game.invite_code}
        gameName={data.game.name}
        variant="bottom"
      />
      <div className="my-4 flex gap-3">
        <Link
          href={`/rounds?tee=${data.rules.tee_id}`}
          className={personalButton}
        >
          {t("personal.addOrSubmit")}
        </Link>
        <button
          className="text-sm underline"
          disabled={busy}
          onClick={() => void refresh().catch((e) => setError(e.message))}
        >
          {t("personal.refresh")}
        </button>
      </div>
      {error && (
        <p role="alert" className="mb-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <LeaderboardTable
        leaderboard={data.board}
        currentUserId={userId}
        scoringCardsCount={data.game.scoring_cards_count}
        gameFormat={
          data.rules.format === "stableford_net" ? "stableford" : "stroke_play"
        }
      />
      <h2 className="mb-3 mt-6 font-semibold">{t("personal.leagueCards")}</h2>
      <ul className="space-y-3">
        {data.submissions.map((s) => (
          <li key={s.id} className="rounded-xl border border-primary/15 p-4">
            <p className="font-semibold">
              {s.player_name} · {s.played_on}
            </p>
            <p className="mt-1 text-sm">
              {t("personal.confirmedRevision", { n: s.revision_number })} ·{" "}
              {t(`personal.submission.${s.status}`)}
            </p>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer underline">
                {t("personal.reviewCard")}
              </summary>
              <ol className="mt-2 space-y-1">
                {s.scores.map((h) => (
                  <li key={h.hole_number}>
                    {t("personal.hole", { n: h.hole_number })}:{" "}
                    {h.completion === "picked_up"
                      ? t("personal.hole.picked_up")
                      : h.strokes}
                  </li>
                ))}
              </ol>
            </details>
            {s.reason && (
              <p className="mt-2 text-xs text-primary/70">
                {t(`personal.reason.${s.reason}`)}
              </p>
            )}
            {s.status === "pending" && s.user_id !== userId && (
              <div className="mt-3">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    className="mt-1"
                    type="checkbox"
                    checked={!!present[s.id]}
                    onChange={(e) =>
                      setPresent((p) => ({ ...p, [s.id]: e.target.checked }))
                    }
                  />
                  {t("personal.present")}
                </label>
                <div className="mt-3 flex gap-2">
                  <button
                    disabled={busy || !present[s.id]}
                    className={personalButton}
                    onClick={() => void attest(s.id, true)}
                  >
                    {t("personal.approve")}
                  </button>
                  <button
                    disabled={busy || !present[s.id]}
                    className="rounded-lg border border-primary/20 px-4 py-2.5 text-sm disabled:opacity-50"
                    onClick={() => void attest(s.id, false)}
                  >
                    {t("personal.reject")}
                  </button>
                </div>
              </div>
            )}
            {s.user_id === userId && (
              <Link
                href={`/rounds/${s.round_id}`}
                className="mt-2 block text-sm underline"
              >
                {t("personal.openCard")}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </main>
  )
}

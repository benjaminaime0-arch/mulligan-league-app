"use client"

/**
 * TeamScoreHeader — the "EUR vs USA" board for Ryder-mode games (Phase D).
 *
 * Shows both teams' match points (halves included) from get_ryder_score,
 * and — for the game admin — a collapsible assignment panel: every member
 * gets a 1/2 toggle (set_member_team RPC) plus an auto-balance button that
 * alternates the unassigned. Team membership is snapshotted per match when
 * players join one, so re-shuffling here never rewrites played rounds.
 */

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useT } from "@/lib/i18n"

type RyderScore = {
  success: boolean
  team1?: { name: string; points: number }
  team2?: { name: string; points: number }
  matches?: { match_id: string; state: string | null; leader: number }[]
}

export type TeamMemberRow = {
  user_id: string
  name: string
  team: number | null
}

export function TeamScoreHeader({
  gameId,
  isAdmin,
  members,
  onChanged,
}: {
  gameId: string
  isAdmin: boolean
  members: TeamMemberRow[]
  /** Parent re-pulls game data after an assignment change. */
  onChanged: () => Promise<void> | void
}) {
  const t = useT()
  const [score, setScore] = useState<RyderScore | null>(null)
  const [assignOpen, setAssignOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("get_ryder_score", { p_game_id: gameId })
    const payload = data as RyderScore | null
    if (payload?.success) setScore(payload)
  }, [gameId])

  useEffect(() => {
    void load()
  }, [load])

  const setTeam = async (userId: string, team: number | null) => {
    setBusy(userId)
    try {
      const { data } = await supabase.rpc("set_member_team", {
        p_game_id: gameId,
        p_user_id: userId,
        p_team: team,
      })
      if ((data as { success?: boolean } | null)?.success) {
        await onChanged()
        await load()
      }
    } finally {
      setBusy(null)
    }
  }

  const autoBalance = async () => {
    // Alternate unassigned members onto the lighter team, deterministic
    // by name so repeated taps don't reshuffle.
    const counts = [0, 0]
    for (const m of members) if (m.team === 1) counts[0]++, void 0
    for (const m of members) if (m.team === 2) counts[1]++, void 0
    const unassigned = members
      .filter((m) => m.team == null)
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const m of unassigned) {
      const target = counts[0] <= counts[1] ? 1 : 2
      counts[target - 1]++
      // Sequential on purpose: tiny lists, and parallel writes would race
      // the balance counters.
      // eslint-disable-next-line no-await-in-loop
      await setTeam(m.user_id, target)
    }
  }

  const t1 = score?.team1
  const t2 = score?.team2
  const leading = t1 && t2 ? (t1.points > t2.points ? 1 : t2.points > t1.points ? 2 : 0) : 0

  const fmtPts = (n: number) =>
    Number.isInteger(n) ? String(n) : String(Math.floor(n)) + ",5"

  return (
    <div className="rounded-xl border border-primary/15 bg-white p-4 shadow-sm">
      <div className="flex items-stretch justify-between gap-3">
        {[
          { def: t("games.team.default1"), data: t1, side: 1 },
          { def: t("games.team.default2"), data: t2, side: 2 },
        ].map(({ def, data, side }) => (
          <div
            key={side}
            className={`flex flex-1 flex-col items-center rounded-lg px-2 py-3 ${
              leading === side ? "bg-primary text-cream" : "bg-cream text-primary"
            }`}
          >
            <p className="max-w-full truncate text-xs font-semibold uppercase tracking-wide opacity-80">
              {data?.name ?? def}
            </p>
            <p className="text-3xl font-extrabold tabular-nums">
              {data ? fmtPts(data.points) : "0"}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-center text-xs text-primary/50">
        {t("games.team.matchescounted", { n: score?.matches?.length ?? 0 })}
      </p>

      {isAdmin && (
        <div className="mt-3 border-t border-primary/10 pt-3">
          <button
            type="button"
            onClick={() => setAssignOpen((v) => !v)}
            className="text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            {assignOpen ? t("games.team.assign.close") : t("games.team.assign.open")}
          </button>
          {assignOpen && (
            <div className="mt-2 flex flex-col gap-1.5">
              {members.map((m) => (
                <div key={m.user_id} className="flex items-center justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm text-primary">{m.name}</p>
                  <div className="flex gap-1">
                    {[1, 2].map((team) => (
                      <button
                        key={team}
                        type="button"
                        disabled={busy === m.user_id}
                        onClick={() => setTeam(m.user_id, m.team === team ? null : team)}
                        className={`h-8 w-8 rounded-lg text-xs font-bold ${
                          m.team === team
                            ? "bg-primary text-cream"
                            : "border border-primary/20 text-primary/60"
                        }`}
                      >
                        {team}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {members.some((m) => m.team == null) && (
                <button
                  type="button"
                  onClick={autoBalance}
                  className="mt-1 self-start rounded-lg border border-primary/20 px-3 py-1.5 text-xs font-medium text-primary hover:bg-cream"
                >
                  {t("games.team.autobalance")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

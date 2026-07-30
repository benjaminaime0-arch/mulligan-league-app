"use client"

/**
 * "Parcours conquis" (Phase F) — the 8 Île-de-France departments as a
 * stylized grid. A course is conquered when the player's best NET round
 * there beat or matched its par reference — you played to your handicap.
 * Pure display over get_profile_course_conquests; renders nothing until
 * the player has verified-course rounds.
 */

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useT } from "@/lib/i18n"

type Row = { dept_no: string; courses_played: number; conquered: number }

const DEPTS: { no: string; label: string }[] = [
  { no: "75", label: "Paris" },
  { no: "77", label: "Seine-et-Marne" },
  { no: "78", label: "Yvelines" },
  { no: "91", label: "Essonne" },
  { no: "92", label: "Hauts-de-Seine" },
  { no: "93", label: "Seine-St-Denis" },
  { no: "94", label: "Val-de-Marne" },
  { no: "95", label: "Val-d'Oise" },
]

export function ConquestCard({ userId }: { userId: string }) {
  const t = useT()
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.rpc("get_profile_course_conquests", {
        p_user_id: userId,
      })
      if (!cancelled) setRows((data ?? []) as Row[])
    })()
    return () => {
      cancelled = true
    }
  }, [userId])

  const byDept = new Map((rows ?? []).map((r) => [r.dept_no, r]))
  const totalPlayed = (rows ?? []).reduce((s, r) => s + Number(r.courses_played), 0)
  if (!rows || totalPlayed === 0) return null

  return (
    <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-primary">{t("profile.conquest.title")}</h2>
        <span className="text-[11px] text-primary/50">
          {t("profile.conquest.subtitle", {
            n: (rows ?? []).reduce((s, r) => s + Number(r.conquered), 0),
            total: totalPlayed,
          })}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {DEPTS.map((d) => {
          const r = byDept.get(d.no)
          const played = Number(r?.courses_played ?? 0)
          const conquered = Number(r?.conquered ?? 0)
          const full = played > 0 && conquered === played
          return (
            <div
              key={d.no}
              title={`${d.label} — ${conquered}/${played || 0}`}
              className={`flex flex-col items-center rounded-lg px-1 py-2 text-center ${
                full && played > 0
                  ? "bg-primary text-cream"
                  : conquered > 0
                    ? "bg-primary/10 text-primary"
                    : played > 0
                      ? "bg-cream text-primary/70"
                      : "bg-cream/50 text-primary/30"
              }`}
            >
              <span className="text-sm font-extrabold">{d.no}</span>
              <span className="text-[10px] tabular-nums">
                {played > 0 ? `${conquered}/${played}` : "–"}
              </span>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-[11px] text-primary/40">{t("profile.conquest.hint")}</p>
    </section>
  )
}

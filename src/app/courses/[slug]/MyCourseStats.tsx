"use client"

/**
 * Signed-in viewer's record on a course page (Phase F). Client island in a
 * server-rendered page: crawlers see nothing, a logged-out browser sees
 * nothing, a player who has rounds here sees their line.
 */

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { useT } from "@/lib/i18n"
import { vsPar } from "@/lib/gameFormat"

type Stats = {
  visible: boolean
  rounds?: number
  best_gross?: number | null
  best_net?: number | null
  avg_vs_par?: number | null
  last_played?: string | null
}

export function MyCourseStats({
  courseId,
  coursePar,
  courseHoles,
}: {
  courseId: string
  coursePar: number | null
  courseHoles: number | null
}) {
  const t = useT()
  const { user } = useAuth()
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.rpc("get_user_course_stats", {
        p_user_id: user.id,
        p_course_id: courseId,
      })
      if (!cancelled) setStats(data as Stats | null)
    })()
    return () => {
      cancelled = true
    }
  }, [user, courseId])

  if (!user || !stats?.visible || !stats.rounds) return null

  // The stored par is the two-loop figure for 9-hole courses; the best-round
  // chip compares an 18-hole round to it, which is the common case.
  const bestRel =
    coursePar != null && courseHoles === 18 ? vsPar(stats.best_gross ?? null, coursePar) : null

  return (
    <section className="mt-8 rounded-xl border border-primary/15 bg-white p-4">
      <h2 className="text-sm font-bold uppercase tracking-wide text-primary/60">
        {t("courses.mystats.title")}
      </h2>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t("courses.mystats.rounds")} value={String(stats.rounds)} />
        <Stat
          label={t("courses.mystats.best")}
          value={
            stats.best_gross != null
              ? `${stats.best_gross}${bestRel ? ` (${bestRel})` : ""}`
              : "–"
          }
        />
        <Stat
          label={t("courses.mystats.bestnet")}
          value={stats.best_net != null ? String(stats.best_net) : "–"}
        />
        <Stat
          label={t("courses.mystats.avgvspar")}
          value={
            stats.avg_vs_par != null
              ? `${stats.avg_vs_par > 0 ? "+" : ""}${stats.avg_vs_par}`
              : "–"
          }
        />
      </div>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-cream px-3 py-2">
      <p className="text-xs text-primary/50">{label}</p>
      <p className="text-lg font-bold tabular-nums text-primary">{value}</p>
    </div>
  )
}

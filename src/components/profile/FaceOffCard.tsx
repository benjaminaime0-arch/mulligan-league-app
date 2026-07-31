"use client"

/**
 * "Face à face" (Phase G) — the viewer's record against another player,
 * shown on that player's profile. Renders nothing when there's no shared
 * history (or when looking at yourself). All comparisons are NET — the
 * same rule as the Elo pairs and the recap grid.
 */

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useT } from "@/lib/i18n"

type H2H = {
  visible: boolean
  matches?: number
  a_wins?: number
  b_wins?: number
  ties?: number
  avg_margin?: number | null
  streak_len?: number
  streak_who?: "a" | "b" | "t" | null
  last5?: { match_id: string; date: string | null; winner: "a" | "b" | "t" }[]
}

export function FaceOffCard({
  viewerId,
  otherId,
  otherName,
}: {
  viewerId: string
  otherId: string
  otherName: string
}) {
  const t = useT()
  const [h2h, setH2h] = useState<H2H | null>(null)

  useEffect(() => {
    if (viewerId === otherId) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.rpc("get_head_to_head", {
        p_user_a: viewerId,
        p_user_b: otherId,
      })
      if (!cancelled) setH2h(data as H2H | null)
    })()
    return () => {
      cancelled = true
    }
  }, [viewerId, otherId])

  if (viewerId === otherId || !h2h?.visible || !h2h.matches) return null

  const you = Number(h2h.a_wins ?? 0)
  const them = Number(h2h.b_wins ?? 0)
  const headline =
    you > them
      ? t("h2h.youlead", { you, them })
      : them > you
        ? t("h2h.theylead", { name: otherName, you, them })
        : t("h2h.level", { n: you })

  return (
    <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-primary">{t("h2h.title")}</h2>
      <p className="mt-2 text-lg font-bold text-primary">{headline}</p>
      <p className="mt-1 text-xs text-primary/50">
        {t("h2h.details", {
          n: h2h.matches,
          ties: Number(h2h.ties ?? 0),
          margin: h2h.avg_margin ?? 0,
        })}
        {Number(h2h.streak_len ?? 0) > 1 && h2h.streak_who !== "t"
          ? ` · ${t(h2h.streak_who === "a" ? "h2h.streak.you" : "h2h.streak.them", {
              n: Number(h2h.streak_len),
              name: otherName,
            })}`
          : ""}
      </p>
      {/* Last 5, most recent first: green = you, red = them, grey = tie */}
      <div className="mt-3 flex gap-1.5">
        {(h2h.last5 ?? []).map((m) => (
          <span
            key={m.match_id}
            title={m.date ?? ""}
            className={`h-2.5 w-6 rounded-full ${
              m.winner === "a"
                ? "bg-emerald-500"
                : m.winner === "b"
                  ? "bg-red-400"
                  : "bg-primary/20"
            }`}
          />
        ))}
      </div>
    </section>
  )
}

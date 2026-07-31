"use client"

/**
 * Indice Mulligan chip (Phase G) — a player's Elo-style rating + trend
 * arrow from their last rated match. Product copy never says "Elo".
 * Renders nothing until the player has at least one rated match.
 */

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useT } from "@/lib/i18n"

export function RatingChip({ userId }: { userId: string }) {
  const t = useT()
  const [rating, setRating] = useState<number | null>(null)
  const [delta, setDelta] = useState<number>(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [{ data: pr }, { data: hist }] = await Promise.all([
        supabase
          .from("player_ratings")
          .select("rating, matches_rated")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("rating_history")
          .select("rating_before, rating_after, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(1),
      ])
      if (cancelled) return
      const row = pr as { rating: number; matches_rated: number } | null
      if (row && row.matches_rated > 0) {
        setRating(Math.round(Number(row.rating)))
        const h = (hist ?? [])[0] as { rating_before: number; rating_after: number } | undefined
        if (h) setDelta(Number(h.rating_after) - Number(h.rating_before))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userId])

  if (rating == null) return null

  return (
    <span
      title={t("rating.tooltip")}
      className="inline-flex items-center gap-1 rounded-full bg-primary/5 px-2.5 py-1 text-xs font-semibold text-primary"
    >
      {t("rating.label")} {rating}
      {delta !== 0 && (
        <span className={delta > 0 ? "text-emerald-600" : "text-red-500"}>
          {delta > 0 ? "▲" : "▼"}
        </span>
      )}
    </span>
  )
}

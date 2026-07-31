"use client"

/**
 * Lazy 1v1 rivalry one-liner for MatchDetailCard (Phase G): "Vous menez
 * 4–2 cette saison". One RPC per (viewer, opponent) pair per session —
 * module-level cache, because the card re-mounts on every carousel swipe.
 * Returns null (render nothing) until there's real shared history.
 */

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useT } from "@/lib/i18n"

type H2H = { visible: boolean; matches?: number; a_wins?: number; b_wins?: number }

const cache = new Map<string, H2H | null>()

export function useHeadToHeadLine({
  enabled,
  viewerId,
  otherId,
  otherName,
}: {
  enabled: boolean
  viewerId: string | null
  otherId: string | null
  otherName: string
}): string | null {
  const t = useT()
  const [h2h, setH2h] = useState<H2H | null>(null)

  useEffect(() => {
    if (!enabled || !viewerId || !otherId) return
    const key = `${viewerId}:${otherId}`
    if (cache.has(key)) {
      setH2h(cache.get(key) ?? null)
      return
    }
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.rpc("get_head_to_head", {
        p_user_a: viewerId,
        p_user_b: otherId,
      })
      const res = (data as H2H | null) ?? null
      cache.set(key, res)
      if (!cancelled) setH2h(res)
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, viewerId, otherId])

  if (!enabled || !h2h?.visible || !h2h.matches || h2h.matches < 1) return null
  const you = Number(h2h.a_wins ?? 0)
  const them = Number(h2h.b_wins ?? 0)
  if (you === 0 && them === 0) return null
  if (you > them) return t("h2h.youlead", { you, them })
  if (them > you) return t("h2h.theylead", { name: otherName, you, them })
  return t("h2h.level", { n: you })
}

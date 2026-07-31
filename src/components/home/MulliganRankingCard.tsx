"use client"

/**
 * "Classement Mulligan" (Phase G) — the app-wide Indice Mulligan top 5 on
 * /home, plus the viewer's own rank when outside it. Reads player_ratings
 * directly (authenticated SELECT by design — an app-wide ladder is the
 * point). Renders nothing until at least one match has been rated.
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useT } from "@/lib/i18n"
import { Avatar } from "@/components/Avatar"

type Row = {
  user_id: string
  rating: number
  matches_rated: number
  profiles: { username: string | null; first_name: string | null; avatar_url: string | null } | null
}

export function MulliganRankingCard({ viewerId }: { viewerId: string }) {
  const t = useT()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [myRank, setMyRank] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from("player_ratings")
        .select("user_id, rating, matches_rated, profiles(username, first_name, avatar_url)")
        .gt("matches_rated", 0)
        .order("rating", { ascending: false })
        .limit(50)
      if (cancelled) return
      const all = ((data ?? []) as unknown as Row[]).map((r) => ({
        ...r,
        profiles: Array.isArray(r.profiles) ? r.profiles[0] : r.profiles,
      }))
      setRows(all.slice(0, 5))
      const idx = all.findIndex((r) => r.user_id === viewerId)
      setMyRank(idx >= 0 ? idx + 1 : null)
    })()
    return () => {
      cancelled = true
    }
  }, [viewerId])

  if (!rows || rows.length === 0) return null

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-primary">{t("rating.ranking.title")}</h2>
        {myRank != null && myRank > 5 && (
          <span className="text-xs text-primary/50">
            {t("rating.ranking.you", { n: myRank })}
          </span>
        )}
      </div>
      <ol className="divide-y divide-primary/5 rounded-xl border border-primary/15 bg-white">
        {rows.map((r, i) => {
          const name = r.profiles?.username || r.profiles?.first_name || "Player"
          return (
            <li key={r.user_id}>
              <Link
                href={`/players/${r.user_id}`}
                className={`flex items-center gap-3 px-4 py-2.5 hover:bg-cream/40 ${
                  r.user_id === viewerId ? "bg-cream/60" : ""
                }`}
              >
                <span className="w-5 text-center text-sm font-bold tabular-nums text-primary/50">
                  {i + 1}
                </span>
                <Avatar src={r.profiles?.avatar_url} size={28} fallback={name} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary">
                  {name}
                </span>
                <span className="text-sm font-bold tabular-nums text-primary">
                  {Math.round(Number(r.rating))}
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
      <p className="mt-1.5 text-[11px] text-primary/40">{t("rating.ranking.hint")}</p>
    </section>
  )
}

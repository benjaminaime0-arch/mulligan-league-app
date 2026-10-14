"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { useT } from "@/lib/i18n"
import { OfficialIndexEditor } from "./OfficialIndexEditor"
import {
  loadPersonalOverview,
  type PersonalOverview,
} from "@/lib/personalRounds"
export function PersonalLevelCard({ overview, editableIndex = false, showHistory = false, onIndexChange }: {
  overview?: PersonalOverview
  editableIndex?: boolean
  showHistory?: boolean
  onIndexChange?: (value: number | null) => void | Promise<void>
}) {
  const t = useT()
  const [loaded, setData] = useState<PersonalOverview | null>(null)
  const data = overview ?? loaded
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (overview) return
    let active = true
    loadPersonalOverview()
      .then((d) => {
        if (active) setData(d)
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [overview])
  return (
    <section className="mb-5 rounded-2xl border border-primary/10 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{t("personal.level.title")}</h2>
        <Link href="/rounds" className="text-sm font-semibold underline">
          {t("personal.cards")}
        </Link>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {t("personal.loadError")}
        </p>
      ) : data ? (
        <>
          <dl className="my-4 grid grid-cols-2 gap-4">
            <div><dt className="text-xs text-primary/70">{t(`personal.level.${data.level.status}`)}</dt><dd className="mt-1 text-4xl font-bold tabular-nums">{data.level.value ?? "—"}</dd><p className="mt-1 text-xs text-primary/70">{t(data.level.cards_count === 1 ? "personal.level.countOne" : "personal.level.count", { n: data.level.cards_count })}</p></div>
            <div className="border-l border-primary/10 pl-4"><dt className="text-xs text-primary/70">{t("personal.official")}</dt><dd className="mt-1 text-4xl font-bold tabular-nums">{data.official_index ?? "—"}</dd></div>
          </dl>
          <details className="border-t border-primary/10 pt-2 text-sm">
            <summary className="cursor-pointer py-2 text-primary/70">{t("personal.ui.help")}</summary>
            <p className="pb-2 text-xs leading-relaxed text-primary/70">{t("personal.level.explanation")}</p>
          </details>
          {editableIndex && <details className="text-sm"><summary className="cursor-pointer py-2 font-semibold">{t("personal.ui.editIndex")}</summary><OfficialIndexEditor value={data.official_index} onSaved={async value => {
            if (!overview) setData(await loadPersonalOverview())
            await onIndexChange?.(value)
          }} /></details>}
          {showHistory && data.history.length > 0 && <details className="text-sm"><summary className="cursor-pointer py-2">{t("personal.level.history")}</summary><ol className="mt-2 space-y-2">{data.history.map((h, i) => <li key={i} className="flex items-center justify-between gap-3 border-t border-primary/10 py-2"><time dateTime={h.calculated_at}>{new Date(h.calculated_at).toLocaleDateString()}</time><span className="font-bold">{h.level_value ?? "—"}</span><span className="text-xs text-primary/70">{t(h.cards_count === 1 ? "personal.level.countOne" : "personal.level.count", { n: h.cards_count })}</span></li>)}</ol></details>}
        </>
      ) : (
        <p className="mt-2 text-sm">{t("common.loading")}</p>
      )}
    </section>
  )
}

"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { useI18n } from "@/lib/i18n"
import { AppIcon } from "@/components/ui/AppIcon"
import { OfficialIndexEditor } from "./OfficialIndexEditor"
import {
  loadPersonalOverview,
  type PersonalOverview,
} from "@/lib/personalRounds"
export function PersonalLevelCard({ overview, compact = false, editableIndex = false, showHistory = false, onIndexChange }: {
  overview?: PersonalOverview
  compact?: boolean
  editableIndex?: boolean
  showHistory?: boolean
  onIndexChange?: (value: number | null) => void | Promise<void>
}) {
  const { t, locale } = useI18n()
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
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
  if (compact && data) return <section className="relative overflow-hidden rounded-[20px] bg-primary p-5 text-white">
    <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 -right-12 h-56 w-56 rounded-full border border-sage/20"><div className="m-5 h-44 w-44 rounded-full border border-sage/20" /></div>
    <div className="relative flex items-center justify-between gap-4">
      <div><h2 className="text-sm font-semibold text-sage">{t("personal.level.title")}</h2><p className="my-1 text-[44px] font-bold leading-none tabular-nums tracking-tight">{data.level.value == null ? "—" : number.format(data.level.value)}</p><p className="text-xs text-sage">{t(`personal.level.${data.level.status}`)} · {t(data.level.cards_count === 1 ? "personal.level.countOne" : "personal.level.count", { n: data.level.cards_count })}</p></div>
      <div className="max-w-[42%] text-right"><p className="text-xs leading-relaxed text-sage">{t("personal.official")}</p><p className="mt-1 text-xl font-bold tabular-nums">{data.official_index == null ? "—" : number.format(data.official_index)}</p><Link href="/profile" className="mt-2 inline-flex min-h-[44px] items-center gap-2 text-xs font-semibold">{t("app.progress")}<AppIcon name="arrow" className="h-4 w-4" /></Link></div>
    </div>
  </section>
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
            <div><dt className="text-xs text-primary/70">{t(`personal.level.${data.level.status}`)}</dt><dd className="mt-1 text-4xl font-bold tabular-nums">{data.level.value == null ? "—" : number.format(data.level.value)}</dd><p className="mt-1 text-xs text-primary/70">{t(data.level.cards_count === 1 ? "personal.level.countOne" : "personal.level.count", { n: data.level.cards_count })}</p></div>
            <div className="border-l border-primary/10 pl-4"><dt className="text-xs text-primary/70">{t("personal.official")}</dt><dd className="mt-1 text-4xl font-bold tabular-nums">{data.official_index == null ? "—" : number.format(data.official_index)}</dd></div>
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

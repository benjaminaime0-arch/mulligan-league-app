"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { useT } from "@/lib/i18n"
import { OfficialIndexEditor } from "./OfficialIndexEditor"
import {
  loadPersonalOverview,
  type PersonalOverview,
} from "@/lib/personalRounds"
export function PersonalLevelCard({ overview, editableIndex = false, onIndexChange }: {
  overview?: PersonalOverview
  editableIndex?: boolean
  onIndexChange?: (value: number | null) => void
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
    <section className="mb-5 rounded-xl border border-primary/15 bg-cream/40 p-4">
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
          <p className="mt-2 text-2xl font-bold">
            {data.level.value ?? "—"}{" "}
            <span className="text-xs font-normal">
              {t(`personal.level.${data.level.status}`)}
            </span>
          </p>
          <p className="mt-1 text-xs text-primary/70">
            {t("personal.level.explanation")}
          </p>
          <p className="mt-2 text-sm">
            {t("personal.official")}: {data.official_index ?? "—"}
          </p>
          {editableIndex && <OfficialIndexEditor value={data.official_index} onSaved={async value => {
            setData(await loadPersonalOverview())
            onIndexChange?.(value)
          }} />}
        </>
      ) : (
        <p className="mt-2 text-sm">{t("common.loading")}</p>
      )}
    </section>
  )
}

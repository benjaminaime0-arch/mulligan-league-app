"use client"

import { useT } from "@/lib/i18n"

export function DraftGuide() {
  const t = useT()

  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-emerald-800">{t("games.draft.title")}</h2>
      <ol className="mt-3 space-y-2 text-sm text-emerald-700">
        <li className="flex items-start gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-200 text-xs font-semibold text-emerald-800">1</span>
          <span>{t("games.draft.step.invite")}</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-200 text-xs font-semibold text-emerald-800">2</span>
          <span>{t("games.draft.step.start")}</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-200 text-xs font-semibold text-emerald-800">3</span>
          <span>{t("games.draft.step.scores")}</span>
        </li>
      </ol>
    </section>
  )
}

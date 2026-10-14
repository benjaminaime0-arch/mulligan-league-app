"use client"
import Link from "next/link"
import { useI18n } from "@/lib/i18n"
import type { PersonalRoundSummary } from "@/lib/personalRounds"

export function RoundList({ rounds }: { rounds: PersonalRoundSummary[] }) {
  const { t, locale } = useI18n()
  return <ul className="space-y-3">{rounds.map(r => <li key={r.id}>
    <Link href={`/rounds/${r.id}`} className="group flex items-center justify-between gap-3 rounded-2xl border border-primary/10 bg-white p-4 transition-colors hover:border-primary/30">
      <div className="min-w-0">
        <p className="font-bold leading-snug">{r.course_name}</p>
        <p className="mt-1 text-sm text-primary/70">{t("personal.picker.holeCount", { n: r.hole_count })} · {new Date(`${r.played_on}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" })} · {r.tee_name}</p>
        <p className={`mt-2 text-xs font-medium ${r.status === "disputed" ? "text-red-700" : "text-primary/70"}`}>{t(`personal.status.${r.status}`)}</p>
      </div>
      <span aria-hidden="true" className="shrink-0 text-xl text-primary/60 transition-transform group-hover:translate-x-1">→</span>
    </Link>
  </li>)}</ul>
}

"use client"
import Link from "next/link"
import { AppIcon } from "@/components/ui/AppIcon"
import { useI18n } from "@/lib/i18n"
import type { PersonalRoundSummary } from "@/lib/personalRounds"

export function RoundList({ rounds }: { rounds: PersonalRoundSummary[] }) {
  const { t, locale } = useI18n()
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  return <ul className="space-y-3">{rounds.map(r => {
    const hasScores = [r.gross_total, r.net_total, r.stableford_points, r.differential].some(value => value != null)
    return <li key={r.id}>
      <Link href={`/rounds/${r.id}`} className="app-surface group block p-4">
        <div className="flex items-start gap-3">
          <span className="app-icon-tile h-10 w-10"><AppIcon name={r.status === "draft" ? "edit" : "flag"} className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1"><p className="break-words font-bold leading-snug">{r.course_name}</p><p className="mt-1 text-xs leading-relaxed text-primary/70">{t("personal.picker.holeCount", { n: r.hole_count })} · {new Date(`${r.played_on}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })} · {r.tee_name}</p></div>
          {hasScores && <dl className="shrink-0 text-right"><dt className="text-[11px] text-primary/70">{t("personal.gross")}</dt><dd className="text-[32px] font-bold leading-none tabular-nums tracking-tight">{r.gross_total == null ? "—" : number.format(r.gross_total)}</dd></dl>}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2"><span className={`app-pill max-w-full ${r.status === "disputed" || r.status === "void" ? "bg-red-50 text-red-800" : r.status === "pending_player_confirmation" || r.status === "pending_validation" ? "bg-amber-50 text-amber-900" : r.status === "validated" ? "bg-sage/35" : "bg-primary/5"}`}>{r.status === "validated" && <AppIcon name="check" className="h-3 w-3 shrink-0" />}{t(`personal.status.${r.status}`)}</span><AppIcon name="arrow" className="h-4 w-4 shrink-0 text-primary/60 transition-transform group-hover:translate-x-1" /></div>
        {hasScores && <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-primary/10 pt-3">
          {([["personal.net", r.net_total], ["personal.stableford", r.stableford_points], ["personal.differential", r.differential]] as const).map(([label, value]) => <div key={label}><dt className="text-[11px] text-primary/70">{t(label)}</dt><dd className="mt-0.5 text-lg font-bold tabular-nums">{value == null ? "—" : number.format(value)}</dd></div>)}
        </dl>}
      </Link>
    </li>
  })}</ul>
}

"use client"
import { useI18n } from "@/lib/i18n"

export function ScoreSummary({ gross, net, stableford, differential }: {
  gross: number | null
  net: number | null
  stableford: number | null
  differential?: number | null
}) {
  const { t, locale } = useI18n()
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  const value = (n: number | null) => n == null ? "—" : number.format(n)
  return <dl className={`grid items-center gap-3 ${differential === undefined ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4"}`}>
    <div><dt className="text-xs opacity-75">{t("personal.gross")}</dt><dd className="mt-1 text-[40px] font-bold leading-none tabular-nums tracking-tight">{value(gross)}</dd></div>
    <div><dt className="text-xs opacity-75">{t("personal.net")}</dt><dd className="mt-1 text-2xl font-bold tabular-nums">{value(net)}</dd></div>
    <div><dt className="text-xs opacity-75">{t("personal.stableford")}</dt><dd className="mt-1 text-2xl font-bold tabular-nums">{value(stableford)}</dd></div>
    {differential !== undefined && <div><dt className="text-xs opacity-75">{t("personal.differential")}</dt><dd className="mt-1 text-2xl font-bold tabular-nums">{value(differential)}</dd></div>}
  </dl>
}

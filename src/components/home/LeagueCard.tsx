"use client"
import Link from "next/link"
import { Avatar } from "@/components/Avatar"
import { AppIcon } from "@/components/ui/AppIcon"
import { useI18n } from "@/lib/i18n"
import { leagueDays, type HubGame } from "@/lib/leaguePresentation"

export function LeagueCard({ game, preview = false }: { game: HubGame; preview?: boolean }) {
  const { t, locale } = useI18n()
  const details = game.personal
  const end = details?.end_date || game.end_date
  const start = details?.start_date || game.start_date
  const days = leagueDays(game.section === "upcoming" ? start : end, details?.timezone)
  const ranked = game.standing.position != null && (game.standing.roundsCounted ?? 0) > 0
  const members = game.members.slice(0, 4)
  const counted = game.standing.roundsCounted
  const date = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })
  return <Link href={`/games/${game.id}`} className="app-surface group block p-4 sm:p-5">
    <div className="flex items-center justify-between gap-3">
      <span className={`app-pill ${game.section === "active" ? "bg-sage/40" : "bg-primary/5"}`}><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />{t(`games.section.${game.section}`)}</span>
      <AppIcon name="arrow" className="h-4 w-4 shrink-0 text-primary/60 transition-transform group-hover:translate-x-1" />
    </div>
    <h3 className="mt-3 break-words text-lg font-bold leading-tight">{game.name}</h3>
    <p className="mt-1 text-xs leading-relaxed text-primary/70">{game.course_name || t("games.card.nocourse")}{details && <> · {t("personal.picker.holeCount", { n: details.hole_count })} · {details.tee_name} · {t(`personal.format.${details.format}`)}</>}</p>
    <div className="mt-4 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="mb-1.5 flex items-center" aria-hidden="true">{members.map((m, i) => <span key={m.user_id} className={`rounded-full border-2 border-white ${i ? "-ml-2" : ""}`}><Avatar src={m.profiles?.avatar_url} size={30} alt="" fallback={m.profiles?.username || m.profiles?.first_name || "P"} /></span>)}{game.memberCount > members.length && <span className="-ml-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-bone text-[10px] font-bold">+{game.memberCount - members.length}</span>}</div>
        <p className="text-xs text-primary/70">{t(game.memberCount === 1 ? "app.playerOne" : "app.players", { n: game.memberCount })}</p>
      </div>
      <div className="text-right">
        <p className="text-xs text-primary/70">{t("home.standings")}</p>
        <p className="mt-0.5 text-3xl font-bold tabular-nums tracking-tight">{ranked ? <>{game.standing.position}<span className="ml-1 text-sm font-medium text-primary/60">/ {game.memberCount}</span></> : <span className="text-sm">{t("app.unranked")}</span>}</p>
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-primary/10 pt-3 text-xs text-primary/70">
      <span className="inline-flex items-center gap-1.5"><AppIcon name="clock" className="h-3.5 w-3.5" />{game.section === "completed" ? t(details?.lifecycle_state === "closed_provisional" ? "personal.closure.closed_provisional" : "games.card.final")
        : days != null && days >= 0 ? t(game.section === "upcoming" ? "app.startsIn" : days === 0 ? "app.lastDay" : "app.daysLeft", { n: game.section === "upcoming" ? days : days + 1 })
        : end ? date(end) : "—"}</span>
      {counted != null && <span>{t(counted === 1 ? "app.cardCounted" : "app.cardsCounted", { n: counted })}</span>}
    </div>
    {preview && !!game.standing.leaders?.length && <ol aria-label={t("games.standings.title")} className="mt-3 space-y-2 border-t border-primary/10 pt-3">{game.standing.leaders.map(row => <li key={row.userId} className="flex items-center gap-2 text-xs"><span className="w-4 font-bold tabular-nums">{row.position}</span><span className="min-w-0 flex-1 truncate">{row.name}</span><span className="font-bold tabular-nums">{row.total}</span></li>)}</ol>}
  </Link>
}

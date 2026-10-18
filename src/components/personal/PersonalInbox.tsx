"use client"
import Link from "next/link"
import { useI18n } from "@/lib/i18n"
import { AppIcon } from "@/components/ui/AppIcon"
import type { PersonalInboxItem } from "@/lib/personalRounds"
export function PersonalInbox({ items }: { items: PersonalInboxItem[] }) {
  const { t, locale } = useI18n()
  if (!items.length) return <p className="my-4 text-sm text-primary/70">{t("personal.inbox.empty")}</p>
  return <section className="my-5 rounded-2xl border border-primary/15 bg-sage/15 p-4">
    <h2 className="font-bold">{t("personal.lifecycle.inbox")}</h2>
    <ul className="mt-3 space-y-2">{items.map(item => <li key={item.id}>
      <Link className="app-surface block p-4" href={`/rounds/${item.id}`}>
        <span className="block text-sm font-bold">{item.status === "pending_player_confirmation" ? t("correction.inboxTitle") : item.player_name}</span>
        <span className="mt-1 block text-xs leading-relaxed text-primary/70">{item.course_name} · {t("personal.picker.holeCount", { n: item.hole_count })} · {new Date(`${item.played_on}T12:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" })}</span>
        {item.status === "pending_validation" && item.auto_validation_at && <span className="mt-2 block text-xs text-primary/60">{t("personal.inbox.due", { date: new Date(item.auto_validation_at).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) })}</span>}
        <span className="mt-3 inline-flex min-h-[44px] items-center gap-2 text-sm font-bold">{t(item.status === "pending_validation" ? "validation.open" : "personal.lifecycle.reviewCorrection")}<AppIcon name="arrow" className="h-4 w-4" /></span>
      </Link>
    </li>)}</ul>
  </section>
}

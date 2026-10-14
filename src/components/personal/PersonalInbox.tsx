"use client"
import Link from "next/link"
import { useT } from "@/lib/i18n"
import type { PersonalInboxItem } from "@/lib/personalRounds"
export function PersonalInbox({ items }: { items: PersonalInboxItem[] }) {
  const t = useT()
  if (!items.length) return <p className="my-4 text-sm text-primary/70">{t("personal.inbox.empty")}</p>
  return <section className="my-5 rounded-xl border border-amber-400 p-4">
    <h2 className="font-semibold">{t("personal.lifecycle.inbox")}</h2>
    <ul className="mt-3 space-y-2">{items.map(item => <li key={item.id}>
      <Link className="block min-h-[44px] py-2 text-sm underline" href={`/rounds/${item.id}`}>
        {item.course_name} · {item.hole_count} · {item.played_on}<br />
        {item.player_name} · {t(`personal.status.${item.status}`)}
      </Link>
      {item.status === "pending_validation" && item.auto_validation_at && <p className="text-xs text-primary/70">{t("personal.inbox.due", { date: new Date(item.auto_validation_at).toLocaleString() })}</p>}
    </li>)}</ul>
  </section>
}

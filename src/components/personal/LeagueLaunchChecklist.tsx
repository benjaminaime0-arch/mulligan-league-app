"use client"

import Link from "next/link"
import { AppIcon } from "@/components/ui/AppIcon"
import { useT } from "@/lib/i18n"
import { leagueActivation } from "@/lib/leagueActivation"

export function LeagueLaunchChecklist({ memberCount, countedCards, invitePrepared, cardHref, onInvite }: {
  memberCount: number; countedCards: number; invitePrepared: boolean; cardHref: string; onInvite: () => void
}) {
  const t = useT()
  const state = leagueActivation(memberCount, countedCards, invitePrepared)
  if (state.completed === 3) return <p className="app-surface mb-4 flex items-center gap-2 px-4 py-3 text-sm font-semibold"><AppIcon name="check" className="h-4 w-4 shrink-0" />{t("activation.launched")}</p>
  const steps = [
    { key: "created", done: true },
    { key: "invite", done: state.invited },
    { key: "card", done: state.firstCard },
  ]
  return <section className="app-surface mb-4 p-4" aria-labelledby="league-launch-title">
    <div className="flex items-center justify-between gap-3"><h2 id="league-launch-title" className="text-sm font-bold">{t("activation.title")}</h2><span className="text-xs font-semibold text-primary/60">{state.completed}/3</span></div>
    <ol className="mt-3 grid gap-2 sm:grid-cols-3">{steps.map((step, i) => <li key={step.key} className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold ${step.done ? "bg-sage/25" : "bg-primary/5 text-primary/70"}`}>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary/15" aria-label={step.done ? t("activation.done") : t("activation.todo")}>{step.done ? <AppIcon name="check" className="h-3.5 w-3.5" /> : i + 1}</span><span>{t(`activation.step.${step.key}`)}</span>
    </li>)}</ol>
    {!state.invited ? <><p className="mt-3 text-xs leading-relaxed text-primary/65">{t("activation.inviteHint")}</p><a href="#league-invitation" onClick={onInvite} className="mt-2 inline-flex min-h-[44px] items-center gap-2 text-sm font-bold">{t("detail.invite")}<AppIcon name="arrow" className="h-4 w-4" /></a></>
      : <><p className="mt-3 text-xs leading-relaxed text-primary/65">{t("activation.cardHint")}</p><Link href={cardHref} className="mt-2 inline-flex min-h-[44px] items-center gap-2 text-sm font-bold">{t("personal.addOrSubmit")}<AppIcon name="arrow" className="h-4 w-4" /></Link></>}
  </section>
}

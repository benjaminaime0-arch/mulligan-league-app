"use client"
import { useRef, useState } from "react"
import { ConfirmModal } from "@/components/ConfirmModal"
import { useI18n } from "@/lib/i18n"
import { copyLeagueReminder, reminderWhatsAppUrl } from "@/lib/leagueReminders"

export function LeagueReminderDialog({ name, message, kind, onClose }: { name: string; message: string; kind?: "join" | "card"; onClose: () => void }) {
  const { t } = useI18n()
  const [feedback, setFeedback] = useState<"copied" | "failed" | null>(null)
  const [busy, setBusy] = useState(false)
  const flight = useRef(false)
  return <ConfirmModal open title={t("reminder.title", { name })} message={t("reminder.hint")} confirmLabel={t("reminder.copy")} cancelLabel={t("reminder.close")} loading={busy} onCancel={onClose} onConfirm={() => {
    if (flight.current) return
    flight.current = true; setBusy(true); setFeedback(null)
    void copyLeagueReminder(message, navigator.clipboard).then(setFeedback).finally(() => { flight.current = false; setBusy(false) })
  }}>
    <div className="my-4 rounded-xl bg-sage/20 p-3" aria-label={t("reminder.preview")}><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{kind ? message.slice(0, message.lastIndexOf("\n")) : message}</p>{kind && <p className="mt-3 text-xs font-semibold text-primary/70">{t(`reminder.link.${kind}`)} · Mulligan</p>}</div>
    <button type="button" className="min-h-[44px] w-full rounded-xl border border-primary/20 px-3 text-sm font-semibold" disabled={busy} onClick={() => window.open(reminderWhatsAppUrl(message), "_blank", "noopener,noreferrer")}>{t("reminder.whatsapp")}</button>
    {feedback && <p role={feedback === "failed" ? "alert" : "status"} className="mt-3 text-xs leading-relaxed text-primary/70">{t(`reminder.${feedback}`)}</p>}
  </ConfirmModal>
}

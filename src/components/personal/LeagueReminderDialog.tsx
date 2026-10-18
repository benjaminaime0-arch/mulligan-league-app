"use client"
import { useRef, useState } from "react"
import { ConfirmModal } from "@/components/ConfirmModal"
import { useI18n } from "@/lib/i18n"
import { copyLeagueReminder, reminderWhatsAppUrl } from "@/lib/leagueReminders"

export function LeagueReminderDialog({ name, message, onClose }: { name: string; message: string; onClose: () => void }) {
  const { t } = useI18n()
  const [feedback, setFeedback] = useState<"copied" | "failed" | null>(null)
  const [busy, setBusy] = useState(false)
  const flight = useRef(false)
  return <ConfirmModal open title={t("reminder.title", { name })} message={t("reminder.hint")} confirmLabel={t("reminder.copy")} cancelLabel={t("reminder.close")} loading={busy} onCancel={onClose} onConfirm={() => {
    if (flight.current) return
    flight.current = true; setBusy(true); setFeedback(null)
    void copyLeagueReminder(message, navigator.clipboard).then(setFeedback).finally(() => { flight.current = false; setBusy(false) })
  }}>
    <p className="my-4 whitespace-pre-wrap break-words rounded-xl bg-sage/20 p-3 text-sm leading-relaxed" aria-label={t("reminder.preview")}>{message}</p>
    <button type="button" className="min-h-[44px] w-full rounded-xl border border-primary/20 px-3 text-sm font-semibold" disabled={busy} onClick={() => window.open(reminderWhatsAppUrl(message), "_blank", "noopener,noreferrer")}>{t("reminder.whatsapp")}</button>
    {feedback && <p role={feedback === "failed" ? "alert" : "status"} className="mt-3 text-xs leading-relaxed text-primary/70">{t(`reminder.${feedback}`)}</p>}
  </ConfirmModal>
}

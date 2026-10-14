"use client"
import { Suspense } from "react"
import { CalendarLeagueCreator } from "@/components/personal/CalendarLeagueCreator"
import { useT } from "@/lib/i18n"
export default function CreateLeaguePage() {
  const t = useT()
  return <Suspense fallback={<main className="p-6">{t("common.loading")}</main>}><CalendarLeagueCreator /></Suspense>
}

"use client"
import { useEffect, useState } from "react"
import { useAuth } from "@/hooks/useAuth"
import { useT } from "@/lib/i18n"
import { loadPersonalCard, type PersonalCard } from "@/lib/personalRounds"
import { PersonalRoundEditor } from "@/components/personal/PersonalRoundEditor"
export default function PersonalRoundPage({
  params,
}: {
  params: { id: string }
}) {
  const { user, loading } = useAuth()
  const t = useT()
  const [data, setData] = useState<PersonalCard | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!user) return
    let active = true
    loadPersonalCard(params.id)
      .then((d) => {
        if (active) setData(d)
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [user, params.id])
  if (error)
    return (
      <main role="alert" className="p-6 text-red-700">
        {error}
      </main>
    )
  if (loading || !user || !data)
    return <main className="p-6">{t("common.loading")}</main>
  return (
    <PersonalRoundEditor
      data={data}
      onReload={async () => setData(await loadPersonalCard(params.id))}
    />
  )
}

"use client"
import { useEffect, useState } from "react"
import { useT } from "@/lib/i18n"
import { supabase } from "@/lib/supabase"
import { parseOfficialIndex } from "@/lib/officialIndex"
import { personalButton, personalInput, personalResult } from "@/lib/personalRounds"
export function OfficialIndexEditor({ value, onSaved }: { value: number | null; onSaved: (value: number | null) => Promise<void> }) {
  const t = useT()
  const [input, setInput] = useState(value == null ? "" : String(value))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setInput(value == null ? "" : String(value)) }, [value])
  return <form className="mt-4 space-y-2" onSubmit={async e => {
    e.preventDefault(); setError(null); setSaved(false)
    let index: number | null
    try { index = parseOfficialIndex(input) } catch { setError(t("profile.handicap.range")); return }
    setBusy(true)
    try {
      personalResult(await supabase.rpc("declare_personal_index", { p_index: index }))
      await onSaved(index); setSaved(true)
    } catch (e) { setError(e instanceof Error ? e.message : t("common.error.generic")) }
    finally { setBusy(false) }
  }}>
    <label className="block text-sm">{t("personal.official")}<input aria-label={t("personal.official")} type="text" inputMode="decimal" className={personalInput} value={input} disabled={busy} onChange={e => { setInput(e.target.value); setSaved(false) }} placeholder="11,4" /></label>
    <p className="text-xs text-primary/70">{t("personal.indexHelp")}</p>
    <button className={personalButton} disabled={busy}>{t("personal.updateIndex")}</button>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {saved && <p role="status" className="text-sm">{t("personal.indexSaved")}</p>}
  </form>
}

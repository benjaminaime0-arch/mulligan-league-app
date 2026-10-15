"use client"

import { useId, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useT } from "@/lib/i18n"

export function LeaguePlayerInvite({ gameId }: { gameId: string }) {
  const t = useT()
  const id = useId()
  const [username, setUsername] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<"sent" | "duplicate" | "error" | null>(null)
  return <form className="mt-4 w-full space-y-2 border-t border-primary/10 pt-4" onSubmit={async event => {
    event.preventDefault()
    if (busy || !username.trim()) return
    setBusy(true); setMessage(null)
    try {
      const { data, error } = await supabase.rpc("invite_league_player", { p_game: gameId, p_username: username.trim() })
      if (error) throw error
      setMessage(data && typeof data === "object" && !Array.isArray(data) && data.duplicate ? "duplicate" : "sent")
    } catch { setMessage("error") }
    finally { setBusy(false) }
  }}>
    <label htmlFor={id} className="block text-xs font-semibold">{t("invite.player.label")}</label>
    <div className="flex flex-wrap gap-2">
      <input id={id} value={username} onChange={event => { setUsername(event.target.value); setMessage(null) }} required maxLength={50} autoComplete="off" autoCapitalize="none" spellCheck={false} className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-primary/20 bg-white px-3 text-sm" placeholder={t("invite.player.placeholder")} />
      <button type="submit" disabled={busy || !username.trim()} className="min-h-[44px] rounded-xl bg-primary px-4 text-xs font-semibold text-white disabled:opacity-40">{t(busy ? "invite.player.sending" : "invite.player.send")}</button>
    </div>
    {message && <p role={message === "error" ? "alert" : "status"} className={`text-xs ${message === "error" ? "text-red-700" : "text-primary/70"}`}>{t(`invite.player.${message}`)}</p>}
  </form>
}

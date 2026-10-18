"use client"
import { useEffect, useRef, useState } from "react"
import { useI18n } from "@/lib/i18n"
import { supabase } from "@/lib/supabase"
import { leagueHasEnded, inviteReturningFriends } from "@/lib/nextLeague"
import { personalResult, personalButton, type PersonalLeague } from "@/lib/personalRounds"

type Friend = { id: string; name: string; username: string | null }
export function PersonalLeagueFriends({ sourceId, gameId, userId, memberIds, invitedIds = [], onPrepared }: {
  sourceId: string; gameId: string; userId: string; memberIds: string[]; invitedIds?: string[]; onPrepared: () => void
}) {
  const { t } = useI18n()
  const [friends, setFriends] = useState<Friend[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [sent, setSent] = useState<string[]>([])
  const [failed, setFailed] = useState<string[]>([])
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(false)
  const sending = useRef(false)
  useEffect(() => {
    let active = true
    setLoading(true); setError(false); setSent([]); setFailed([])
    void (async () => {
      const source = personalResult<PersonalLeague | null>(await supabase.rpc("get_personal_league", { p_game: sourceId }))
      if (!source || !leagueHasEnded(source) || sourceId === gameId) throw new Error("Unavailable source")
      const ids = source.board.filter(row => row.user_id !== userId).map(row => row.user_id)
      const profiles = ids.length ? await supabase.from("profiles").select("id, username").in("id", ids) : { data: [], error: null }
      if (profiles.error) throw profiles.error
      if (!active) return
      const list = source.board.filter(row => row.user_id !== userId).map(row => ({ id: row.user_id, name: row.player_name, username: profiles.data?.find(p => p.id === row.user_id)?.username ?? null }))
      setFriends(list); setSelected(list.filter(f => !!f.username).map(f => f.id))
    })().catch(() => { if (active) setError(true) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [sourceId, gameId, userId])
  const candidates = friends.filter(friend => !memberIds.includes(friend.id) && !sent.includes(friend.id) && !invitedIds.includes(friend.id))
  const awaiting = Array.from(new Set([...sent, ...invitedIds])).filter(id => !memberIds.includes(id))
  const unresolved = failed.filter(id => !memberIds.includes(id))
  const allJoined = friends.length > 0 && friends.every(friend => memberIds.includes(friend.id))
  const selectionCount = candidates.filter(f => f.username && selected.includes(f.id)).length
  async function invite() {
    if (sending.current || loading) return
    const recipients = candidates.filter(f => selected.includes(f.id) && !!f.username)
    if (!recipients.length) return
    sending.current = true; setBusy(true); setFailed([])
    try {
      const { successes, failures } = await inviteReturningFriends(recipients.map(friend => ({ id: friend.id, username: friend.username! })), async username => personalResult<{sent?: boolean; duplicate?: boolean}>(await supabase.rpc("invite_league_player", { p_game: gameId, p_username: username })))
      setSent(previous => Array.from(new Set([...previous, ...successes]))); setFailed(failures)
      if (successes.length) onPrepared()
    } finally { sending.current = false; setBusy(false) }
  }
  return <section className="mb-4 rounded-xl bg-sage/20 p-3" aria-label={t("season.friends")}>
    <h3 className="text-sm font-bold">{t("season.friends")}</h3>
    <p className="mt-1 text-xs leading-relaxed text-primary/70">{t("season.friendsHint")}</p>
    {loading ? <p role="status" className="mt-2 text-xs">{t("common.loading")}</p> : error ? <p role="alert" className="mt-2 text-xs text-red-700">{t("season.friendsError")}</p> : <>
      <ul className="mt-2">{candidates.map(friend => <li key={friend.id}><label className="flex min-h-[44px] items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(friend.id)} disabled={busy || !friend.username} onChange={e => setSelected(prev => e.target.checked ? [...prev, friend.id] : prev.filter(id => id !== friend.id))} /><span className="min-w-0 break-words">{friend.name}{!friend.username && <span className="block text-xs text-primary/60">{t("season.shareInstead")}</span>}</span></label></li>)}</ul>
      {!!awaiting.length && <p role="status" className="my-2 text-xs font-semibold">{t(awaiting.length === 1 ? "season.sentOne" : "season.sent", { n: awaiting.length })}</p>}
      {!!unresolved.length && <p role="alert" className="my-2 text-xs text-red-700">{t("season.failed", { names: friends.filter(f => unresolved.includes(f.id)).map(f => f.name).join(", ") })}</p>}
      {!friends.length && <p className="mt-2 text-xs">{t("season.noFriends")}</p>}
      {!!candidates.length && <button type="button" className={`${personalButton} mt-2 w-full`} disabled={busy || !candidates.some(f => f.username && selected.includes(f.id))} onClick={() => void invite()}>{t(busy ? "invite.player.sending" : selectionCount === 1 ? "season.inviteOne" : "season.inviteSelected", { n: selectionCount })}</button>}
      {allJoined && <p className="mt-2 text-xs">{t("season.alreadyJoined")}</p>}
    </>}
  </section>
}

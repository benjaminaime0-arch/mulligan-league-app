import { CardDraft, type DraftStatus } from "@/lib/cardDraft"
import { cachedPersonalCard, cachePersonalCard, draftStorageWithEvents } from "@/lib/cardOffline"
import { holesAsJson, loadPersonalCard, personalResult, type PersonalCard } from "@/lib/personalRounds"
import { supabase } from "@/lib/supabase"
let currentOwner: string | null = null
export function setCardDraftOwner(id: string | null) { currentOwner = id }
const engines = new Map<string, CardDraft>()
export function cardDraftEngine(card: PersonalCard): CardDraft {
  const key = `${card.round.user_id}:${card.round.id}`
  const existing = engines.get(key)
  if (existing) {
    if (!existing.snapshot().dirty && card.round.draft_version >= existing.snapshot().version) existing.acceptServer(card)
    return existing
  }
  const engine = new CardDraft(card, draftStorageWithEvents(), {
    online: () => navigator.onLine,
    active: () => currentOwner === card.round.user_id,
    load: async () => { const fresh = await loadPersonalCard(card.round.id); cachePersonalCard(fresh); return fresh },
    save: async (holes, version) => {
      const res = personalResult<{ draft_version: number }>(await supabase.rpc("save_personal_card", { p_round: card.round.id, p_holes: holesAsJson(holes), p_expected_version: version }))
      // Update the offline snapshot so an acknowledged save survives a cold start.
      const snapshot = cachedPersonalCard(card.round.user_id, card.round.id)
      if (snapshot) cachePersonalCard({ ...snapshot, holes, round: { ...snapshot.round, draft_version: res.draft_version } })
      window.dispatchEvent(new CustomEvent("mulligan:card-synced", { detail: { id: card.round.id } }))
      return res.draft_version
    },
  })
  engines.set(key, engine)
  return engine
}
export function stopCardDrafts(owner: string) {
  if (currentOwner === owner) currentOwner = null
  for (const [key, engine] of Array.from(engines.entries())) if (key.startsWith(`${owner}:`)) { engine.stop(); engines.delete(key) }
}
export const automaticDraftStatuses: DraftStatus[] = ["pending", "offline", "saved"]

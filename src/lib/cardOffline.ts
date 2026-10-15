import type { PersonalCard } from "@/lib/personalRounds"
import { CARD_CACHE_PREFIX, activeOwnerKey, draftKey, readDraft, sameHoles, type DraftStorage } from "@/lib/cardDraft"

export function cardStorage(): Storage { return window.localStorage }
export function offlineOwner(): string | null {
  try { return cardStorage().getItem(activeOwnerKey) } catch { return null }
}
export function setOfflineOwner(id: string | null) {
  try { if (id) cardStorage().setItem(activeOwnerKey, id); else cardStorage().removeItem(activeOwnerKey) } catch { /* offline access stays unavailable */ }
}
const cardKey = (owner: string, id: string) => `${CARD_CACHE_PREFIX}card:${owner}:${id}`
const readyPaths = new Set<string>()
export function markCardShellReady(path: string) { readyPaths.add(path) }
export function isCardShellReady(path: string): boolean { return readyPaths.has(path) }
export function cachePersonalCard(card: PersonalCard): boolean {
  if (!card.is_owner || card.round.user_id !== offlineOwner()) return false
  try {
    const previous = cachedPersonalCard(card.round.user_id, card.round.id)
    // An earlier request may arrive after a more recent save/validation.
    if (previous && (previous.round.draft_version > card.round.draft_version ||
      (["validated", "disputed", "expired"].includes(previous.round.status) && previous.round.status !== card.round.status))) return true
    // No tokens, contacts, other players' cards, rankings or league data.
    const cached = { server_now: card.server_now, is_owner: true, round: card.round, tee: card.tee, reference_holes: card.reference_holes, holes: card.holes,
      revision: card.revision, level: card.level, validators: [], events: [], leagues: [], revisions: card.revision ? [card.revision] : [] }
    cardStorage().setItem(cardKey(card.round.user_id, card.round.id), JSON.stringify({ ...cached, offline_cached_at: Date.now() }))
    window.dispatchEvent(new Event("mulligan:cards"))
    return true
  } catch { return false }
}
export function cachedPersonalCard(owner: string, id: string): PersonalCard | null {
  if (owner !== offlineOwner()) return null
  try {
    const card = JSON.parse(cardStorage().getItem(cardKey(owner, id)) || "null") as (PersonalCard & { offline_cached_at: number }) | null
    if (!card?.is_owner || card.round.user_id !== owner || card.round.id !== id || ![9, 18].includes(card.tee.hole_count) || card.reference_holes.length !== card.tee.hole_count) return null
    return { ...card, server_now: new Date(new Date(card.server_now).getTime() + Math.max(0, Date.now() - card.offline_cached_at)).toISOString() }
  } catch { return null }
}
export function cachedPersonalCards(owner: string): PersonalCard[] {
  try {
    return Object.keys(cardStorage()).filter(key => key.startsWith(cardKey(owner, ""))).map(key => cachedPersonalCard(owner, key.slice(cardKey(owner, "").length))).filter((c): c is PersonalCard => !!c)
  } catch { return [] }
}
export function pendingCards(owner: string): PersonalCard[] {
  return cachedPersonalCards(owner).filter(card => {
    const entry = readDraft(cardStorage(), owner, card.round.id, card.tee.hole_count, true) ?? readDraft(cardStorage(), owner, card.round.id, card.tee.hole_count)
    return !!entry && (!sameHoles(entry.base, entry.holes) || !!entry.sent)
  })
}
export function clearCardOfflineData(owner: string) {
  try {
    const storage = cardStorage()
    for (const key of Object.keys(storage)) if (key.startsWith(CARD_CACHE_PREFIX) && key.includes(`:${owner}:`)) storage.removeItem(key)
    if (offlineOwner() === owner) setOfflineOwner(null)
    window.dispatchEvent(new Event("mulligan:cards"))
  } catch { /* local-storage access may be disabled */ }
}
export function draftStorageWithEvents(): DraftStorage {
  return {
    getItem: key => cardStorage().getItem(key),
    setItem: (key, value) => { cardStorage().setItem(key, value); window.dispatchEvent(new Event("mulligan:cards")) },
    removeItem: key => { cardStorage().removeItem(key); window.dispatchEvent(new Event("mulligan:cards")) },
  }
}
export function hasLocalChanges(owner: string, id: string, count: number): boolean {
  const entry = readDraft(cardStorage(), owner, id, count, true) ?? readDraft(cardStorage(), owner, id, count)
  return !!entry && (!sameHoles(entry.base, entry.holes) || !!entry.sent)
}
export function isCardNetworkError(error: unknown): boolean {
  return !navigator.onLine || /fetch|network|load failed/i.test(error instanceof Error ? error.message : String(error))
}
export function downloadLocalScores(owner: string, id: string) {
  const key = draftKey(owner, id)
  const entry = cardStorage().getItem(key.replace(":draft:", ":recovery:")) ?? cardStorage().getItem(key)
  if (!entry) return
  const url = URL.createObjectURL(new Blob([entry], { type: "application/json" }))
  const a = document.createElement("a"); a.href = url; a.download = `mulligan-${id}.json`; a.click(); URL.revokeObjectURL(url)
}

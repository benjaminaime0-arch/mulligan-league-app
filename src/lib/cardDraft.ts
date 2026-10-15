import type { PersonalCard, PersonalHole } from "./personalRounds"

export type DraftStatus = "saved" | "pending" | "saving" | "offline" | "conflict" | "blocked" | "session" | "invalid" | "storageError"
export type DraftEntry = {
  schema: 1; owner: string; round: string; version: number; base: PersonalHole[]; holes: PersonalHole[];
  stamp: string; sent?: { version: number; holes: PersonalHole[] }
}
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">
export type DraftState = { holes: PersonalHole[]; version: number; status: DraftStatus; dirty: boolean; conflict: PersonalHole[] | null }
export const CARD_CACHE_PREFIX = "mulligan.cards.v1:"
export const activeOwnerKey = `${CARD_CACHE_PREFIX}owner`
export const draftKey = (owner: string, round: string) => `${CARD_CACHE_PREFIX}draft:${owner}:${round}`
const recoveryKey = (owner: string, round: string) => `${CARD_CACHE_PREFIX}recovery:${owner}:${round}`
const copy = (holes: PersonalHole[]) => holes.map(h => ({ ...h }))
export const sameHoles = (a: PersonalHole[], b: PersonalHole[]) => a.length === b.length && a.every((h, i) => h.hole_number === b[i].hole_number && h.completion === b[i].completion && h.strokes === b[i].strokes)
export function draftHoles(card: PersonalCard): PersonalHole[] {
  return card.reference_holes.map(ref => ({ ...(card.holes.find(h => h.hole_number === ref.hole_number) ?? { hole_number: ref.hole_number, completion: "not_played", strokes: null }) }))
}
export function validDraftHoles(holes: PersonalHole[]): boolean {
  return holes.every(h => h.completion === "completed" ? Number.isInteger(h.strokes) && h.strokes! >= 1 && h.strokes! <= 30 : h.strokes === null)
}
export function readDraft(storage: DraftStorage, owner: string, round: string, count: number, recovery = false): DraftEntry | null {
  try {
    const e = JSON.parse(storage.getItem(recovery ? recoveryKey(owner, round) : draftKey(owner, round)) || "null") as DraftEntry | null
    const shape = (holes: PersonalHole[]) => Array.isArray(holes) && holes.length === count && holes.every((h, i) => h.hole_number === i + 1 && ["completed", "not_played", "picked_up"].includes(h.completion) && (h.strokes === null || Number.isFinite(h.strokes)))
    return e?.schema === 1 && e.owner === owner && e.round === round && Number.isInteger(e.version) && e.version >= 0 && typeof e.stamp === "string" && shape(e.base) && shape(e.holes) && (!e.sent || (Number.isInteger(e.sent.version) && shape(e.sent.holes))) ? e : null
  } catch { return null }
}

/** One serialized writer per editor. CAS on the server is the final authority.
 * Persist the in-flight snapshot before sending: a lost response can be reconciled
 * after a reload without resubmitting or discarding edits made during the request. */
export class CardDraft {
  entry: DraftEntry
  state: DraftState
  private running: Promise<number> | null = null
  private other: PersonalCard | null = null
  private stopped = false
  private stamp: string | null
  private listeners = new Set<() => void>()
  constructor(private card: PersonalCard, private storage: DraftStorage, private transport: {
    load: () => Promise<PersonalCard>; save: (holes: PersonalHole[], version: number) => Promise<number>;
    online: () => boolean; active: () => boolean;
  }) {
    const base = draftHoles(card)
    const saved = readDraft(storage, card.round.user_id, card.round.id, base.length)
    const recovery = readDraft(storage, card.round.user_id, card.round.id, base.length, true)
    this.stamp = saved?.stamp ?? null
    this.entry = recovery ?? saved ?? { schema: 1, owner: card.round.user_id, round: card.round.id, version: card.round.draft_version, base, holes: copy(base), stamp: "initial" }
    this.state = { holes: copy(this.entry.holes), version: this.entry.version, status: "saved", dirty: !sameHoles(this.entry.base, this.entry.holes) || !!this.entry.sent, conflict: null }
    if (recovery && saved && !sameHoles(recovery.holes, saved.holes)) this.setConflict(saved.holes)
    else this.reconcile(card)
    this.emit()
  }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  snapshot = () => this.state
  private emit() { this.state = { ...this.state, holes: copy(this.entry.holes), version: this.entry.version, dirty: !sameHoles(this.entry.base, this.entry.holes) || !!this.entry.sent }; this.listeners.forEach(fn => fn()) }
  private setConflict(holes: PersonalHole[]) { this.state.status = "conflict"; this.state.conflict = copy(holes) }
  private persist(force = false): boolean {
    if (!this.transport.active() || this.stopped) return false
    try {
      const latest = readDraft(this.storage, this.entry.owner, this.entry.round, this.entry.holes.length)
      if (!force && latest && latest.stamp !== this.stamp && !sameHoles(latest.holes, this.entry.holes)) {
        this.storage.setItem(recoveryKey(this.entry.owner, this.entry.round), JSON.stringify(this.entry))
        this.setConflict(latest.holes)
        return false
      }
      this.entry.stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      this.storage.setItem(draftKey(this.entry.owner, this.entry.round), JSON.stringify(this.entry))
      this.stamp = this.entry.stamp
      return true
    } catch { this.state.status = "storageError"; return false }
  }
  private reconcile(card: PersonalCard) {
    this.card = card
    this.other = null
    this.state.conflict = null
    if (!card.is_owner || card.round.status !== "draft") { this.state.status = "blocked"; this.other = card; return }
    const server = draftHoles(card)
    if (card.round.draft_version !== this.entry.version) {
      if (sameHoles(this.entry.base, this.entry.holes) && !this.entry.sent) {
        this.entry.holes = copy(server)
        this.entry.base = copy(server)
        this.entry.version = card.round.draft_version
      }
      const acknowledged = sameHoles(server, this.entry.holes) || (this.entry.sent && sameHoles(server, this.entry.sent.holes))
      if (!acknowledged) { this.other = card; this.setConflict(server); return }
      this.entry.base = server
      this.entry.version = card.round.draft_version
      delete this.entry.sent
    }
    this.state.status = sameHoles(this.entry.base, this.entry.holes) ? "saved" : this.transport.online() ? "pending" : "offline"
    if (this.state.status === "saved") delete this.entry.sent
  }
  update(holes: PersonalHole[]) {
    if (this.stopped || this.state.status === "conflict" || this.state.status === "blocked" || !this.card.is_owner || this.card.round.status !== "draft") return
    this.entry.holes = copy(holes)
    this.state.status = !validDraftHoles(holes) ? "invalid" : sameHoles(this.entry.base, holes) && !this.entry.sent ? "saved" : this.transport.online() ? "pending" : "offline"
    this.persist()
    this.emit()
  }
  /** Reloading an authoritative card must never erase a pending local edit. */
  acceptServer(card: PersonalCard) { this.reconcile(card); this.persist(); this.emit() }
  choose(keepMine: boolean) {
    if (this.state.status !== "conflict") return
    if (this.other) {
      this.entry.version = this.other.round.draft_version
      this.entry.base = draftHoles(this.other)
    } else {
      const latest = readDraft(this.storage, this.entry.owner, this.entry.round, this.entry.holes.length)
      if (latest) { this.entry.version = latest.version; this.entry.base = copy(latest.base) }
    }
    if (!keepMine && this.state.conflict) this.entry.holes = copy(this.state.conflict)
    delete this.entry.sent
    this.state.conflict = null
    this.other = null
    this.state.status = sameHoles(this.entry.base, this.entry.holes) ? "saved" : "pending"
    try { this.storage.removeItem(recoveryKey(this.entry.owner, this.entry.round)) } catch { /* persist reports unavailable storage */ }
    this.persist(true)
    this.emit()
  }
  observeStorage() {
    const latest = readDraft(this.storage, this.entry.owner, this.entry.round, this.entry.holes.length)
    if (latest && latest.stamp !== this.stamp) {
      if (!this.state.dirty && !this.running) { this.entry = latest; this.stamp = latest.stamp; this.state.status = sameHoles(latest.base, latest.holes) && !latest.sent ? "saved" : "pending" }
      else if (!sameHoles(latest.holes, this.entry.holes)) { this.persist(); }
      this.emit()
    }
  }
  flush(): Promise<number> {
    if (this.running) return this.running
    this.running = this.sync().finally(() => { this.running = null })
    return this.running
  }
  private async sync(): Promise<number> {
    if (this.stopped || !this.transport.active()) throw new Error("session")
    if (["conflict", "blocked"].includes(this.state.status)) throw new Error(this.state.status)
    if (this.state.status === "storageError" && !this.persist()) { this.emit(); throw new Error("storageError") }
    if (!validDraftHoles(this.entry.holes)) { this.state.status = "invalid"; this.emit(); throw new Error("invalid") }
    if (!this.transport.online()) { this.state.status = "offline"; this.emit(); throw new Error("offline") }
    try {
      // Check for status/version changes and ambiguous acknowledgements before retrying.
      this.reconcile(await this.transport.load())
      if (this.stopped || !this.transport.active()) throw new Error("session")
      if (["conflict", "blocked"].includes(this.state.status)) { this.persist(); throw new Error(this.state.status) }
      while (!sameHoles(this.entry.base, this.entry.holes)) {
        if (!validDraftHoles(this.entry.holes)) { this.state.status = "invalid"; throw new Error("invalid") }
        if (this.state.status === "conflict") throw new Error("conflict")
        const sent = { version: this.entry.version, holes: copy(this.entry.holes) }
        this.entry.sent = sent
        this.state.status = "saving"
        if (!this.persist()) throw new Error(this.state.status)
        this.emit()
        const version = await this.transport.save(sent.holes, sent.version)
        if (this.stopped || !this.transport.active()) throw new Error("session")
        this.entry.version = version
        this.entry.base = sent.holes
        delete this.entry.sent
        if (!this.persist()) throw new Error(this.state.status)
      }
      this.state.status = "saved"
      this.persist()
      this.emit()
      return this.entry.version
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!this.stopped && this.transport.active() && !["conflict", "blocked", "storageError", "invalid"].includes(this.state.status)) {
        this.state.status = /deadline|Only drafts|Round not found/i.test(message) ? "blocked" : /JWT|token|session|authenticated/i.test(message) ? "session" : "offline"
        this.persist()
      }
      this.emit()
      throw error
    }
  }
  stop() { this.stopped = true; this.listeners.clear() }
}

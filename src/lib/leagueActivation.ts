/** Progress uses accepted, validated league cards, never drafts or pending cards. */
export function leagueActivation(memberCount: number, countedCards: number, invitePrepared: boolean) {
  const invited = invitePrepared || memberCount > 1
  const firstCard = countedCards > 0
  return {
    invited,
    firstCard,
    // Internal measurement only: joining is not an extra launch-checklist step.
    friendJoined: memberCount > 1,
    activeGroup: memberCount > 1 && firstCard,
    completed: 1 + Number(invited) + Number(firstCard),
  }
}

const inviteKey = (id: string) => `mulligan.league.invite-prepared.${id}`
export function hasPreparedInvite(id: string): boolean {
  try { return window.localStorage.getItem(inviteKey(id)) === "1" } catch { return false }
}
export function rememberPreparedInvite(id: string): void {
  try { window.localStorage.setItem(inviteKey(id), "1") } catch { /* Progress still works for this visit. */ }
}

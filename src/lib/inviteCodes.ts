// Preserve both six-character legacy codes and the current ten-character codes.
export function normalizeInviteCode(value: string): string {
  return value.trim().toUpperCase().slice(0, 10)
}
export function isInviteCode(value: string): boolean {
  return /^(?:[A-Z0-9]{6}|[A-Z0-9]{10})$/.test(value)
}

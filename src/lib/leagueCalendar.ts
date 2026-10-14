/** Same inclusive start / exclusive anniversary convention as the server. */
export function calendarLeagueEnd(start: string, months: number): string | null {
  if (![1, 2, 3].includes(months) || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null
  const [year, month, day] = start.split("-").map(Number)
  const initial = new Date(Date.UTC(year, month - 1, day))
  if (initial.toISOString().slice(0, 10) !== start) return null
  const last = new Date(Date.UTC(year, month - 1 + months + 1, 0))
  const anniversary = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), Math.min(day, last.getUTCDate())))
  anniversary.setUTCDate(anniversary.getUTCDate() - 1)
  return anniversary.toISOString().slice(0, 10)
}

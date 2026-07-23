/**
 * Local-date helpers.
 *
 * The app compares against `match_date`, which is a plain calendar date
 * (no timezone). Deriving "today" with `new Date().toISOString().slice(0,10)`
 * yields the UTC date, so for users east/west of UTC around midnight the
 * app's notion of "today" is off by a day — nagging players to submit a
 * score for a round not yet played, or hiding today's match as "upcoming"
 * (AUD#17). Always build the y-m-d string from local getters instead.
 * Timezone policy for the product is Europe/Paris; the client's local
 * time is the right proxy for a French audience.
 */

/** `YYYY-MM-DD` for the given date in the viewer's local timezone. */
export function toLocalIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** `YYYY-MM-DD` for today in the viewer's local timezone. */
export function todayLocalIso(): string {
  return toLocalIso(new Date())
}

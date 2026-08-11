/**
 * Unwrap a NON-CRITICAL Supabase RPC/query response: on error, log it
 * loudly with the call's name and return the fallback so the page still
 * renders its empty state.
 *
 * The point is the logging, not the fallback. Several dashboard cards
 * (records, honors, badges, courses) used bare `if (!res.error)` guards:
 * a production outage — an RPC renamed out from under the client, a
 * revoked grant, a bad deploy — presented as a user who simply had no
 * records yet, indistinguishable from the genuine empty state and
 * invisible to error tooling. Route every non-critical read through
 * here so failures at least reach the console (and anything tailing it).
 */
export function rpcOrFallback<T>(
  name: string,
  res: { data: unknown; error: { message?: string } | null },
  fallback: T,
): T {
  if (res.error) {
    console.error(`[rpc] ${name} failed:`, res.error.message ?? res.error)
    return fallback
  }
  return (res.data ?? fallback) as T
}

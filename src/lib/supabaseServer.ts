import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

/**
 * Anonymous server-side client for the public /courses pages (Phase F).
 *
 * Separate from src/lib/supabase.ts on purpose: that one persists a browser
 * session; server components need a stateless client. Anon key only — the
 * course referential is readable by anon by design (SEO pages), and nothing
 * personal is reachable this way. Instantiated per call so a bad env in CI
 * (dummy URL) fails inside the caller's try/catch, not at module load.
 */
export function supabaseAnonServer() {
  // Typed: this client is used only by the public /courses pages, a small
  // surface that already matches the generated row types cleanly — so it
  // gets the Database generic now (the browser client's flip is deferred;
  // see src/lib/supabase.ts).
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

// NOTE: intentionally NOT parameterized as createClient<Database> yet.
// Doing so surfaces ~34 pre-existing type-drift errors (loose
// `string | number` id types that are really `string`, null/undefined
// boundary mismatches) across MatchDetailCard, games/[id] and profile —
// all files with PRs in flight. Flip this generic and fix those call
// sites in one clean sweep AFTER the current PR queue merges; the
// Database type is imported here so that follow-up is a one-word change.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  }
})

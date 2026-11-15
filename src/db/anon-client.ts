/**
 * Anon-role Drizzle client.
 *
 * This client connects to the same Postgres database as ./index.ts but
 * uses the Supabase anon (publishable) API key over PostgREST instead of
 * a direct service-role connection. It is RLS-restricted by definition:
 * SELECT works only where a policy permits it (we have permissive SELECT
 * policies on all 12 tables); INSERT/UPDATE/DELETE all fail with an
 * RLS-policy-violation error because no policy permits them.
 *
 * The primary consumer is the RLS denial test suite (per AC-058). The
 * SvelteKit page loader also uses this surface to generate signed URLs
 * without service-role access.
 *
 * IMPORTANT: this client connects via PostgREST (REST API), not direct
 * Postgres. Drizzle does not support PostgREST as a transport, so the
 * "client" here is the @supabase/supabase-js client. RLS denial tests
 * therefore call the supabase-js methods directly rather than Drizzle's
 * query builder. This is the standard pattern for verifying RLS denial:
 * the anon role gates at the API layer, not at the SQL layer.
 *
 * Usage in tests:
 *
 *   import { anonClient } from "../src/db/anon-client.js";
 *   const result = await anonClient.from("tasks").insert({ ... });
 *   expect(result.error).toBeTruthy();  // RLS denies INSERT
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requireSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) {
    throw new Error("SUPABASE_URL is not set in env");
  }
  // Defensive: strip trailing /rest/v1/ if a dashboard-pasted value
  // included it; supabase-js will append the path itself.
  return url.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
}

function requireAnonKey(): string {
  const key = process.env.SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error("SUPABASE_ANON_KEY is not set in env");
  }
  return key;
}

/**
 * Lazily-constructed singleton. We do not auto-construct on import
 * because tests that don't touch the anon client should not require
 * SUPABASE_URL / SUPABASE_ANON_KEY to be present.
 */
let _anonClient: SupabaseClient | undefined;

export function anonClient(): SupabaseClient {
  if (!_anonClient) {
    _anonClient = createClient(requireSupabaseUrl(), requireAnonKey(), {
      auth: {
        // Tests don't sign in; we want raw anon-role access.
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return _anonClient;
}

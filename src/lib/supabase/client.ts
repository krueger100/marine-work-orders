import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export type AppSupabaseClient = SupabaseClient<Database>;

let client: AppSupabaseClient | null = null;

/**
 * The single browser-side Supabase client.
 *
 * It only ever holds the public (publishable) key: every permission is
 * enforced by Postgres (RLS + SECURITY DEFINER functions), never by this code.
 *
 * The auth session lives in sessionStorage, so each browser tab is its own
 * anonymous session and can act as a different member (e.g. Captain in one
 * tab, Crew in another) without the tabs overwriting each other.
 */
export function getSupabase(): AppSupabaseClient {
  if (typeof window === "undefined") {
    throw new Error("getSupabase() is browser-only.");
  }
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
      );
    }
    client = createClient<Database>(url, key, {
      auth: {
        storage: window.sessionStorage,
        storageKey: "mwo-auth",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

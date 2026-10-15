import { createClient } from "@supabase/supabase-js";

/**
 * Daily Vercel Cron target (see vercel.json). Supabase pauses free projects
 * after a week without activity; one small authenticated query a day keeps
 * the live demo reachable for reviewers.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return Response.json({ ok: false, error: "Supabase is not configured" }, { status: 500 });

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: authError } = await supabase.auth.signInAnonymously();
  if (authError) return Response.json({ ok: false, error: authError.message }, { status: 502 });

  const { data, error } = await supabase.rpc("list_directory");
  if (error) return Response.json({ ok: false, error: error.message }, { status: 502 });

  const vessels = (data as { vessels?: unknown[] } | null)?.vessels?.length ?? 0;
  return Response.json({ ok: true, vessels });
}

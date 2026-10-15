import type { Session } from "@supabase/supabase-js";
import type { AppSupabaseClient } from "@/lib/supabase/client";
import type { ActingMember, Directory } from "@/lib/types";
import { toAppError, unwrap } from "./errors";

const TAB_CHANNEL = "mwo-tabs";
// Identifies this JS context, so a tab never mistakes its own claim for another tab's.
const TAB_ID = typeof crypto !== "undefined" ? crypto.randomUUID() : String(Math.random());

let sessionPromise: Promise<Session> | null = null;

/**
 * Makes sure this tab has its own anonymous Supabase session.
 *
 * Sessions live in sessionStorage (one per tab). A duplicated tab inherits a
 * copy of that storage, so it would share - and fight over - the original
 * tab's acting member. If another open tab already owns the session we start
 * a fresh anonymous one.
 */
export function ensureTabSession(supabase: AppSupabaseClient): Promise<Session> {
  sessionPromise ??= startTabSession(supabase).catch((error) => {
    sessionPromise = null; // allow a retry
    throw error;
  });
  return sessionPromise;
}

let resetPromise: Promise<Session> | null = null;

/**
 * Discards this tab's session (rejected by the server: revoked, tampered or
 * expired beyond refresh) and starts a fresh anonymous one. Concurrent callers
 * share a single reset.
 */
export function resetTabSession(supabase: AppSupabaseClient): Promise<Session> {
  resetPromise ??= (async () => {
    sessionPromise = null;
    // Local sign-out only clears this tab's storage; the server may already
    // consider the token invalid, so a failure here is expected and ignored.
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    return ensureTabSession(supabase);
  })().finally(() => {
    resetPromise = null;
  });
  return resetPromise;
}

async function startTabSession(supabase: AppSupabaseClient): Promise<Session> {
  let {
    data: { session },
  } = await supabase.auth.getSession();

  if (session && (await isClaimedByAnotherTab(session.user.id))) {
    await supabase.auth.signOut({ scope: "local" });
    session = null;
  }

  if (!session) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.session) {
      throw toAppError(error ?? new Error("Could not start a session."));
    }
    session = data.session;
  }

  claimSessionForThisTab(session.user.id);
  return session;
}

function isClaimedByAnotherTab(userId: string): Promise<boolean> {
  if (typeof BroadcastChannel === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const channel = new BroadcastChannel(TAB_CHANNEL);
    const timer = setTimeout(() => finish(false), 150);
    function finish(claimed: boolean) {
      clearTimeout(timer);
      channel.close();
      resolve(claimed);
    }
    channel.onmessage = (event) => {
      const { type, userId: claimedId, tabId } = event.data ?? {};
      if (type === "claimed" && claimedId === userId && tabId !== TAB_ID) finish(true);
    };
    channel.postMessage({ type: "who-has", userId, tabId: TAB_ID });
  });
}

let claimChannel: BroadcastChannel | null = null;

function claimSessionForThisTab(userId: string) {
  if (typeof BroadcastChannel === "undefined") return;
  claimChannel?.close();
  claimChannel = new BroadcastChannel(TAB_CHANNEL);
  claimChannel.onmessage = (event) => {
    const { type, userId: askedId, tabId } = event.data ?? {};
    if (type === "who-has" && askedId === userId && tabId !== TAB_ID) {
      claimChannel?.postMessage({ type: "claimed", userId, tabId: TAB_ID });
    }
  };
}

/** Active vessels and members for the three dropdowns (no personal data). */
export async function fetchDirectory(supabase: AppSupabaseClient): Promise<Directory> {
  return unwrap(await supabase.rpc("list_directory")) as unknown as Directory;
}

/** Switches this session to act as the given member and returns them. */
export async function actAs(supabase: AppSupabaseClient, memberId: string): Promise<ActingMember> {
  return unwrap(await supabase.rpc("act_as", { p_member_id: memberId })) as unknown as ActingMember;
}

/** The member this session is acting as, or null if none / deactivated. */
export async function fetchWhoami(supabase: AppSupabaseClient): Promise<ActingMember | null> {
  return (unwrap(await supabase.rpc("whoami")) as unknown as ActingMember | null) ?? null;
}

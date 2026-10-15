"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { onAuthFailure, reportAuthFailure } from "@/lib/api/auth-events";
import { errorMessage, toAppError } from "@/lib/api/errors";
import { actAs, ensureTabSession, fetchDirectory, fetchWhoami, resetTabSession } from "@/lib/api/session";
import { loadSelection, resolveSelection, saveSelection, type Selection } from "@/lib/session-rules";
import { getSupabase } from "@/lib/supabase/client";
import type { ActingMember, Directory, Role, VesselScope } from "@/lib/types";

interface SessionContextValue {
  status: "loading" | "ready" | "error";
  error: string | null;
  directory: Directory | null;
  /** What the dropdowns show. Updates instantly on every change. */
  selection: Selection | null;
  /** The member the database has confirmed this session is acting as. */
  member: ActingMember | null;
  /** True while a member switch is in flight. */
  switching: boolean;
  selectVessel: (vessel: VesselScope) => void;
  selectRole: (role: Role) => void;
  selectMember: (memberId: string) => void;
  /** Re-read the directory and the acting member (after admin edits). */
  refresh: () => Promise<void>;
  /** Called when the database reports the acting member is gone. */
  recoverLostSession: () => void;
  retry: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside <SessionProvider>.");
  return value;
}

/** The confirmed acting member. Only call below a "ready" session gate. */
export function useMember(): ActingMember {
  const { member } = useSession();
  if (!member) throw new Error("useMember called without an acting member.");
  return member;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionContextValue["status"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [member, setMember] = useState<ActingMember | null>(null);
  const [switching, setSwitching] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Member switches run one at a time; only the latest request wins.
  const switchQueue = useRef<Promise<void>>(Promise.resolve());
  const requestedMemberId = useRef<string | null>(null);
  // Session recovery runs once at a time and at most every 30 seconds.
  const recovering = useRef<Promise<void> | null>(null);
  const lastRecoveryAt = useRef(0);

  const switchTo = useCallback(
    (memberId: string) => {
      requestedMemberId.current = memberId;
      setSwitching(true);
      switchQueue.current = switchQueue.current.then(async () => {
        if (requestedMemberId.current !== memberId) return; // superseded
        try {
          const confirmed = await actAs(getSupabase(), memberId);
          if (requestedMemberId.current !== memberId) return;
          setMember(confirmed);
          // Drop cached data that belonged to other identities.
          queryClient.removeQueries({ predicate: (q) => q.queryKey[1] !== confirmed.id });
        } catch (e) {
          if (toAppError(e).isAuthFailure) reportAuthFailure(); // recovery re-acts as this member
          else toast.error(errorMessage(e));
        } finally {
          if (requestedMemberId.current === memberId) setSwitching(false);
        }
      });
    },
    [queryClient],
  );

  const apply = useCallback(
    (next: Selection | null) => {
      setSelection(next);
      if (!next) return;
      saveSelection(next);
      if (next.memberId !== requestedMemberId.current) switchTo(next.memberId);
    },
    [switchTo],
  );

  // Bootstrap: own anonymous session -> directory -> restore or default selection.
  // If the stored session is rejected by the server, start a fresh one once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        const connect = async () => {
          await ensureTabSession(supabase);
          const dir = await fetchDirectory(supabase);
          const initial = resolveSelection(dir, loadSelection() ?? {});
          const confirmed = initial ? await actAs(supabase, initial.memberId) : null;
          return { dir, initial, confirmed };
        };

        let result: Awaited<ReturnType<typeof connect>>;
        try {
          result = await connect();
        } catch (e) {
          if (!toAppError(e).isAuthFailure) throw e;
          await resetTabSession(supabase);
          result = await connect();
        }
        if (cancelled) return;

        setDirectory(result.dir);
        setSelection(result.initial);
        if (result.initial) {
          requestedMemberId.current = result.initial.memberId;
          saveSelection(result.initial);
        }
        setMember(result.confirmed);
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setError(errorMessage(e));
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Vessel change keeps the role and member when they are still valid there.
  const selectVessel = useCallback(
    (vessel: VesselScope) => {
      if (directory) {
        apply(resolveSelection(directory, { vessel, role: selection?.role, memberId: selection?.memberId }));
      }
    },
    [apply, directory, selection],
  );

  // Role change picks the first member of that role on the vessel.
  const selectRole = useCallback(
    (role: Role) => {
      if (directory) apply(resolveSelection(directory, { vessel: selection?.vessel, role }));
    },
    [apply, directory, selection],
  );

  const selectMember = useCallback(
    (memberId: string) => {
      if (directory) {
        apply(resolveSelection(directory, { vessel: selection?.vessel, role: selection?.role, memberId }));
      }
    },
    [apply, directory, selection],
  );

  const refresh = useCallback(async () => {
    try {
      const supabase = getSupabase();
      const [dir, me] = await Promise.all([fetchDirectory(supabase), fetchWhoami(supabase)]);
      setDirectory(dir);
      if (me) {
        setMember(me);
        const next = resolveSelection(dir, { vessel: selection?.vessel, role: me.role, memberId: me.id });
        if (next && next.memberId === me.id) {
          // Still valid: just reflect any role/vessel changes in the dropdowns.
          setSelection(next);
          saveSelection(next);
        } else {
          apply(next); // the current member can no longer be selected here
        }
      } else {
        apply(resolveSelection(dir, { vessel: selection?.vessel, role: selection?.role }));
      }
    } catch (e) {
      if (toAppError(e).isAuthFailure) reportAuthFailure();
      else toast.error(errorMessage(e));
    }
  }, [apply, selection]);

  const recoverLostSession = useCallback(() => {
    toast.warning("That member is no longer active. Switching to another member.");
    requestedMemberId.current = null;
    void refresh();
  }, [refresh]);

  // The server rejected this tab's session (revoked, tampered or expired beyond
  // refresh): start a fresh anonymous session and act as the same member again.
  const recoverAuth = useCallback((): Promise<void> => {
    if (recovering.current) return recovering.current;
    if (Date.now() - lastRecoveryAt.current < 30_000) return Promise.resolve(); // avoid a sign-in loop
    lastRecoveryAt.current = Date.now();

    recovering.current = (async () => {
      try {
        const supabase = getSupabase();
        await resetTabSession(supabase);
        const memberId = requestedMemberId.current;
        if (memberId) setMember(await actAs(supabase, memberId));
        await queryClient.invalidateQueries();
      } catch (e) {
        const appError = toAppError(e);
        if (appError.isAuthFailure || appError.isNetworkFailure || appError.isRateLimited) {
          toast.error(errorMessage(appError));
        } else {
          recoverLostSession(); // e.g. the member was deactivated meanwhile
        }
      } finally {
        recovering.current = null;
      }
    })();
    return recovering.current;
  }, [queryClient, recoverLostSession]);

  useEffect(() => onAuthFailure(() => void recoverAuth()), [recoverAuth]);

  // Another admin (or another tab) may have changed things: re-sync on focus.
  useEffect(() => {
    if (status !== "ready") return;
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [status, refresh]);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      error,
      directory,
      selection,
      member,
      switching,
      selectVessel,
      selectRole,
      selectMember,
      refresh,
      recoverLostSession,
      retry: () => {
        setStatus("loading");
        setAttempt((n) => n + 1);
      },
    }),
    [status, error, directory, selection, member, switching, selectVessel, selectRole, selectMember, refresh, recoverLostSession],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

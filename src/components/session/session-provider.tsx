"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api/errors";
import { actAs, ensureTabSession, fetchDirectory, fetchWhoami } from "@/lib/api/session";
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
          toast.error(errorMessage(e));
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
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabase();
        await ensureTabSession(supabase);
        const dir = await fetchDirectory(supabase);
        if (cancelled) return;
        setDirectory(dir);
        const initial = resolveSelection(dir, loadSelection() ?? {});
        setSelection(initial);
        if (initial) {
          requestedMemberId.current = initial.memberId;
          const confirmed = await actAs(supabase, initial.memberId);
          if (cancelled) return;
          setMember(confirmed);
          saveSelection(initial);
        }
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
      toast.error(errorMessage(e));
    }
  }, [apply, selection]);

  const recoverLostSession = useCallback(() => {
    toast.warning("That member is no longer active. Switching to another member.");
    requestedMemberId.current = null;
    void refresh();
  }, [refresh]);

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

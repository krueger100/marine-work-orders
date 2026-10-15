"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useSession } from "@/components/session/session-provider";
import { errorMessage, toAppError } from "@/lib/api/errors";
import { getSupabase, type AppSupabaseClient } from "@/lib/supabase/client";

/** Query-key roots; every key is [root, actingMemberId, ...params]. */
export type QueryRoot = "work-orders" | "work-order" | "stats" | "crew" | "members" | "vessels" | "roster";

interface Options<TVars, TResult> {
  /** Toast shown on success. */
  success?: string | ((result: TResult, vars: TVars) => string);
  /** Query roots to refetch afterwards. */
  invalidate?: QueryRoot[];
  /** Also re-read the dropdown directory and acting member (admin edits). */
  refreshSession?: boolean;
  onSuccess?: (result: TResult, vars: TVars) => void;
}

/**
 * useMutation with the app's conventions: database error messages go to a
 * toast, a lost session triggers recovery, and related queries refetch.
 */
export function useAppMutation<TVars, TResult = void>(
  fn: (supabase: AppSupabaseClient, vars: TVars) => Promise<TResult>,
  options: Options<TVars, TResult> = {},
) {
  const queryClient = useQueryClient();
  const session = useSession();

  return useMutation({
    mutationFn: (vars: TVars) => fn(getSupabase(), vars),
    onSuccess: async (result, vars) => {
      const { success } = options;
      if (success) toast.success(typeof success === "function" ? success(result, vars) : success);
      options.onSuccess?.(result, vars);
      await Promise.all([
        ...(options.invalidate ?? []).map((root) => queryClient.invalidateQueries({ queryKey: [root] })),
        options.refreshSession ? session.refresh() : null,
      ]);
    },
    onError: (error) => {
      const appError = toAppError(error);
      if (appError.isSessionLost) session.recoverLostSession();
      else toast.error(errorMessage(appError)); // auth failures also trigger recovery (see Providers)
    },
  });
}

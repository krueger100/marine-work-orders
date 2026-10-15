"use client";

import { useQuery } from "@tanstack/react-query";
import { useMember } from "@/components/session/session-provider";
import {
  listAssignableMembers,
  listMembers,
  listVesselRoster,
  listVesselSummaries,
  type MemberQuery,
} from "@/lib/api/admin";
import {
  getWorkOrder,
  getWorkOrderStats,
  listAssignableCrew,
  listWorkOrders,
  type WorkOrderQuery,
} from "@/lib/api/work-orders";
import { getSupabase } from "@/lib/supabase/client";
import type { VesselScope } from "@/lib/types";

// Every key is [root, actingMemberId, ...params], so switching members can
// never show another member's cached data.

export function useWorkOrders(query: WorkOrderQuery) {
  const member = useMember();
  return useQuery({
    queryKey: ["work-orders", member.id, query],
    queryFn: () => listWorkOrders(getSupabase(), query),
    // While the next page/filter loads keep the previous rows on screen, but
    // only if they belong to the same member and vessel.
    placeholderData: (previous, previousQuery) => {
      const [, memberId, params] = previousQuery?.queryKey ?? [];
      return memberId === member.id && (params as WorkOrderQuery | undefined)?.vessel === query.vessel
        ? previous
        : undefined;
    },
  });
}

export function useWorkOrder(id: number | null) {
  const member = useMember();
  return useQuery({
    queryKey: ["work-order", member.id, id],
    queryFn: () => getWorkOrder(getSupabase(), id!),
    enabled: id !== null,
  });
}

export function useWorkOrderStats(vessel: VesselScope) {
  const member = useMember();
  return useQuery({
    queryKey: ["stats", member.id, vessel],
    queryFn: () => getWorkOrderStats(getSupabase(), vessel),
  });
}

export function useAssignableCrew(vesselId: string | null) {
  const member = useMember();
  return useQuery({
    queryKey: ["crew", member.id, vesselId],
    queryFn: () => listAssignableCrew(getSupabase(), vesselId!),
    enabled: vesselId !== null,
  });
}

export function useMembers(query: MemberQuery) {
  const member = useMember();
  return useQuery({
    queryKey: ["members", member.id, query],
    queryFn: () => listMembers(getSupabase(), query),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === member.id ? previous : undefined,
  });
}

export function useVesselSummaries() {
  const member = useMember();
  return useQuery({
    queryKey: ["vessels", member.id],
    queryFn: () => listVesselSummaries(getSupabase()),
  });
}

export function useAssignableMembers(enabled: boolean) {
  const member = useMember();
  return useQuery({
    queryKey: ["members", member.id, "assignable"],
    queryFn: () => listAssignableMembers(getSupabase()),
    enabled,
  });
}

export function useVesselRoster(vesselId: string | null) {
  const member = useMember();
  return useQuery({
    queryKey: ["roster", member.id, vesselId],
    queryFn: () => listVesselRoster(getSupabase(), vesselId!),
    enabled: vesselId !== null,
  });
}

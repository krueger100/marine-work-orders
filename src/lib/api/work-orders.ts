import type { AppSupabaseClient } from "@/lib/supabase/client";
import {
  ALL_VESSELS,
  type Page,
  type PersonRef,
  type VesselScope,
  type WorkOrderDetail,
  type WorkOrderFilter,
  type WorkOrderListItem,
  type WorkOrderStats,
} from "@/lib/types";
import { unwrap } from "./errors";

export const WORK_ORDER_PAGE_SIZE = 25;

export interface WorkOrderQuery {
  vessel: VesselScope;
  filter: WorkOrderFilter;
  search: string;
  page: number; // 0-based
}

const LIST_COLUMNS = `
  id, title, status, attested_at, rejection_count, updated_at,
  vessel:vessels ( id, name ),
  assignee:members!work_orders_assigned_to_fkey ( id, full_name )
`;

/**
 * One page of work orders. RLS decides which rows exist for the caller;
 * this only narrows by vessel, status and title. Uses the
 * (vessel_id, status, id) / (assigned_to, status, id) indexes.
 */
export async function listWorkOrders(
  supabase: AppSupabaseClient,
  { vessel, filter, search, page }: WorkOrderQuery,
): Promise<Page<WorkOrderListItem>> {
  let query = supabase.from("work_orders").select(LIST_COLUMNS, { count: "exact" });

  if (vessel !== ALL_VESSELS) query = query.eq("vessel_id", vessel);

  switch (filter) {
    case "open":
      query = query.eq("status", "Open");
      break;
    case "in_progress":
      query = query.eq("status", "In Progress");
      break;
    case "awaiting_review":
      query = query.eq("status", "Done").is("attested_at", null);
      break;
    case "attested":
      query = query.not("attested_at", "is", null);
      break;
  }

  // PostgREST parameterizes the value; strip LIKE wildcards so a search for
  // "50%" is literal rather than a pattern.
  const term = search.trim().replace(/[%_*\\]/g, "");
  if (term) query = query.ilike("title", `%${term}%`);

  const from = page * WORK_ORDER_PAGE_SIZE;
  const { data, error, count, status } = await query
    .order("id", { ascending: false })
    .range(from, from + WORK_ORDER_PAGE_SIZE - 1);

  return { rows: unwrap({ data, error, status }) as unknown as WorkOrderListItem[], total: count ?? 0 };
}

const DETAIL_COLUMNS = `
  id, vessel_id, title, issue, solution, status, assigned_to, created_by,
  attested_at, rejection_count, last_rejection_reason, created_at, updated_at,
  vessel:vessels ( id, name ),
  assignee:members!work_orders_assigned_to_fkey ( id, full_name ),
  creator:members!work_orders_created_by_fkey ( id, full_name ),
  attester:members!work_orders_attested_by_fkey ( id, full_name ),
  events:work_order_events (
    id, event_type, from_status, to_status, comment, created_at,
    actor:members ( id, full_name )
  )
`;

export async function getWorkOrder(supabase: AppSupabaseClient, id: number): Promise<WorkOrderDetail | null> {
  const data = unwrap(
    await supabase.from("work_orders").select(DETAIL_COLUMNS).eq("id", id).maybeSingle(),
  ) as unknown as WorkOrderDetail | null;
  if (!data) return null;
  // Chronological history (a work order has a handful of events).
  data.events.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  return data;
}

export async function getWorkOrderStats(supabase: AppSupabaseClient, vessel: VesselScope): Promise<WorkOrderStats> {
  const data = unwrap(
    await supabase.rpc("work_order_stats", vessel === ALL_VESSELS ? {} : { p_vessel_id: vessel }),
  );
  return data as unknown as WorkOrderStats;
}

/** Active crew serving on a vessel: the people a captain may assign. */
export async function listAssignableCrew(supabase: AppSupabaseClient, vesselId: string): Promise<PersonRef[]> {
  const data = unwrap(
    await supabase
      .from("members")
      .select("id, full_name, vessel_assignments!inner ( vessel_id )")
      .eq("role", "Crew")
      .eq("is_active", true)
      .eq("vessel_assignments.vessel_id", vesselId)
      .order("full_name"),
  );
  return data.map(({ id, full_name }) => ({ id, full_name }));
}

// --- Lifecycle mutations: thin wrappers over the database functions. -------

export async function createWorkOrder(
  supabase: AppSupabaseClient,
  input: { vesselId: string; title: string; issue: string; assignedTo: string },
): Promise<number> {
  const id = unwrap(
    await supabase.rpc("create_work_order", {
      p_vessel_id: input.vesselId,
      p_title: input.title,
      p_issue: input.issue,
      p_assigned_to: input.assignedTo,
    }),
  );
  return Number(id);
}

export async function startWorkOrder(supabase: AppSupabaseClient, id: number) {
  unwrap(await supabase.rpc("start_work_order", { p_work_order_id: id }));
}

export async function saveWorkOrderSolution(supabase: AppSupabaseClient, id: number, solution: string) {
  unwrap(await supabase.rpc("save_work_order_solution", { p_work_order_id: id, p_solution: solution }));
}

export async function completeWorkOrder(supabase: AppSupabaseClient, id: number, solution: string) {
  unwrap(await supabase.rpc("complete_work_order", { p_work_order_id: id, p_solution: solution }));
}

export async function attestWorkOrder(supabase: AppSupabaseClient, id: number) {
  unwrap(await supabase.rpc("attest_work_order", { p_work_order_id: id }));
}

export async function rejectWorkOrder(supabase: AppSupabaseClient, id: number, reason: string) {
  unwrap(await supabase.rpc("reject_work_order", { p_work_order_id: id, p_reason: reason }));
}

export async function reassignWorkOrder(supabase: AppSupabaseClient, id: number, assignedTo: string) {
  unwrap(await supabase.rpc("reassign_work_order", { p_work_order_id: id, p_assigned_to: assignedTo }));
}

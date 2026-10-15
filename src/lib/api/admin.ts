import type { AppSupabaseClient } from "@/lib/supabase/client";
import type { Member, Page, Role, VesselSummary } from "@/lib/types";
import { unwrap } from "./errors";

export const MEMBER_PAGE_SIZE = 25;

export interface MemberQuery {
  search: string;
  role: Role | "all";
  status: "active" | "inactive" | "all";
  page: number; // 0-based
}

export async function listMembers(
  supabase: AppSupabaseClient,
  { search, role, status, page }: MemberQuery,
): Promise<Page<Member>> {
  let query = supabase
    .from("members")
    .select("id, full_name, email, role, is_active, created_at, vessel_assignments ( vessel_id )", {
      count: "exact",
    });

  if (role !== "all") query = query.eq("role", role);
  if (status !== "all") query = query.eq("is_active", status === "active");

  // Characters that are syntax in a PostgREST or() filter are stripped; values
  // are still sent as parameters, never concatenated into SQL.
  const term = search.trim().replace(/[%_*\\,()"]/g, "");
  if (term) query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`);

  const from = page * MEMBER_PAGE_SIZE;
  // Enum order: Admins, then Captains, then Crew; alphabetical within a role.
  const { data, error, count } = await query
    .order("role")
    .order("full_name")
    .range(from, from + MEMBER_PAGE_SIZE - 1);

  const rows = unwrap({ data, error }).map(({ vessel_assignments, ...member }) => ({
    ...member,
    vessel_ids: vessel_assignments.map((a) => a.vessel_id),
  }));
  return { rows: rows as Member[], total: count ?? 0 };
}

export interface MemberInput {
  fullName: string;
  email: string;
  role: Role;
  vesselIds: string[];
}

export async function createMember(supabase: AppSupabaseClient, input: MemberInput): Promise<string> {
  return unwrap(
    await supabase.rpc("create_member", {
      p_full_name: input.fullName,
      p_email: input.email,
      p_role: input.role,
      p_vessel_ids: input.role === "Admin" ? [] : input.vesselIds,
    }),
  );
}

export async function updateMember(supabase: AppSupabaseClient, id: string, input: MemberInput) {
  unwrap(
    await supabase.rpc("update_member", {
      p_member_id: id,
      p_full_name: input.fullName,
      p_email: input.email,
      p_role: input.role,
      p_vessel_ids: input.role === "Admin" ? [] : input.vesselIds,
    }),
  );
}

export async function setMemberActive(supabase: AppSupabaseClient, id: string, isActive: boolean) {
  unwrap(await supabase.rpc("set_member_active", { p_member_id: id, p_is_active: isActive }));
}

export async function removeMemberFromVessel(supabase: AppSupabaseClient, memberId: string, vesselId: string) {
  unwrap(await supabase.rpc("remove_member_from_vessel", { p_member_id: memberId, p_vessel_id: vesselId }));
}

export async function assignMemberToVessel(supabase: AppSupabaseClient, memberId: string, vesselId: string) {
  unwrap(await supabase.rpc("assign_member_to_vessel", { p_member_id: memberId, p_vessel_id: vesselId }));
}

// --- Vessels ------------------------------------------------------------------

export async function listVesselSummaries(supabase: AppSupabaseClient): Promise<VesselSummary[]> {
  const data = unwrap(
    await supabase
      .from("vessel_summaries")
      .select("id, name, imo_number, vessel_type, is_active, captain_count, crew_count, active_work_order_count")
      .order("is_active", { ascending: false })
      .order("name"),
  );
  return data as VesselSummary[];
}

export interface VesselInput {
  name: string;
  imoNumber: string;
  vesselType: string;
}

export async function createVessel(supabase: AppSupabaseClient, input: VesselInput): Promise<string> {
  return unwrap(
    await supabase.rpc("create_vessel", {
      p_name: input.name,
      p_imo_number: input.imoNumber,
      p_vessel_type: input.vesselType,
    }),
  );
}

export async function updateVessel(supabase: AppSupabaseClient, id: string, input: VesselInput) {
  unwrap(
    await supabase.rpc("update_vessel", {
      p_vessel_id: id,
      p_name: input.name,
      p_imo_number: input.imoNumber,
      p_vessel_type: input.vesselType,
    }),
  );
}

export async function setVesselActive(supabase: AppSupabaseClient, id: string, isActive: boolean) {
  unwrap(await supabase.rpc("set_vessel_active", { p_vessel_id: id, p_is_active: isActive }));
}

/** Active Captains and Crew: candidates for a vessel roster. */
export async function listAssignableMembers(supabase: AppSupabaseClient) {
  return unwrap(
    await supabase
      .from("members")
      .select("id, full_name, role")
      .eq("is_active", true)
      .neq("role", "Admin")
      .order("full_name"),
  );
}

export interface RosterMember {
  id: string;
  full_name: string;
  role: Role;
  is_active: boolean;
}

/** Members currently assigned to a vessel (for the vessel roster). */
export async function listVesselRoster(supabase: AppSupabaseClient, vesselId: string): Promise<RosterMember[]> {
  const rows = unwrap(
    await supabase
      .from("vessel_assignments")
      .select("member:members ( id, full_name, role, is_active )")
      .eq("vessel_id", vesselId),
  ) as unknown as { member: RosterMember | null }[];
  return rows
    .map((row) => row.member)
    .filter((m): m is RosterMember => m !== null)
    .sort((a, b) => a.role.localeCompare(b.role) || a.full_name.localeCompare(b.full_name));
}

export async function resetDemoData(supabase: AppSupabaseClient) {
  unwrap(await supabase.rpc("reset_demo_data"));
}

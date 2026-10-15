// Domain types shared by the data layer and the UI.

export const ROLES = ["Admin", "Captain", "Crew"] as const;
export type Role = (typeof ROLES)[number];

export const WORK_ORDER_STATUSES = ["Open", "In Progress", "Done"] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

/** Dashboard filter. "awaiting_review" = Done, not attested; "attested" = closed. */
export type WorkOrderFilter = "all" | "open" | "in_progress" | "awaiting_review" | "attested";

/** Value of the vessel selector: a vessel id, or the whole fleet (Admins only). */
export type VesselScope = string | "all";
export const ALL_VESSELS = "all" as const;

export interface DirectoryVessel {
  id: string;
  name: string;
}

export interface DirectoryMember {
  id: string;
  full_name: string;
  role: Role;
  vessel_ids: string[];
}

export interface Directory {
  vessels: DirectoryVessel[];
  members: DirectoryMember[];
}

export interface ActingMember {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  vessel_ids: string[];
}

export interface PersonRef {
  id: string;
  full_name: string;
}

export interface WorkOrderListItem {
  id: number;
  title: string;
  status: WorkOrderStatus;
  attested_at: string | null;
  rejection_count: number;
  updated_at: string;
  vessel: { id: string; name: string } | null;
  assignee: PersonRef | null;
}

export type WorkOrderEventType =
  | "created"
  | "started"
  | "completed"
  | "attested"
  | "rejected"
  | "reassigned";

export interface WorkOrderEvent {
  id: number;
  event_type: WorkOrderEventType;
  from_status: WorkOrderStatus | null;
  to_status: WorkOrderStatus | null;
  comment: string | null;
  created_at: string;
  actor: PersonRef | null;
}

export interface WorkOrderDetail {
  id: number;
  vessel_id: string;
  title: string;
  issue: string;
  solution: string | null;
  status: WorkOrderStatus;
  assigned_to: string;
  created_by: string;
  attested_at: string | null;
  rejection_count: number;
  last_rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  vessel: { id: string; name: string } | null;
  assignee: PersonRef | null;
  creator: PersonRef | null;
  attester: PersonRef | null;
  events: WorkOrderEvent[];
}

export interface WorkOrderStats {
  open: number;
  in_progress: number;
  awaiting_review: number;
  attested: number;
  total: number;
}

export interface Member {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  is_active: boolean;
  created_at: string;
  vessel_ids: string[];
}

export interface VesselSummary {
  id: string;
  name: string;
  imo_number: string;
  vessel_type: string;
  is_active: boolean;
  captain_count: number;
  crew_count: number;
  active_work_order_count: number;
}

export interface Page<T> {
  rows: T[];
  total: number;
}

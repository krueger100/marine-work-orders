// Pure rules for the three dependent dropdowns (Vessel -> Role -> Member).
// Kept free of React so they are easy to read and to reason about.
import { ALL_VESSELS, type Directory, type DirectoryMember, type Role, type VesselScope } from "./types";

export interface Selection {
  vessel: VesselScope;
  role: Role;
  memberId: string;
}

/** Roles offered for a vessel. "All vessels" is fleet-wide, so only Admins. */
export function rolesFor(vessel: VesselScope): Role[] {
  return vessel === ALL_VESSELS ? ["Admin"] : ["Admin", "Captain", "Crew"];
}

/**
 * Active members selectable for a vessel + role. Admins are fleet-wide and
 * appear for every vessel; Captains and Crew only where they are assigned.
 */
export function membersFor(directory: Directory, vessel: VesselScope, role: Role): DirectoryMember[] {
  return directory.members.filter((m) => {
    if (m.role !== role) return false;
    if (role === "Admin") return true;
    return vessel !== ALL_VESSELS && m.vessel_ids.includes(vessel);
  });
}

const ROLE_PREFERENCE: Role[] = ["Captain", "Crew", "Admin"];

/**
 * Turns a (possibly stale or partial) wish into a valid selection:
 * keep what is still valid, otherwise fall back to the first sensible option.
 * Returns null only when there is nobody to act as at all.
 */
export function resolveSelection(directory: Directory, wish: Partial<Selection>): Selection | null {
  const vesselIds = directory.vessels.map((v) => v.id);
  const vessel: VesselScope =
    wish.vessel === ALL_VESSELS || (wish.vessel && vesselIds.includes(wish.vessel))
      ? wish.vessel
      : (vesselIds[0] ?? ALL_VESSELS);

  const allowed = rolesFor(vessel);
  const candidates = [wish.role, ...ROLE_PREFERENCE].filter(
    (r): r is Role => !!r && allowed.includes(r) && membersFor(directory, vessel, r).length > 0,
  );
  const role = candidates[0];
  if (!role) return null;

  const members = membersFor(directory, vessel, role);
  const member = members.find((m) => m.id === wish.memberId) ?? members[0];
  return { vessel, role, memberId: member.id };
}

const STORAGE_KEY = "mwo-selection";

export function loadSelection(): Partial<Selection> | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Selection>) : null;
  } catch {
    return null;
  }
}

export function saveSelection(selection: Selection) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Storage can be unavailable (private mode); the selection just won't survive a reload.
  }
}

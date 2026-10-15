"use client";

import { UserMinus, UserPlus } from "lucide-react";
import { useState } from "react";
import { RoleBadge } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/form";
import { Spinner } from "@/components/ui/states";
import { assignMemberToVessel, removeMemberFromVessel } from "@/lib/api/admin";
import { useAssignableMembers, useVesselRoster } from "@/lib/hooks/queries";
import { useAppMutation, type QueryRoot } from "@/lib/hooks/use-app-mutation";
import type { VesselSummary } from "@/lib/types";

const REFRESH: QueryRoot[] = ["roster", "vessels", "members", "crew"];

/** Who serves on a vessel: assign and remove captains and crew. */
export function VesselRosterDialog({ vessel, onClose }: { vessel: VesselSummary; onClose: () => void }) {
  const roster = useVesselRoster(vessel.id);
  const candidates = useAssignableMembers(vessel.is_active);
  const [toAdd, setToAdd] = useState("");

  const assign = useAppMutation((s, memberId: string) => assignMemberToVessel(s, memberId, vessel.id), {
    success: "Assigned to the vessel.",
    invalidate: REFRESH,
    refreshSession: true,
    onSuccess: () => setToAdd(""),
  });
  const remove = useAppMutation((s, memberId: string) => removeMemberFromVessel(s, memberId, vessel.id), {
    success: "Removed from the vessel.",
    invalidate: REFRESH,
    refreshSession: true,
  });

  const assignedIds = new Set(roster.data?.map((m) => m.id));
  const available = (candidates.data ?? []).filter((m) => !assignedIds.has(m.id));

  return (
    <Dialog open onClose={onClose} title={`${vessel.name} roster`} description="Captains and crew assigned to this vessel.">
      <div className="space-y-5">
        {vessel.is_active ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={toAdd} onChange={(e) => setToAdd(e.target.value)} aria-label="Member to assign" className="flex-1">
              <option value="">Add a captain or crew member…</option>
              {available.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name} ({m.role})
                </option>
              ))}
            </Select>
            <Button onClick={() => assign.mutate(toAdd)} disabled={!toAdd} loading={assign.isPending}>
              <UserPlus className="size-4" aria-hidden />
              Assign
            </Button>
          </div>
        ) : (
          <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">Reactivate this vessel to assign people to it.</p>
        )}

        {roster.isPending ? (
          <Spinner label="Loading roster" />
        ) : roster.data?.length === 0 ? (
          <p className="text-sm text-slate-500">Nobody is assigned yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {roster.data?.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {m.full_name}
                  {!m.is_active && <span className="ml-1 text-xs text-slate-400">(inactive)</span>}
                </span>
                <RoleBadge role={m.role} />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove.mutate(m.id)}
                  loading={remove.isPending && remove.variables === m.id}
                  aria-label={`Remove ${m.full_name} from ${vessel.name}`}
                >
                  <UserMinus className="size-3.5" aria-hidden />
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

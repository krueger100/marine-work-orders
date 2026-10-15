"use client";

import { Pencil, Plus, Power, Users } from "lucide-react";
import { useState } from "react";
import { ActiveBadge } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { setVesselActive } from "@/lib/api/admin";
import { errorMessage } from "@/lib/api/errors";
import { formatNumber } from "@/lib/format";
import { useVesselSummaries } from "@/lib/hooks/queries";
import { useAppMutation } from "@/lib/hooks/use-app-mutation";
import type { VesselSummary } from "@/lib/types";
import { VesselFormDialog } from "./vessel-form-dialog";
import { VesselRosterDialog } from "./vessel-roster-dialog";

export function VesselsAdmin() {
  const vessels = useVesselSummaries();
  const [editing, setEditing] = useState<VesselSummary | "new" | null>(null);
  const [rosterOf, setRosterOf] = useState<VesselSummary | null>(null);
  const [toggling, setToggling] = useState<VesselSummary | null>(null);

  const toggleActive = useAppMutation((s, v: VesselSummary) => setVesselActive(s, v.id, !v.is_active), {
    success: (_, v) => (v.is_active ? `${v.name} deactivated.` : `${v.name} reactivated.`),
    invalidate: ["vessels"],
    refreshSession: true,
    onSuccess: () => setToggling(null),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Vessels</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Manage the fleet and who serves on each vessel. A vessel with unattested work orders cannot be taken out of
            service.
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus className="size-4" aria-hidden />
          New vessel
        </Button>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        {vessels.error && !vessels.data ? (
          <ErrorState message={errorMessage(vessels.error)} onRetry={() => vessels.refetch()} />
        ) : vessels.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : vessels.data.length === 0 ? (
          <EmptyState title="No vessels yet">Create the first vessel to start assigning crew.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {vessels.data.map((v) => (
              <li key={v.id} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                    {v.name}
                    {!v.is_active && <ActiveBadge active={false} />}
                  </p>
                  <p className="text-sm text-slate-500">
                    IMO <span className="font-mono">{v.imo_number}</span> · {v.vessel_type}
                  </p>
                </div>
                <dl className="grid grid-cols-3 gap-4 text-sm lg:w-80">
                  <Stat label="Captains" value={v.captain_count} warn={v.is_active && v.captain_count === 0} />
                  <Stat label="Crew" value={v.crew_count} />
                  <Stat label="Active WOs" value={v.active_work_order_count} />
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setRosterOf(v)}>
                    <Users className="size-3.5" aria-hidden />
                    Roster
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setEditing(v)}>
                    <Pencil className="size-3.5" aria-hidden />
                    Edit
                  </Button>
                  <Button variant={v.is_active ? "ghost" : "secondary"} size="sm" onClick={() => setToggling(v)}>
                    <Power className="size-3.5" aria-hidden />
                    {v.is_active ? "Deactivate" : "Reactivate"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && <VesselFormDialog vessel={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {rosterOf && <VesselRosterDialog vessel={rosterOf} onClose={() => setRosterOf(null)} />}

      <ConfirmDialog
        open={toggling !== null}
        title={toggling?.is_active ? `Deactivate ${toggling.name}?` : `Reactivate ${toggling?.name ?? ""}?`}
        confirmLabel={toggling?.is_active ? "Deactivate" : "Reactivate"}
        variant={toggling?.is_active ? "danger" : "primary"}
        loading={toggleActive.isPending}
        onConfirm={() => toggling && toggleActive.mutate(toggling)}
        onClose={() => setToggling(null)}
      >
        {toggling?.is_active
          ? "It disappears from the vessel selector and its captains and crew lose access to it. Refused while it has unattested work orders."
          : "It returns to the vessel selector and its assigned captains and crew regain access."}
      </ConfirmDialog>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={warn ? "font-semibold text-amber-600" : "font-semibold text-slate-900"}>{formatNumber(value)}</dd>
    </div>
  );
}

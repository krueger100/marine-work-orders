import clsx from "clsx";
import type { Role, WorkOrderStatus } from "@/lib/types";

const BASE = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap";

const STATUS_STYLES: Record<WorkOrderStatus, string> = {
  Open: "bg-sky-50 text-sky-800 ring-sky-600/20",
  "In Progress": "bg-amber-50 text-amber-800 ring-amber-600/25",
  Done: "bg-violet-50 text-violet-800 ring-violet-600/20",
};

/**
 * Status is one of Open / In Progress / Done. A Done work order is either
 * awaiting the captain's review or attested (closed); that is shown as a
 * second badge rather than as a fourth status.
 */
export function StatusBadges({
  status,
  attestedAt,
  rejectionCount = 0,
}: {
  status: WorkOrderStatus;
  attestedAt: string | null;
  rejectionCount?: number;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={clsx(BASE, STATUS_STYLES[status])}>{status}</span>
      {status === "Done" &&
        (attestedAt ? (
          <span className={clsx(BASE, "bg-emerald-50 text-emerald-800 ring-emerald-600/25")}>Attested</span>
        ) : (
          <span className={clsx(BASE, "bg-white text-violet-700 ring-violet-300")}>Awaiting review</span>
        ))}
      {status === "In Progress" && rejectionCount > 0 && (
        <span className={clsx(BASE, "bg-rose-50 text-rose-700 ring-rose-600/20")}>Rejected</span>
      )}
    </span>
  );
}

const ROLE_STYLES: Record<Role, string> = {
  Admin: "bg-slate-800 text-white ring-slate-800",
  Captain: "bg-sky-100 text-sky-900 ring-sky-700/20",
  Crew: "bg-slate-100 text-slate-700 ring-slate-500/20",
};

export function RoleBadge({ role }: { role: Role }) {
  return <span className={clsx(BASE, ROLE_STYLES[role])}>{role}</span>;
}

export function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <span className={clsx(BASE, "bg-emerald-50 text-emerald-700 ring-emerald-600/20")}>Active</span>
  ) : (
    <span className={clsx(BASE, "bg-slate-100 text-slate-500 ring-slate-400/30")}>Inactive</span>
  );
}

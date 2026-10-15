"use client";

import { Plus, Search } from "lucide-react";
import { useState } from "react";
import { useMember, useSession } from "@/components/session/session-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { WORK_ORDER_PAGE_SIZE } from "@/lib/api/work-orders";
import { useWorkOrders, useWorkOrderStats } from "@/lib/hooks/queries";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { ALL_VESSELS, type Role, type WorkOrderFilter } from "@/lib/types";
import { CreateWorkOrderDialog } from "./create-work-order-dialog";
import { StatsCards } from "./stats-cards";
import { WorkOrderDetailSheet } from "./work-order-detail-sheet";
import { WorkOrderList } from "./work-order-list";

const ROLE_HINTS: Record<Role, string> = {
  Admin: "Fleet-wide, read-only view of work orders. Manage users and vessels from the tabs above.",
  Captain: "Create work orders for your crew, then attest or reject them once they are marked Done.",
  Crew: "Your assigned work orders: start them, document the solution and mark them Done for review.",
};

export function WorkOrdersDashboard() {
  const { selection, directory } = useSession();
  const member = useMember();
  const vessel = selection?.vessel ?? ALL_VESSELS;
  const vesselName =
    vessel === ALL_VESSELS ? "All vessels" : (directory?.vessels.find((v) => v.id === vessel)?.name ?? "Vessel");

  const [filter, setFilter] = useState<WorkOrderFilter>("all");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search);

  // Page resets to the first page whenever what is being listed changes.
  const listKey = `${member.id}|${vessel}|${filter}|${debouncedSearch}`;
  const [pageState, setPageState] = useState({ key: listKey, page: 0 });
  const page = pageState.key === listKey ? pageState.page : 0;

  // The open work order belongs to the member who opened it.
  const [opened, setOpened] = useState<{ memberId: string; id: number } | null>(null);
  const openId = opened?.memberId === member.id ? opened.id : null;
  const [creating, setCreating] = useState(false);

  const stats = useWorkOrderStats(vessel);
  const list = useWorkOrders({ vessel, filter, search: debouncedSearch, page });
  const canCreate = member.role === "Captain" && vessel !== ALL_VESSELS;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-sky-700">{member.role === "Crew" ? "My work orders" : "Work orders"}</p>
          <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900">{vesselName}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">{ROLE_HINTS[member.role]}</p>
        </div>
        {canCreate && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            New work order
          </Button>
        )}
      </div>

      <StatsCards stats={stats.data} loading={stats.isPending} active={filter} onSelect={setFilter} />

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between">
          <FilterTabs value={filter} onChange={setFilter} />
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              type="search"
              placeholder="Search titles…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              aria-label="Search work orders by title"
            />
          </div>
        </div>

        <WorkOrderList
          result={list.data}
          loading={list.isPending}
          fetching={list.isFetching}
          error={list.error}
          onRetry={() => list.refetch()}
          showVessel={vessel === ALL_VESSELS}
          showAssignee={member.role !== "Crew"}
          page={page}
          pageSize={WORK_ORDER_PAGE_SIZE}
          onPageChange={(next) => setPageState({ key: listKey, page: next })}
          onOpen={(id) => setOpened({ memberId: member.id, id })}
          filtered={filter !== "all" || debouncedSearch.trim() !== ""}
          onClearFilters={() => {
            setFilter("all");
            setSearch("");
          }}
          emptyHint={
            member.role === "Captain"
              ? "Create a work order to get your crew started."
              : member.role === "Crew"
                ? "Nothing assigned to you here right now."
                : "Nothing matches this view."
          }
        />
      </section>

      {canCreate && (
        <CreateWorkOrderDialog
          open={creating}
          vesselId={vessel}
          vesselName={vesselName}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setOpened({ memberId: member.id, id });
          }}
        />
      )}

      <WorkOrderDetailSheet id={openId} onClose={() => setOpened(null)} />
    </div>
  );
}

const FILTERS: { value: WorkOrderFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "awaiting_review", label: "Awaiting review" },
  { value: "attested", label: "Attested" },
];

function FilterTabs({ value, onChange }: { value: WorkOrderFilter; onChange: (value: WorkOrderFilter) => void }) {
  return (
    <div role="group" aria-label="Filter by status" className="-mx-1 flex gap-1 overflow-x-auto px-1">
      {FILTERS.map((f) => (
        <button
          key={f.value}
          type="button"
          aria-pressed={value === f.value}
          onClick={() => onChange(f.value)}
          className={
            value === f.value
              ? "rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium whitespace-nowrap text-white"
              : "rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap text-slate-600 hover:bg-slate-100"
          }
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

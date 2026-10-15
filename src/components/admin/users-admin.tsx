"use client";

import { Pencil, Plus, RefreshCcw, Search, UserCheck, UserX } from "lucide-react";
import { useState } from "react";
import { useMember } from "@/components/session/session-provider";
import { ActiveBadge, RoleBadge } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input, Select } from "@/components/ui/form";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { MEMBER_PAGE_SIZE, resetDemoData, setMemberActive, type MemberQuery } from "@/lib/api/admin";
import { errorMessage } from "@/lib/api/errors";
import { useMembers, useVesselSummaries } from "@/lib/hooks/queries";
import { useAppMutation } from "@/lib/hooks/use-app-mutation";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { ROLES, type Member } from "@/lib/types";
import { MemberFormDialog } from "./member-form-dialog";

export function UsersAdmin() {
  const me = useMember();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<MemberQuery["role"]>("all");
  const [status, setStatus] = useState<MemberQuery["status"]>("active");
  const debouncedSearch = useDebounced(search);

  const listKey = `${debouncedSearch}|${role}|${status}`;
  const [pageState, setPageState] = useState({ key: listKey, page: 0 });
  const page = pageState.key === listKey ? pageState.page : 0;

  const members = useMembers({ search: debouncedSearch, role, status, page });
  const vessels = useVesselSummaries();
  const vesselName = (id: string) => vessels.data?.find((v) => v.id === id)?.name ?? "…";

  const [editing, setEditing] = useState<Member | "new" | null>(null);
  const [toggling, setToggling] = useState<Member | null>(null);
  const [resetting, setResetting] = useState(false);

  const toggleActive = useAppMutation((s, m: Member) => setMemberActive(s, m.id, !m.is_active), {
    success: (_, m) => (m.is_active ? `${m.full_name} deactivated.` : `${m.full_name} reactivated.`),
    invalidate: ["members", "vessels", "roster", "crew"],
    refreshSession: true,
    onSuccess: () => setToggling(null),
  });

  const reset = useAppMutation((s) => resetDemoData(s), {
    success: "Demo data restored.",
    invalidate: ["members", "vessels", "roster", "crew", "work-orders", "work-order", "stats"],
    refreshSession: true,
    onSuccess: () => setResetting(false),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Users</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Create users, set their role and vessels, or deactivate them. Users are never deleted, so work order history
            stays intact.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setResetting(true)}>
            <RefreshCcw className="size-4" aria-hidden />
            Reset demo data
          </Button>
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden />
            New user
          </Button>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="grid gap-2 border-b border-slate-200 p-3 sm:grid-cols-[1fr_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              type="search"
              placeholder="Search name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              aria-label="Search users"
            />
          </div>
          <Select value={role} onChange={(e) => setRole(e.target.value as MemberQuery["role"])} aria-label="Filter by role">
            <option value="all">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value as MemberQuery["status"])} aria-label="Filter by status">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </Select>
        </div>

        {members.error && !members.data ? (
          <ErrorState message={errorMessage(members.error)} onRetry={() => members.refetch()} />
        ) : members.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : members.data.rows.length === 0 ? (
          <EmptyState
            title="No users found"
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setRole("all");
                  setStatus("active");
                }}
              >
                Clear filters
              </Button>
            }
          >
            Nothing matches the current search or filters.
          </EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {members.data.rows.map((m) => (
                <li key={m.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                      {m.full_name}
                      <RoleBadge role={m.role} />
                      {!m.is_active && <ActiveBadge active={false} />}
                      {m.id === me.id && <span className="text-xs font-normal text-slate-500">(you)</span>}
                    </p>
                    <p className="truncate text-sm text-slate-500">{m.email}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {m.role === "Admin"
                        ? "Fleet-wide"
                        : m.vessel_ids.length === 0
                          ? "Not assigned to a vessel"
                          : m.vessel_ids.map(vesselName).join(" · ")}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setEditing(m)}>
                      <Pencil className="size-3.5" aria-hidden />
                      Edit
                    </Button>
                    <Button
                      variant={m.is_active ? "ghost" : "secondary"}
                      size="sm"
                      onClick={() => setToggling(m)}
                      disabled={m.id === me.id && m.is_active}
                      title={m.id === me.id ? "Switch to another Admin to deactivate yourself" : undefined}
                    >
                      {m.is_active ? <UserX className="size-3.5" aria-hidden /> : <UserCheck className="size-3.5" aria-hidden />}
                      {m.is_active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <Pagination
              page={page}
              pageSize={MEMBER_PAGE_SIZE}
              total={members.data.total}
              onPageChange={(next) => setPageState({ key: listKey, page: next })}
              loading={members.isFetching}
            />
          </>
        )}
      </section>

      {editing && <MemberFormDialog member={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        open={toggling !== null}
        title={toggling?.is_active ? `Deactivate ${toggling.full_name}?` : `Reactivate ${toggling?.full_name ?? ""}?`}
        confirmLabel={toggling?.is_active ? "Deactivate" : "Reactivate"}
        variant={toggling?.is_active ? "danger" : "primary"}
        loading={toggleActive.isPending}
        onConfirm={() => toggling && toggleActive.mutate(toggling)}
        onClose={() => setToggling(null)}
      >
        {toggling?.is_active ? (
          <>
            They disappear from the member switcher and lose access immediately. This is refused while they still hold
            active work orders, or if they are the only captain left to review a vessel&apos;s open work.
          </>
        ) : (
          <>They regain access to the vessels they are still assigned to.</>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={resetting}
        title="Reset demo data?"
        confirmLabel="Reset everything"
        loading={reset.isPending}
        onConfirm={() => reset.mutate(undefined)}
        onClose={() => setResetting(false)}
      >
        Rebuilds the demo fleet, users and work orders (including the 50,000 load-test work orders). Everything other
        reviewers changed is lost.
      </ConfirmDialog>
    </div>
  );
}

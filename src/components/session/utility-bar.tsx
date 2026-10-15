"use client";

import clsx from "clsx";
import { Anchor, ChevronDown, Loader2, UserRound } from "lucide-react";
import { useState } from "react";
import { membersFor, rolesFor } from "@/lib/session-rules";
import { ALL_VESSELS, ROLES, type Role } from "@/lib/types";
import { useSession } from "./session-provider";

const SELECT =
  "h-9 w-full rounded-md border border-white/15 bg-slate-800 px-2.5 pr-8 text-sm text-white " +
  "focus:border-sky-400 focus:ring-2 focus:ring-sky-400/30 focus:outline-none disabled:opacity-50";

/**
 * Mock authentication: three dependent dropdowns.
 *   Vessel -> Role (for that vessel) -> Member (active, that role, that vessel)
 * Picking a member switches the database session to that member immediately.
 */
export function UtilityBar() {
  const { status, directory, selection, member, switching, selectVessel, selectRole, selectMember } = useSession();
  const [expanded, setExpanded] = useState(false);
  const ready = status === "ready" && directory && selection;

  const allowedRoles = selection ? rolesFor(selection.vessel) : [];
  const members = ready ? membersFor(directory, selection.vessel, selection.role) : [];

  return (
    <header className="sticky top-0 z-40 bg-slate-900 text-white shadow-md">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-3 px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-md bg-sky-600">
            <Anchor className="size-4.5" aria-hidden />
          </span>
          <span className="leading-tight">
            FleetOps
            <span className="block text-[11px] font-normal text-slate-400">Work orders</span>
          </span>
        </div>

        {/* Acting-as chip; on phones it also toggles the switcher. */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-white/10 md:pointer-events-none lg:order-last"
          aria-expanded={expanded}
          aria-controls="session-switcher"
        >
          {switching ? (
            <Loader2 className="size-5 shrink-0 animate-spin text-sky-300" aria-label="Switching member" />
          ) : (
            <UserRound className="size-5 shrink-0 text-sky-300" aria-hidden />
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{member?.full_name ?? "Starting session…"}</span>
            <span className="block text-[11px] text-slate-400">{member ? `Acting as ${member.role}` : " "}</span>
          </span>
          <ChevronDown className={clsx("size-4 shrink-0 text-slate-400 transition md:hidden", expanded && "rotate-180")} />
        </button>

        <div
          id="session-switcher"
          className={clsx(
            // Phones: collapsed behind the chip. Tablets: own row. Desktop: inline.
            "w-full grid-cols-1 gap-2 sm:grid-cols-3 md:grid lg:w-auto lg:max-w-3xl lg:flex-1",
            expanded ? "grid" : "hidden",
          )}
        >
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-medium tracking-wide text-slate-400 uppercase">1 · Vessel</span>
            <select
              className={SELECT}
              disabled={!ready}
              value={selection?.vessel ?? ""}
              onChange={(e) => selectVessel(e.target.value)}
            >
              {!ready && <option>Loading…</option>}
              {ready && (
                <>
                  {directory.vessels.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                  <option value={ALL_VESSELS}>All vessels (Admins)</option>
                </>
              )}
            </select>
          </label>

          <label className="block">
            <span className="mb-0.5 block text-[11px] font-medium tracking-wide text-slate-400 uppercase">2 · Role</span>
            <select
              className={SELECT}
              disabled={!ready}
              value={selection?.role ?? ""}
              onChange={(e) => selectRole(e.target.value as Role)}
            >
              {ready &&
                ROLES.map((role) => {
                  const count = membersFor(directory, selection.vessel, role).length;
                  const enabled = allowedRoles.includes(role) && count > 0;
                  return (
                    <option key={role} value={role} disabled={!enabled}>
                      {role} ({count})
                    </option>
                  );
                })}
            </select>
          </label>

          <label className="block">
            <span className="mb-0.5 block text-[11px] font-medium tracking-wide text-slate-400 uppercase">3 · Member</span>
            <select
              className={SELECT}
              disabled={!ready || members.length === 0}
              value={selection?.memberId ?? ""}
              onChange={(e) => {
                selectMember(e.target.value);
                setExpanded(false);
              }}
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </header>
  );
}

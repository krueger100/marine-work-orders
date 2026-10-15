"use client";

import { CheckCircle2, History, Play, RotateCcw, Send, UserRoundCog } from "lucide-react";
import { useState } from "react";
import { useMember } from "@/components/session/session-provider";
import { StatusBadges } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/states";
import { errorMessage } from "@/lib/api/errors";
import {
  attestWorkOrder,
  completeWorkOrder,
  reassignWorkOrder,
  rejectWorkOrder,
  saveWorkOrderSolution,
  startWorkOrder,
} from "@/lib/api/work-orders";
import { EVENT_LABELS, formatDateTime, formatWorkOrderId } from "@/lib/format";
import { useAssignableCrew, useWorkOrder } from "@/lib/hooks/queries";
import { useAppMutation, type QueryRoot } from "@/lib/hooks/use-app-mutation";
import type { WorkOrderDetail } from "@/lib/types";
import { rejectionSchema, solutionSchema } from "@/lib/validation";

const REFRESH: QueryRoot[] = ["work-orders", "work-order", "stats"];

export function WorkOrderDetailSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  const query = useWorkOrder(id);
  const wo = query.data;

  return (
    <Dialog
      open={id !== null}
      onClose={onClose}
      variant="sheet"
      title={id !== null ? formatWorkOrderId(id) : ""}
      description={wo ? <StatusBadges status={wo.status} attestedAt={wo.attested_at} rejectionCount={wo.rejection_count} /> : null}
    >
      {query.isPending ? (
        <Spinner label="Loading work order" className="py-10" />
      ) : query.error ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : !wo ? (
        <EmptyState title="Not available">This work order does not exist or is not visible to the current member.</EmptyState>
      ) : (
        <WorkOrderDetailBody wo={wo} />
      )}
    </Dialog>
  );
}

function WorkOrderDetailBody({ wo }: { wo: WorkOrderDetail }) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold text-slate-900">{wo.title}</h3>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <Meta label="Vessel" value={wo.vessel?.name} />
          <Meta label="Assigned to" value={wo.assignee?.full_name} />
          <Meta label="Created by" value={wo.creator?.full_name} />
          <Meta label="Created" value={formatDateTime(wo.created_at)} />
          <Meta label="Last updated" value={formatDateTime(wo.updated_at)} />
          {wo.attested_at && <Meta label="Attested" value={`${wo.attester?.full_name ?? "—"}, ${formatDateTime(wo.attested_at)}`} />}
        </dl>
      </div>

      {wo.status === "In Progress" && wo.rejection_count > 0 && wo.last_rejection_reason && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm">
          <p className="font-medium text-rose-900">Sent back by the captain</p>
          <p className="mt-1 whitespace-pre-wrap text-rose-800">{wo.last_rejection_reason}</p>
        </div>
      )}

      <Section title="Issue">
        <p className="whitespace-pre-wrap text-slate-700">{wo.issue}</p>
      </Section>

      <ActionPanel wo={wo} />

      <Section title="History" icon={<History className="size-4" aria-hidden />}>
        {wo.events.length === 0 ? (
          <p className="text-sm text-slate-500">No history recorded (generated load-test data).</p>
        ) : (
          <ol className="space-y-3 border-l border-slate-200 pl-4">
            {wo.events.map((e) => (
              <li key={e.id} className="relative text-sm">
                <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-white bg-slate-400" aria-hidden />
                <p className="text-slate-800">
                  <span className="font-medium">{EVENT_LABELS[e.event_type]}</span>
                  {e.actor && <> by {e.actor.full_name}</>}
                  <span className="text-slate-400"> · {formatDateTime(e.created_at)}</span>
                </p>
                {e.comment && <p className="mt-0.5 whitespace-pre-wrap text-slate-600">{e.comment}</p>}
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

/** Shows only the actions the acting member may take; the database re-checks every one. */
function ActionPanel({ wo }: { wo: WorkOrderDetail }) {
  const member = useMember();
  const attested = wo.attested_at !== null;
  const isAssignedCrew = member.role === "Crew" && wo.assigned_to === member.id;
  const isVesselCaptain = member.role === "Captain" && member.vessel_ids.includes(wo.vessel_id);

  if (isAssignedCrew && wo.status === "In Progress") {
    // Re-mount the editor when the server copy changes (e.g. after a rejection).
    return <SolutionEditor key={`${wo.id}-${wo.updated_at}`} wo={wo} />;
  }

  return (
    <>
      <Section title="Solution">
        {wo.solution ? (
          <p className="whitespace-pre-wrap text-slate-700">{wo.solution}</p>
        ) : (
          <p className="text-sm text-slate-500 italic">Not documented yet.</p>
        )}
      </Section>

      {attested ? (
        <Notice>This work order is attested and closed. It can no longer change.</Notice>
      ) : isAssignedCrew && wo.status === "Open" ? (
        <StartWork id={wo.id} />
      ) : isAssignedCrew && wo.status === "Done" ? (
        <Notice>Marked Done. Waiting for the captain to attest or reject it.</Notice>
      ) : isVesselCaptain && wo.status === "Done" ? (
        <ReviewActions id={wo.id} />
      ) : isVesselCaptain ? (
        <Reassign wo={wo} />
      ) : member.role === "Admin" ? (
        <Notice>Admins have read-only access to work orders.</Notice>
      ) : null}
    </>
  );
}

function StartWork({ id }: { id: number }) {
  const start = useAppMutation((s, workOrderId: number) => startWorkOrder(s, workOrderId), {
    success: "Work started. Status is now In Progress.",
    invalidate: REFRESH,
  });
  return (
    <Button onClick={() => start.mutate(id)} loading={start.isPending}>
      <Play className="size-4" aria-hidden />
      Start work
    </Button>
  );
}

function SolutionEditor({ wo }: { wo: WorkOrderDetail }) {
  const [solution, setSolution] = useState(wo.solution ?? "");
  const [error, setError] = useState<string>();

  const save = useAppMutation((s, text: string) => saveWorkOrderSolution(s, wo.id, text), {
    success: "Solution saved.",
    invalidate: ["work-order"],
  });
  const complete = useAppMutation((s, text: string) => completeWorkOrder(s, wo.id, text), {
    success: "Marked Done and sent to the captain for review.",
    invalidate: REFRESH,
  });

  function markDone() {
    const parsed = solutionSchema.safeParse(solution);
    if (!parsed.success) {
      setError("Document the solution before marking the work order Done.");
      return;
    }
    setError(undefined);
    complete.mutate(parsed.data);
  }

  const busy = save.isPending || complete.isPending;
  return (
    <Section title="Solution">
      <Field label="What did you do?" error={error} hint="Save a draft any time. Marking Done sends it to the captain.">
        {(a) => (
          <Textarea {...a} value={solution} onChange={(e) => setSolution(e.target.value)} rows={5} maxLength={4000} />
        )}
      </Field>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => save.mutate(solution)} loading={save.isPending} disabled={busy}>
          Save draft
        </Button>
        <Button variant="success" onClick={markDone} loading={complete.isPending} disabled={busy}>
          <Send className="size-4" aria-hidden />
          Mark as Done
        </Button>
      </div>
    </Section>
  );
}

function ReviewActions({ id }: { id: number }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();

  const attest = useAppMutation((s, workOrderId: number) => attestWorkOrder(s, workOrderId), {
    success: "Attested. The work order is closed.",
    invalidate: REFRESH,
  });
  const reject = useAppMutation((s, text: string) => rejectWorkOrder(s, id, text), {
    success: "Rejected and sent back to the crew member.",
    invalidate: REFRESH,
  });

  function submitRejection() {
    const parsed = rejectionSchema.safeParse(reason);
    if (!parsed.success) {
      setError("Give a reason of at least 5 characters so the crew knows what to fix.");
      return;
    }
    setError(undefined);
    reject.mutate(parsed.data);
  }

  return (
    <Section title="Captain's review">
      {!rejecting ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="success" onClick={() => attest.mutate(id)} loading={attest.isPending}>
            <CheckCircle2 className="size-4" aria-hidden />
            Attest
          </Button>
          <Button variant="secondary" onClick={() => setRejecting(true)} disabled={attest.isPending}>
            <RotateCcw className="size-4" aria-hidden />
            Reject…
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Rejection reason" required error={error} hint="The crew member sees this when the work comes back.">
            {(a) => <Textarea {...a} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={2000} autoFocus />}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" onClick={submitRejection} loading={reject.isPending}>
              Send back to crew
            </Button>
            <Button variant="ghost" onClick={() => setRejecting(false)} disabled={reject.isPending}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}

function Reassign({ wo }: { wo: WorkOrderDetail }) {
  const crew = useAssignableCrew(wo.vessel_id);
  const [assignee, setAssignee] = useState(wo.assigned_to);
  const reassign = useAppMutation((s, to: string) => reassignWorkOrder(s, wo.id, to), {
    success: "Work order reassigned.",
    invalidate: REFRESH,
  });

  return (
    <Section title="Assignment" icon={<UserRoundCog className="size-4" aria-hidden />}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field label="Assigned crew member">
            {(a) => (
              <Select {...a} value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={crew.isPending}>
                {!crew.data?.some((c) => c.id === wo.assigned_to) && (
                  <option value={wo.assigned_to}>{wo.assignee?.full_name ?? "Current assignee"}</option>
                )}
                {crew.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Button
          variant="secondary"
          onClick={() => reassign.mutate(assignee)}
          loading={reassign.isPending}
          disabled={assignee === wo.assigned_to}
        >
          Reassign
        </Button>
      </div>
    </Section>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {icon}
        {title}
      </h4>
      {children}
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="truncate text-slate-800">{value ?? "—"}</dd>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">{children}</p>;
}

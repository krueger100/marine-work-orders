"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { createWorkOrder } from "@/lib/api/work-orders";
import { formatWorkOrderId } from "@/lib/format";
import { useAssignableCrew } from "@/lib/hooks/queries";
import { useAppMutation } from "@/lib/hooks/use-app-mutation";
import { fieldErrors, workOrderSchema } from "@/lib/validation";

interface Props {
  open: boolean;
  vesselId: string;
  vesselName: string;
  onClose: () => void;
  onCreated: (id: number) => void;
}

const EMPTY = { title: "", issue: "", assignedTo: "" };

export function CreateWorkOrderDialog({ open, vesselId, vesselName, onClose, onCreated }: Props) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const crew = useAssignableCrew(open ? vesselId : null);

  const create = useAppMutation(createWorkOrder, {
    success: (id) => `${formatWorkOrderId(id)} created and assigned.`,
    invalidate: ["work-orders", "stats"],
    onSuccess: (id) => {
      setForm(EMPTY);
      onCreated(id);
    },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = workOrderSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    create.mutate({ vesselId, ...parsed.data });
  }

  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New work order"
      description={<>For <b className="font-medium text-slate-700">{vesselName}</b>. It starts as Open.</>}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="create-work-order" loading={create.isPending}>
            Create work order
          </Button>
        </>
      }
    >
      <form id="create-work-order" onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Title" required error={errors.title}>
          {(a) => <Input {...a} value={form.title} onChange={set("title")} maxLength={120} placeholder="e.g. Port stabilizer fin hydraulic leak" />}
        </Field>
        <Field label="Issue" required error={errors.issue} hint="What is wrong, where, and anything the crew should know.">
          {(a) => <Textarea {...a} value={form.issue} onChange={set("issue")} maxLength={4000} rows={4} />}
        </Field>
        <Field
          label="Assign to"
          required
          error={errors.assignedTo}
          hint={crew.data?.length === 0 ? "No active crew serve on this vessel yet. An Admin can assign some." : undefined}
        >
          {(a) => (
            <Select {...a} value={form.assignedTo} onChange={set("assignedTo")} disabled={crew.isPending}>
              <option value="">{crew.isPending ? "Loading crew…" : "Choose a crew member"}</option>
              {crew.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </form>
    </Dialog>
  );
}

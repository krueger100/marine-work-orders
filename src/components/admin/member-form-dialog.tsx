"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { createMember, updateMember, type MemberInput } from "@/lib/api/admin";
import { useVesselSummaries } from "@/lib/hooks/queries";
import { useAppMutation } from "@/lib/hooks/use-app-mutation";
import { ROLES, type Member, type Role } from "@/lib/types";
import { fieldErrors, memberSchema } from "@/lib/validation";

interface Props {
  /** null = create a new user. */
  member: Member | null;
  onClose: () => void;
}

/** Create or edit a user: details, role and vessel assignments, saved in one transaction. */
export function MemberFormDialog({ member, onClose }: Props) {
  const [form, setForm] = useState<MemberInput>({
    fullName: member?.full_name ?? "",
    email: member?.email ?? "",
    role: member?.role ?? "Crew",
    vesselIds: member?.vessel_ids ?? [],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const vessels = useVesselSummaries();

  const save = useAppMutation(
    (s, input: MemberInput) => (member ? updateMember(s, member.id, input) : createMember(s, input).then(() => undefined)),
    {
      success: member ? "User updated." : "User created.",
      invalidate: ["members", "vessels", "roster", "crew"],
      refreshSession: true,
      onSuccess: onClose,
    },
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = memberSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  }

  function toggleVessel(id: string, checked: boolean) {
    setForm((f) => ({
      ...f,
      vesselIds: checked ? [...f.vesselIds, id] : f.vesselIds.filter((v) => v !== id),
    }));
  }

  // Active vessels can be picked; an inactive vessel stays listed only if already assigned.
  const vesselOptions = (vessels.data ?? []).filter((v) => v.is_active || form.vesselIds.includes(v.id));

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={member ? `Edit ${member.full_name}` : "New user"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="member-form" loading={save.isPending}>
            {member ? "Save changes" : "Create user"}
          </Button>
        </>
      }
    >
      <form id="member-form" onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required error={errors.fullName}>
            {(a) => (
              <Input {...a} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} maxLength={100} />
            )}
          </Field>
          <Field label="Email" required error={errors.email} hint="Must be unique across the fleet.">
            {(a) => (
              <Input {...a} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={254} />
            )}
          </Field>
        </div>

        <Field
          label="Role"
          required
          error={errors.role}
          hint={member && member.role !== form.role ? "Changing a role is refused if it would leave active work orders without an owner." : undefined}
        >
          {(a) => (
            <Select {...a} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">Vessel assignments</legend>
          {form.role === "Admin" ? (
            <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">
              Admins are fleet-wide and are not assigned to vessels. Existing assignments are removed.
            </p>
          ) : vessels.isPending ? (
            <p className="text-sm text-slate-500">Loading vessels…</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {vesselOptions.map((v) => (
                <label
                  key={v.id}
                  className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm has-checked:border-sky-600 has-checked:bg-sky-50"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-sky-700"
                    checked={form.vesselIds.includes(v.id)}
                    onChange={(e) => toggleVessel(v.id, e.target.checked)}
                  />
                  <span className="min-w-0 flex-1 truncate">{v.name}</span>
                  {!v.is_active && <span className="text-xs text-slate-400">inactive</span>}
                </label>
              ))}
            </div>
          )}
          {form.role !== "Admin" && (
            <p className="text-xs text-slate-500">
              {form.role === "Crew" ? "Crew" : "Captains"} only see work orders on the vessels ticked here.
            </p>
          )}
        </fieldset>
      </form>
    </Dialog>
  );
}

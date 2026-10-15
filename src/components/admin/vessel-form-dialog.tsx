"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { createVessel, updateVessel, type VesselInput } from "@/lib/api/admin";
import { useAppMutation } from "@/lib/hooks/use-app-mutation";
import type { VesselSummary } from "@/lib/types";
import { fieldErrors, vesselSchema } from "@/lib/validation";

const VESSEL_TYPES = ["Cruise ship", "Expedition yacht", "Ferry", "Tender", "Support vessel"];

export function VesselFormDialog({ vessel, onClose }: { vessel: VesselSummary | null; onClose: () => void }) {
  const [form, setForm] = useState<VesselInput>({
    name: vessel?.name ?? "",
    imoNumber: vessel?.imo_number ?? "",
    vesselType: vessel?.vessel_type ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useAppMutation(
    (s, input: VesselInput) => (vessel ? updateVessel(s, vessel.id, input) : createVessel(s, input).then(() => undefined)),
    {
      success: vessel ? "Vessel updated." : "Vessel created.",
      invalidate: ["vessels"],
      refreshSession: true,
      onSuccess: onClose,
    },
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = vesselSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={vessel ? `Edit ${vessel.name}` : "New vessel"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="vessel-form" loading={save.isPending}>
            {vessel ? "Save changes" : "Create vessel"}
          </Button>
        </>
      }
    >
      <form id="vessel-form" onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Name" required error={errors.name}>
          {(a) => <Input {...a} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} placeholder="MV Ocean Example" />}
        </Field>
        <Field label="IMO number" required error={errors.imoNumber} hint="7 digits; the last is a check digit (e.g. 9387425).">
          {(a) => (
            <Input
              {...a}
              value={form.imoNumber}
              onChange={(e) => setForm({ ...form, imoNumber: e.target.value })}
              inputMode="numeric"
              maxLength={7}
              className="font-mono"
            />
          )}
        </Field>
        <Field label="Type" required error={errors.vesselType}>
          {(a) => (
            <>
              <Input {...a} list="vessel-types" value={form.vesselType} onChange={(e) => setForm({ ...form, vesselType: e.target.value })} maxLength={40} />
              <datalist id="vessel-types">
                {VESSEL_TYPES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </>
          )}
        </Field>
      </form>
    </Dialog>
  );
}

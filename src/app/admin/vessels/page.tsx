import { VesselsAdmin } from "@/components/admin/vessels-admin";
import { AdminGate } from "@/components/session/session-gate";

// Rendered behind the client-side session gate (see app/page.tsx).
export const instant = false;

export default function VesselsPage() {
  return (
    <AdminGate>
      <VesselsAdmin />
    </AdminGate>
  );
}

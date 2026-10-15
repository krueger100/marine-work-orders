import { UsersAdmin } from "@/components/admin/users-admin";
import { AdminGate } from "@/components/session/session-gate";

// Rendered behind the client-side session gate (see app/page.tsx).
export const instant = false;

export default function UsersPage() {
  return (
    <AdminGate>
      <UsersAdmin />
    </AdminGate>
  );
}

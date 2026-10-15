import { WorkOrdersDashboard } from "@/components/work-orders/work-orders-dashboard";

// Content renders only after the client-side session gate resolves the acting
// member, so there is no server-rendered page UI to validate as instant.
export const instant = false;

export default function HomePage() {
  return <WorkOrdersDashboard />;
}

"use client";

import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { useSession } from "./session-provider";

/** Renders children only once this tab is acting as a member. */
export function SessionGate({ children }: { children: React.ReactNode }) {
  const { status, error, member, retry } = useSession();

  if (status === "error") {
    return <ErrorState title="Could not start a session" message={error ?? undefined} onRetry={retry} />;
  }
  if (status === "loading") {
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (!member) {
    return <EmptyState title="Nobody to act as">There are no active members in the fleet yet.</EmptyState>;
  }
  return <>{children}</>;
}

/** Admin pages: the UI hides them from other roles; the database refuses them anyway. */
export function AdminGate({ children }: { children: React.ReactNode }) {
  const { member } = useSession();
  if (member?.role !== "Admin") {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <ShieldAlert className="size-10 text-slate-300" aria-hidden />
        <p className="font-medium text-slate-800">Admins only</p>
        <p className="max-w-sm text-sm text-slate-500">
          Switch to an Admin in the top bar to manage users and vessels.
        </p>
        <Link href="/" className="text-sm font-medium text-sky-700 hover:underline">
          Back to work orders
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}

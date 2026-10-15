import clsx from "clsx";
import { StatusBadges } from "@/components/ui/badges";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { errorMessage } from "@/lib/api/errors";
import { formatRelative, formatWorkOrderId } from "@/lib/format";
import type { Page, WorkOrderListItem } from "@/lib/types";

interface WorkOrderListProps {
  result: Page<WorkOrderListItem> | undefined;
  loading: boolean;
  fetching: boolean;
  error: Error | null;
  onRetry: () => void;
  showVessel: boolean;
  showAssignee: boolean;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onOpen: (id: number) => void;
  emptyHint: string;
  /** True when a status filter or search is narrowing the list. */
  filtered: boolean;
  onClearFilters: () => void;
}

/** Table on wide screens, cards on phones; both open the detail sheet. */
export function WorkOrderList(props: WorkOrderListProps) {
  const { result, loading, fetching, error, onRetry, showVessel, showAssignee, onOpen, emptyHint, filtered, onClearFilters } =
    props;

  if (error && !result) return <ErrorState message={errorMessage(error)} onRetry={onRetry} />;
  if (loading && !result) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  }
  if (!result || result.rows.length === 0) {
    return filtered ? (
      <EmptyState
        title="No matching work orders"
        action={
          <Button variant="secondary" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        }
      >
        Nothing matches the current status filter or search.
      </EmptyState>
    ) : (
      <EmptyState title="No work orders">{emptyHint}</EmptyState>
    );
  }

  return (
    <div className={clsx("transition-opacity", fetching && "opacity-60")}>
      {/* Phones */}
      <ul className="divide-y divide-slate-100 md:hidden">
        {result.rows.map((wo) => (
          <li key={wo.id}>
            <button type="button" onClick={() => onOpen(wo.id)} className="w-full space-y-1.5 px-4 py-3 text-left hover:bg-slate-50">
              <span className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-slate-500">{formatWorkOrderId(wo.id)}</span>
                <span className="text-xs text-slate-500">{formatRelative(wo.updated_at)}</span>
              </span>
              <span className="block font-medium text-slate-900">{wo.title}</span>
              <StatusBadges status={wo.status} attestedAt={wo.attested_at} rejectionCount={wo.rejection_count} />
              {(showAssignee || showVessel) && (
                <span className="block text-xs text-slate-500">
                  {showAssignee && <>Assigned to {wo.assignee?.full_name ?? "—"}</>}
                  {showAssignee && showVessel && " · "}
                  {showVessel && wo.vessel?.name}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {/* Tablets and up */}
      <table className="hidden w-full text-sm md:table">
        <thead className="bg-slate-50 text-left text-xs font-medium tracking-wide text-slate-500 uppercase">
          <tr>
            <th scope="col" className="px-4 py-2.5">ID</th>
            <th scope="col" className="px-4 py-2.5">Title</th>
            <th scope="col" className="px-4 py-2.5">Status</th>
            {showAssignee && <th scope="col" className="px-4 py-2.5">Assigned to</th>}
            {showVessel && <th scope="col" className="px-4 py-2.5">Vessel</th>}
            <th scope="col" className="px-4 py-2.5 text-right">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {result.rows.map((wo) => (
            <tr key={wo.id} onClick={() => onOpen(wo.id)} className="cursor-pointer hover:bg-slate-50">
              <td className="px-4 py-3 font-mono text-xs whitespace-nowrap text-slate-500">{formatWorkOrderId(wo.id)}</td>
              <td className="max-w-md px-4 py-3">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(wo.id);
                  }}
                  className="text-left font-medium text-slate-900 hover:text-sky-700 hover:underline"
                >
                  {wo.title}
                </button>
              </td>
              <td className="px-4 py-3">
                <StatusBadges status={wo.status} attestedAt={wo.attested_at} rejectionCount={wo.rejection_count} />
              </td>
              {showAssignee && <td className="px-4 py-3 whitespace-nowrap text-slate-700">{wo.assignee?.full_name ?? "—"}</td>}
              {showVessel && <td className="px-4 py-3 whitespace-nowrap text-slate-700">{wo.vessel?.name ?? "—"}</td>}
              <td className="px-4 py-3 text-right whitespace-nowrap text-slate-500">{formatRelative(wo.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Pagination
        page={props.page}
        pageSize={props.pageSize}
        total={result.total}
        onPageChange={props.onPageChange}
        loading={fetching}
      />
    </div>
  );
}

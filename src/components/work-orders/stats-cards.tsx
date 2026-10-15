import clsx from "clsx";
import { formatNumber } from "@/lib/format";
import type { WorkOrderFilter, WorkOrderStats } from "@/lib/types";
import { Skeleton } from "@/components/ui/states";

const CARDS: { filter: WorkOrderFilter; key: keyof WorkOrderStats; label: string; accent: string }[] = [
  { filter: "open", key: "open", label: "Open", accent: "bg-sky-500" },
  { filter: "in_progress", key: "in_progress", label: "In progress", accent: "bg-amber-500" },
  { filter: "awaiting_review", key: "awaiting_review", label: "Awaiting review", accent: "bg-violet-500" },
  { filter: "attested", key: "attested", label: "Attested", accent: "bg-emerald-500" },
];

interface StatsCardsProps {
  stats: WorkOrderStats | undefined;
  loading: boolean;
  active: WorkOrderFilter;
  onSelect: (filter: WorkOrderFilter) => void;
}

/** Status counters; clicking one filters the list (clicking again clears it). */
export function StatsCards({ stats, loading, active, onSelect }: StatsCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {CARDS.map((card) => {
        const selected = active === card.filter;
        return (
          <button
            key={card.key}
            type="button"
            onClick={() => onSelect(selected ? "all" : card.filter)}
            aria-pressed={selected}
            className={clsx(
              "rounded-xl border bg-white p-4 text-left shadow-xs transition hover:border-slate-300",
              selected ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200",
            )}
          >
            <span className="flex items-center gap-2 text-sm text-slate-600">
              <span className={clsx("size-2 rounded-full", card.accent)} aria-hidden />
              {card.label}
            </span>
            {loading || !stats ? (
              <Skeleton className="mt-2 h-7 w-16" />
            ) : (
              <span className="mt-1 block text-2xl font-semibold text-slate-900 tabular-nums">
                {formatNumber(stats[card.key])}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

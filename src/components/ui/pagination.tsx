import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { Button } from "./button";

interface PaginationProps {
  page: number; // 0-based
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  loading?: boolean;
}

export function Pagination({ page, pageSize, total, onPageChange, loading }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  return (
    <nav className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3" aria-label="Pagination">
      <p className="text-sm text-slate-600">
        {total === 0 ? "No results" : <>Showing <b>{formatNumber(from)}</b>–<b>{formatNumber(to)}</b> of <b>{formatNumber(total)}</b></>}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page === 0 || loading}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="text-sm text-slate-600 tabular-nums">
          {page + 1} / {formatNumber(pageCount)}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page + 1 >= pageCount || loading}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </nav>
  );
}

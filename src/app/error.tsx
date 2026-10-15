"use client"; // Error boundaries must be Client Components

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Shown instead of a page when it crashes while rendering; the top bar stays usable. */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <AlertTriangle className="size-10 text-amber-500" aria-hidden />
      <h1 className="text-lg font-semibold text-slate-900">Something went wrong on this page</h1>
      <p className="text-sm text-slate-600">
        The problem was not caused by anything you did. Try again, or go back to the work orders.
      </p>
      <div className="mt-2 flex gap-2">
        <Button onClick={() => retry()}>Try again</Button>
        <Link
          href="/"
          className="inline-flex h-10 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          Back to work orders
        </Link>
      </div>
    </div>
  );
}

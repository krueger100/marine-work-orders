"use client";

import clsx from "clsx";
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** "center" = modal dialog; "sheet" = full-height panel from the right (full screen on phones). */
  variant?: "center" | "sheet";
  size?: "md" | "lg";
}

/**
 * Accessible modal built on the native <dialog> element: focus trapping,
 * Escape to close and the backdrop come from the browser.
 */
export function Dialog({ open, onClose, title, description, children, footer, variant = "center", size = "md" }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  // Close on a backdrop click only if the press also started on the backdrop,
  // so selecting text and releasing outside the panel never closes it.
  const pressStartedOnBackdrop = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onPointerDown={(event) => {
        pressStartedOnBackdrop.current = event.target === ref.current;
      }}
      onClick={(event) => {
        if (pressStartedOnBackdrop.current && event.target === ref.current) onClose();
        pressStartedOnBackdrop.current = false;
      }}
      className={clsx(
        "bg-transparent p-0 text-slate-900 backdrop:bg-slate-950/50 backdrop:backdrop-blur-[1px]",
        variant === "center" && "m-auto w-[calc(100%-2rem)]",
        variant === "center" && (size === "lg" ? "max-w-2xl" : "max-w-lg"),
        variant === "sheet" && "m-0 ml-auto h-dvh max-h-dvh w-full max-w-2xl",
      )}
    >
      {open && (
        <div
          className={clsx(
            "flex flex-col bg-white shadow-xl",
            variant === "center" ? "max-h-[calc(100dvh-2rem)] rounded-xl" : "h-full",
          )}
        >
          <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
              {description && <div className="mt-0.5 text-sm text-slate-500">{description}</div>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-1 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              aria-label="Close"
            >
              <X className="size-5" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</footer>
          )}
        </div>
      )}
    </dialog>
  );
}

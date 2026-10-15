import type { WorkOrderEventType } from "./types";

export function formatWorkOrderId(id: number): string {
  return `WO-${String(id).padStart(6, "0")}`;
}

const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const dateOnly = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

export function formatDate(iso: string): string {
  return dateOnly.format(new Date(iso));
}

const relative = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

export function formatRelative(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export const EVENT_LABELS: Record<WorkOrderEventType, string> = {
  created: "Created",
  started: "Started work",
  completed: "Marked Done",
  attested: "Attested",
  rejected: "Rejected",
  reassigned: "Reassigned",
};

export function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

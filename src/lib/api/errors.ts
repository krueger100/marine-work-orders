import type { PostgrestError } from "@supabase/supabase-js";

/** An error whose message is safe and useful to show to the user. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "AppError";
  }

  /** The acting member is gone (deactivated, or the session was reset). */
  get isSessionLost(): boolean {
    return this.code === "28000";
  }
}

/**
 * Converts a Supabase error into an AppError. Database functions raise
 * human-readable messages, so they are passed through as-is.
 */
export function toAppError(error: PostgrestError | Error): AppError {
  if (error instanceof AppError) return error;
  if ("code" in error && typeof error.code === "string") {
    return new AppError(error.message, error.code);
  }
  return new AppError(error.message || "Something went wrong. Please try again.");
}

/** Unwraps a Supabase response, throwing an AppError on failure. */
export function unwrap<T>(response: { data: T | null; error: PostgrestError | null }): T {
  if (response.error) throw toAppError(response.error);
  return response.data as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

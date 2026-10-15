import type { PostgrestError } from "@supabase/supabase-js";

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

// PostgREST error codes for a missing, malformed or expired JWT.
const JWT_ERROR_CODES = new Set(["PGRST301", "PGRST302", "PGRST303"]);

/** An error whose message is safe and useful to show to the user. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AppError";
  }

  /** The acting member is gone (deactivated, or the session was reset). */
  get isSessionLost(): boolean {
    return this.code === "28000";
  }

  /** This tab's Supabase session is invalid, revoked or expired beyond refresh. */
  get isAuthFailure(): boolean {
    return this.status === 401 || (this.code !== undefined && JWT_ERROR_CODES.has(this.code));
  }

  /** The request never reached the server. */
  get isNetworkFailure(): boolean {
    return this.status === 0 || /failed to fetch|networkerror|load failed|fetch failed/i.test(this.message);
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

/**
 * Converts a Supabase (PostgREST or Auth) error into an AppError. Database
 * functions raise human-readable messages, so those are passed through as-is.
 */
export function toAppError(error: PostgrestError | Error | unknown, status?: number): AppError {
  if (error instanceof AppError) return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message, code } = error as { message?: unknown; code?: unknown };
    const authStatus = (error as { status?: unknown }).status; // Supabase Auth errors carry it
    return new AppError(
      typeof message === "string" && message ? message : GENERIC_MESSAGE,
      typeof code === "string" && code ? code : undefined,
      status ?? (typeof authStatus === "number" ? authStatus : undefined),
    );
  }
  return new AppError(GENERIC_MESSAGE);
}

/** Unwraps a Supabase response, throwing an AppError on failure. */
export function unwrap<T>(response: { data: T | null; error: PostgrestError | null; status?: number }): T {
  if (response.error) throw toAppError(response.error, response.status);
  return response.data as T;
}

/**
 * The text to show the user. Infrastructure failures get plain-language
 * explanations; validation and permission messages come from the database.
 */
export function errorMessage(error: unknown): string {
  const appError = toAppError(error);
  if (appError.isNetworkFailure) return "Can't reach the server. Check your connection and try again.";
  if (appError.isAuthFailure) return "Your session had expired, so a new one was started. Please try again.";
  if (appError.isRateLimited) return "Too many new sessions from this network. Please wait a few minutes and try again.";
  return appError.message;
}

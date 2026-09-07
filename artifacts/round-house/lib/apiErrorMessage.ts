import { ApiError } from "@workspace/api-client-react";

/**
 * True when `e` is the structured 402 the server returns for a paid
 * capability (see `artifacts/api-server/src/lib/capabilities.ts`).
 * The global PaywallSheet handles these — call sites should suppress
 * their inline error UI to avoid duplicate/conflicting messaging.
 */
export function isPaywallError(e: unknown): boolean {
  if (!(e instanceof ApiError) || e.status !== 402) return false;
  const data = e.data;
  if (!data || typeof data !== "object") return false;
  const cap = (data as Record<string, unknown>).capability;
  return cap === "create_property_records" || cap === "expanded_participation";
}

/**
 * Extract a human-readable error message from an unknown thrown value
 * without resorting to `any` casts. Server endpoints in this codebase
 * conventionally respond with `{ error: string }` on 4xx/5xx.
 *
 * Returns an empty string for structured paywall 402s so callers that
 * do `setError(extractApiErrorMessage(...))` won't render a duplicate
 * inline message alongside the global PaywallSheet.
 */
export function extractApiErrorMessage(e: unknown, fallback: string): string {
  if (isPaywallError(e)) return "";
  if (e instanceof ApiError) {
    const data = e.data;
    if (data && typeof data === "object" && "error" in data) {
      const value = (data as Record<string, unknown>).error;
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

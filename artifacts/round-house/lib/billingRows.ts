/**
 * Pure helper for the Billing screen's outward-account list ordering.
 *
 * The screen receives `accountId` as a search param (set by the global
 * paywall sheet's Enable handler — see `lib/paywallSheetCopy.ts`) and
 * must move the matching row to the top so it's the first thing the
 * user sees, plus paint a highlight border around it.
 *
 * Extracted from `app/account/billing.tsx` so it can be unit-tested
 * end-to-end alongside the paywall sheet behaviour (task #342).
 */
export interface OrderableBillingRow {
  outwardAccount: { id: number };
}

export function orderHighlightedFirst<R extends OrderableBillingRow>(
  rows: readonly R[],
  highlightId: number | null,
): R[] {
  if (highlightId == null) return [...rows];
  const hit = rows.find((r) => r.outwardAccount.id === highlightId);
  if (!hit) return [...rows];
  return [hit, ...rows.filter((r) => r.outwardAccount.id !== highlightId)];
}

export function isHighlightedRow(
  row: OrderableBillingRow,
  highlightId: number | null,
): boolean {
  return highlightId != null && row.outwardAccount.id === highlightId;
}

/**
 * Task #643 — single source of truth for "where does a Message tap land?".
 *
 * The inbox thread route (`/inbox/[otherUserId]`) accepts either the
 * counterpart's outward-account id (numeric — pins the exact skin
 * pair, matches what the inbox list does today) or the personal-clerk
 * id as a fallback for legacy rows that don't carry one.
 *
 * Callers also pass the personal-clerk id along as `?clerk=<id>` so
 * the blocked-state team-up CTA on the thread screen can call
 * `connectToUser(clerkId, …)` if the recipient hasn't accepted yet.
 */
export interface MessageTargetInput {
  clerkId: string;
  counterpartOutwardAccountId?: number | null;
  /**
   * Set when the row represents a counterpart skin that's been
   * retired (#340). Retired rows must not be tappable for messaging
   * — the helper short-circuits to null so the UI knows to hide the
   * Message control entirely.
   */
  counterpartArchivedAt?: string | null;
}

/**
 * Compose the deep-link href the Message control should navigate to.
 * Returns null when the row is not messageable (retired counterpart).
 */
export function messageHrefFor(input: MessageTargetInput): string | null {
  if (input.counterpartArchivedAt) return null;
  const target = input.counterpartOutwardAccountId ?? input.clerkId;
  const params = new URLSearchParams({
    compose: "1",
    clerk: input.clerkId,
  });
  return `/inbox/${encodeURIComponent(String(target))}?${params.toString()}`;
}

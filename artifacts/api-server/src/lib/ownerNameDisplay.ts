/**
 * #640 — Per-skin "show owner's last initial only" rendering helper.
 *
 * When a skin's `lastInitialOnly` flag is on, the owner-name surfaced on
 * that skin (People search row, public profile header, chat headers and
 * thread sender attributions, …) is rendered as `First L.` instead of
 * the owner's full name. Centralised here so every server-side response
 * path applies the same rule and the clients can keep rendering whatever
 * the server hands them.
 *
 * Whitespace-only first/last tokens degrade gracefully:
 *   - Single token (no last name) → returned as-is.
 *   - Empty / null → returned as-is.
 *   - Multiple middle tokens → only the very last token is initialised
 *     so "Mary Jo Van Houten" → "Mary Jo Van H." (matches how a
 *     person tends to introduce themselves on chat).
 */
export function formatOwnerNameForSkin(
  name: string | null | undefined,
  lastInitialOnly: boolean | null | undefined,
): string | null | undefined {
  if (!lastInitialOnly) return name;
  if (typeof name !== "string") return name;
  const trimmed = name.trim();
  if (!trimmed) return name;
  // Split on any whitespace run; if there's only one token, there's no
  // last name to abbreviate — return the original (don't strip the
  // sole token down to a single letter).
  const tokens = trimmed.split(/\s+/);
  if (tokens.length < 2) return name;
  const last = tokens[tokens.length - 1];
  const lead = tokens.slice(0, -1).join(" ");
  // Use the first character of the last token (preserves original
  // capitalisation in case it's already upper).
  const initial = last.charAt(0).toUpperCase();
  return `${lead} ${initial}.`;
}

/**
 * Default value for `outward_accounts.last_initial_only` when a skin is
 * being created. Owner-facing public-business kinds (trade_pro / home /
 * facilities) default OFF — those owners chose to be a public face.
 * Teammate and collab variants default ON so the team-member surface
 * never accidentally exposes the personal-profile last name of someone
 * who joined to help, not to be listed.
 */
import type { UserModeKind } from "@workspace/db";

const TRUE_DEFAULT_KINDS: ReadonlySet<UserModeKind> = new Set([
  "home_teammate",
  "trade_pro_teammate",
  "facilities_teammate",
  "trade_pro_collab",
  "facilities_collab",
]);

export function defaultLastInitialOnlyForKind(kind: UserModeKind): boolean {
  return TRUE_DEFAULT_KINDS.has(kind);
}

/**
 * #674 — Centralised insert-default merge for `outward_accounts`.
 *
 * Every code path that inserts an `outward_accounts` row should pipe
 * its `.values({...})` payload through this helper so the per-kind
 * `last_initial_only` rule from {@link defaultLastInitialOnlyForKind}
 * is applied uniformly. Callers may still pass an explicit boolean
 * (e.g. the POST /outward-accounts override) — that wins. Anything
 * non-boolean (undefined, null, string, number) falls back to the
 * per-kind default so a stray payload can't accidentally publish a
 * teammate / collab skin with the privacy toggle off.
 *
 * Returns a copy with `lastInitialOnly` always set to a strict boolean
 * so the inserted row is never relying on the schema-level `false`
 * default for kinds that should be ON.
 */
export function applyOutwardAccountKindDefaults<
  T extends { kind: UserModeKind; lastInitialOnly?: boolean | null },
>(values: T): T & { lastInitialOnly: boolean } {
  const explicit = values.lastInitialOnly;
  return {
    ...values,
    lastInitialOnly:
      typeof explicit === "boolean"
        ? explicit
        : defaultLastInitialOnlyForKind(values.kind),
  };
}

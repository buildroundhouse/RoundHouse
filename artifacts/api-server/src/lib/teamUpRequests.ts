/**
 * Task #663 retired the legacy team-up handshake. Avatar-to-avatar
 * connections no longer exist; "do these two share a workspace?" is
 * answered by `entity_members`.
 *
 * This module is intentionally thin — it now exists only as a
 * compatibility shim for the small set of callers (`routes/concierge.ts`,
 * `routes/properties.ts`) that still want a single yes/no for "can
 * these two avatars participate together". `hasAcceptedConnection`
 * resolves both outward accounts to their owners and asks the entity
 * layer.
 *
 * The compose helpers were removed alongside the team-up endpoints in
 * `routes/users.ts`. If you find yourself reaching for them, you're
 * probably re-introducing a flow this task explicitly removed; reach
 * for `autoCastMembership` and `entity_members` instead.
 */
import { ownerClerkIdsForOutwardAccounts, shareAnyEntity } from "./entityAccess";

/**
 * True when the two outward accounts' owners share at least one
 * approved entity. Replaces the old `user_connections`-based check.
 */
export async function hasAcceptedConnection(
  accountIdA: number,
  accountIdB: number,
): Promise<boolean> {
  if (accountIdA === accountIdB) return true;
  const owners = await ownerClerkIdsForOutwardAccounts([accountIdA, accountIdB]);
  const ownerA = owners.get(accountIdA);
  const ownerB = owners.get(accountIdB);
  if (!ownerA || !ownerB) return false;
  if (ownerA === ownerB) return true;
  return shareAnyEntity(ownerA, ownerB);
}

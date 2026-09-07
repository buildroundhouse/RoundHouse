/**
 * Task #663 — entity-membership access helpers.
 *
 * `canParticipateInEntity` is the single replacement for the old
 * `hasAcceptedConnection` gate. A user (via any of their avatars) can
 * participate in an entity if they have an `entity_members` row with
 * `status='approved'` and `archived_at IS NULL`.
 *
 * `sharedEntityIds` returns the entity ids both viewers participate
 * in. Used wherever we need the "do these two interact?" check.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, entityMembersTable, outwardAccountsTable } from "@workspace/db";

/** True iff the user is an approved member of the entity. */
export async function canParticipateInEntity(
  userClerkId: string,
  entityId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: entityMembersTable.id })
    .from(entityMembersTable)
    .where(
      and(
        eq(entityMembersTable.entityId, entityId),
        eq(entityMembersTable.userClerkId, userClerkId),
        eq(entityMembersTable.status, "approved"),
        isNull(entityMembersTable.archivedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Approved membership row for a user on a specific entity (or null). */
export async function getApprovedMembership(
  userClerkId: string,
  entityId: number,
) {
  const [row] = await db
    .select()
    .from(entityMembersTable)
    .where(
      and(
        eq(entityMembersTable.entityId, entityId),
        eq(entityMembersTable.userClerkId, userClerkId),
        eq(entityMembersTable.status, "approved"),
        isNull(entityMembersTable.archivedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Entity ids the given user participates in (status='approved'). */
export async function approvedEntityIdsFor(
  userClerkId: string,
): Promise<number[]> {
  const rows = await db
    .select({ entityId: entityMembersTable.entityId })
    .from(entityMembersTable)
    .where(
      and(
        eq(entityMembersTable.userClerkId, userClerkId),
        eq(entityMembersTable.status, "approved"),
        isNull(entityMembersTable.archivedAt),
      ),
    );
  return [...new Set(rows.map((r) => r.entityId))];
}

/**
 * Entity ids both `userA` and `userB` participate in. Used for the
 * "do these two share a workspace?" check that replaces avatar-pair
 * connections.
 */
export async function sharedEntityIds(
  userAClerkId: string,
  userBClerkId: string,
): Promise<number[]> {
  if (userAClerkId === userBClerkId) {
    return approvedEntityIdsFor(userAClerkId);
  }
  const [a, b] = await Promise.all([
    approvedEntityIdsFor(userAClerkId),
    approvedEntityIdsFor(userBClerkId),
  ]);
  const setB = new Set(b);
  return a.filter((id) => setB.has(id));
}

/** Whether two users share at least one entity. */
export async function shareAnyEntity(
  userAClerkId: string,
  userBClerkId: string,
): Promise<boolean> {
  const ids = await sharedEntityIds(userAClerkId, userBClerkId);
  return ids.length > 0;
}

/**
 * Resolve an outward account id to its owner clerk id. Single-call
 * helper used wherever we need to convert a skin id to its underlying
 * person.
 */
export async function ownerClerkIdForOutwardAccount(
  accountId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ ownerClerkId: outwardAccountsTable.ownerClerkId })
    .from(outwardAccountsTable)
    .where(eq(outwardAccountsTable.id, accountId))
    .limit(1);
  return row?.ownerClerkId ?? null;
}

/**
 * Bulk variant for multiple accounts.
 */
export async function ownerClerkIdsForOutwardAccounts(
  accountIds: number[],
): Promise<Map<number, string>> {
  if (accountIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: outwardAccountsTable.id,
      ownerClerkId: outwardAccountsTable.ownerClerkId,
    })
    .from(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.id, accountIds));
  return new Map(rows.map((r) => [r.id, r.ownerClerkId] as const));
}

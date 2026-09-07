import { and, eq, isNull, or, asc, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db, outwardAccountsTable, usersTable } from "@workspace/db";

/**
 * Build a "this column matches the active outward account" predicate that
 * also accepts NULL rows (legacy data that was created before outward
 * accounts existed and has not yet been backfilled). Returns `undefined`
 * when there is no active outward account so callers can drop the filter
 * with a no-op.
 */
export function outwardAccountFilter(
  column: AnyPgColumn,
  activeOutwardAccountId: number | null | undefined,
): SQL | undefined {
  if (activeOutwardAccountId == null) return undefined;
  return or(eq(column, activeOutwardAccountId), isNull(column));
}

/**
 * Resolve the default outward account id for an arbitrary user (used when
 * stamping rows that name a counterparty — e.g. the assignee on a work
 * order or the invitee on a property membership). Falls back to the user's
 * earliest non-archived outward account when `users.active_outward_account_id`
 * is not set.
 *
 * Returns `null` when the user has no outward accounts at all (should be
 * impossible after the migration but is treated as a soft failure so route
 * handlers don't blow up).
 */
export async function getDefaultOutwardAccountForUser(
  clerkId: string,
): Promise<number | null> {
  const [user] = await db
    .select({ activeOutwardAccountId: usersTable.activeOutwardAccountId })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId));
  if (user?.activeOutwardAccountId != null) {
    const [acct] = await db
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.id, user.activeOutwardAccountId),
          eq(outwardAccountsTable.ownerClerkId, clerkId),
          isNull(outwardAccountsTable.archivedAt),
        ),
      );
    if (acct) return acct.id;
  }
  const [first] = await db
    .select({ id: outwardAccountsTable.id })
    .from(outwardAccountsTable)
    .where(
      and(
        eq(outwardAccountsTable.ownerClerkId, clerkId),
        isNull(outwardAccountsTable.archivedAt),
      ),
    )
    .orderBy(asc(outwardAccountsTable.id))
    .limit(1);
  return first?.id ?? null;
}

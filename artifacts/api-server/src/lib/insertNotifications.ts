import { inArray } from "drizzle-orm";
import { db, notificationsTable, usersTable, outwardAccountsTable } from "@workspace/db";
import { resolveRecipientModeIds } from "./modeResolution";

type NotifInsert = typeof notificationsTable.$inferInsert;

/**
 * Wrapper for notification inserts that auto-tags
 *   - `createdInModeId` to the recipient's currently active mode (legacy
 *     per-mode firewall), and
 *   - `outwardAccountId` to the recipient's currently active outward
 *     account (the canonical per-account firewall introduced by #307).
 *
 * This is the per-account "internal firewall" for the notifications
 * table — without it, a notification fired by activity in account A
 * could surface in account B for the same person. Callers may pre-set
 * either field to override; if so, that value is preserved.
 */
export async function insertNotifications(values: NotifInsert | NotifInsert[]) {
  const arr = Array.isArray(values) ? values : [values];
  if (arr.length === 0) return [];

  const needLegacyMode = arr.filter((v) => v.createdInModeId === undefined);
  if (needLegacyMode.length > 0) {
    const ids = [...new Set(needLegacyMode.map((v) => v.userClerkId))];
    const map = await resolveRecipientModeIds(ids);
    for (const v of needLegacyMode) {
      v.createdInModeId = map.get(v.userClerkId) ?? null;
    }
  }

  const needOutward = arr.filter((v) => v.outwardAccountId === undefined);
  if (needOutward.length > 0) {
    const ids = [...new Set(needOutward.map((v) => v.userClerkId))];
    const rows = await db
      .select({
        clerkId: usersTable.clerkId,
        activeOutwardAccountId: usersTable.activeOutwardAccountId,
      })
      .from(usersTable)
      .where(inArray(usersTable.clerkId, ids));
    const accountByClerk = new Map(
      rows.map((r) => [r.clerkId, r.activeOutwardAccountId]),
    );
    // Heal users with no active id — fall back to the user's earliest
    // outward account so legacy seeded rows map to a real account.
    const missing = ids.filter((id) => accountByClerk.get(id) == null);
    if (missing.length > 0) {
      const fallback = await db
        .select({
          ownerClerkId: outwardAccountsTable.ownerClerkId,
          id: outwardAccountsTable.id,
        })
        .from(outwardAccountsTable)
        .where(inArray(outwardAccountsTable.ownerClerkId, missing));
      const earliestByClerk = new Map<string, number>();
      for (const r of fallback) {
        const cur = earliestByClerk.get(r.ownerClerkId);
        if (cur == null || r.id < cur) earliestByClerk.set(r.ownerClerkId, r.id);
      }
      for (const id of missing) {
        const fb = earliestByClerk.get(id);
        if (fb != null) accountByClerk.set(id, fb);
      }
    }
    for (const v of needOutward) {
      v.outwardAccountId = accountByClerk.get(v.userClerkId) ?? null;
    }
  }

  return db.insert(notificationsTable).values(arr).returning();
}

/**
 * Convenience: emit a notification for a (user, outward account) pair
 * explicitly. Used by routes that already know the recipient's outward
 * account (e.g. /messages, where the thread itself names the target
 * outward account) so the firewall is enforced even if the recipient's
 * active account drifts between the send and a later read.
 */
export async function insertNotificationForOutwardAccount(
  values: NotifInsert & { outwardAccountId: number },
) {
  const [row] = await db.insert(notificationsTable).values(values).returning();
  return row;
}


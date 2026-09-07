import { eq, inArray } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

/**
 * Resolves which mode a notification (or any user-bound row) should be
 * delivered to. We use the recipient's currently-active mode at the time
 * of the write. If unknown, we leave it NULL — the inbox queries are
 * NULL-tolerant so the user will still see it.
 */
export async function resolveRecipientModeId(clerkId: string): Promise<number | null> {
  const [row] = await db
    .select({ lastActiveModeId: usersTable.lastActiveModeId })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId));
  return row?.lastActiveModeId ?? null;
}

export async function resolveRecipientModeIds(
  clerkIds: string[],
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (clerkIds.length === 0) return out;
  const rows = await db
    .select({ clerkId: usersTable.clerkId, lastActiveModeId: usersTable.lastActiveModeId })
    .from(usersTable)
    .where(inArray(usersTable.clerkId, clerkIds));
  for (const r of rows) out.set(r.clerkId, r.lastActiveModeId ?? null);
  return out;
}

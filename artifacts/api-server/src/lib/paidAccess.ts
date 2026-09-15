import { and, eq, isNull } from "drizzle-orm";
import { db, outwardAccountsTable } from "@workspace/db";

// Billing enable/cancel and processor webhooks maintain capabilityState.
// Eligibility follows the person, independently of the currently selected role.
export async function personHasPaidAccess(clerkId: string, connection: Pick<typeof db, "select"> = db): Promise<boolean> {
  const rows = await connection.select({ id: outwardAccountsTable.id }).from(outwardAccountsTable)
    .where(and(eq(outwardAccountsTable.ownerClerkId, clerkId), eq(outwardAccountsTable.capabilityState, "expanded"), isNull(outwardAccountsTable.archivedAt))).limit(1);
  return rows.length > 0;
}

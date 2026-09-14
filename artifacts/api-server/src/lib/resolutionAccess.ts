import { and, eq, isNull, getTableColumns } from "drizzle-orm";
import { db, entityMembersTable, outwardAccountsTable, entitiesTable } from "@workspace/db";
import type { AuthRequest } from "../middlewares/requireAuth";
import { resolveActiveOutwardAccountId } from "./outwardAccounts";

export function isResolutionContributor(kind: string | undefined, membership?: { role: string; permissions?: { createOnProperties?: boolean } } | null) {
  if (!kind || ["viewer", "collab", "trade_pro_collab", "facilities_collab"].includes(kind)) return false;
  return !!membership && !["viewer", "collaborator"].includes(membership.role)
    && membership.permissions?.createOnProperties !== false;
}

export async function resolutionAccess(req: AuthRequest): Promise<{ kind: string | undefined; memberships: (typeof entityMembersTable.$inferSelect)[] }> {
  const id = req.activeOutwardAccountId ?? await resolveActiveOutwardAccountId(req.userId);
  if (id == null) return { kind: undefined, memberships: [] };
  const [[account], memberships] = await Promise.all([
    db.select({ kind: outwardAccountsTable.kind }).from(outwardAccountsTable).where(and(eq(outwardAccountsTable.id, id), isNull(outwardAccountsTable.archivedAt))),
    db.select(getTableColumns(entityMembersTable)).from(entityMembersTable).innerJoin(entitiesTable, eq(entitiesTable.id, entityMembersTable.entityId)).where(and(isNull(entitiesTable.archivedAt), eq(entityMembersTable.userClerkId, req.userId), eq(entityMembersTable.userOutwardAccountId, id), eq(entityMembersTable.status, "approved"), isNull(entityMembersTable.archivedAt))),
  ]);
  return { kind: account?.kind, memberships };
}

export function canActOnResolution(access: Awaited<ReturnType<typeof resolutionAccess>>, entityId?: number) {
  // Earlier personal discussions did not record an Entity. Preserve those
  // discussions for operational avatars; do not invent Entity authority.
  return entityId == null
    ? isResolutionContributor(access.kind, { role: "worker" })
    : access.memberships.some(m => m.entityId === entityId && isResolutionContributor(access.kind, m));
}

import type { RequestHandler } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, entitiesTable, entityMembersTable, usersTable } from "@workspace/db";
import type { AuthRequest } from "./requireAuth";
import { personHasPaidAccess } from "../lib/paidAccess";

// Setup, search, billing, Identity and invitation routes remain available.
// Operational requests require a real relationship, regardless of client navigation.
const operational = /^(?:\/(?:logs|messages|work-orders|calendar|task-lists|rewards|game-room|reminders|resolutions|standards|assets|financial-documents)(?:\/|$)|\/users\/me\/events\/|\/(?:properties|entities)\/[^/]+\/(?:logs|messages|work-orders|calendar|assets)(?:\/|$))/;

export const firstConnection: RequestHandler = async (req, res, next) => {
  const { userId, activeOutwardAccountId } = req as AuthRequest;
  if (!userId || !operational.test(req.path)) { next(); return; }
  const [user] = await db.select({ isAdmin: usersTable.isAdmin }).from(usersTable).where(eq(usersTable.clerkId, userId)).limit(1);
  if (user?.isAdmin) { next(); return; }
  const memberships = await db.select({ entityId: entitiesTable.id, kind: entitiesTable.kind, accountId: entityMembersTable.userOutwardAccountId, owner: entitiesTable.createdByUserClerkId, controller: entitiesTable.controllerUserClerkId })
    .from(entityMembersTable).innerJoin(entitiesTable, eq(entitiesTable.id, entityMembersTable.entityId))
    .where(and(eq(entityMembersTable.userClerkId, userId), eq(entityMembersTable.status, "approved"), isNull(entityMembersTable.archivedAt), isNull(entitiesTable.archivedAt)));
  if (!memberships.length) {
    res.status(409).json({ code: "intake_required", error: "Complete and ACTIVATE your first Property or Business relationship." }); return;
  }
  const destination = req.path.match(/^\/(entities|properties)\/(\d+)\//);
  let entityId = destination?.[1] === "entities" ? Number(destination[2]) : null;
  if (destination?.[1] === "properties") {
    const linked = await db.execute<{ entity_id: number }>(sql`SELECT entity_id FROM property_entity_links WHERE property_id=${Number(destination[2])} LIMIT 1`);
    entityId = linked.rows[0]?.entity_id ?? -1;
  }
  const active = memberships.filter((membership) => membership.accountId === activeOutwardAccountId && (entityId === null || membership.entityId === entityId));
  if (!active.length) {
    res.status(403).json({ code: "working_context_required", error: "Select an authorized Property, Business, or your private History." }); return;
  }
  const history = active.some((membership) => membership.kind === "history" && membership.owner === userId);
  if (history && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    res.status(403).json({ code: "history_read_only", error: "History is read-only. Switch to an authorized Property or Business to create activity." }); return;
  }
  if (!history && req.method === "POST" && /\/messages(?:\/|$)/.test(req.path) && !req.path.endsWith("/read")) {
    const paid = await personHasPaidAccess(userId) || (await Promise.all(active.map((membership) => personHasPaidAccess(membership.controller)))).every(Boolean);
    if (!paid) {
      res.status(402).json({ code: "paid_party_required", error: "Messaging requires paid access for you or the person controlling this Property or Business." }); return;
    }
  }
  // Existing route handlers still enforce record-specific scope and authority.
  next();
};

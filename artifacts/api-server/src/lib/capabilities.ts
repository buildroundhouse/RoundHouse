import { type Response } from "express";
import type { AuthRequest } from "../middlewares/requireAuth";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db, entitiesTable, entityMembersTable, outwardAccountsTable } from "@workspace/db";
import { personHasPaidAccess } from "./paidAccess";

/**
 * The closed set of paid capabilities (#309). Today these all map to the
 * single "expanded" capability bundle on a skin, but keeping them named
 * lets the UI explain *which* capability a user just hit, and leaves room
 * for a future tier split without touching every call site.
 *
 * Free actions (connecting, messaging, viewing properties they
 * participate on, commenting, basic photos/notes) are *not* listed and
 * never call into this module.
 */
export const PAID_CAPABILITIES = [
  // Creating/structuring records on properties: work orders, recurring
  // tasks, structured logs, property standards, property specs.
  "create_property_records",
  // Operating with expanded participation permissions and tools on
  // properties — for now: adding/removing members.
  "expanded_participation",
  // AI concierge on the timeline (chat, suggestions, voice input).
  "ai_concierge",
] as const;
export type PaidCapability = (typeof PAID_CAPABILITIES)[number];

/**
 * Single source of truth that answers "is paid capability X available
 * for skin Y?". Reads `outward_accounts.capability_state` and nothing
 * else — the lapse webhook is what keeps that column honest.
 */
export async function isCapabilityAvailable(
  outwardAccountId: number | null,
  _capability: PaidCapability,
  entityId?: number,
): Promise<boolean> {
  if (outwardAccountId == null) return false;
  const [account] = await db.select({ owner: outwardAccountsTable.ownerClerkId }).from(outwardAccountsTable)
    .where(and(eq(outwardAccountsTable.id, outwardAccountId), isNull(outwardAccountsTable.archivedAt))).limit(1);
  if (!account) return false;
  const contexts = await db.select({ controller: entitiesTable.controllerUserClerkId }).from(entityMembersTable)
    .innerJoin(entitiesTable, eq(entitiesTable.id, entityMembersTable.entityId))
    .where(and(eq(entityMembersTable.userOutwardAccountId, outwardAccountId), eq(entityMembersTable.userClerkId, account.owner),
      eq(entityMembersTable.status, "approved"), isNull(entityMembersTable.archivedAt), isNull(entitiesTable.archivedAt), ne(entitiesTable.kind, "history"),
      entityId === undefined ? undefined : eq(entitiesTable.id, entityId)));
  if (!contexts.length) return false;
  if (await personHasPaidAccess(account.owner)) return true;
  // Without a destination parameter, do not borrow a paid controller from an
  // unrelated membership to enable actions in a free destination.
  return (await Promise.all(contexts.map((context) => personHasPaidAccess(context.controller)))).every(Boolean);
}

export interface CapabilityRequiredPayload {
  error: string;
  capability: PaidCapability;
  outwardAccountId: number | null;
  /**
   * Mobile deep-link the client should open to take the user straight to
   * the billing row for this skin. The mobile app routes this to the
   * private-account billing screen with the skin pre-selected.
   */
  deepLink: string;
}

/**
 * One-line gate at the top of any handler that performs a paid action.
 * Returns true when the active outward account has the capability;
 * otherwise writes a 402 response and returns false so the caller can
 * `return` immediately.
 *
 * The 402 body is structured for the mobile sheet to render a clear
 * "this capability requires payment on this skin" message and offer the
 * deep-link.
 */
export async function requirePaidCapability(
  req: AuthRequest,
  res: Response,
  capability: PaidCapability,
): Promise<boolean> {
  const outwardAccountId = req.activeOutwardAccountId ?? null;
  let entityId = Number(req.params.entityId ?? req.body?.entityId) || undefined;
  const propertyId = Number(req.params.propertyId ?? req.body?.propertyId ?? (req.path.startsWith("/properties/") ? req.params.id : undefined));
  if (propertyId) {
    const linked = await db.execute<{ entity_id: number }>(sql`SELECT entity_id FROM property_entity_links WHERE property_id=${propertyId} LIMIT 1`);
    entityId = linked.rows[0]?.entity_id ?? -1;
  }
  const ok = await isCapabilityAvailable(outwardAccountId, capability, entityId);
  if (ok) return true;
  const payload: CapabilityRequiredPayload = {
    error:
      "This action requires paid access for you or the person controlling this Property or Business. " +
      "Your role and authorized scope still apply.",
    capability,
    outwardAccountId,
    deepLink: outwardAccountId
      ? `roundhouse://account/billing?accountId=${outwardAccountId}`
      : "roundhouse://account/billing",
  };
  res.status(402).json(payload);
  return false;
}

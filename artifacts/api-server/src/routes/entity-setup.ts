import { Router, type IRouter } from "express";
import { and, eq, ilike, isNull, or } from "drizzle-orm";
import {
  db,
  entitiesTable,
  entityBusinessDetailsTable,
  entityMembersTable,
  outwardAccountsTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { resolveActiveOutwardAccountId } from "../lib/outwardAccounts";
import { isAdminDemoClerkId } from "../lib/adminDemo";

const router: IRouter = Router();

type CreationCapacity = "owner" | "temporary_admin";

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * GET /entity-setup/business/search?q=...
 *
 * Search first-class Business Entities before creating another one. This is
 * intentionally separate from /pros/search: a Business Entity can exist even
 * when its legitimate owner has not yet created a Trade profile in Roundhouse.
 */
router.get(
  "/entity-setup/business/search",
  requireAuth,
  async (req, res): Promise<void> => {
    const q = cleanString(req.query.q);
    if (!q) {
      res.json({ entities: [] });
      return;
    }

    const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);
    const pattern = `%${escaped}%`;

    const rows = await db
      .select({
        id: entitiesTable.id,
        name: entitiesTable.name,
        logoUrl: entitiesTable.logoUrl,
        coverPhotoUrl: entitiesTable.coverPhotoUrl,
        controllerUserClerkId: entitiesTable.controllerUserClerkId,
        companyName: entityBusinessDetailsTable.companyName,
        tagline: entityBusinessDetailsTable.tagline,
      })
      .from(entitiesTable)
      .leftJoin(
        entityBusinessDetailsTable,
        eq(entityBusinessDetailsTable.entityId, entitiesTable.id),
      )
      .where(
        and(
          eq(entitiesTable.kind, "business"),
          isNull(entitiesTable.archivedAt),
          or(
            ilike(entitiesTable.name, pattern),
            ilike(entityBusinessDetailsTable.companyName, pattern),
          ),
        ),
      )
      .limit(20);

    res.json({
      entities: rows.map((row) => ({
        id: row.id,
        kind: "business",
        displayName: row.name,
        companyName: row.companyName,
        tagline: row.tagline,
        logoUrl: row.logoUrl,
        coverPhotoUrl: row.coverPhotoUrl,
        controllerUserClerkId: row.controllerUserClerkId,
      })),
    });
  },
);

/**
 * POST /entity-setup/business
 *
 * Create a real Business Entity from Profile / Find. The creator may enter
 * only as Owner or Temporary Admin. Both receive the same operational control.
 * Temporary Admin does not assert ownership; its membership carries an
 * unclaimed marker in permissions.scope until a legitimate owner claims the
 * Entity through the transfer / dispute process.
 *
 * This route deliberately accepts the neutral Viewer fallback as the acting
 * identity. An unaffiliated Viewer must be able to create the Entity that will
 * give their account a real operating context instead of being trapped in a
 * functionless Viewer state.
 */
router.post(
  "/entity-setup/business",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId, activeOutwardAccountId: hdrId } = req as AuthRequest;
    const activeOutwardAccountId =
      hdrId ?? (await resolveActiveOutwardAccountId(userId));

    if (activeOutwardAccountId == null) {
      res.status(409).json({ error: "Account is not ready yet." });
      return;
    }

    const [activeAccount] = await db
      .select()
      .from(outwardAccountsTable)
      .where(eq(outwardAccountsTable.id, activeOutwardAccountId));
    if (!activeAccount || activeAccount.ownerClerkId !== userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const displayName =
      cleanString(req.body?.displayName) ?? cleanString(req.body?.name);
    if (!displayName) {
      res.status(400).json({ error: "Business name is required." });
      return;
    }

    const creationCapacityRaw = cleanString(req.body?.creationCapacity) ?? "owner";
    if (
      creationCapacityRaw !== "owner" &&
      creationCapacityRaw !== "temporary_admin"
    ) {
      res.status(400).json({
        error: "creationCapacity must be owner or temporary_admin.",
      });
      return;
    }
    const creationCapacity = creationCapacityRaw as CreationCapacity;

    // Exact-name duplicate guard. The UI searches first, but enforce a final
    // server-side check so a fast double-submit cannot manufacture duplicates.
    const [duplicate] = await db
      .select({ id: entitiesTable.id, name: entitiesTable.name })
      .from(entitiesTable)
      .where(
        and(
          eq(entitiesTable.kind, "business"),
          isNull(entitiesTable.archivedAt),
          ilike(entitiesTable.name, displayName),
        ),
      )
      .limit(1);
    if (duplicate) {
      res.status(409).json({
        error: "A Business Entity with that name already exists. Select it instead.",
        code: "business_entity_exists",
        entityId: duplicate.id,
      });
      return;
    }

    const legalName = cleanString(req.body?.legalName);
    const tagline = cleanString(req.body?.tagline);
    const isDemo = await isAdminDemoClerkId(userId);

    const [entity] = await db
      .insert(entitiesTable)
      .values({
        kind: "business",
        name: displayName,
        controllerOutwardAccountId: activeOutwardAccountId,
        controllerUserClerkId: userId,
        createdByUserClerkId: userId,
        isAdminDemo: isDemo,
      })
      .returning();

    await db.insert(entityBusinessDetailsTable).values({
      entityId: entity.id,
      companyName: legalName ?? displayName,
      tagline,
    });

    const temporaryAdmin = creationCapacity === "temporary_admin";
    const [membership] = await db
      .insert(entityMembersTable)
      .values({
        entityId: entity.id,
        userClerkId: userId,
        userOutwardAccountId: activeOutwardAccountId,
        role: temporaryAdmin ? "admin" : "owner",
        status: "approved",
        direction: "invite",
        permissions: {
          seeContacts: true,
          seeBilling: true,
          createOnProperties: true,
          manageTeam: true,
          manageParticipants: true,
          scope: {
            creationCapacity,
            temporaryAdmin,
            unclaimed: temporaryAdmin,
          },
        },
        requestedByOutwardAccountId: activeOutwardAccountId,
        decidedAt: new Date(),
      })
      .returning();

    res.status(201).json({
      id: entity.id,
      kind: entity.kind,
      displayName: entity.name,
      isAdminDemo: entity.isAdminDemo,
      creationCapacity,
      unclaimed: temporaryAdmin,
      myMembership: membership,
    });
  },
);

export default router;

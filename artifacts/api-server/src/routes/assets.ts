import { Router, type IRouter } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  db,
  propertyAssetsTable,
  propertiesTable,
  workOrdersTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { publicUserColumns } from "../lib/userPublic";
import { ObjectStorageService } from "../lib/objectStorage";
import { assertCallerOwnsUploads } from "../lib/objectAccess";
import { getMembershipForProperty } from "../lib/propertyAccess";

const objectStorage = new ObjectStorageService();
function normalizeStoragePath(input: unknown): string | null {
  if (typeof input !== "string" || !input) return null;
  try {
    return objectStorage.normalizeObjectEntityPath(input);
  } catch {
    return input;
  }
}

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(String(v), 10);
}

async function getMembership(propertyId: number, userId: string) {
  return getMembershipForProperty(propertyId, userId);
}

function canManage(role?: string) {
  return role === "owner" || role === "admin";
}

function toDateOrNull(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

router.get("/properties/:propertyId/assets", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const propertyId = parseId(req.params.propertyId);
  const m = await getMembership(propertyId, userId);
  if (!m) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const rows = await db
    .select()
    .from(propertyAssetsTable)
    .where(eq(propertyAssetsTable.propertyId, propertyId))
    .orderBy(desc(propertyAssetsTable.createdAt));
  res.json({ assets: rows });
});

router.post("/properties/:propertyId/assets", requireAuth, async (req, res): Promise<void> => {
  const { userId, activeOutwardAccountId } = req as AuthRequest;
  const propertyId = parseId(req.params.propertyId);
  const m = await getMembership(propertyId, userId);
  if (!m || !canManage(m.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { name, assetTag, category, location, photoUrl, installedAt, warrantyEndsAt, notes } = req.body;
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const normalizedPhoto = photoUrl ? normalizeStoragePath(String(photoUrl)) : null;
  await assertCallerOwnsUploads(userId, [normalizedPhoto]);
  const [row] = await db
    .insert(propertyAssetsTable)
    .values({
      propertyId,
      name: String(name).trim(),
      assetTag: assetTag ? String(assetTag).trim() : null,
      category: category ? String(category) : null,
      location: location ? String(location) : null,
      photoUrl: normalizedPhoto,
      installedAt: toDateOrNull(installedAt),
      warrantyEndsAt: toDateOrNull(warrantyEndsAt),
      notes: notes ? String(notes) : "",
      createdByClerkId: userId,
      creatorOutwardAccountId: activeOutwardAccountId,
    })
    .returning();
  res.status(201).json(row);
});

router.put("/properties/:propertyId/assets/:assetId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const propertyId = parseId(req.params.propertyId);
  const assetId = parseId(req.params.assetId);
  const [existing] = await db
    .select()
    .from(propertyAssetsTable)
    .where(and(eq(propertyAssetsTable.id, assetId), eq(propertyAssetsTable.propertyId, propertyId)));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const m = await getMembership(propertyId, userId);
  if (!m || !canManage(m.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { name, assetTag, category, location, photoUrl, installedAt, warrantyEndsAt, notes, archivedAt } = req.body;
  const updates: Record<string, unknown> = {};
  if (name != null) updates.name = String(name).trim();
  if (assetTag !== undefined) updates.assetTag = assetTag ? String(assetTag).trim() : null;
  if (category !== undefined) updates.category = category ? String(category) : null;
  if (location !== undefined) updates.location = location ? String(location) : null;
  let removedPath: string | null = null;
  if (photoUrl !== undefined) {
    const np = photoUrl ? normalizeStoragePath(String(photoUrl)) : null;
    await assertCallerOwnsUploads(userId, [np]);
    updates.photoUrl = np;
    if (existing.photoUrl) {
      const oldNormalized = normalizeStoragePath(existing.photoUrl) ?? existing.photoUrl;
      if (oldNormalized !== np) removedPath = existing.photoUrl;
    }
  }
  if (installedAt !== undefined) updates.installedAt = toDateOrNull(installedAt);
  if (warrantyEndsAt !== undefined) updates.warrantyEndsAt = toDateOrNull(warrantyEndsAt);
  if (notes != null) updates.notes = String(notes);
  if (archivedAt !== undefined) updates.archivedAt = toDateOrNull(archivedAt);
  const [updated] = await db
    .update(propertyAssetsTable)
    .set(updates)
    .where(eq(propertyAssetsTable.id, assetId))
    .returning();
  if (removedPath) await objectStorage.deleteObjectEntity(removedPath);
  res.json(updated);
});

router.delete("/properties/:propertyId/assets/:assetId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const propertyId = parseId(req.params.propertyId);
  const assetId = parseId(req.params.assetId);
  const [existing] = await db
    .select()
    .from(propertyAssetsTable)
    .where(and(eq(propertyAssetsTable.id, assetId), eq(propertyAssetsTable.propertyId, propertyId)));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const m = await getMembership(propertyId, userId);
  if (!m || !canManage(m.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  // Detach from any work orders so they aren't broken.
  await db.update(workOrdersTable).set({ assetId: null }).where(eq(workOrdersTable.assetId, assetId));
  await db.delete(propertyAssetsTable).where(eq(propertyAssetsTable.id, assetId));
  if (existing.photoUrl) await objectStorage.deleteObjectEntity(existing.photoUrl);
  res.sendStatus(204);
});

router.get("/properties/:propertyId/assets/:assetId/work-orders", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const propertyId = parseId(req.params.propertyId);
  const assetId = parseId(req.params.assetId);
  const m = await getMembership(propertyId, userId);
  if (!m) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const rows = await db
    .select()
    .from(workOrdersTable)
    .where(and(eq(workOrdersTable.propertyId, propertyId), eq(workOrdersTable.assetId, assetId)))
    .orderBy(desc(workOrdersTable.createdAt));
  // Enrich users + property + asset for cards.
  const userIds = new Set<string>();
  for (const r of rows) {
    if (r.assigneeClerkId) userIds.add(r.assigneeClerkId);
    userIds.add(r.createdByClerkId);
  }
  const users = userIds.size
    ? await db.select(publicUserColumns).from(usersTable).where(inArray(usersTable.clerkId, [...userIds]))
    : [];
  const userMap = Object.fromEntries(users.map((u) => [u.clerkId, u]));
  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId));
  const [asset] = await db
    .select()
    .from(propertyAssetsTable)
    .where(and(eq(propertyAssetsTable.id, assetId), eq(propertyAssetsTable.propertyId, propertyId)));
  if (!asset) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }
  const workOrders = rows.map((r) => ({
    ...r,
    assignee: r.assigneeClerkId ? userMap[r.assigneeClerkId] ?? null : null,
    createdBy: userMap[r.createdByClerkId] ?? null,
    property: property ?? null,
    asset: asset ?? null,
  }));
  res.json({ workOrders });
});

export default router;

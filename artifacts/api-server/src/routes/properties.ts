import { Router, type IRouter } from "express";
import { eq, and, inArray, sql, or, ne, isNull } from "drizzle-orm";
import {
  db,
  propertiesTable,
  propertyMemberEventsTable,
  usersTable,
  outwardAccountsTable,
  notificationsTable,
  workLogsTable,
  jobRatingsTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { requirePaidCapability } from "../lib/capabilities";
import { resolveActiveOutwardAccountId, resolveDefaultOutwardAccountIdForUser } from "../lib/outwardAccounts";
import { hasAcceptedConnection } from "../lib/teamUpRequests";
import {
  canAssignPeople,
  effectiveRole,
  upsertPropertyMembership,
  archiveEntityMemberForProperty,
  archiveAllEntityMembersForProperty,
  listMembersForProperty,
  listMembershipsForUser,
  getMembershipForProperty,
  type PropertyMembershipShape,
} from "../lib/propertyAccess";
import { insertNotifications } from "../lib/insertNotifications";
import { publicUserColumns } from "../lib/userPublic";
import { sendPushToUser } from "../lib/push";
import { shouldNotify } from "../lib/notificationPrefs";
import { ObjectStorageService } from "../lib/objectStorage";
import { assertCallerOwnsUploads } from "../lib/objectAccess";
import {
  clearExpiredMutesForProperties,
  clearExpiredMutesForProperty,
} from "../lib/expireMutes";
import { isAdminDemoClerkId } from "../lib/adminDemo";

const objectStorage = new ObjectStorageService();

const router: IRouter = Router();

async function aggregateMemberStats(propertyId: number, userClerkIds: string[]) {
  if (userClerkIds.length === 0) return { ratingMap: {}, jobMap: {}, responseMap: {} };

  const ratingRows = await db
    .select({
      memberClerkId: jobRatingsTable.memberClerkId,
      avg: sql<number>`avg(${jobRatingsTable.stars})`,
      count: sql<number>`count(*)`,
    })
    .from(jobRatingsTable)
    .where(
      and(
        eq(jobRatingsTable.propertyId, propertyId),
        inArray(jobRatingsTable.memberClerkId, userClerkIds)
      )
    )
    .groupBy(jobRatingsTable.memberClerkId);

  const jobRows = await db
    .select({
      assigneeClerkId: workLogsTable.assigneeClerkId,
      count: sql<number>`count(*)`,
    })
    .from(workLogsTable)
    .where(
      and(
        eq(workLogsTable.propertyId, propertyId),
        inArray(workLogsTable.assigneeClerkId, userClerkIds)
      )
    )
    .groupBy(workLogsTable.assigneeClerkId);

  const responseRows = await db
    .select({
      assigneeClerkId: workLogsTable.assigneeClerkId,
      createdAt: workLogsTable.createdAt,
      completedAt: workLogsTable.completedAt,
    })
    .from(workLogsTable)
    .where(
      and(
        eq(workLogsTable.propertyId, propertyId),
        inArray(workLogsTable.assigneeClerkId, userClerkIds),
        eq(workLogsTable.status, "done")
      )
    );

  const ratingMap: Record<string, { avg: number; count: number }> = {};
  for (const r of ratingRows) {
    ratingMap[r.memberClerkId] = { avg: Number(r.avg), count: Number(r.count) };
  }
  const jobMap: Record<string, number> = {};
  for (const j of jobRows) {
    if (j.assigneeClerkId) jobMap[j.assigneeClerkId] = Number(j.count);
  }
  const responseAccum: Record<string, { sum: number; count: number }> = {};
  for (const r of responseRows) {
    if (!r.assigneeClerkId || !r.completedAt || !r.createdAt) continue;
    const minutes =
      (new Date(r.completedAt).getTime() - new Date(r.createdAt).getTime()) / 60000;
    if (!Number.isFinite(minutes) || minutes < 0) continue;
    const slot = (responseAccum[r.assigneeClerkId] ||= { sum: 0, count: 0 });
    slot.sum += minutes;
    slot.count += 1;
  }
  const responseMap: Record<string, number> = {};
  for (const [k, v] of Object.entries(responseAccum)) {
    if (v.count > 0) responseMap[k] = v.sum / v.count;
  }
  return { ratingMap, jobMap, responseMap };
}

async function getMembership(
  propertyId: number,
  userId: string,
  activeOutwardAccountId: number | null,
): Promise<PropertyMembershipShape | null> {
  return getMembershipForProperty(propertyId, userId, {
    activeOutwardAccountId,
  });
}

async function getPropertyWithMembers(propertyId: number, currentUserId: string) {
  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId));
  if (!property) return null;

  const members = await listMembersForProperty(propertyId);

  const userIds = [...new Set(members.map((m) => m.userClerkId))];
  const users = userIds.length > 0
    ? await db.select(publicUserColumns).from(usersTable).where(inArray(usersTable.clerkId, userIds))
    : [];

  const userMap = Object.fromEntries(users.map((u) => [u.clerkId, u]));
  const { ratingMap, jobMap, responseMap } = await aggregateMemberStats(propertyId, userIds);

  const membersWithUsers = members.map((m) => ({
    ...m,
    user: userMap[m.userClerkId],
    avgRating: ratingMap[m.userClerkId]?.avg ?? null,
    ratingCount: ratingMap[m.userClerkId]?.count ?? 0,
    jobCount: jobMap[m.userClerkId] ?? 0,
    avgResponseMinutes: responseMap[m.userClerkId] ?? null,
  }));
  const currentMember = members.find((m) => m.userClerkId === currentUserId);
  const userRole = currentMember?.role || (property.ownerClerkId === currentUserId ? "owner" : "viewer");

  return { ...property, members: membersWithUsers, userRole };
}

router.get("/properties", requireAuth, async (req, res): Promise<void> => {
  const { userId, activeOutwardAccountId } = req as AuthRequest;

  // Scope the user's property list to the outward-facing account ("skin")
  // they're acting as. Rows whose `userOutwardAccountId` is NULL are
  // legacy/transitional and stay visible to every skin so pre-migration
  // data isn't hidden until backfill catches up.
  const memberRows = await listMembershipsForUser(userId, {
    activeOutwardAccountId,
  });

  // #503 — OSP memberships do not surface the property in the
  // user's property list. OSPs reach a property only through their
  // own assigned work orders, never as a property they "have".
  const memberPropertyIds = memberRows
    .filter((m) => effectiveRole(m) !== "outside_service_provider")
    .map((m) => m.propertyId);

  if (memberPropertyIds.length === 0) {
    res.json({ properties: [] });
    return;
  }

  await clearExpiredMutesForProperties(memberPropertyIds);

  // Re-scope properties to the active outward account ("skin") on the
  // owner side: properties YOU created are only visible while you're
  // acting as the same skin that created them. Properties owned by
  // someone else (where you've been invited as a member) stay visible
  // regardless of which of your skins is active — until per-membership
  // skin scoping lands as part of the work-surface task.
  // Legacy properties (`outward_account_id IS NULL`) created before the
  // outward-accounts migration ran stay visible under any active skin so
  // they don't silently disappear before the backfill catches up.
  const ownerScopeFilter =
    activeOutwardAccountId != null
      ? or(
          ne(propertiesTable.ownerClerkId, userId),
          eq(propertiesTable.ownerOutwardAccountId, activeOutwardAccountId),
          isNull(propertiesTable.ownerOutwardAccountId),
        )
      : undefined;

  const props = await db
    .select()
    .from(propertiesTable)
    .where(
      ownerScopeFilter
        ? and(inArray(propertiesTable.id, memberPropertyIds), ownerScopeFilter)
        : inArray(propertiesTable.id, memberPropertyIds),
    );

  const propertyIds = props.map((p) => p.id);
  if (propertyIds.length === 0) {
    res.json({ properties: [] });
    return;
  }

  const memberLists = await Promise.all(
    propertyIds.map((id) => listMembersForProperty(id)),
  );
  const allMembers = memberLists.flat();

  const allUserIds = [...new Set(allMembers.map((m) => m.userClerkId))];
  const allUsers = allUserIds.length > 0
    ? await db.select(publicUserColumns).from(usersTable).where(inArray(usersTable.clerkId, allUserIds))
    : [];
  const userMap = Object.fromEntries(allUsers.map((u) => [u.clerkId, u]));

  const properties = await Promise.all(
    props.map(async (prop) => {
      const propMembers = allMembers.filter((m) => m.propertyId === prop.id);
      const propUserIds = propMembers.map((m) => m.userClerkId);
      const { ratingMap, jobMap, responseMap } = await aggregateMemberStats(prop.id, propUserIds);
      const enriched = propMembers.map((m) => ({
        ...m,
        user: userMap[m.userClerkId],
        avgRating: ratingMap[m.userClerkId]?.avg ?? null,
        ratingCount: ratingMap[m.userClerkId]?.count ?? 0,
        jobCount: jobMap[m.userClerkId] ?? 0,
        avgResponseMinutes: responseMap[m.userClerkId] ?? null,
      }));
      const currentMember = enriched.find((m) => m.userClerkId === userId);
      const userRole = currentMember?.role || "viewer";
      return { ...prop, members: enriched, userRole };
    })
  );

  res.json({ properties });
});

router.post("/properties", requireAuth, async (req, res): Promise<void> => {
  const { userId, activeOutwardAccountId } = req as AuthRequest;
  if (
    !(await requirePaidCapability(
      req as AuthRequest,
      res,
      "create_property_records" as any,
    ))
  )
    return;
  const ownerOutwardAccountId =
    activeOutwardAccountId ?? (await resolveDefaultOutwardAccountIdForUser(userId));
  const { name, address, type, coverColor, coverPhotoUrl, placeId, latitude, longitude } = req.body;

  if (!name) {
    res.status(400).json({ error: "Name is required" });
    return;
  }

  if (coverPhotoUrl) {
    await assertCallerOwnsUploads(userId, [String(coverPhotoUrl)]);
  }

  const placeIdValue = typeof placeId === "string" && placeId.length > 0 ? placeId : null;
  const isValidLat =
    typeof latitude === "number" && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90;
  const isValidLng =
    typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180;
  if (latitude != null && !isValidLat) {
    res.status(400).json({ error: "latitude must be between -90 and 90" });
    return;
  }
  if (longitude != null && !isValidLng) {
    res.status(400).json({ error: "longitude must be between -180 and 180" });
    return;
  }
  const latValue = isValidLat ? (latitude as number) : null;
  const lngValue = isValidLng ? (longitude as number) : null;

  // Auto-stamp the demo flag if this caller is a demo avatar from the
  // admin Wardrobe. Behavior and permissions are unchanged — UI surfaces
  // simply render a "DEMO" badge so anyone interacting with this row
  // knows it isn't real production data. See lib/adminDemo.ts.
  const isDemo = await isAdminDemoClerkId(userId);

  const [property] = await db
    .insert(propertiesTable)
    .values({
      name,
      address: address || "",
      type: type || "home",
      ownerClerkId: userId,
      // Stamp the active outward-facing account ("skin") that owns this
      // property so it stays scoped to that skin in the owner's list.
      // Falls back to the user's seeded default if no skin is active.
      ownerOutwardAccountId,
      coverColor: coverColor || "#C8693A",
      coverPhotoUrl: coverPhotoUrl || null,
      placeId: placeIdValue,
      latitude: latValue,
      longitude: lngValue,
      isAdminDemo: isDemo,
    })
    .returning();

  if (ownerOutwardAccountId == null) {
    res
      .status(500)
      .json({ error: "Could not resolve owner outward account" });
    return;
  }
  await upsertPropertyMembership({
    propertyId: property.id,
    userClerkId: userId,
    userOutwardAccountId: ownerOutwardAccountId,
    role: "owner",
  });

  await db.insert(propertyMemberEventsTable).values({
    propertyId: property.id,
    userClerkId: userId,
    eventType: "joined",
    role: "owner",
    byClerkId: userId,
  });

  const result = await getPropertyWithMembers(property.id, userId);
  res.status(201).json(result);
});

router.get("/properties/:propertyId", requireAuth, async (req, res): Promise<void> => {
  const { userId, activeOutwardAccountId } = req as AuthRequest;
  const rawId = Array.isArray(req.params.propertyId) ? req.params.propertyId[0] : req.params.propertyId;
  const propertyId = parseInt(rawId, 10);

  const membership = await getMembership(propertyId, userId, activeOutwardAccountId);

  if (!membership) {
    res.status(404).json({ error: "Property not found" });
    return;
  }

  // #503 — Outside service providers must not see property-wide data.
  // They reach the property only through their own assigned work
  // orders, never directly.
  if (effectiveRole(membership) === "outside_service_provider") {
    res.status(403).json({
      error: "Outside service providers can only access their own assigned work.",
    });
    return;
  }

  await clearExpiredMutesForProperty(propertyId);

  const result = await getPropertyWithMembers(propertyId, userId);
  if (!result) {
    res.status(404).json({ error: "Property not found" });
    return;
  }

  res.json(result);
});

router.put("/properties/:propertyId", requireAuth, async (req, res): Promise<void> => {
  const { userId, activeOutwardAccountId } = req as AuthRequest;
  const rawId = Array.isArray(req.params.propertyId) ? req.params.propertyId[0] : req.params.propertyId;
  const propertyId = parseInt(rawId, 10);

  const membership = await getMembership(propertyId, userId, activeOutwardAccountId);

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { name, address, type, coverColor, coverPhotoUrl, isPro, standardsMutedUntil } = req.body;
  const updates: Record<string, unknown> = {};
  if (name != null) updates.name = name;
  if (address != null) updates.address = address;
  if (type != null) updates.type = type;
  if (coverColor != null) updates.coverColor = coverColor;
  if (coverPhotoUrl !== undefined) {
    if (coverPhotoUrl === null) {
      updates.coverPhotoUrl = null;
    } else {
      await assertCallerOwnsUploads(userId, [String(coverPhotoUrl)]);
      updates.coverPhotoUrl = coverPhotoUrl;
    }
  }
  const { placeId, latitude, longitude } = req.body;
  if (placeId !== undefined) {
    if (placeId === null) {
      updates.placeId = null;
    } else if (typeof placeId === "string") {
      updates.placeId = placeId.length > 0 ? placeId : null;
    } else {
      res.status(400).json({ error: "placeId must be a string or null" });
      return;
    }
  }
  if (latitude !== undefined) {
    if (latitude === null) {
      updates.latitude = null;
    } else if (
      typeof latitude === "number" &&
      Number.isFinite(latitude) &&
      latitude >= -90 &&
      latitude <= 90
    ) {
      updates.latitude = latitude;
    } else {
      res.status(400).json({ error: "latitude must be a number between -90 and 90, or null" });
      return;
    }
  }
  if (longitude !== undefined) {
    if (longitude === null) {
      updates.longitude = null;
    } else if (
      typeof longitude === "number" &&
      Number.isFinite(longitude) &&
      longitude >= -180 &&
      longitude <= 180
    ) {
      updates.longitude = longitude;
    } else {
      res.status(400).json({ error: "longitude must be a number between -180 and 180, or null" });
      return;
    }
  }
  if (isPro != null) updates.isPro = isPro;
  if (standardsMutedUntil !== undefined) {
    if (standardsMutedUntil === null) {
      updates.standardsMutedUntil = null;
    } else if (typeof standardsMutedUntil === "string") {
      const parsed = new Date(standardsMutedUntil);
      if (Number.isNaN(parsed.getTime())) {
        res.status(400).json({ error: "standardsMutedUntil must be a valid ISO date" });
        return;
      }
      updates.standardsMutedUntil = parsed;
    } else {
      res.status(400).json({ error: "standardsMutedUntil must be a string or null" });
      return;
    }
  }

  await db.update(propertiesTable).set(updates).where(eq(propertiesTable.id, propertyId));

  const result = await getPropertyWithMembers(propertyId, userId);
  res.json(result);
});

router.delete("/properties/:propertyId", requireAuth, async (req, res): Promise<void> => {
  const { userId, activeOutwardAccountId } = req as AuthRequest;
  const rawId = Array.isArray(req.params.propertyId) ? req.params.propertyId[0] : req.params.propertyId;
  const propertyId = parseInt(rawId, 10);

  const membership = await getMembership(propertyId, userId, activeOutwardAccountId);

  if (!membership || membership.role !== "owner") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const logsForProperty = await db
    .select()
    .from(workLogsTable)
    .where(eq(workLogsTable.propertyId, propertyId));

  const logIds = logsForProperty.map((l) => l.id);
  const logFilePaths: string[] = [];
  for (const l of logsForProperty) {
    if (l.photoUrl) logFilePaths.push(l.photoUrl);
    for (const a of l.attachments ?? []) {
      const p = typeof a?.path === "string" ? a.path : "";
      if (p) logFilePaths.push(p);
    }
  }

  if (logIds.length > 0) {
    await db.delete(jobRatingsTable).where(inArray(jobRatingsTable.workLogId, logIds));
  }
  await db.delete(workLogsTable).where(eq(workLogsTable.propertyId, propertyId));
  await archiveAllEntityMembersForProperty(propertyId);
  await db.delete(propertiesTable).where(eq(propertiesTable.id, propertyId));

  for (const p of logFilePaths) {
    await objectStorage.deleteObjectEntity(p);
  }

  res.sendStatus(204);
});

router.post("/properties/:propertyId/geocode", requireAuth, async (req, res): Promise<void> => {
  const { userId, activeOutwardAccountId } = req as AuthRequest;
  const rawId = Array.isArray(req.params.propertyId) ? req.params.propertyId[0] : req.params.propertyId;
  const propertyId = parseInt(rawId, 10);
  if (Number.isNaN(propertyId)) {
    res.status(400).json({ error: "Invalid property id" });
    return;
  }

  const membership = await getMembership(propertyId, userId, activeOutwardAccountId);

  if (!membership) {
    res.status(404).json({ error: "Property not found" });
    return;
  }
  if (!["owner", "admin"].includes(membership.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const { placeId, latitude, longitude } = req.body ?? {};
  if (typeof placeId !== "string" || placeId.length === 0) {
    res.status(400).json({ error: "placeId is required" });
    return;
  }
  if (
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90
  ) {
    res.status(400).json({ error: "latitude must be a number between -90 and 90" });
    return;
  }
  if (
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    res.status(400).json({ error: "longitude must be a number between -180 and 180" });
    return;
  }

  const [property] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId));
  if (!property) {
    res.status(404).json({ error: "Property not found" });
    return;
  }

  const hasExistingPlaceData =
    !!property.placeId || property.latitude != null || property.longitude != null;

  if (!hasExistingPlaceData) {
    await db
      .update(propertiesTable)
      .set({ placeId, latitude, longitude })
      .where(eq(propertiesTable.id, propertyId));
  }

  const result = await getPropertyWithMembers(propertyId, userId);
  res.json(result);
});

router.post("/properties/:propertyId/transfer-ownership", requireAuth, async (req, res): Promise<void> => {
  const { userId, activeOutwardAccountId } = req as AuthRequest;
  const rawId = Array.isArray(req.params.propertyId) ? req.params.propertyId[0] : req.params.propertyId;
  const propertyId = parseInt(rawId, 10);
  if (Number.isNaN(propertyId)) {
    res.status(400).json({ error: "Invalid property id" });
    return;
  }

  const membership = await getMembership(propertyId, userId, activeOutwardAccountId);

  if (!membership || membership.role !== "owner") {
    res.status(403).json({ error: "Only the current owner can transfer ownership" });
    return;
  }

  const { newOwnerClerkId } = req.body ?? {};
  if (!newOwnerClerkId || typeof newOwnerClerkId !== "string") {
    res.status(400).json({ error: "newOwnerClerkId is required" });
    return;
  }
  if (newOwnerClerkId === userId) {
    res.status(400).json({ error: "You are already the owner" });
    return;
  }

  const newOwnerMembership = await getMembershipForProperty(
    propertyId,
    newOwnerClerkId,
  );

  if (!newOwnerMembership) {
    res.status(400).json({ error: "New owner must already be a member of this property" });
    return;
  }

  if (newOwnerMembership.archivedAt) {
    res.status(400).json({ error: "New owner cannot be an archived member" });
    return;
  }

  // The current owner's membership is required so we know which
  // outward account to flip to "admin".
  const currentOwnerMembership = await getMembershipForProperty(
    propertyId,
    userId,
  );
  if (!currentOwnerMembership || currentOwnerMembership.userOutwardAccountId == null) {
    res.status(400).json({ error: "Current owner membership not found" });
    return;
  }
  if (newOwnerMembership.userOutwardAccountId == null) {
    res.status(400).json({ error: "New owner is missing an outward account" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(propertiesTable)
      .set({ ownerClerkId: newOwnerClerkId })
      .where(eq(propertiesTable.id, propertyId));

    await tx.insert(propertyMemberEventsTable).values([
      {
        propertyId,
        userClerkId: newOwnerClerkId,
        eventType: "role_changed",
        role: "owner",
        byClerkId: userId,
      },
      {
        propertyId,
        userClerkId: userId,
        eventType: "role_changed",
        role: "admin",
        byClerkId: userId,
      },
    ]);
  });
  // Flip the membership roles on entity_members. Done after the txn
  // commits so a single source of truth exists.
  await upsertPropertyMembership({
    propertyId,
    userClerkId: newOwnerClerkId,
    userOutwardAccountId: newOwnerMembership.userOutwardAccountId,
    role: "owner",
  });
  await upsertPropertyMembership({
    propertyId,
    userClerkId: userId,
    userOutwardAccountId: currentOwnerMembership.userOutwardAccountId,
    role: "admin",
  });

  const result = await getPropertyWithMembers(propertyId, userId);
  res.json(result);
});

router.get("/properties/:propertyId/members", requireAuth, async (req, res): Promise<void> => {
  const { userId, activeOutwardAccountId } = req as AuthRequest;
  const rawId = Array.isArray(req.params.propertyId) ? req.params.propertyId[0] : req.params.propertyId;
  const propertyId = parseInt(rawId, 10);

  const membership = await getMembership(propertyId, userId, activeOutwardAccountId);

  if (!membership) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // #503 — Outside service providers do not see the property people
  // sheet. They reach the property only through their own assigned
  // work orders.
  if (effectiveRole(membership) === "outside_service_provider") {
    res.status(403).json({
      error: "Outside service providers can only access their own assigned work.",
    });
    return;
  }

  const members = await listMembersForProperty(propertyId);

  const userIds = members.map((m) => m.userClerkId);
  const users = userIds.length > 0
    ? await db.select(publicUserColumns).from(usersTable).where(inArray(usersTable.clerkId, userIds))
    : [];
  const userMap = Object.fromEntries(users.map((u) => [u.clerkId, u]));
  const { ratingMap, jobMap, responseMap } = await aggregateMemberStats(propertyId, userIds);
  // #503 — The Property People sheet is strictly Name · Label · Chip.
  // Everyone — including managers — gets a minimal directory user
  // projection (id, clerkId, name, username, avatar) and the
  // per-property contact fields (phone / license / trade / company)
  // are NEVER returned on this endpoint. Managers needing contact
  // detail go through dedicated profile endpoints, not the people
  // sheet.
  const toDirectoryUser = (u: (typeof users)[number] | undefined) => {
    if (!u) return undefined;
    return {
      id: u.id,
      clerkId: u.clerkId,
      name: u.name,
      username: u.username,
      avatarUrl: u.avatarUrl,
    };
  };
  const membersWithUsers = members.map((m) => {
    const directoryUser = toDirectoryUser(userMap[m.userClerkId]);
    return {
      ...m,
      phone: null,
      licenseNumber: null,
      tradeType: null,
      companyName: null,
      user: directoryUser,
      avgRating: ratingMap[m.userClerkId]?.avg ?? null,
      ratingCount: ratingMap[m.userClerkId]?.count ?? 0,
      jobCount: jobMap[m.userClerkId] ?? 0,
      avgResponseMinutes: responseMap[m.userClerkId] ?? null,
    };
  });

  res.json({ members: membersWithUsers });
});

router.post("/properties/:propertyId/members", requireAuth, async (req, res): Promise<void> => {
  const ar = req as AuthRequest;
  const { userId } = ar;
  const rawId = Array.isArray(req.params.propertyId) ? req.params.propertyId[0] : req.params.propertyId;
  const propertyId = parseInt(rawId, 10);
  // #503 — `role` is intentionally NOT read from the body. The legacy
  // path used to allow owner/admin to elevate the new member's role
  // arbitrarily; per the new permission matrix that's only allowed via
  // the connection-driven /assignments endpoint. Everyone added through
  // this path lands as a plain "member" and gets their per-property
  // classification from the accepted connection (worker / OSP /
  // collaborator), preventing classification bypass.
  const { email, tradeType, companyName, phone, licenseNumber } = req.body;

  if (!email) {
    res.status(400).json({ error: "Email is required" });
    return;
  }
  if (!(await requirePaidCapability(ar, res, "expanded_participation"))) return;

  const membership = await getMembershipForProperty(propertyId, userId);

  // #503 — Authority for adding/assigning a person matches the new
  // POST /assignments rule: owner or a Trade Pro Worker (i.e.
  // canAssignPeople), not just owner/admin. This closes the parallel
  // authority hole between this legacy email-based path and the
  // connection-driven /assignments endpoint.
  if (!canAssignPeople(membership)) {
    res.status(403).json({
      error: "Only the owner or a Trade Pro Worker may add people to this property.",
    });
    return;
  }

  const [targetUser] = await db.select(publicUserColumns).from(usersTable).where(eq(usersTable.email, email));

  if (!targetUser) {
    res.status(404).json({ error: "User not found. They must sign up first." });
    return;
  }

  const existingMembership = await getMembershipForProperty(
    propertyId,
    targetUser.clerkId,
  );
  if (existingMembership) {
    res.status(400).json({ error: "User is already a member" });
    return;
  }

  const targetOutwardAccountId = await resolveDefaultOutwardAccountIdForUser(
    targetUser.clerkId,
  );

  // #503 — Adding someone to a property is an "assignment" and requires
  // an accepted, non-archived user_connection between the caller and the
  // target. This brings this legacy email-based path in line with the
  // new POST /properties/:id/assignments rule so connection-less
  // additions can no longer slip through.
  const callerOutwardAccountId =
    ar.activeOutwardAccountId ?? (await resolveActiveOutwardAccountId(userId));
  if (callerOutwardAccountId == null || targetOutwardAccountId == null) {
    res
      .status(403)
      .json({ error: "You can only add people you're already connected with." });
    return;
  }
  const accepted = await hasAcceptedConnection(
    callerOutwardAccountId,
    targetOutwardAccountId,
  );
  if (!accepted) {
    res
      .status(403)
      .json({ error: "You can only add people you're already connected with." });
    return;
  }

  // #503 — Derive classification from the underlying connection (same
  // logic as POST /assignments, direction-agnostic) so this legacy path
  // can't bypass the role matrix. `client` connections are not
  // assignable to a property.
  const conn = await resolveAcceptedConnection(callerOutwardAccountId, targetOutwardAccountId);
  const cls = classifyFromConnection(conn);
  if (!cls.ok) {
    if (cls.reason === "client_not_assignable") {
      res.status(400).json({
        error: "Clients are not assignable; assign your own workers/collaborators instead.",
      });
    } else {
      res
        .status(403)
        .json({ error: "You can only add people you're already connected with." });
    }
    return;
  }
  const classification = cls.classification;

  const newMember = await upsertPropertyMembership({
    propertyId,
    userClerkId: targetUser.clerkId,
    userOutwardAccountId: targetOutwardAccountId,
    role: "member",
    classification,
    connectionId: conn?.id ?? null,
    assignedByClerkId: userId,
    invitedBy: userId,
    tradeType: tradeType || null,
    companyName: companyName || null,
    phone: phone || null,
    licenseNumber: licenseNumber || null,
  });
  if (!newMember) {
    res.status(500).json({ error: "Could not create membership" });
    return;
  }

  await db.insert(propertyMemberEventsTable).values({
    propertyId,
    userClerkId: targetUser.clerkId,
    eventType: "joined",
    role: newMember.role,
    byClerkId: userId,
  });

  if (await shouldNotify(targetUser.clerkId, "invite")) {
    await insertNotifications({
      userClerkId: targetUser.clerkId,
      type: "invite",
      title: "Property invite",
      body: `You have been added to a property.`,
      relatedId: String(propertyId),
    });

    void sendPushToUser(targetUser.clerkId, {
      title: "You were added to a property",
      body: `You have access to a new property.`,
      data: { type: "invite", propertyId },
    });
  }

  // #503 — Match the People-sheet contract: minimal directory user only.
  res.status(201).json({
    ...newMember,
    user: {
      id: targetUser.id,
      clerkId: targetUser.clerkId,
      name: targetUser.name,
      username: targetUser.username,
      avatarUrl: targetUser.avatarUrl,
    },
    avgRating: null,
    ratingCount: 0,
    jobCount: 0,
    avgResponseMinutes: null,
  });
});

router.put("/properties/:propertyId/members/:memberUserId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const rawId = Array.isArray(req.params.propertyId) ? req.params.propertyId[0] : req.params.propertyId;
  const propertyId = parseInt(rawId, 10);
  const rawUserId = Array.isArray(req.params.memberUserId) ? req.params.memberUserId[0] : req.params.memberUserId;

  const membership = await getMembershipForProperty(propertyId, userId);

  const isSelf = rawUserId === userId;
  if (!isSelf && (!membership || !["owner", "admin"].includes(membership.role))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const targetMembership = await getMembershipForProperty(propertyId, rawUserId);
  if (!targetMembership || targetMembership.userOutwardAccountId == null) {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  const {
    role,
    tradeType,
    companyName,
    phone,
    licenseNumber,
    notes,
    archived,
    notifyJobStarted,
    notifyJobCompleted,
  } = req.body;
  const updates: Parameters<typeof upsertPropertyMembership>[0] = {
    propertyId,
    userClerkId: rawUserId,
    userOutwardAccountId: targetMembership.userOutwardAccountId,
  };
  let touched = false;
  if (role != null && !isSelf) {
    updates.role = role;
    touched = true;
  }
  if (tradeType !== undefined) {
    updates.tradeType = tradeType;
    touched = true;
  }
  if (companyName !== undefined) {
    updates.companyName = companyName;
    touched = true;
  }
  if (phone !== undefined) {
    updates.phone = phone;
    touched = true;
  }
  if (licenseNumber !== undefined) {
    updates.licenseNumber = licenseNumber;
    touched = true;
  }
  if (notes !== undefined) {
    updates.notes = notes;
    touched = true;
  }
  if (archived === true) {
    updates.archivedAt = new Date();
    touched = true;
  }
  if (archived === false) {
    updates.archivedAt = null;
    touched = true;
  }
  if (isSelf && notifyJobStarted !== undefined) {
    if (notifyJobStarted !== null && typeof notifyJobStarted !== "boolean") {
      res.status(400).json({ error: "notifyJobStarted must be a boolean or null" });
      return;
    }
    updates.notifyJobStarted = notifyJobStarted;
    touched = true;
  }
  if (isSelf && notifyJobCompleted !== undefined) {
    if (notifyJobCompleted !== null && typeof notifyJobCompleted !== "boolean") {
      res.status(400).json({ error: "notifyJobCompleted must be a boolean or null" });
      return;
    }
    updates.notifyJobCompleted = notifyJobCompleted;
    touched = true;
  }

  if (!touched) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const updated = await upsertPropertyMembership(updates);
  if (!updated) {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  const [user] = await db.select(publicUserColumns).from(usersTable).where(eq(usersTable.clerkId, rawUserId));
  const { ratingMap, jobMap, responseMap } = await aggregateMemberStats(propertyId, [rawUserId]);

  res.json({
    ...updated,
    user,
    avgRating: ratingMap[rawUserId]?.avg ?? null,
    ratingCount: ratingMap[rawUserId]?.count ?? 0,
    jobCount: jobMap[rawUserId] ?? 0,
    avgResponseMinutes: responseMap[rawUserId] ?? null,
  });
});

router.delete("/properties/:propertyId/members/:memberUserId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const rawId = Array.isArray(req.params.propertyId) ? req.params.propertyId[0] : req.params.propertyId;
  const propertyId = parseInt(rawId, 10);
  const rawUserId = Array.isArray(req.params.memberUserId) ? req.params.memberUserId[0] : req.params.memberUserId;

  const membership = await getMembershipForProperty(propertyId, userId);

  const isSelf = rawUserId === userId;
  if (!isSelf && (!membership || !["owner", "admin"].includes(membership.role))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const removed = await getMembershipForProperty(propertyId, rawUserId);
  if (!removed) {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  await archiveEntityMemberForProperty(propertyId, rawUserId);

  await db.insert(propertyMemberEventsTable).values({
    propertyId,
    userClerkId: rawUserId,
    eventType: "left",
    role: removed.role,
    byClerkId: userId,
  });

  res.sendStatus(204);
});

router.get("/properties/:propertyId/members/:memberUserId/stats", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const rawId = Array.isArray(req.params.propertyId) ? req.params.propertyId[0] : req.params.propertyId;
  const propertyId = parseInt(rawId, 10);
  const rawUserId = Array.isArray(req.params.memberUserId) ? req.params.memberUserId[0] : req.params.memberUserId;

  const requesterMembership = await getMembershipForProperty(propertyId, userId);

  if (!requesterMembership) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const member = await getMembershipForProperty(propertyId, rawUserId);

  if (!member) {
    res.status(404).json({ error: "Member not found" });
    return;
  }

  const [user] = await db.select(publicUserColumns).from(usersTable).where(eq(usersTable.clerkId, rawUserId));

  const logs = await db
    .select()
    .from(workLogsTable)
    .where(and(eq(workLogsTable.propertyId, propertyId), eq(workLogsTable.assigneeClerkId, rawUserId)));

  const ratings = await db
    .select()
    .from(jobRatingsTable)
    .where(and(eq(jobRatingsTable.propertyId, propertyId), eq(jobRatingsTable.memberClerkId, rawUserId)));

  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId));

  const completedLogs = logs.filter((l) => l.status === "done");
  const responseTimes = completedLogs
    .filter((l) => l.completedAt && l.createdAt)
    .map((l) => (new Date(l.completedAt!).getTime() - new Date(l.createdAt).getTime()) / 60000);
  const avgResponseMinutes =
    responseTimes.length > 0 ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : null;

  const ratingCount = ratings.length;
  const avgRating = ratingCount > 0 ? ratings.reduce((s, r) => s + r.stars, 0) / ratingCount : null;

  const enrichedLogs = logs.map((l) => ({ ...l, author: user, property, assignee: user }));

  res.json({
    member: {
      ...member,
      user,
      avgRating,
      ratingCount,
      jobCount: logs.length,
    },
    avgRating,
    ratingCount,
    jobCount: logs.length,
    completedCount: completedLogs.length,
    avgResponseMinutes,
    logs: enrichedLogs,
    ratings,
  });
});

// ---------------------------------------------------------------------
// #503 — Connection-driven property assignments
// ---------------------------------------------------------------------
// `POST /properties/:propertyId/assignments`
//   Body: { targetClerkId: string, targetOutwardAccountId?: number }
//
// Assigns a person to a property with a per-role classification derived
// from the underlying user_connection between the assigner's active
// outward account and the target's outward account. The endpoint
// enforces:
//   * only the property owner or a Trade Pro Worker on the property
//     may assign people (per #503 assignment authority)
//   * an accepted, non-archived user_connection must already exist
//     between the assigner and target (no "stranger" assignments)
//   * the connection's `kind` + `classification` is what decides the
//     resulting `propertyMembers.classification`:
//        kind=core, classification=worker        → "worker"
//        kind=core, classification=outside_…     → "outside_service_provider"
//        kind=collaborator                       → "collaborator"
//        kind=client                             → 400 (clients are not
//                                                       assignable resources)
// `DELETE /properties/:propertyId/assignments/:userClerkId` removes the
// membership and emits a "left" event, mirroring the existing
// member-removal route's behaviour.
// #503 — Resolve the directional connection row in EITHER direction
// (caller→target or target→caller). Returns the matching row or null.
// We pick the row authored by the assigning side first when both exist
// because that side's `kind`/`classification` describes how the assigner
// labeled the relationship; if only the reverse exists, we fall back to
// it so legacy/inconsistent data still classifies correctly instead of
// silently defaulting to "worker".
// Task #663: avatar-to-avatar `user_connections` rows no longer exist,
// so there is no per-pair "kind / classification" record to derive an
// assignment classification from. Both POST /assignments and the legacy
// email-add-by-property path now derive classification from the request
// itself (defaulting to "worker") once the entity-shared check above
// has confirmed the two avatars can collaborate. Property reads switch
// to entity_members in T006; until then we keep the same response
// shape so the mobile client doesn't have to branch.
async function resolveAcceptedConnection(
  _callerOutwardAccountId: number,
  _targetOutwardAccountId: number,
): Promise<{ id: number; kind: string | null; classification: string | null } | null> {
  return null;
}

function classifyFromConnection(_conn: { kind?: string | null; classification?: string | null } | null):
  | { ok: true; classification: "worker" | "outside_service_provider" | "collaborator" }
  | { ok: false; reason: "client_not_assignable" | "missing_connection" } {
  // Default everyone the caller can entity-share with to "worker"; the
  // Outside Service Provider / Collaborator distinctions previously
  // encoded on the connection row will be reintroduced as part of the
  // T007 AddToEntitySheet payload.
  return { ok: true, classification: "worker" };
}

router.post("/properties/:propertyId/assignments", requireAuth, async (req, res): Promise<void> => {
  const ar = req as AuthRequest;
  const { userId } = ar;
  const rawId = Array.isArray(req.params.propertyId) ? req.params.propertyId[0] : req.params.propertyId;
  const propertyId = parseInt(rawId, 10);
  const targetClerkId = typeof req.body?.targetClerkId === "string" ? req.body.targetClerkId : null;
  const targetOutwardAccountIdRaw = req.body?.targetOutwardAccountId;
  if (!targetClerkId) {
    res.status(400).json({ error: "targetClerkId is required" });
    return;
  }
  if (!(await requirePaidCapability(ar, res, "expanded_participation"))) return;

  // Caller's per-property authority.
  const membership = await getMembershipForProperty(propertyId, userId);
  // #503 — Only the owner or an existing Trade Pro Worker may assign
  // people. Strictly owner + worker; legacy "admin" is NOT granted
  // assignment authority.
  if (!canAssignPeople(membership)) {
    res.status(403).json({ error: "Only the property owner or a Trade Pro Worker may assign people" });
    return;
  }

  // Resolve the assigner's active outward account; connections are
  // skin-scoped, so we have to use the same skin the caller is acting as.
  const fromOutwardAccountId =
    ar.activeOutwardAccountId ?? (await resolveActiveOutwardAccountId(userId));
  if (fromOutwardAccountId == null) {
    res.status(400).json({ error: "Active outward account not resolved" });
    return;
  }

  // Resolve the target outward account: prefer an explicitly-provided
  // counterpart skin so the caller can disambiguate when the target has
  // multiple outward accounts (homeowner + trade pro, etc).
  let toOutwardAccountId: number | null = null;
  if (typeof targetOutwardAccountIdRaw === "number") {
    const [acct] = await db
      .select({ id: outwardAccountsTable.id, ownerClerkId: outwardAccountsTable.ownerClerkId })
      .from(outwardAccountsTable)
      .where(eq(outwardAccountsTable.id, targetOutwardAccountIdRaw));
    if (!acct || acct.ownerClerkId !== targetClerkId) {
      res.status(400).json({ error: "targetOutwardAccountId does not belong to targetClerkId" });
      return;
    }
    toOutwardAccountId = acct.id;
  } else {
    toOutwardAccountId = await resolveDefaultOutwardAccountIdForUser(targetClerkId);
  }
  if (toOutwardAccountId == null) {
    res.status(400).json({ error: "Target outward account not resolved" });
    return;
  }

  // Require an accepted connection between the assigner and target.
  const accepted = await hasAcceptedConnection(fromOutwardAccountId, toOutwardAccountId);
  if (!accepted) {
    res.status(403).json({
      error: "An accepted connection between you and this person is required before assigning them.",
    });
    return;
  }

  // #503 — Look up the connection in either direction (caller→target
  // or target→caller). hasAcceptedConnection above is symmetric, so
  // fetch the row symmetrically too — otherwise a reverse-only row
  // would silently fall back to "worker" and could let a `client`
  // through.
  const conn = await resolveAcceptedConnection(fromOutwardAccountId, toOutwardAccountId);
  const cls = classifyFromConnection(conn);
  if (!cls.ok) {
    if (cls.reason === "client_not_assignable") {
      res.status(400).json({
        error: "Clients are not assignable; assign your own workers/collaborators instead.",
      });
    } else {
      res.status(403).json({
        error: "An accepted connection between you and this person is required before assigning them.",
      });
    }
    return;
  }
  const classification = cls.classification;

  // Idempotent upsert-by-pair: if the person is already a member,
  // refresh classification/connection fields rather than 409'ing.
  const existing = await getMembershipForProperty(propertyId, targetClerkId);

  let saved: PropertyMembershipShape | null;
  if (existing) {
    saved = await upsertPropertyMembership({
      propertyId,
      userClerkId: targetClerkId,
      userOutwardAccountId:
        existing.userOutwardAccountId ?? toOutwardAccountId,
      classification,
      connectionId: conn?.id ?? null,
      assignedByClerkId: userId,
      archivedAt: null,
    });
  } else {
    saved = await upsertPropertyMembership({
      propertyId,
      userClerkId: targetClerkId,
      userOutwardAccountId: toOutwardAccountId,
      role: "member",
      classification,
      connectionId: conn?.id ?? null,
      assignedByClerkId: userId,
      invitedBy: userId,
    });
    await db.insert(propertyMemberEventsTable).values({
      propertyId,
      userClerkId: targetClerkId,
      eventType: "joined",
      role: "member",
      byClerkId: userId,
    });
  }
  if (!saved) {
    res.status(500).json({ error: "Could not upsert assignment" });
    return;
  }

  // Notify the assignee.
  if (await shouldNotify(targetClerkId, "invite")) {
    await insertNotifications({
      userClerkId: targetClerkId,
      type: "invite",
      title: "You were assigned to a property",
      body: `You have a new ${classification.replace("_", " ")} assignment.`,
      relatedId: String(propertyId),
    });
    void sendPushToUser(targetClerkId, {
      title: "You were assigned to a property",
      body: `You have a new ${classification.replace("_", " ")} assignment.`,
      data: { type: "invite", propertyId },
    });
  }

  const [target] = await db.select(publicUserColumns).from(usersTable).where(eq(usersTable.clerkId, targetClerkId));
  res.status(existing ? 200 : 201).json({
    ...saved,
    user: target,
    avgRating: null,
    ratingCount: 0,
    jobCount: 0,
    avgResponseMinutes: null,
  });
});

router.delete("/properties/:propertyId/assignments/:userClerkId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const rawId = Array.isArray(req.params.propertyId) ? req.params.propertyId[0] : req.params.propertyId;
  const propertyId = parseInt(rawId, 10);
  const targetClerkId = Array.isArray(req.params.userClerkId) ? req.params.userClerkId[0] : req.params.userClerkId;
  const membership = await getMembershipForProperty(propertyId, userId);
  // #503 — Strict owner + worker authority for unassigning, mirroring
  // the assignment endpoint. Targets may always remove themselves.
  if (!canAssignPeople(membership) && targetClerkId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const removed = await getMembershipForProperty(propertyId, targetClerkId);
  if (!removed) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }
  await archiveEntityMemberForProperty(propertyId, targetClerkId);
  await db.insert(propertyMemberEventsTable).values({
    propertyId,
    userClerkId: targetClerkId,
    eventType: "left",
    role: removed.role,
    byClerkId: userId,
  });
  res.sendStatus(204);
});

export default router;

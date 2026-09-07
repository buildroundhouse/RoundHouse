import { Router, type IRouter } from "express";
import { eq, and, desc, inArray, or, lte, sql } from "drizzle-orm";
import {
  db,
  propertiesTable,
  propertyAssetsTable,
  workOrdersTable,
  workOrderCommentsTable,
  workOrderCommentReadsTable,
  recurringTasksTable,
  usersTable,
  notificationsTable,
  type WorkOrderAttachment,
} from "@workspace/db";
import {
  getMembershipForProperty,
  listMembersForProperty,
  listMembershipsForUser,
} from "../lib/propertyAccess";
import { isNull } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { requirePaidCapability } from "../lib/capabilities";
import { resolveDefaultOutwardAccountIdForUser } from "../lib/outwardAccounts";
import { insertNotifications } from "../lib/insertNotifications";
import { publicUserColumns } from "../lib/userPublic";
import { sendPushToUser, sendPushToUsers } from "../lib/push";
import { filterRecipientsByPref, shouldNotify } from "../lib/notificationPrefs";
import { ObjectStorageService } from "../lib/objectStorage";
import { assertCallerOwnsUploads } from "../lib/objectAccess";

const objectStorage = new ObjectStorageService();
function normalizeStoragePath(input: unknown): string | null {
  if (typeof input !== "string" || !input) return null;
  try {
    return objectStorage.normalizeObjectEntityPath(input);
  } catch {
    return input;
  }
}

const VALID_PHASES = new Set(["created", "in_progress", "complete"]);

type AttachmentInput = Partial<Record<keyof WorkOrderAttachment, unknown>>;

function normalizeAttachments(
  input: unknown,
  defaults?: { phase?: WorkOrderAttachment["phase"]; addedByClerkId?: string },
): WorkOrderAttachment[] | null {
  if (input === undefined) return null;
  if (!Array.isArray(input)) return [];
  const nowIso = new Date().toISOString();
  const out: WorkOrderAttachment[] = [];
  for (const raw of input as AttachmentInput[]) {
    if (!raw || typeof raw !== "object") continue;
    const path = typeof raw.path === "string" ? normalizeStoragePath(raw.path) : null;
    const kind = raw.kind === "image" || raw.kind === "file" ? raw.kind : null;
    if (!path || !kind) continue;
    const phase =
      typeof raw.phase === "string" && VALID_PHASES.has(raw.phase)
        ? (raw.phase as WorkOrderAttachment["phase"])
        : defaults?.phase;
    const addedAt = typeof raw.addedAt === "string" ? raw.addedAt : nowIso;
    const addedByClerkId =
      typeof raw.addedByClerkId === "string" ? raw.addedByClerkId : defaults?.addedByClerkId;
    out.push({
      path,
      kind,
      ...(typeof raw.name === "string" ? { name: raw.name } : {}),
      ...(typeof raw.contentType === "string" ? { contentType: raw.contentType } : {}),
      ...(typeof raw.size === "number" ? { size: raw.size } : {}),
      ...(phase ? { phase } : {}),
      addedAt,
      ...(addedByClerkId ? { addedByClerkId } : {}),
    });
  }
  return out;
}

const router: IRouter = Router();

const VALID_STATUSES = ["requested", "open", "assigned", "in_progress", "complete", "verified", "cancelled"] as const;
type Status = (typeof VALID_STATUSES)[number];

const VALID_TRANSITIONS: Record<Status, Status[]> = {
  requested: ["open", "cancelled"],
  open: ["assigned", "in_progress", "cancelled"],
  assigned: ["in_progress", "open", "cancelled"],
  in_progress: ["complete", "assigned", "cancelled"],
  complete: ["verified", "in_progress"],
  verified: [],
  // Cancelled is terminal: rejected approval requests cannot be silently
  // re-opened. To resurrect work, create a new work order.
  cancelled: [],
};

function parseId(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(String(v), 10);
}

async function getMembership(propertyId: number, userId: string) {
  return getMembershipForProperty(propertyId, userId);
}

// #503 — Per-property classification used by the permission matrix.
// Legacy memberships (no `classification`) fall back to their `role`,
// so existing owner/admin paths keep working unchanged.
function effectiveClassification(m: { role: string; classification?: string | null } | undefined | null): string {
  if (!m) return "";
  if (m.role === "owner") return "owner";
  if (m.role === "admin") return "admin";
  return m.classification || m.role;
}

// "Manager" = anyone allowed to mutate the work-order list at large
// (assign/edit/cancel/verify any order). Owner, admin, and Trade Pro
// Workers qualify.
function canManage(m: { role: string; classification?: string | null } | string | undefined | null) {
  if (typeof m === "string") {
    // Legacy callers (workflows / cron / tests) sometimes pass just the role.
    return m === "owner" || m === "admin";
  }
  const eff = effectiveClassification(m);
  return eff === "owner" || eff === "admin" || eff === "worker";
}

// #503 — outside_service_provider may create work orders, but only ones
// that target themselves as the assignee.
function isOutsideServiceProvider(m: { role: string; classification?: string | null } | undefined | null) {
  return effectiveClassification(m) === "outside_service_provider";
}

// #503 — collaborators are read-only on the property; they cannot create
// or edit work orders at all.
function isReadOnlyCollaborator(m: { role: string; classification?: string | null } | undefined | null) {
  return effectiveClassification(m) === "collaborator";
}

// #503 — Outside service providers may only see/touch a work order if
// they are its assignee or its creator. Used by every work-order-adjacent
// endpoint (single GET, comments, photos, status, approve/reject) so the
// scope stays consistent.
function ospCanAccessOrder(
  m: { role: string; classification?: string | null } | undefined | null,
  order: { assigneeClerkId: string | null; createdByClerkId: string },
  userId: string,
): boolean {
  if (!isOutsideServiceProvider(m)) return true;
  return order.assigneeClerkId === userId || order.createdByClerkId === userId;
}

/**
 * #537 — load per-viewer connection tags (Service · Identity / chip)
 * keyed by the *target's* outward account id. The viewer is whichever
 * skin the caller is currently acting as. Comments and work orders
 * each carry the target's outward account id, so the lookup is a
 * single batched query.
 */
type ViewerConnectionTag = {
  serviceTitle: string | null;
  onSiteIdentity: string | null;
  onSiteIdentityOther: string | null;
  chip: string | null;
  chipOther: string | null;
};

async function loadConnectionTagsForViewer(
  _viewerOutwardAccountId: number | null,
  _targetOutwardAccountIds: (number | null | undefined)[],
): Promise<Map<number, ViewerConnectionTag>> {
  // Task #663: per-viewer connection tags (Service · On-site identity ·
  // Collaborator chip) lived on `user_connections`, which has been
  // retired in favor of entity_members. The equivalent surface — the
  // Service / Identity chip pair the viewer's avatar earned by joining
  // an entity — will land alongside the entity-membership UI in T007.
  // Until that lands, fall back to "no tag" so work-order rows still
  // attach the user object cleanly without leaking stale data.
  return new Map<number, ViewerConnectionTag>();
}

async function attachUsersToOrder<
  T extends {
    assigneeClerkId: string | null;
    createdByClerkId: string;
    assigneeOutwardAccountId?: number | null;
    createdByOutwardAccountId?: number | null;
  },
>(rows: T[], viewerOutwardAccountId: number | null = null) {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.assigneeClerkId) ids.add(r.assigneeClerkId);
    ids.add(r.createdByClerkId);
  }
  const list = [...ids];
  const users = list.length
    ? await db.select(publicUserColumns).from(usersTable).where(inArray(usersTable.clerkId, list))
    : [];
  const map = Object.fromEntries(users.map((u) => [u.clerkId, u]));
  // #537 — attach the viewer's per-client tag (composed Service · Identity
  // line) to the assignee/createdBy user objects. The target outward
  // account ids live on the work order row.
  const tagMap = await loadConnectionTagsForViewer(
    viewerOutwardAccountId,
    rows.flatMap((r) => [r.assigneeOutwardAccountId, r.createdByOutwardAccountId]),
  );
  const decorate = (
    user: typeof users[number] | undefined,
    targetAccountId: number | null | undefined,
  ) => {
    if (!user) return null;
    const tag = targetAccountId != null ? tagMap.get(targetAccountId) : undefined;
    return { ...user, connectionTag: tag ?? null };
  };
  return rows.map((r) => ({
    ...r,
    assignee: r.assigneeClerkId
      ? decorate(map[r.assigneeClerkId], r.assigneeOutwardAccountId ?? null)
      : null,
    createdBy: decorate(map[r.createdByClerkId], r.createdByOutwardAccountId ?? null),
  }));
}

async function attachPropertyToOrder<T extends { propertyId: number }>(rows: T[]) {
  const ids = [...new Set(rows.map((r) => r.propertyId))];
  const props = ids.length
    ? await db.select().from(propertiesTable).where(inArray(propertiesTable.id, ids))
    : [];
  const map = Object.fromEntries(props.map((p) => [p.id, p]));
  return rows.map((r) => ({ ...r, property: map[r.propertyId] ?? null }));
}

async function attachAssetToOrder<T extends { assetId: number | null }>(rows: T[]) {
  const ids = [...new Set(rows.map((r) => r.assetId).filter((v): v is number => typeof v === "number"))];
  const assets = ids.length
    ? await db.select().from(propertyAssetsTable).where(inArray(propertyAssetsTable.id, ids))
    : [];
  const map = Object.fromEntries(assets.map((a) => [a.id, a]));
  return rows.map((r) => ({ ...r, asset: r.assetId ? map[r.assetId] ?? null : null }));
}

// ---------- Work Orders ----------
router.get("/properties/:propertyId/work-order-photos", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const propertyId = parseId(req.params.propertyId);
  const m = await getMembership(propertyId, userId);
  if (!m) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  // #503 — OSPs only see photos from their own work orders.
  const ordersAll = await db
    .select()
    .from(workOrdersTable)
    .where(eq(workOrdersTable.propertyId, propertyId));
  const orders = isOutsideServiceProvider(m)
    ? ordersAll.filter((o) => o.assigneeClerkId === userId || o.createdByClerkId === userId)
    : ordersAll;
  const orderIds = orders.map((o) => o.id);
  const comments = orderIds.length
    ? await db
        .select()
        .from(workOrderCommentsTable)
        .where(inArray(workOrderCommentsTable.workOrderId, orderIds))
    : [];

  type Photo = {
    path: string;
    workOrderId: number;
    addedAt?: string;
    addedByClerkId?: string;
    source: "work_order" | "comment";
  };
  const photos: Photo[] = [];
  const seen = new Set<string>();
  const pushPhoto = (p: Photo) => {
    const key = `${p.workOrderId}:${p.path}`;
    if (seen.has(key)) return;
    seen.add(key);
    photos.push(p);
  };
  for (const o of orders) {
    if (o.photoUrl) {
      pushPhoto({
        path: o.photoUrl,
        workOrderId: o.id,
        addedAt: o.createdAt instanceof Date ? o.createdAt.toISOString() : String(o.createdAt),
        addedByClerkId: o.createdByClerkId,
        source: "work_order",
      });
    }
    for (const a of o.attachments ?? []) {
      if (!a || a.kind !== "image" || typeof a.path !== "string") continue;
      pushPhoto({
        path: a.path,
        workOrderId: o.id,
        addedAt: a.addedAt,
        addedByClerkId: a.addedByClerkId,
        source: "work_order",
      });
    }
  }
  for (const c of comments) {
    for (const a of c.attachments ?? []) {
      if (!a || a.kind !== "image" || typeof a.path !== "string") continue;
      pushPhoto({
        path: a.path,
        workOrderId: c.workOrderId,
        addedAt:
          a.addedAt ??
          (c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt)),
        addedByClerkId: a.addedByClerkId ?? c.authorClerkId,
        source: "comment",
      });
    }
  }
  // Newest first.
  photos.sort((a, b) => {
    const ta = a.addedAt ? new Date(a.addedAt).getTime() : 0;
    const tb = b.addedAt ? new Date(b.addedAt).getTime() : 0;
    return tb - ta;
  });
  res.json({ photos });
});

router.get("/properties/:propertyId/work-orders", requireAuth, async (req, res): Promise<void> => {
  const { userId, activeOutwardAccountId } = req as AuthRequest;
  const propertyId = parseId(req.params.propertyId);
  const m = await getMembership(propertyId, userId);
  if (!m) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const statusFilter = req.query.status ? String(req.query.status) : undefined;
  const conditions = [eq(workOrdersTable.propertyId, propertyId)];
  if (statusFilter) conditions.push(eq(workOrdersTable.status, statusFilter));
  // #503 — outside_service_providers only see work orders they are
  // either the assignee or the creator of.
  if (isOutsideServiceProvider(m)) {
    conditions.push(
      or(
        eq(workOrdersTable.assigneeClerkId, userId),
        eq(workOrdersTable.createdByClerkId, userId),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(workOrdersTable)
    .where(and(...conditions))
    .orderBy(desc(workOrdersTable.createdAt));
  const enriched = await attachAssetToOrder(
    await attachPropertyToOrder(await attachUsersToOrder(rows, activeOutwardAccountId ?? null)),
  );
  res.json({ workOrders: enriched });
});

router.post("/properties/:propertyId/work-orders", requireAuth, async (req, res): Promise<void> => {
  const ar = req as AuthRequest;
  const { userId, activeOutwardAccountId } = ar;
  const propertyId = parseId(req.params.propertyId);
  const m = await getMembership(propertyId, userId);
  if (!m) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (!(await requirePaidCapability(ar, res, "create_property_records"))) return;
  const {
    title,
    description,
    priority,
    dueDate,
    assigneeClerkId,
    photoUrl,
    attachments,
    category,
    assetId,
    poNumber,
    costEstimate,
    costActual,
    requestApproval,
  } = req.body;
  if (!title || typeof title !== "string") {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const isManager = canManage(m);
  // Approval requests are only valid on commercial properties; for other property
  // types the original Trade Pro flow applies (managers create directly).
  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId));
  if (!property) {
    res.status(404).json({ error: "Property not found" });
    return;
  }
  const isCommercial = property.type === "commercial";
  const wantsApproval = Boolean(requestApproval) && isCommercial;
  // #503 — Collaborators are read-only on the property and may never
  // create work orders (even via the approval-request path).
  if (isReadOnlyCollaborator(m)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  // #503 — Outside service providers may create their own work orders,
  // but the order MUST be scoped to themselves: assigned to + (if asking
  // for approval) requested by themselves only.
  const isOsp = isOutsideServiceProvider(m);
  if (isOsp) {
    if (assigneeClerkId && String(assigneeClerkId) !== userId) {
      res.status(403).json({ error: "Outside service providers may only create work orders assigned to themselves" });
      return;
    }
  } else if (!isManager && !wantsApproval) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const approvalStatus = wantsApproval ? "pending" : "none";
  const status: Status = wantsApproval
    ? "requested"
    : assigneeClerkId
    ? "assigned"
    : "open";
  const normalizedAttachments =
    normalizeAttachments(attachments, { phase: "created", addedByClerkId: userId }) ?? [];
  const normalizedPhoto = photoUrl ? normalizeStoragePath(String(photoUrl)) : null;
  await assertCallerOwnsUploads(userId, [normalizedPhoto, ...normalizedAttachments.map((a) => a.path)]);
  // Validate asset belongs to this property if supplied.
  let resolvedAssetId: number | null = null;
  if (assetId != null) {
    const id = Number(assetId);
    if (Number.isFinite(id)) {
      const [asset] = await db
        .select()
        .from(propertyAssetsTable)
        .where(and(eq(propertyAssetsTable.id, id), eq(propertyAssetsTable.propertyId, propertyId)));
      if (!asset) {
        res.status(400).json({ error: "Invalid assetId for this property" });
        return;
      }
      resolvedAssetId = id;
    }
  }
  const createdByOutwardAccountId =
    activeOutwardAccountId ?? (await resolveDefaultOutwardAccountIdForUser(userId));
  // Outside service providers always self-assign their work orders.
  const finalAssigneeClerkId = isOsp
    ? userId
    : !wantsApproval && assigneeClerkId
    ? String(assigneeClerkId)
    : null;
  const assigneeOutwardAccountId = finalAssigneeClerkId
    ? await resolveDefaultOutwardAccountIdForUser(finalAssigneeClerkId)
    : null;
  const [order] = await db
    .insert(workOrdersTable)
    .values({
      propertyId,
      title: String(title),
      description: description ? String(description) : "",
      priority: priority ? String(priority) : "normal",
      dueDate: dueDate ? new Date(dueDate) : null,
      status,
      category: category ? String(category) : null,
      assetId: resolvedAssetId,
      approvalStatus,
      requestedByClerkId: wantsApproval ? userId : null,
      poNumber: poNumber ? String(poNumber).trim() : null,
      costEstimate: costEstimate != null && costEstimate !== "" ? String(costEstimate) : null,
      costActual: costActual != null && costActual !== "" ? String(costActual) : null,
      assigneeClerkId: finalAssigneeClerkId,
      assigneeOutwardAccountId,
      photoUrl: normalizedPhoto,
      attachments: normalizedAttachments,
      createdByClerkId: userId,
      createdByOutwardAccountId,
    })
    .returning();

  // Notify managers when a work order is requested for approval.
  if (wantsApproval) {
    const allMembers = await listMembersForProperty(propertyId);
    const managers = allMembers.filter((mgr) => mgr.role === "owner" || mgr.role === "admin");
    const candidates = managers.map((mgr) => mgr.userClerkId).filter((uid) => uid !== userId);
    const targets = await filterRecipientsByPref(candidates, "work_order_requested");
    if (targets.length > 0) {
      await insertNotifications(
        targets.map((uid) => ({
          userClerkId: uid,
          type: "work_order_requested",
          title: "Work order needs approval",
          body: `${order.title} was requested.`,
          relatedId: String(order.id),
        })),
      );
      void sendPushToUsers(targets, {
        title: "Work order needs approval",
        body: `${order.title} was requested.`,
        data: { type: "work_order_requested", workOrderId: order.id, propertyId },
      });
    }
  }

  if (
    order.assigneeClerkId &&
    order.assigneeClerkId !== userId &&
    (await shouldNotify(order.assigneeClerkId, "work_order_assigned"))
  ) {
    await insertNotifications({
      userClerkId: order.assigneeClerkId,
      type: "work_order_assigned",
      title: "New work order assigned",
      body: `You were assigned: ${order.title}`,
      relatedId: String(order.id),
    });
    void sendPushToUser(order.assigneeClerkId, {
      title: "New work order assigned",
      body: `You were assigned: ${order.title}`,
      data: { type: "work_order_assigned", workOrderId: order.id, propertyId },
    });
  }

  const [enriched] = await attachAssetToOrder(
    await attachPropertyToOrder(await attachUsersToOrder([order], activeOutwardAccountId ?? null)),
  );
  res.status(201).json(enriched);
});

router.get("/work-orders/mine", requireAuth, async (req, res): Promise<void> => {
  const { userId, activeOutwardAccountId } = req as AuthRequest;
  const rows = await db
    .select()
    .from(workOrdersTable)
    .where(
      and(
        eq(workOrdersTable.assigneeClerkId, userId),
        inArray(workOrdersTable.status, ["open", "assigned", "in_progress", "complete"]),
      ),
    )
    .orderBy(workOrdersTable.dueDate, desc(workOrdersTable.createdAt));
  const enriched = await attachAssetToOrder(
    await attachPropertyToOrder(await attachUsersToOrder(rows, activeOutwardAccountId ?? null)),
  );

  // Compute photo-attachment hints from the latest comment on each work order.
  const workOrderIds = enriched.map((w) => w.id);
  const latestPhotoCountByWO: Record<number, number> = {};
  const latestPhotoPathsByWO: Record<number, string[]> = {};
  const latestCommentAuthorClerkIdByWO: Record<number, string> = {};
  const latestCommentCreatedAtByWO: Record<number, Date> = {};
  if (workOrderIds.length > 0) {
    const comments = await db
      .select()
      .from(workOrderCommentsTable)
      .where(inArray(workOrderCommentsTable.workOrderId, workOrderIds))
      .orderBy(desc(workOrderCommentsTable.createdAt));
    const seen = new Set<number>();
    for (const c of comments) {
      if (seen.has(c.workOrderId)) continue;
      seen.add(c.workOrderId);
      const atts = (c.attachments ?? []) as { kind?: string; path?: string }[];
      const images = atts.filter((a) => a.kind === "image");
      latestPhotoCountByWO[c.workOrderId] = images.length;
      const paths = images
        .map((a) => a.path)
        .filter((p): p is string => typeof p === "string" && p.length > 0);
      latestPhotoPathsByWO[c.workOrderId] = paths;
      if (c.authorClerkId) latestCommentAuthorClerkIdByWO[c.workOrderId] = c.authorClerkId;
      latestCommentCreatedAtByWO[c.workOrderId] = c.createdAt;
    }
  }
  const authorClerkIds = Array.from(new Set(Object.values(latestCommentAuthorClerkIdByWO)));
  const authorUsers = authorClerkIds.length
    ? await db
        .select(publicUserColumns)
        .from(usersTable)
        .where(inArray(usersTable.clerkId, authorClerkIds))
    : [];
  const authorNamesByClerkId: Record<string, string | null> = Object.fromEntries(
    authorUsers.map((u) => [u.clerkId, u.name ?? null]),
  );
  const withHints = enriched.map((w) => {
    const paths = latestPhotoPathsByWO[w.id] ?? [];
    const count = latestPhotoCountByWO[w.id] ?? 0;
    const authorClerkId = latestCommentAuthorClerkIdByWO[w.id];
    const createdAt = latestCommentCreatedAtByWO[w.id];
    return {
      ...w,
      latestCommentHasPhoto: count > 0,
      latestCommentPhotoCount: count,
      latestCommentPhotoPath: paths[0] ?? null,
      latestCommentPhotoPaths: paths,
      latestCommentAuthorName: authorClerkId ? authorNamesByClerkId[authorClerkId] ?? null : null,
      latestCommentCreatedAt: createdAt ? createdAt.toISOString() : null,
    };
  });
  res.json({ workOrders: withHints });
});

router.get("/work-orders/unread-comment-counts", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const propertyIdRaw = req.query.propertyId;
  const propertyId = propertyIdRaw !== undefined ? parseId(propertyIdRaw as string) : undefined;

  const orderConditions = [];
  // #503 — OSP scoping must be applied PER PROPERTY, not globally. A
  // user can be OSP on property A and a manager/worker on property B;
  // they should still see only their own assigned/created orders on A
  // while seeing every order on B.
  if (typeof propertyId === "number" && !Number.isNaN(propertyId)) {
    const m = await getMembership(propertyId, userId);
    if (!m) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    orderConditions.push(eq(workOrdersTable.propertyId, propertyId));
    if (isOutsideServiceProvider(m)) {
      orderConditions.push(
        or(
          eq(workOrdersTable.assigneeClerkId, userId),
          eq(workOrdersTable.createdByClerkId, userId),
        )!,
      );
    }
  } else {
    const memberships = await listMembershipsForUser(userId);
    if (memberships.length === 0) {
      res.json({ counts: [] });
      return;
    }
    const ospPropertyIds = memberships
      .filter((m) => isOutsideServiceProvider(m))
      .map((m) => m.propertyId);
    const unrestrictedPropertyIds = memberships
      .filter((m) => !isOutsideServiceProvider(m))
      .map((m) => m.propertyId);
    // Build: (propertyId IN unrestricted) OR (propertyId IN osp AND
    // (assignee = me OR creator = me)). Either side may be empty.
    const branches: ReturnType<typeof and>[] = [];
    if (unrestrictedPropertyIds.length > 0) {
      branches.push(inArray(workOrdersTable.propertyId, unrestrictedPropertyIds));
    }
    if (ospPropertyIds.length > 0) {
      branches.push(
        and(
          inArray(workOrdersTable.propertyId, ospPropertyIds),
          or(
            eq(workOrdersTable.assigneeClerkId, userId),
            eq(workOrdersTable.createdByClerkId, userId),
          )!,
        )!,
      );
    }
    if (branches.length === 1) {
      orderConditions.push(branches[0]!);
    } else {
      orderConditions.push(or(...branches)!);
    }
  }

  const rows = await db
    .select({
      workOrderId: workOrderCommentsTable.workOrderId,
      count: sql<number>`count(*)`,
    })
    .from(workOrderCommentsTable)
    .innerJoin(workOrdersTable, eq(workOrdersTable.id, workOrderCommentsTable.workOrderId))
    .leftJoin(
      workOrderCommentReadsTable,
      and(
        eq(workOrderCommentReadsTable.workOrderId, workOrderCommentsTable.workOrderId),
        eq(workOrderCommentReadsTable.userClerkId, userId),
      ),
    )
    .where(
      and(
        ...orderConditions,
        // Don't count the user's own comments as unread.
        sql`${workOrderCommentsTable.authorClerkId} <> ${userId}`,
        or(
          sql`${workOrderCommentReadsTable.lastReadAt} IS NULL`,
          sql`${workOrderCommentsTable.createdAt} > ${workOrderCommentReadsTable.lastReadAt}`,
        ),
      ),
    )
    .groupBy(workOrderCommentsTable.workOrderId);

  res.json({
    counts: rows.map((r) => ({ workOrderId: r.workOrderId, unreadCount: Number(r.count) })),
  });
});

router.post(
  "/work-orders/:workOrderId/comments/read",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const id = parseId(req.params.workOrderId);
    const [order] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
    if (!order) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const m = await getMembership(order.propertyId, userId);
    if (!m) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    // #503 — OSPs cannot mark another contractor's thread as read.
    if (!ospCanAccessOrder(m, order, userId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const now = new Date();
    await db
      .insert(workOrderCommentReadsTable)
      .values({ userClerkId: userId, workOrderId: id, lastReadAt: now })
      .onConflictDoUpdate({
        target: [workOrderCommentReadsTable.userClerkId, workOrderCommentReadsTable.workOrderId],
        set: { lastReadAt: now },
      });
    res.json({ workOrderId: id, lastReadAt: now.toISOString() });
  },
);

router.get("/work-orders/overdue-counts", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const memberships = await listMembershipsForUser(userId);
  if (memberships.length === 0) {
    res.json({ counts: [] });
    return;
  }
  // #503 — OSP scoping must be applied PER PROPERTY: on properties
  // where the caller is OSP, count only orders they are assigned to or
  // created; on properties where they are owner/worker/etc, count
  // every overdue order. Mirrors the unread-comment-counts approach.
  const ospPropertyIds = memberships
    .filter((m) => isOutsideServiceProvider(m))
    .map((m) => m.propertyId);
  const unrestrictedPropertyIds = memberships
    .filter((m) => !isOutsideServiceProvider(m))
    .map((m) => m.propertyId);
  const branches: ReturnType<typeof and>[] = [];
  if (unrestrictedPropertyIds.length > 0) {
    branches.push(inArray(workOrdersTable.propertyId, unrestrictedPropertyIds));
  }
  if (ospPropertyIds.length > 0) {
    branches.push(
      and(
        inArray(workOrdersTable.propertyId, ospPropertyIds),
        or(
          eq(workOrdersTable.assigneeClerkId, userId),
          eq(workOrdersTable.createdByClerkId, userId),
        )!,
      )!,
    );
  }
  if (branches.length === 0) {
    res.json({ counts: [] });
    return;
  }
  const propertyScope = branches.length === 1 ? branches[0]! : or(...branches)!;
  const rows = await db
    .select({
      propertyId: workOrdersTable.propertyId,
      count: sql<number>`count(*)`,
    })
    .from(workOrdersTable)
    .where(
      and(
        propertyScope,
        inArray(workOrdersTable.status, ["open", "assigned", "in_progress"]),
        lte(workOrdersTable.dueDate, new Date()),
      ),
    )
    .groupBy(workOrdersTable.propertyId);
  res.json({
    counts: rows.map((r) => ({ propertyId: r.propertyId, overdueCount: Number(r.count) })),
  });
});

// Active Clients aggregation for the Reminders hub. A "client" is the owner
// of a property where the current user (a Pro) has at least one in-flight
// work order. Each entry is keyed by the client's clerk id so multiple
// properties belonging to the same homeowner roll up into one row, and the
// most recently touched work order is surfaced as the navigation target.
router.get("/work-orders/active-clients", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const ACTIVE_STATUSES = ["open", "assigned", "in_progress", "complete"] as const;

  const orders = await db
    .select()
    .from(workOrdersTable)
    .where(
      and(
        eq(workOrdersTable.assigneeClerkId, userId),
        inArray(workOrdersTable.status, ACTIVE_STATUSES as unknown as string[]),
      ),
    );

  if (orders.length === 0) {
    res.json({ clients: [] });
    return;
  }

  const propertyIds = [...new Set(orders.map((o) => o.propertyId))];
  const properties = await db
    .select()
    .from(propertiesTable)
    .where(inArray(propertiesTable.id, propertyIds));
  const propertyById = new Map(properties.map((p) => [p.id, p]));

  type Group = {
    clientClerkId: string;
    propertyId: number;
    propertyName: string;
    activeWorkOrderCount: number;
    mostRecentWorkOrderId: number;
    mostRecentWorkOrderTitle: string;
    lastActivityAt: string;
  };
  const groups = new Map<string, Group>();
  for (const o of orders) {
    const property = propertyById.get(o.propertyId);
    if (!property) continue;
    const clientClerkId = property.ownerClerkId;
    const activityAt =
      o.updatedAt instanceof Date ? o.updatedAt : new Date(String(o.updatedAt));
    const existing = groups.get(clientClerkId);
    if (!existing) {
      groups.set(clientClerkId, {
        clientClerkId,
        propertyId: property.id,
        propertyName: property.name,
        activeWorkOrderCount: 1,
        mostRecentWorkOrderId: o.id,
        mostRecentWorkOrderTitle: o.title,
        lastActivityAt: activityAt.toISOString(),
      });
    } else {
      existing.activeWorkOrderCount += 1;
      if (activityAt.toISOString() > existing.lastActivityAt) {
        existing.lastActivityAt = activityAt.toISOString();
        existing.mostRecentWorkOrderId = o.id;
        existing.mostRecentWorkOrderTitle = o.title;
        existing.propertyId = property.id;
        existing.propertyName = property.name;
      }
    }
  }

  const clientClerkIds = [...groups.keys()];
  const clientUsers = clientClerkIds.length
    ? await db
        .select(publicUserColumns)
        .from(usersTable)
        .where(inArray(usersTable.clerkId, clientClerkIds))
    : [];
  const userByClerkId = new Map(clientUsers.map((u) => [u.clerkId, u]));

  const clients = [...groups.values()]
    .map((g) => {
      const u = userByClerkId.get(g.clientClerkId) ?? null;
      return {
        clientClerkId: g.clientClerkId,
        clientName: u?.name ?? null,
        clientAvatarUrl: u?.avatarUrl ?? null,
        propertyId: g.propertyId,
        propertyName: g.propertyName,
        activeWorkOrderCount: g.activeWorkOrderCount,
        mostRecentWorkOrderId: g.mostRecentWorkOrderId,
        mostRecentWorkOrderTitle: g.mostRecentWorkOrderTitle,
        lastActivityAt: g.lastActivityAt,
      };
    })
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));

  res.json({ clients });
});

router.get("/work-orders/:workOrderId", requireAuth, async (req, res): Promise<void> => {
  const { userId, activeOutwardAccountId } = req as AuthRequest;
  const id = parseId(req.params.workOrderId);
  const [order] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (!order) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const m = await getMembership(order.propertyId, userId);
  if (!m) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  // #503 — outside_service_provider scope: only their own work orders.
  if (
    isOutsideServiceProvider(m) &&
    order.assigneeClerkId !== userId &&
    order.createdByClerkId !== userId
  ) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const [enriched] = await attachAssetToOrder(
    await attachPropertyToOrder(await attachUsersToOrder([order], activeOutwardAccountId ?? null)),
  );
  res.json(enriched);
});

router.put("/work-orders/:workOrderId", requireAuth, async (req, res): Promise<void> => {
  const { userId, activeOutwardAccountId } = req as AuthRequest;
  const id = parseId(req.params.workOrderId);
  const [existing] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const m = await getMembership(existing.propertyId, userId);
  if (!m) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  // #503 — Read-only collaborators may never mutate a work order, even
  // an attachments-only update on something they happen to be assignee
  // or creator of.
  if (isReadOnlyCollaborator(m)) {
    res.status(403).json({ error: "Collaborators cannot edit work orders." });
    return;
  }
  const {
    title,
    description,
    priority,
    dueDate,
    assigneeClerkId,
    photoUrl,
    attachments,
    category,
    assetId,
    poNumber,
    costEstimate,
    costActual,
  } = req.body;
  // Identify whether the request touches manager-only fields (anything other than attachments).
  const touchesManagerFields =
    title != null ||
    description != null ||
    priority != null ||
    dueDate !== undefined ||
    photoUrl !== undefined ||
    assigneeClerkId !== undefined ||
    category !== undefined ||
    assetId !== undefined ||
    poNumber !== undefined ||
    costEstimate !== undefined ||
    costActual !== undefined;
  const isAssignee = existing.assigneeClerkId === userId;
  const isCreator = existing.createdByClerkId === userId;
  if (touchesManagerFields && !canManage(m)) {
    res.status(403).json({ error: "Only owners/admins can edit work orders" });
    return;
  }
  if (!touchesManagerFields && !canManage(m) && !isAssignee && !isCreator) {
    // Attachments-only update: allow assignee or creator to attach evidence.
    res.status(403).json({ error: "Only the assignee, creator, or a manager can edit attachments" });
    return;
  }
  const updates: Record<string, unknown> = {};
  if (title != null) updates.title = String(title);
  if (description != null) updates.description = String(description);
  if (priority != null) updates.priority = String(priority);
  if (dueDate !== undefined) updates.dueDate = dueDate ? new Date(dueDate) : null;
  const removedPaths: string[] = [];
  if (photoUrl !== undefined) {
    const np = photoUrl ? normalizeStoragePath(String(photoUrl)) : null;
    await assertCallerOwnsUploads(userId, [np]);
    updates.photoUrl = np;
    if (existing.photoUrl) {
      const oldNormalized = normalizeStoragePath(existing.photoUrl) ?? existing.photoUrl;
      if (oldNormalized !== np) removedPaths.push(existing.photoUrl);
    }
  }
  if (attachments !== undefined) {
    const phase: WorkOrderAttachment["phase"] | undefined =
      existing.status === "in_progress"
        ? "in_progress"
        : existing.status === "complete" || existing.status === "verified"
        ? "complete"
        : "created";
    const na = normalizeAttachments(attachments, { phase, addedByClerkId: userId }) ?? [];
    await assertCallerOwnsUploads(userId, na.map((a) => a.path));
    updates.attachments = na;
    const newPaths = new Set(na.map((a) => a.path));
    for (const a of existing.attachments ?? []) {
      const p = typeof a?.path === "string" ? a.path : "";
      if (!p) continue;
      const normalized = normalizeStoragePath(p) ?? p;
      if (!newPaths.has(normalized) && !newPaths.has(p)) removedPaths.push(p);
    }
  }
  if (assigneeClerkId !== undefined) {
    updates.assigneeClerkId = assigneeClerkId ? String(assigneeClerkId) : null;
    updates.assigneeOutwardAccountId = assigneeClerkId
      ? await resolveDefaultOutwardAccountIdForUser(String(assigneeClerkId))
      : null;
    if (assigneeClerkId && existing.status === "open") {
      updates.status = "assigned";
    }
  }
  if (category !== undefined) updates.category = category ? String(category) : null;
  if (assetId !== undefined) {
    if (assetId == null) {
      updates.assetId = null;
    } else {
      const aid = Number(assetId);
      if (Number.isFinite(aid)) {
        const [asset] = await db
          .select()
          .from(propertyAssetsTable)
          .where(and(eq(propertyAssetsTable.id, aid), eq(propertyAssetsTable.propertyId, existing.propertyId)));
        if (!asset) {
          res.status(400).json({ error: "Invalid assetId for this property" });
          return;
        }
        updates.assetId = aid;
      }
    }
  }
  if (poNumber !== undefined) updates.poNumber = poNumber ? String(poNumber).trim() : null;
  if (costEstimate !== undefined) updates.costEstimate = costEstimate === "" || costEstimate == null ? null : String(costEstimate);
  if (costActual !== undefined) updates.costActual = costActual === "" || costActual == null ? null : String(costActual);
  const [updated] = await db.update(workOrdersTable).set(updates).where(eq(workOrdersTable.id, id)).returning();

  for (const p of removedPaths) {
    await objectStorage.deleteObjectEntity(p);
  }

  if (
    assigneeClerkId &&
    assigneeClerkId !== existing.assigneeClerkId &&
    assigneeClerkId !== userId &&
    (await shouldNotify(String(assigneeClerkId), "work_order_assigned"))
  ) {
    await insertNotifications({
      userClerkId: String(assigneeClerkId),
      type: "work_order_assigned",
      title: "Work order assigned to you",
      body: `You were assigned: ${updated.title}`,
      relatedId: String(updated.id),
    });
    void sendPushToUser(String(assigneeClerkId), {
      title: "Work order assigned to you",
      body: `You were assigned: ${updated.title}`,
      data: { type: "work_order_assigned", workOrderId: updated.id, propertyId: existing.propertyId },
    });
  }

  const [enriched] = await attachAssetToOrder(
    await attachPropertyToOrder(await attachUsersToOrder([updated], activeOutwardAccountId ?? null)),
  );
  res.json(enriched);
});

router.delete("/work-orders/:workOrderId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const id = parseId(req.params.workOrderId);
  const [existing] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const m = await getMembership(existing.propertyId, userId);
  if (!m || !canManage(m)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const commentRows = await db
    .select({ attachments: workOrderCommentsTable.attachments })
    .from(workOrderCommentsTable)
    .where(eq(workOrderCommentsTable.workOrderId, id));
  await db.delete(workOrderCommentsTable).where(eq(workOrderCommentsTable.workOrderId, id));
  await db.delete(workOrderCommentReadsTable).where(eq(workOrderCommentReadsTable.workOrderId, id));
  await db.delete(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (existing.photoUrl) {
    await objectStorage.deleteObjectEntity(existing.photoUrl);
  }
  for (const a of existing.attachments ?? []) {
    const p = typeof a?.path === "string" ? a.path : "";
    if (p) await objectStorage.deleteObjectEntity(p);
  }
  for (const row of commentRows) {
    for (const a of row.attachments ?? []) {
      const p = typeof a?.path === "string" ? a.path : "";
      if (p) await objectStorage.deleteObjectEntity(p);
    }
  }
  res.sendStatus(204);
});

router.post("/work-orders/:workOrderId/status", requireAuth, async (req, res): Promise<void> => {
  const { userId, activeOutwardAccountId } = req as AuthRequest;
  const id = parseId(req.params.workOrderId);
  const { status: newStatus, attachments } = req.body;
  if (!newStatus || !VALID_STATUSES.includes(newStatus)) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }
  const [existing] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const m = await getMembership(existing.propertyId, userId);
  if (!m) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  // #503 — Collaborators are read-only on work orders; OSPs cannot
  // drive status on someone else's work order.
  if (isReadOnlyCollaborator(m)) {
    res.status(403).json({ error: "Collaborators cannot change work-order status." });
    return;
  }
  if (!ospCanAccessOrder(m, existing, userId)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const allowed = VALID_TRANSITIONS[existing.status as Status] ?? [];
  if (!allowed.includes(newStatus)) {
    res.status(400).json({ error: `Cannot transition from ${existing.status} to ${newStatus}` });
    return;
  }
  // Approval flow: transitions out of "requested" must go through the dedicated
  // /approve and /reject endpoints so approvalStatus stays consistent.
  if (existing.status === "requested") {
    res.status(400).json({ error: "Use /approve or /reject for requested work orders" });
    return;
  }
  // Role gating for verify
  if (newStatus === "verified" && !canManage(m)) {
    res.status(403).json({ error: "Only owners/admins can verify" });
    return;
  }
  // Assignee or manager can move into in_progress / complete
  const isAssignee = existing.assigneeClerkId === userId;
  const transitionsRequiringAssigneeOrManager: Status[] = ["in_progress", "complete"];
  if (transitionsRequiringAssigneeOrManager.includes(newStatus) && !isAssignee && !canManage(m)) {
    res.status(403).json({ error: "Only the assignee or a manager can update this status" });
    return;
  }

  const updates: Record<string, unknown> = { status: newStatus };
  if (newStatus === "in_progress" && !existing.startedAt) updates.startedAt = new Date();
  if (newStatus === "complete") updates.completedAt = new Date();
  if (newStatus === "verified") updates.verifiedAt = new Date();

  const phase: WorkOrderAttachment["phase"] | undefined =
    newStatus === "in_progress" ? "in_progress" : newStatus === "complete" ? "complete" : undefined;
  const incoming = normalizeAttachments(attachments, { phase, addedByClerkId: userId });
  if (incoming && incoming.length > 0) {
    await assertCallerOwnsUploads(userId, incoming.map((a) => a.path));
    updates.attachments = [...(existing.attachments ?? []), ...incoming];
  }

  const [updated] = await db.update(workOrdersTable).set(updates).where(eq(workOrdersTable.id, id)).returning();

  // Notifications
  if (newStatus === "complete") {
    // notify property owner(s)/admins
    const allMembers = await listMembersForProperty(existing.propertyId);
    const managers = allMembers.filter((mgr) => mgr.role === "owner" || mgr.role === "admin");
    const candidates = managers.map((mgr) => mgr.userClerkId).filter((uid) => uid !== userId);
    const targets = await filterRecipientsByPref(candidates, "work_order_complete");
    if (targets.length > 0) {
      await insertNotifications(
        targets.map((uid) => ({
          userClerkId: uid,
          type: "work_order_complete",
          title: "Work order completed",
          body: `${updated.title} is ready for verification.`,
          relatedId: String(updated.id),
        })),
      );
      void sendPushToUsers(targets, {
        title: "Work order completed",
        body: `${updated.title} is ready for verification.`,
        data: { type: "work_order_complete", workOrderId: updated.id, propertyId: existing.propertyId },
      });
    }
  } else if (
    newStatus === "verified" &&
    existing.assigneeClerkId &&
    existing.assigneeClerkId !== userId &&
    (await shouldNotify(existing.assigneeClerkId, "work_order_verified"))
  ) {
    await insertNotifications({
      userClerkId: existing.assigneeClerkId,
      type: "work_order_verified",
      title: "Work order verified",
      body: `${updated.title} was verified.`,
      relatedId: String(updated.id),
    });
    void sendPushToUser(existing.assigneeClerkId, {
      title: "Work order verified",
      body: `${updated.title} was verified.`,
      data: { type: "work_order_verified", workOrderId: updated.id, propertyId: existing.propertyId },
    });
  }

  const [enriched] = await attachAssetToOrder(
    await attachPropertyToOrder(await attachUsersToOrder([updated], activeOutwardAccountId ?? null)),
  );
  res.json(enriched);
});

// ---------- Approvals ----------
async function approveOrReject(req: AuthRequest, res: import("express").Response, decision: "approved" | "rejected") {
  const { userId, activeOutwardAccountId } = req;
  const id = parseId(req.params.workOrderId);
  const [existing] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const m = await getMembership(existing.propertyId, userId);
  if (!m || !canManage(m)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (existing.status !== "requested" || existing.approvalStatus !== "pending") {
    res.status(400).json({ error: "Work order is not awaiting approval" });
    return;
  }
  const updates: Record<string, unknown> = {
    approvalStatus: decision,
    approvedByClerkId: userId,
    approvedAt: new Date(),
    status: decision === "approved" ? (existing.assigneeClerkId ? "assigned" : "open") : "cancelled",
  };
  const [updated] = await db.update(workOrdersTable).set(updates).where(eq(workOrdersTable.id, id)).returning();

  // Notify the requestor of the decision.
  if (existing.requestedByClerkId && existing.requestedByClerkId !== userId) {
    const decisionType =
      decision === "approved" ? "work_order_approved" : "work_order_rejected";
    if (await shouldNotify(existing.requestedByClerkId, decisionType)) {
      const title = decision === "approved" ? "Work order approved" : "Work order rejected";
      const body = `${updated.title} was ${decision}.`;
      await insertNotifications({
        userClerkId: existing.requestedByClerkId,
        type: decisionType,
        title,
        body,
        relatedId: String(updated.id),
      });
      void sendPushToUser(existing.requestedByClerkId, {
        title,
        body,
        data: {
          type: decisionType,
          workOrderId: updated.id,
          propertyId: existing.propertyId,
        },
      });
    }
  }
  const [enriched] = await attachAssetToOrder(
    await attachPropertyToOrder(await attachUsersToOrder([updated], activeOutwardAccountId ?? null)),
  );
  res.json(enriched);
}

router.post("/work-orders/:workOrderId/approve", requireAuth, async (req, res) =>
  approveOrReject(req as AuthRequest, res, "approved"),
);
router.post("/work-orders/:workOrderId/reject", requireAuth, async (req, res) =>
  approveOrReject(req as AuthRequest, res, "rejected"),
);

// ---------- Comments ----------
router.get("/work-orders/:workOrderId/comments", requireAuth, async (req, res): Promise<void> => {
  const { userId, activeOutwardAccountId } = req as AuthRequest;
  const id = parseId(req.params.workOrderId);
  const [order] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (!order) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const m = await getMembership(order.propertyId, userId);
  if (!m) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  // #503 — OSPs cannot read another contractor's work order thread.
  if (!ospCanAccessOrder(m, order, userId)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const rows = await db
    .select()
    .from(workOrderCommentsTable)
    .where(eq(workOrderCommentsTable.workOrderId, id))
    .orderBy(workOrderCommentsTable.createdAt);
  const authorIds = [...new Set(rows.map((r) => r.authorClerkId))];
  const authors = authorIds.length
    ? await db.select(publicUserColumns).from(usersTable).where(inArray(usersTable.clerkId, authorIds))
    : [];
  const authorMap = Object.fromEntries(authors.map((u) => [u.clerkId, u]));
  // #537 — attach the viewer's per-client tag to each comment author. The
  // author's target outward account is stamped on the row at write time
  // (and backfilled on legacy rows by
  // lib/db/scripts/backfillCommentAuthorOutwardAccount.ts), so we can
  // resolve the tag directly without a per-author fallback.
  const tagMap = await loadConnectionTagsForViewer(
    activeOutwardAccountId ?? null,
    rows.map((r) => r.authorOutwardAccountId),
  );
  const comments = rows.map((r) => {
    const author = authorMap[r.authorClerkId] ?? null;
    const tag = r.authorOutwardAccountId != null
      ? tagMap.get(r.authorOutwardAccountId) ?? null
      : null;
    return { ...r, author: author ? { ...author, connectionTag: tag } : null };
  });
  res.json({ comments });
});

router.post("/work-orders/:workOrderId/comments", requireAuth, async (req, res): Promise<void> => {
  const { userId, activeOutwardAccountId } = req as AuthRequest;
  const id = parseId(req.params.workOrderId);
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body) {
    res.status(400).json({ error: "body is required" });
    return;
  }
  const [order] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (!order) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const m = await getMembership(order.propertyId, userId);
  if (!m) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  // #503 — Read-only collaborators cannot post on a work order, and an
  // OSP can only post on their own assigned/created order.
  if (isReadOnlyCollaborator(m) || !ospCanAccessOrder(m, order, userId)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const normalizedAttachments =
    normalizeAttachments(req.body?.attachments, { addedByClerkId: userId }) ?? [];
  await assertCallerOwnsUploads(userId, normalizedAttachments.map((a) => a.path));
  // #546 — Stamp the author's current skin onto the comment so the
  // per-client tag (#537) resolves against the right outward account
  // even if the author later switches their default skin.
  const authorOutwardAccountId =
    activeOutwardAccountId ?? (await resolveDefaultOutwardAccountIdForUser(userId));
  const [comment] = await db
    .insert(workOrderCommentsTable)
    .values({
      workOrderId: id,
      authorClerkId: userId,
      authorOutwardAccountId,
      body,
      attachments: normalizedAttachments,
    })
    .returning();

  // Notify assignee + creator (excluding the commenter)
  const recipients = new Set<string>();
  if (order.assigneeClerkId && order.assigneeClerkId !== userId) recipients.add(order.assigneeClerkId);
  if (order.createdByClerkId && order.createdByClerkId !== userId) recipients.add(order.createdByClerkId);
  const targets = await filterRecipientsByPref([...recipients], "work_order_comment");
  if (targets.length > 0) {
    const [author] = await db
      .select(publicUserColumns)
      .from(usersTable)
      .where(eq(usersTable.clerkId, userId));
    const authorName = author?.name ?? "Someone";
    const preview = body.length > 120 ? `${body.slice(0, 117)}...` : body;
    await insertNotifications(
      targets.map((uid) => ({
        userClerkId: uid,
        type: "work_order_comment",
        title: `New comment on ${order.title}`,
        body: `${authorName}: ${preview}`,
        relatedId: String(order.id),
      })),
    );
    void sendPushToUsers(targets, {
      title: `New comment on ${order.title}`,
      body: `${authorName}: ${preview}`,
      data: { type: "work_order_comment", workOrderId: order.id, propertyId: order.propertyId },
    });
  }

  const [authorRow] = await db
    .select(publicUserColumns)
    .from(usersTable)
    .where(eq(usersTable.clerkId, userId));
  res.status(201).json({ ...comment, author: authorRow ?? null });
});

router.put(
  "/work-orders/:workOrderId/comments/:commentId",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const workOrderId = parseId(req.params.workOrderId);
    const commentId = parseId(req.params.commentId);
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body) {
      res.status(400).json({ error: "body is required" });
      return;
    }
    const [comment] = await db
      .select()
      .from(workOrderCommentsTable)
      .where(
        and(
          eq(workOrderCommentsTable.id, commentId),
          eq(workOrderCommentsTable.workOrderId, workOrderId),
        ),
      );
    if (!comment) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (comment.authorClerkId !== userId) {
      res.status(403).json({ error: "Only the author can edit this comment" });
      return;
    }
    const [order] = await db
      .select()
      .from(workOrdersTable)
      .where(eq(workOrdersTable.id, workOrderId));
    if (!order) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const m = await getMembership(order.propertyId, userId);
    if (!m) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    // #503 — Read-only collaborators may not edit comments; OSPs may
    // only edit comments on orders they're assigned to or created.
    if (isReadOnlyCollaborator(m)) {
      res.status(403).json({ error: "Collaborators cannot edit work-order comments." });
      return;
    }
    if (!ospCanAccessOrder(m, order, userId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const updates: Record<string, unknown> = { body };
    const removedPaths: string[] = [];
    if (req.body?.attachments !== undefined) {
      const na =
        normalizeAttachments(req.body.attachments, { addedByClerkId: userId }) ?? [];
      await assertCallerOwnsUploads(userId, na.map((a) => a.path));
      updates.attachments = na;
      const newPaths = new Set(na.map((a) => a.path));
      for (const a of comment.attachments ?? []) {
        const p = typeof a?.path === "string" ? a.path : "";
        if (!p) continue;
        const normalized = normalizeStoragePath(p) ?? p;
        if (!newPaths.has(normalized) && !newPaths.has(p)) removedPaths.push(p);
      }
    }
    const [updated] = await db
      .update(workOrderCommentsTable)
      .set(updates)
      .where(eq(workOrderCommentsTable.id, commentId))
      .returning();
    for (const p of removedPaths) {
      await objectStorage.deleteObjectEntity(p);
    }
    const [authorRow] = await db
      .select(publicUserColumns)
      .from(usersTable)
      .where(eq(usersTable.clerkId, userId));
    res.json({ ...updated, author: authorRow ?? null });
  },
);

router.delete(
  "/work-orders/:workOrderId/comments/:commentId",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const workOrderId = parseId(req.params.workOrderId);
    const commentId = parseId(req.params.commentId);
    const [comment] = await db
      .select()
      .from(workOrderCommentsTable)
      .where(
        and(
          eq(workOrderCommentsTable.id, commentId),
          eq(workOrderCommentsTable.workOrderId, workOrderId),
        ),
      );
    if (!comment) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [order] = await db
      .select()
      .from(workOrdersTable)
      .where(eq(workOrdersTable.id, workOrderId));
    if (!order) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const m = await getMembership(order.propertyId, userId);
    if (!m) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    // #503 — Collaborators are read-only; OSPs are scoped to their own
    // orders even for delete-on-author.
    if (isReadOnlyCollaborator(m)) {
      res.status(403).json({ error: "Collaborators cannot delete work-order comments." });
      return;
    }
    if (!ospCanAccessOrder(m, order, userId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const isAuthor = comment.authorClerkId === userId;
    if (!isAuthor && !canManage(m)) {
      res
        .status(403)
        .json({ error: "Only the author or a manager can delete this comment" });
      return;
    }
    await db
      .delete(workOrderCommentsTable)
      .where(eq(workOrderCommentsTable.id, commentId));
    for (const a of comment.attachments ?? []) {
      const p = typeof a?.path === "string" ? a.path : "";
      if (p) await objectStorage.deleteObjectEntity(p);
    }
    res.sendStatus(204);
  },
);

// ---------- Recurring Tasks ----------
router.get("/properties/:propertyId/recurring-tasks", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const propertyId = parseId(req.params.propertyId);
  const m = await getMembership(propertyId, userId);
  if (!m) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const rows = await db
    .select()
    .from(recurringTasksTable)
    .where(eq(recurringTasksTable.propertyId, propertyId))
    .orderBy(recurringTasksTable.nextDueAt);
  // attach assignee
  const ids = [...new Set(rows.map((r) => r.assigneeClerkId).filter(Boolean) as string[])];
  const users = ids.length
    ? await db.select(publicUserColumns).from(usersTable).where(inArray(usersTable.clerkId, ids))
    : [];
  const map = Object.fromEntries(users.map((u) => [u.clerkId, u]));
  const enriched = rows.map((r) => ({
    ...r,
    assignee: r.assigneeClerkId ? map[r.assigneeClerkId] ?? null : null,
  }));
  res.json({ recurringTasks: enriched });
});

router.post("/properties/:propertyId/recurring-tasks", requireAuth, async (req, res): Promise<void> => {
  const ar = req as AuthRequest;
  const { userId } = ar;
  const propertyId = parseId(req.params.propertyId);
  const m = await getMembership(propertyId, userId);
  if (!m || !canManage(m)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (!(await requirePaidCapability(ar, res, "create_property_records"))) return;
  const { title, description, priority, cadence, cadenceValue, assigneeClerkId, nextDueAt } = req.body;
  if (!title || typeof title !== "string") {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const [task] = await db
    .insert(recurringTasksTable)
    .values({
      propertyId,
      title: String(title),
      description: description ? String(description) : "",
      priority: priority ? String(priority) : "normal",
      cadence: cadence ? String(cadence) : "weekly",
      cadenceValue: cadenceValue ? Number(cadenceValue) : 1,
      assigneeClerkId: assigneeClerkId ? String(assigneeClerkId) : null,
      createdByClerkId: userId,
      nextDueAt: nextDueAt ? new Date(nextDueAt) : new Date(),
    })
    .returning();
  res.status(201).json(task);
});

router.put("/recurring-tasks/:taskId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const id = parseId(req.params.taskId);
  const [existing] = await db.select().from(recurringTasksTable).where(eq(recurringTasksTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const m = await getMembership(existing.propertyId, userId);
  if (!m || !canManage(m)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { title, description, priority, cadence, cadenceValue, assigneeClerkId, nextDueAt, isActive } = req.body;
  const updates: Record<string, unknown> = {};
  if (title != null) updates.title = String(title);
  if (description != null) updates.description = String(description);
  if (priority != null) updates.priority = String(priority);
  if (cadence != null) updates.cadence = String(cadence);
  if (cadenceValue != null) updates.cadenceValue = Number(cadenceValue);
  if (assigneeClerkId !== undefined) updates.assigneeClerkId = assigneeClerkId ? String(assigneeClerkId) : null;
  if (nextDueAt !== undefined) updates.nextDueAt = nextDueAt ? new Date(nextDueAt) : new Date();
  if (isActive != null) updates.isActive = !!isActive;
  const [updated] = await db.update(recurringTasksTable).set(updates).where(eq(recurringTasksTable.id, id)).returning();
  res.json(updated);
});

router.delete("/recurring-tasks/:taskId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const id = parseId(req.params.taskId);
  const [existing] = await db.select().from(recurringTasksTable).where(eq(recurringTasksTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const m = await getMembership(existing.propertyId, userId);
  if (!m || !canManage(m)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  await db.delete(recurringTasksTable).where(eq(recurringTasksTable.id, id));
  res.sendStatus(204);
});

// ---------- Background generator ----------
function advanceDueDate(from: Date, cadence: string, cadenceValue: number): Date {
  const next = new Date(from);
  const v = Math.max(1, cadenceValue || 1);
  switch (cadence) {
    case "daily":
      next.setDate(next.getDate() + v);
      break;
    case "weekly":
      next.setDate(next.getDate() + 7 * v);
      break;
    case "biweekly":
      next.setDate(next.getDate() + 14 * v);
      break;
    case "monthly":
      next.setMonth(next.getMonth() + v);
      break;
    case "custom":
      next.setDate(next.getDate() + v);
      break;
    default:
      next.setDate(next.getDate() + 7);
  }
  return next;
}

let isGenerating = false;
export async function generateRecurringWorkOrders(): Promise<{ created: number }> {
  if (isGenerating) return { created: 0 };
  isGenerating = true;
  let created = 0;
  try {
    const now = new Date();
    const due = await db
      .select()
      .from(recurringTasksTable)
      .where(and(eq(recurringTasksTable.isActive, true), lte(recurringTasksTable.nextDueAt, now)));

    for (const task of due) {
      const createdByOutwardAccountId =
        await resolveDefaultOutwardAccountIdForUser(task.createdByClerkId);
      const assigneeOutwardAccountId = task.assigneeClerkId
        ? await resolveDefaultOutwardAccountIdForUser(task.assigneeClerkId)
        : null;
      await db.insert(workOrdersTable).values({
        propertyId: task.propertyId,
        title: task.title,
        description: task.description,
        priority: task.priority,
        dueDate: task.nextDueAt,
        status: task.assigneeClerkId ? "assigned" : "open",
        assigneeClerkId: task.assigneeClerkId,
        assigneeOutwardAccountId,
        createdByClerkId: task.createdByClerkId,
        createdByOutwardAccountId,
        recurringTaskId: task.id,
      });
      if (
        task.assigneeClerkId &&
        (await shouldNotify(task.assigneeClerkId, "work_order_assigned"))
      ) {
        await insertNotifications({
          userClerkId: task.assigneeClerkId,
          type: "work_order_assigned",
          title: "Recurring work order created",
          body: `New recurring task: ${task.title}`,
          relatedId: String(task.id),
        });
        void sendPushToUser(task.assigneeClerkId, {
          title: "Recurring work order created",
          body: `New recurring task: ${task.title}`,
          data: { type: "work_order_assigned", recurringTaskId: task.id, propertyId: task.propertyId },
        });
      }
      const next = advanceDueDate(task.nextDueAt, task.cadence, task.cadenceValue);
      await db
        .update(recurringTasksTable)
        .set({ lastGeneratedAt: now, nextDueAt: next })
        .where(eq(recurringTasksTable.id, task.id));
      created += 1;
    }
  } finally {
    isGenerating = false;
  }
  return { created };
}

export default router;

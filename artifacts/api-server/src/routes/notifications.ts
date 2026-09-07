import { Router, type IRouter } from "express";
import { eq, and, desc, sql, inArray, or, lt, notInArray } from "drizzle-orm";
import {
  db,
  notificationsTable,
  usersTable,
  workLogsTable,
  workOrdersTable,
  propertyStandardsTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { sendPushToUser } from "../lib/push";

const router: IRouter = Router();

const LOG_TYPES = new Set([
  "assignment",
  "unassignment",
  "reassignment",
  "log",
  "rating",
  "due_date_changed",
  "due_date_request",
  "due_date_request_accepted",
  "due_date_request_declined",
]);

const WORK_ORDER_TYPES = new Set([
  "work_order_assigned",
  "work_order_requested",
  "work_order_complete",
  "work_order_verified",
  "work_order_approved",
  "work_order_rejected",
  "work_order_comment",
]);

const RESCHEDULE_TYPES = new Set([
  "due_date_request",
  "due_date_request_accepted",
  "due_date_request_declined",
]);

interface DeepLink {
  workOrderId?: number;
  propertyId?: number;
  logId?: number;
  standardId?: number;
  tab?: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function decodeCursor(raw: unknown): { createdAt: Date; id: number } | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const [tsPart, idPart] = decoded.split(":");
    const ts = Number(tsPart);
    const id = Number(idPart);
    if (!Number.isFinite(ts) || !Number.isFinite(id)) return null;
    return { createdAt: new Date(ts), id };
  } catch {
    return null;
  }
}

function encodeCursor(createdAt: Date, id: number): string {
  return Buffer.from(`${createdAt.getTime()}:${id}`, "utf8").toString("base64url");
}

// Notifications are owner-scoped: the personal inbox follows the
// person across all of their avatars, properties, and businesses.
// Rows are still stamped with `outwardAccountId` on insert so callers
// have context about which thread/entity raised the notification, but
// that column is no longer used to gate the feed. Switching avatars
// must never hide a notification — that contradicts the
// entity/property model where the inbox is anchored to the human, not
// the avatar.

// Task #663 — entity-only invite cutover. Notification types from the
// retired avatar-to-avatar handshake are filtered out at the query
// layer so any rows left behind by older clients (or the data
// migration window) are invisible in the inbox without us having to
// destructively delete history. Add new dead types here as we retire
// more legacy surfaces.
const LEGACY_HIDDEN_NOTIFICATION_TYPES = [
  "team_up_request",
  "team_up_accepted",
  "team_up_declined",
  "connection_request",
] as const;

router.get("/notifications", requireAuth, async (req, res): Promise<void> => {
  const ar = req as AuthRequest;
  const { userId } = ar;

  const userScope = and(
    eq(notificationsTable.userClerkId, userId),
    notInArray(
      notificationsTable.type,
      LEGACY_HIDDEN_NOTIFICATION_TYPES as unknown as string[],
    ),
  )!;

  const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const parsedLimit = typeof rawLimit === "string" ? parseInt(rawLimit, 10) : NaN;
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(MAX_LIMIT, Math.max(1, parsedLimit))
    : DEFAULT_LIMIT;

  const rawCursor = Array.isArray(req.query.cursor) ? req.query.cursor[0] : req.query.cursor;
  const cursor = decodeCursor(rawCursor);

  const cursorCondition = cursor
    ? or(
        lt(notificationsTable.createdAt, cursor.createdAt),
        and(
          eq(notificationsTable.createdAt, cursor.createdAt),
          lt(notificationsTable.id, cursor.id),
        ),
      )
    : undefined;

  const notifications = await db
    .select()
    .from(notificationsTable)
    .where(cursorCondition ? and(userScope, cursorCondition) : userScope)
    .orderBy(desc(notificationsTable.createdAt), desc(notificationsTable.id))
    .limit(limit);

  const nextCursor =
    notifications.length === limit
      ? encodeCursor(
          notifications[notifications.length - 1].createdAt,
          notifications[notifications.length - 1].id,
        )
      : null;

  const logIds = new Set<number>();
  const workOrderIds = new Set<number>();
  const standardIds = new Set<number>();
  for (const n of notifications) {
    if (!n.relatedId) continue;
    if (LOG_TYPES.has(n.type)) {
      const id = parseInt(n.relatedId, 10);
      if (Number.isFinite(id)) logIds.add(id);
    } else if (WORK_ORDER_TYPES.has(n.type)) {
      const id = parseInt(n.relatedId, 10);
      if (Number.isFinite(id)) workOrderIds.add(id);
    } else if (n.type === "standard_overdue" && n.relatedId.startsWith("standard:")) {
      const id = parseInt(n.relatedId.slice("standard:".length), 10);
      if (Number.isFinite(id)) standardIds.add(id);
    }
  }

  const logRows = logIds.size
    ? await db
        .select({ id: workLogsTable.id, propertyId: workLogsTable.propertyId })
        .from(workLogsTable)
        .where(inArray(workLogsTable.id, Array.from(logIds)))
    : [];
  const orderRows = workOrderIds.size
    ? await db
        .select({ id: workOrdersTable.id, propertyId: workOrdersTable.propertyId })
        .from(workOrdersTable)
        .where(inArray(workOrdersTable.id, Array.from(workOrderIds)))
    : [];
  const standardRows = standardIds.size
    ? await db
        .select({ id: propertyStandardsTable.id, propertyId: propertyStandardsTable.propertyId })
        .from(propertyStandardsTable)
        .where(inArray(propertyStandardsTable.id, Array.from(standardIds)))
    : [];
  const logToProperty = new Map(logRows.map((r) => [r.id, r.propertyId]));
  const orderToProperty = new Map(orderRows.map((r) => [r.id, r.propertyId]));
  const standardToProperty = new Map(standardRows.map((r) => [r.id, r.propertyId]));

  const enriched = notifications.map((n) => {
    const deepLink: DeepLink = {};
    const relatedNum = n.relatedId ? parseInt(n.relatedId, 10) : NaN;
    if (LOG_TYPES.has(n.type) && Number.isFinite(relatedNum)) {
      deepLink.logId = relatedNum;
      const pid = logToProperty.get(relatedNum);
      if (pid != null) deepLink.propertyId = pid;
      if (RESCHEDULE_TYPES.has(n.type)) deepLink.tab = "logs";
    } else if (WORK_ORDER_TYPES.has(n.type) && Number.isFinite(relatedNum)) {
      deepLink.workOrderId = relatedNum;
      const pid = orderToProperty.get(relatedNum);
      if (pid != null) deepLink.propertyId = pid;
    } else if (n.type === "standard_overdue" && n.relatedId?.startsWith("standard:")) {
      const sid = parseInt(n.relatedId.slice("standard:".length), 10);
      if (Number.isFinite(sid)) {
        deepLink.standardId = sid;
        const pid = standardToProperty.get(sid);
        if (pid != null) {
          deepLink.propertyId = pid;
          deepLink.tab = "standards";
        }
      }
    } else if (n.type === "invite" && Number.isFinite(relatedNum)) {
      deepLink.propertyId = relatedNum;
    }
    return {
      ...n,
      deepLink: Object.keys(deepLink).length ? deepLink : undefined,
    };
  });

  const [{ count: unreadCount }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notificationsTable)
    .where(and(userScope, eq(notificationsTable.isRead, false)));

  res.json({ notifications: enriched, unreadCount: Number(unreadCount), nextCursor });
});

router.post("/notifications/test", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;

  const [user] = await db
    .select({ expoPushToken: usersTable.expoPushToken })
    .from(usersTable)
    .where(eq(usersTable.clerkId, userId));

  if (!user || !user.expoPushToken) {
    res.status(400).json({ error: "no_push_token" });
    return;
  }

  await sendPushToUser(userId, {
    title: "Round House test",
    body: "Push notifications are working on this device.",
    data: { type: "test" },
  });

  res.json({ sent: true });
});

router.post("/notifications/read-all", requireAuth, async (req, res): Promise<void> => {
  const ar = req as AuthRequest;
  const { userId } = ar;

  // Owner-scoped — clears every unread notification addressed to this
  // person, regardless of which avatar surfaced it. Matches the GET
  // feed (which is also owner-scoped) so the unread badge zeros out.
  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(eq(notificationsTable.userClerkId, userId));

  res.sendStatus(204);
});

router.post("/notifications/:notificationId/read", requireAuth, async (req, res): Promise<void> => {
  const ar = req as AuthRequest;
  const { userId } = ar;
  const rawId = Array.isArray(req.params.notificationId) ? req.params.notificationId[0] : req.params.notificationId;
  const notificationId = parseInt(rawId, 10);

  // Owner-scoped — a notification can be marked read from any avatar,
  // since the personal inbox follows the person.
  const [notif] = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(
      and(
        eq(notificationsTable.id, notificationId),
        eq(notificationsTable.userClerkId, userId),
      ),
    )
    .returning();

  if (!notif) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;

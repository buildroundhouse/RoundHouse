import { Router, type IRouter } from "express";
import { eq, and, asc, desc, inArray, sql, or, isNull } from "drizzle-orm";
import {
  db,
  workLogsTable,
  propertiesTable,
  usersTable,
  notificationsTable,
  jobRatingsTable,
  type WorkLogAttachment,
} from "@workspace/db";
import {
  getMembershipForProperty,
  listMembersForProperty,
  listMembershipsForUser,
  listMembershipsForUsersOnProperty,
} from "../lib/propertyAccess";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { requirePaidCapability } from "../lib/capabilities";
import { insertNotifications } from "../lib/insertNotifications";
import type { ActiveModeRequest } from "../middlewares/withActiveMode";
import { publicUserColumns } from "../lib/userPublic";
import { sendPushToUser, sendPushToUsers } from "../lib/push";
import { filterRecipientsByPref, shouldNotify } from "../lib/notificationPrefs";
import { ObjectStorageService } from "../lib/objectStorage";
import { assertCallerOwnsUploads } from "../lib/objectAccess";
import { recordPoints } from "../lib/rewards";

const objectStorage = new ObjectStorageService();
function normalizeStoragePath(input: unknown): string | null {
  if (typeof input !== "string" || !input) return null;
  try {
    return objectStorage.normalizeObjectEntityPath(input);
  } catch {
    return input;
  }
}

type AttachmentInput = Partial<Record<keyof WorkLogAttachment, unknown>>;

function normalizeAttachments(
  input: unknown,
  ctx: { addedByClerkId: string },
): WorkLogAttachment[] {
  if (!Array.isArray(input)) return [];
  const nowIso = new Date().toISOString();
  const out: WorkLogAttachment[] = [];
  for (const raw of input as AttachmentInput[]) {
    if (!raw || typeof raw !== "object") continue;
    const path = typeof raw.path === "string" ? normalizeStoragePath(raw.path) : null;
    const kind = raw.kind === "image" || raw.kind === "file" ? raw.kind : null;
    if (!path || !kind) continue;
    out.push({
      path,
      kind,
      ...(typeof raw.name === "string" ? { name: raw.name } : {}),
      ...(typeof raw.contentType === "string" ? { contentType: raw.contentType } : {}),
      ...(typeof raw.size === "number" ? { size: raw.size } : {}),
      addedAt: nowIso,
      addedByClerkId: ctx.addedByClerkId,
    });
  }
  return out;
}

const router: IRouter = Router();

async function enrichLog(log: typeof workLogsTable.$inferSelect) {
  const [author] = await db.select(publicUserColumns).from(usersTable).where(eq(usersTable.clerkId, log.authorClerkId));
  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, log.propertyId));
  let assignee = null;
  if (log.assigneeClerkId) {
    const [a] = await db.select(publicUserColumns).from(usersTable).where(eq(usersTable.clerkId, log.assigneeClerkId));
    assignee = a || null;
  }
  return { ...log, author, property, assignee };
}

async function enrichLogs(logs: (typeof workLogsTable.$inferSelect)[]) {
  if (logs.length === 0) return [];
  const userIds = [...new Set(logs.flatMap((l) => [l.authorClerkId, l.assigneeClerkId].filter(Boolean) as string[]))];
  const propertyIds = [...new Set(logs.map((l) => l.propertyId))];
  const [users, properties] = await Promise.all([
    userIds.length > 0
      ? db.select(publicUserColumns).from(usersTable).where(inArray(usersTable.clerkId, userIds))
      : Promise.resolve([]),
    propertyIds.length > 0
      ? db.select().from(propertiesTable).where(inArray(propertiesTable.id, propertyIds))
      : Promise.resolve([]),
  ]);
  const uMap = Object.fromEntries(users.map((u) => [u.clerkId, u]));
  const pMap = Object.fromEntries(properties.map((p) => [p.id, p]));
  return logs.map((l) => ({
    ...l,
    author: uMap[l.authorClerkId],
    property: pMap[l.propertyId],
    assignee: l.assigneeClerkId ? uMap[l.assigneeClerkId] || null : null,
  }));
}

async function getLogOrFail(logId: number) {
  const [log] = await db.select().from(workLogsTable).where(eq(workLogsTable.id, logId));
  return log || null;
}

async function isPropertyMember(propertyId: number, userId: string) {
  return getMembershipForProperty(propertyId, userId);
}

// #503 — Per-role gates for the property work-log surface.
// Outside service providers do not see/touch the property-wide work
// log; they reach the property only through their own assigned work
// orders. Read-only collaborators may read but not mutate.
type LogMembershipLike = { role: string; classification: string | null } | null | undefined;
function isOspMembership(m: LogMembershipLike): boolean {
  return !!m && m.classification === "outside_service_provider";
}
function isCollaboratorMembership(m: LogMembershipLike): boolean {
  return !!m && m.classification === "collaborator";
}
function denyOspLog(res: import("express").Response, m: LogMembershipLike): boolean {
  if (isOspMembership(m)) {
    res.status(403).json({
      error: "Outside service providers can only access their own assigned work.",
    });
    return true;
  }
  return false;
}
function denyCollaboratorLogWrite(res: import("express").Response, m: LogMembershipLike): boolean {
  if (isCollaboratorMembership(m)) {
    res.status(403).json({ error: "Collaborators are read-only on this property." });
    return true;
  }
  return false;
}

router.get("/properties/:propertyId/logs", requireAuth, async (req, res): Promise<void> => {
  const { userId, activeModeId } = req as ActiveModeRequest;
  const rawId = Array.isArray(req.params.propertyId) ? req.params.propertyId[0] : req.params.propertyId;
  const propertyId = parseInt(rawId, 10);
  const limit = Math.min(parseInt(String(req.query.limit || "20"), 10), 100);
  const offset = parseInt(String(req.query.offset || "0"), 10);

  const membership = await isPropertyMember(propertyId, userId);
  if (!membership) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (denyOspLog(res, membership)) return;

  // Per-mode firewall: my own logs only show in the mode they were authored
  // in. Other members' logs always show (they belong to that user, not me).
  const modeFilter = activeModeId != null
    ? or(
        sql`${workLogsTable.authorClerkId} <> ${userId}`,
        isNull(workLogsTable.createdInModeId),
        eq(workLogsTable.createdInModeId, activeModeId),
      )
    : undefined;

  const whereExpr = modeFilter
    ? and(eq(workLogsTable.propertyId, propertyId), modeFilter)
    : eq(workLogsTable.propertyId, propertyId);

  const logs = await db
    .select()
    .from(workLogsTable)
    .where(whereExpr)
    .orderBy(desc(workLogsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(workLogsTable)
    .where(whereExpr);

  const enriched = await enrichLogs(logs);
  res.json({ logs: enriched, total: Number(count) });
});

router.post("/properties/:propertyId/logs", requireAuth, async (req, res): Promise<void> => {
  const ar = req as ActiveModeRequest;
  const { userId, activeModeId } = ar;
  const rawId = Array.isArray(req.params.propertyId) ? req.params.propertyId[0] : req.params.propertyId;
  const propertyId = parseInt(rawId, 10);

  const membership = await isPropertyMember(propertyId, userId);
  if (!membership) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (denyOspLog(res, membership)) return;
  if (denyCollaboratorLogWrite(res, membership)) return;
  if (!(await requirePaidCapability(ar, res, "create_property_records"))) return;

  const { note, photoUrl, attachments, isRealTime, score, assigneeClerkId, status, dueDate } = req.body;

  if (note == null) {
    res.status(400).json({ error: "Note is required" });
    return;
  }

  if (assigneeClerkId) {
    const assigneeMembership = await isPropertyMember(propertyId, assigneeClerkId);
    if (!assigneeMembership) {
      res.status(400).json({ error: "Assignee is not a member of this property" });
      return;
    }
  }

  const finalStatus = status || (assigneeClerkId ? "open" : "done");
  const completedAt = finalStatus === "done" ? new Date() : null;

  let parsedDueDate: Date | null = null;
  if (dueDate != null) {
    const d = new Date(dueDate);
    if (Number.isNaN(d.getTime())) {
      res.status(400).json({ error: "Invalid dueDate" });
      return;
    }
    parsedDueDate = d;
  }

  const photoPathForLog = photoUrl ? normalizeStoragePath(String(photoUrl)) : null;
  const attachmentsForLog = normalizeAttachments(attachments, { addedByClerkId: userId });
  await assertCallerOwnsUploads(userId, [photoPathForLog, ...attachmentsForLog.map((a) => a.path)]);

  // #310: public attribution is via `authorOutwardAccountId` (the skin).
  // `authorClerkId` stays the actual personal-profile clerk so points,
  // assignment lookups, and notifications keep working. When the
  // author is a team member acting as a company skin (not the owner),
  // we *also* stamp `actedByClerkId` so admin views can show which
  // team member did the work.
  const actingSeat = (req as AuthRequest).actingAsTeamSeat;
  const actedByClerkId = actingSeat ? userId : null;

  const [log] = await db
    .insert(workLogsTable)
    .values({
      propertyId,
      authorClerkId: userId,
      assigneeClerkId: assigneeClerkId || null,
      status: finalStatus,
      note,
      photoUrl: photoPathForLog,
      attachments: attachmentsForLog,
      isRealTime: isRealTime !== false,
      score: score ?? 10,
      dueDate: parsedDueDate,
      completedAt,
      createdInModeId: activeModeId ?? null,
      actedByClerkId,
    })
    .returning();

  // Reward the author for logging work; reward the assignee for delivering a
  // job when the log is created already in the "done" state. Idempotent on logId.
  await recordPoints({
    userClerkId: userId,
    eventType: "log_completed",
    sourceRef: `log:${log.id}`,
  });
  if (finalStatus === "done" && log.assigneeClerkId) {
    await recordPoints({
      userClerkId: log.assigneeClerkId,
      eventType: "job_delivered",
      sourceRef: `log:${log.id}`,
    });
  }

  const otherMembers = await listMembersForProperty(propertyId);

  const [author] = await db.select(publicUserColumns).from(usersTable).where(eq(usersTable.clerkId, userId));
  const authorName = author?.name || "Someone";

  const notifs: Array<typeof notificationsTable.$inferInsert> = [];

  const assigneeWantsAssignment =
    assigneeClerkId && assigneeClerkId !== userId
      ? await shouldNotify(assigneeClerkId, "assignment")
      : false;

  if (assigneeWantsAssignment) {
    notifs.push({
      userClerkId: assigneeClerkId!,
      type: "assignment",
      title: "New job assigned",
      body: `${authorName} assigned you a job: ${note.slice(0, 60)}`,
      relatedId: String(log.id),
    });
  }

  const logCandidates = otherMembers
    .map((m) => m.userClerkId)
    .filter((id) => id !== userId && id !== assigneeClerkId);
  const logRecipients = await filterRecipientsByPref(logCandidates, "log");
  for (const uid of logRecipients) {
    notifs.push({
      userClerkId: uid,
      type: "log",
      title: "New work logged",
      body: `${authorName} logged work on a property.`,
      relatedId: String(log.id),
    });
  }

  if (notifs.length > 0) {
    await insertNotifications(notifs);
  }

  if (assigneeWantsAssignment) {
    void sendPushToUser(assigneeClerkId!, {
      title: "New job assigned",
      body: `${authorName} assigned you a job: ${note.slice(0, 60)}`,
      data: { type: "assignment", logId: log.id, propertyId },
    });
  }

  const enriched = await enrichLog(log);
  res.status(201).json(enriched);
});

router.get("/logs/feed", requireAuth, async (req, res): Promise<void> => {
  const { userId, activeModeId } = req as ActiveModeRequest;
  const { activeOutwardAccountId } = req as AuthRequest;
  const limit = Math.min(parseInt(String(req.query.limit || "30"), 10), 100);
  const offset = parseInt(String(req.query.offset || "0"), 10);

  const memberships = await listMembershipsForUser(userId);

  // #503 — OSP memberships do not contribute to the cross-property log
  // feed; OSPs reach property work only through their own assigned WOs.
  const memberPropertyIds = memberships
    .filter((m) => !isOspMembership(m))
    .map((m) => m.propertyId);

  if (memberPropertyIds.length === 0) {
    res.json({ logs: [], total: 0 });
    return;
  }

  // Re-scope the feed to the active outward account ("skin"). Mirror the
  // owner-side rule from GET /properties: if the property is one YOU own,
  // only include it while you're acting as the same skin that created it.
  // Properties owned by other people stay visible regardless.
  const visibleProps = await db
    .select({ id: propertiesTable.id })
    .from(propertiesTable)
    .where(
      activeOutwardAccountId != null
        ? and(
            inArray(propertiesTable.id, memberPropertyIds),
            or(
              sql`${propertiesTable.ownerClerkId} <> ${userId}`,
              eq(propertiesTable.ownerOutwardAccountId, activeOutwardAccountId),
              // Legacy properties not yet stamped stay visible.
              isNull(propertiesTable.ownerOutwardAccountId),
            ),
          )
        : inArray(propertiesTable.id, memberPropertyIds),
    );
  const propertyIds = visibleProps.map((p) => p.id);

  if (propertyIds.length === 0) {
    res.json({ logs: [], total: 0 });
    return;
  }

  // Per-mode firewall: only show logs that were authored in the current mode
  // OR by another user (i.e. authorClerkId !== userId), OR legacy NULL.
  // This way, my OWN logs are partitioned per account, but logs from
  // collaborators on shared properties stay visible.
  const modeFilter = activeModeId != null
    ? or(
        sql`${workLogsTable.authorClerkId} <> ${userId}`,
        isNull(workLogsTable.createdInModeId),
        eq(workLogsTable.createdInModeId, activeModeId),
      )
    : undefined;

  const whereExpr = modeFilter
    ? and(inArray(workLogsTable.propertyId, propertyIds), modeFilter)
    : inArray(workLogsTable.propertyId, propertyIds);

  const logs = await db
    .select()
    .from(workLogsTable)
    .where(whereExpr)
    .orderBy(desc(workLogsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(workLogsTable)
    .where(whereExpr);

  const enriched = await enrichLogs(logs);
  res.json({ logs: enriched, total: Number(count) });
});

router.get("/logs/assigned-to-me", requireAuth, async (req, res): Promise<void> => {
  const { userId, activeModeId } = req as ActiveModeRequest;
  const limit = Math.min(parseInt(String(req.query.limit || "100"), 10), 200);
  const offset = parseInt(String(req.query.offset || "0"), 10);
  const statusFilter = req.query.status ? String(req.query.status) : null;

  // Per-mode firewall: if a log's author is me, only include if it was created
  // in the current mode (or legacy NULL). If the author is someone else (true
  // assignment from another user), always include.
  const modeFilter = activeModeId != null
    ? or(
        sql`${workLogsTable.authorClerkId} <> ${userId}`,
        isNull(workLogsTable.createdInModeId),
        eq(workLogsTable.createdInModeId, activeModeId),
      )
    : undefined;

  const baseAssignee = eq(workLogsTable.assigneeClerkId, userId);
  const whereClauses = and(
    baseAssignee,
    statusFilter ? eq(workLogsTable.status, statusFilter) : undefined,
    modeFilter,
  );

  const logs = await db
    .select()
    .from(workLogsTable)
    .where(whereClauses)
    .orderBy(
      sql`${workLogsTable.dueDate} IS NULL`,
      asc(workLogsTable.dueDate),
      desc(workLogsTable.createdAt),
    )
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(workLogsTable)
    .where(whereClauses);

  const enriched = await enrichLogs(logs);
  res.json({ logs: enriched, total: Number(count) });
});

router.put("/logs/:logId/assignee", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const rawId = Array.isArray(req.params.logId) ? req.params.logId[0] : req.params.logId;
  const logId = parseInt(rawId, 10);
  const { assigneeClerkId } = req.body;

  const log = await getLogOrFail(logId);
  if (!log) {
    res.status(404).json({ error: "Log not found" });
    return;
  }

  const membership = await isPropertyMember(log.propertyId, userId);
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (assigneeClerkId) {
    const assigneeMembership = await isPropertyMember(log.propertyId, assigneeClerkId);
    if (!assigneeMembership) {
      res.status(400).json({ error: "Assignee is not a member of this property" });
      return;
    }
  }

  const previousAssigneeClerkId = log.assigneeClerkId;
  const newAssigneeClerkId = assigneeClerkId || null;

  const [updated] = await db
    .update(workLogsTable)
    .set({ assigneeClerkId: newAssigneeClerkId })
    .where(eq(workLogsTable.id, logId))
    .returning();

  const assignmentChanged = previousAssigneeClerkId !== newAssigneeClerkId;

  if (assignmentChanged) {
    const [actor] = await db
      .select(publicUserColumns)
      .from(usersTable)
      .where(eq(usersTable.clerkId, userId));
    const actorName = actor?.name || "Someone";
    const noteSnippet = (log.note || "").slice(0, 60);

    const notifs: Array<typeof notificationsTable.$inferInsert> = [];

    if (
      newAssigneeClerkId &&
      newAssigneeClerkId !== userId &&
      (await shouldNotify(newAssigneeClerkId, "assignment"))
    ) {
      const body = noteSnippet
        ? `${actorName} assigned you a job: ${noteSnippet}`
        : `${actorName} assigned you a job.`;
      notifs.push({
        userClerkId: newAssigneeClerkId,
        type: "assignment",
        title: "New job assigned",
        body,
        relatedId: String(logId),
      });
      void sendPushToUser(newAssigneeClerkId, {
        title: "New job assigned",
        body,
        data: { type: "assignment", logId, propertyId: log.propertyId },
      });
    }

    if (
      previousAssigneeClerkId &&
      previousAssigneeClerkId !== userId &&
      previousAssigneeClerkId !== newAssigneeClerkId &&
      (await shouldNotify(previousAssigneeClerkId, "unassignment"))
    ) {
      const body = noteSnippet
        ? `${actorName} unassigned you from a job: ${noteSnippet}`
        : `${actorName} unassigned you from a job.`;
      notifs.push({
        userClerkId: previousAssigneeClerkId,
        type: "unassignment",
        title: "Job unassigned",
        body,
        relatedId: String(logId),
      });
      void sendPushToUser(previousAssigneeClerkId, {
        title: "Job unassigned",
        body,
        data: { type: "unassignment", logId, propertyId: log.propertyId },
      });
    }

    const ownersAll = await listMembersForProperty(log.propertyId);
    const owners = ownersAll.filter((m) => m.role === "owner");

    const excluded = new Set<string>([userId]);
    if (newAssigneeClerkId) excluded.add(newAssigneeClerkId);
    if (previousAssigneeClerkId) excluded.add(previousAssigneeClerkId);

    let ownerTitle: string;
    let ownerType: string;
    let ownerBody: string;
    if (newAssigneeClerkId && previousAssigneeClerkId) {
      ownerTitle = "Job reassigned";
      ownerType = "reassignment";
      ownerBody = noteSnippet
        ? `${actorName} reassigned a job: ${noteSnippet}`
        : `${actorName} reassigned a job.`;
    } else if (newAssigneeClerkId) {
      ownerTitle = "Job assigned";
      ownerType = "assignment";
      ownerBody = noteSnippet
        ? `${actorName} assigned a job: ${noteSnippet}`
        : `${actorName} assigned a job.`;
    } else {
      ownerTitle = "Job unassigned";
      ownerType = "unassignment";
      ownerBody = noteSnippet
        ? `${actorName} unassigned a job: ${noteSnippet}`
        : `${actorName} unassigned a job.`;
    }

    const ownerCandidates = owners
      .map((o) => o.userClerkId)
      .filter((id) => !excluded.has(id));
    const ownerRecipients = await filterRecipientsByPref(ownerCandidates, ownerType);
    for (const uid of ownerRecipients) {
      notifs.push({
        userClerkId: uid,
        type: ownerType,
        title: ownerTitle,
        body: ownerBody,
        relatedId: String(logId),
      });
    }

    if (notifs.length > 0) {
      await insertNotifications(notifs);
    }
  }

  const enriched = await enrichLog(updated);
  res.json(enriched);
});

router.put("/logs/:logId/due-date", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const rawId = Array.isArray(req.params.logId) ? req.params.logId[0] : req.params.logId;
  const logId = parseInt(rawId, 10);
  const { dueDate } = req.body;

  const log = await getLogOrFail(logId);
  if (!log) {
    res.status(404).json({ error: "Log not found" });
    return;
  }

  const membership = await isPropertyMember(log.propertyId, userId);
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  let parsedDueDate: Date | null = null;
  if (dueDate != null) {
    const d = new Date(dueDate);
    if (Number.isNaN(d.getTime())) {
      res.status(400).json({ error: "Invalid dueDate" });
      return;
    }
    parsedDueDate = d;
  }

  const previousDueDate = log.dueDate ? new Date(log.dueDate) : null;
  const previousMs = previousDueDate ? previousDueDate.getTime() : null;
  const newMs = parsedDueDate ? parsedDueDate.getTime() : null;
  const dueDateChanged = previousMs !== newMs;

  const [updated] = await db
    .update(workLogsTable)
    .set({ dueDate: parsedDueDate })
    .where(eq(workLogsTable.id, logId))
    .returning();

  if (dueDateChanged) {
    const [actor] = await db
      .select(publicUserColumns)
      .from(usersTable)
      .where(eq(usersTable.clerkId, userId));
    const actorName = actor?.name || "Someone";
    const noteSnippet = (log.note || "").slice(0, 60);
    const formatDate = (d: Date) =>
      d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const newLabel = parsedDueDate ? formatDate(parsedDueDate) : null;
    const oldLabel = previousDueDate ? formatDate(previousDueDate) : null;

    let assigneeTitle: string;
    let assigneeBody: string;
    let ownerTitle: string;
    let ownerBody: string;
    if (newLabel && oldLabel) {
      assigneeTitle = "Job due date moved";
      assigneeBody = noteSnippet
        ? `${actorName} moved your due date to ${newLabel} for: ${noteSnippet}`
        : `${actorName} moved your due date to ${newLabel}.`;
      ownerTitle = "Job due date moved";
      ownerBody = noteSnippet
        ? `${actorName} moved a job's due date to ${newLabel}: ${noteSnippet}`
        : `${actorName} moved a job's due date to ${newLabel}.`;
    } else if (newLabel) {
      assigneeTitle = "Job due date set";
      assigneeBody = noteSnippet
        ? `${actorName} set your due date to ${newLabel} for: ${noteSnippet}`
        : `${actorName} set your due date to ${newLabel}.`;
      ownerTitle = "Job due date set";
      ownerBody = noteSnippet
        ? `${actorName} set a job's due date to ${newLabel}: ${noteSnippet}`
        : `${actorName} set a job's due date to ${newLabel}.`;
    } else {
      assigneeTitle = "Job due date cleared";
      assigneeBody = noteSnippet
        ? `${actorName} cleared the due date for: ${noteSnippet}`
        : `${actorName} cleared your job's due date.`;
      ownerTitle = "Job due date cleared";
      ownerBody = noteSnippet
        ? `${actorName} cleared a job's due date: ${noteSnippet}`
        : `${actorName} cleared a job's due date.`;
    }

    const notifs: Array<typeof notificationsTable.$inferInsert> = [];
    const assigneeClerkId = log.assigneeClerkId;

    if (
      assigneeClerkId &&
      assigneeClerkId !== userId &&
      (await shouldNotify(assigneeClerkId, "due_date_changed"))
    ) {
      notifs.push({
        userClerkId: assigneeClerkId,
        type: "due_date_changed",
        title: assigneeTitle,
        body: assigneeBody,
        relatedId: String(log.propertyId),
      });
      void sendPushToUser(assigneeClerkId, {
        title: assigneeTitle,
        body: assigneeBody,
        data: {
          type: "due_date_changed",
          logId,
          propertyId: log.propertyId,
        },
      });
    }

    const ownersAllDue = await listMembersForProperty(log.propertyId);
    const owners = ownersAllDue.filter((m) => m.role === "owner");

    const ownerCandidates = owners
      .map((o) => o.userClerkId)
      .filter((id) => id !== userId && id !== assigneeClerkId);
    const ownerRecipients = await filterRecipientsByPref(ownerCandidates, "due_date_changed");
    for (const uid of ownerRecipients) {
      notifs.push({
        userClerkId: uid,
        type: "due_date_changed",
        title: ownerTitle,
        body: ownerBody,
        relatedId: String(log.propertyId),
      });
    }

    if (notifs.length > 0) {
      await insertNotifications(notifs);
    }

    if (ownerRecipients.length > 0) {
      void sendPushToUsers(ownerRecipients, {
        title: ownerTitle,
        body: ownerBody,
        data: {
          type: "due_date_changed",
          logId,
          propertyId: log.propertyId,
        },
      });
    }
  }

  const enriched = await enrichLog(updated);
  res.json(enriched);
});

router.post("/logs/:logId/due-date-request", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const rawId = Array.isArray(req.params.logId) ? req.params.logId[0] : req.params.logId;
  const logId = parseInt(rawId, 10);
  const { proposedDate, reason } = req.body;

  const log = await getLogOrFail(logId);
  if (!log) {
    res.status(404).json({ error: "Log not found" });
    return;
  }

  if (log.assigneeClerkId !== userId) {
    res.status(403).json({ error: "Only the assignee can request a reschedule" });
    return;
  }

  if (log.status === "done") {
    res.status(400).json({ error: "Cannot reschedule a completed job" });
    return;
  }

  if (proposedDate == null) {
    res.status(400).json({ error: "proposedDate is required" });
    return;
  }
  const proposed = new Date(proposedDate);
  if (Number.isNaN(proposed.getTime())) {
    res.status(400).json({ error: "Invalid proposedDate" });
    return;
  }

  let trimmedReason: string | null = null;
  if (reason != null) {
    if (typeof reason !== "string") {
      res.status(400).json({ error: "reason must be a string" });
      return;
    }
    const t = reason.trim();
    if (t.length > 280) {
      res.status(400).json({ error: "reason must be 280 characters or fewer" });
      return;
    }
    trimmedReason = t.length > 0 ? t : null;
  }

  const [updated] = await db
    .update(workLogsTable)
    .set({
      dueDateRequestedDate: proposed,
      dueDateRequestedByClerkId: userId,
      dueDateRequestedAt: new Date(),
      dueDateRequestedReason: trimmedReason,
      dueDateResponseNote: null,
    })
    .where(eq(workLogsTable.id, logId))
    .returning();

  // Notify owners/admins (and the author if not owner/admin/the assignee)
  const members = await listMembersForProperty(log.propertyId);

  const recipientIds = new Set<string>();
  for (const m of members) {
    if (m.userClerkId === userId) continue;
    if (["owner", "admin"].includes(m.role)) recipientIds.add(m.userClerkId);
  }
  if (log.authorClerkId && log.authorClerkId !== userId) {
    recipientIds.add(log.authorClerkId);
  }

  if (recipientIds.size > 0) {
    const [actor] = await db
      .select(publicUserColumns)
      .from(usersTable)
      .where(eq(usersTable.clerkId, userId));
    const actorName = actor?.name || "Someone";
    const noteSnippet = (log.note || "").slice(0, 60);
    const reasonSnippet = trimmedReason ? trimmedReason.slice(0, 80) : "";
    const dateLabel = proposed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const title = "Reschedule requested";
    const body = reasonSnippet
      ? `${actorName} proposed ${dateLabel} — ${reasonSnippet}`
      : noteSnippet
        ? `${actorName} proposed ${dateLabel} for: ${noteSnippet}`
        : `${actorName} proposed a new due date (${dateLabel}).`;
    const ids = await filterRecipientsByPref([...recipientIds], "due_date_request");
    if (ids.length > 0) {
      await insertNotifications(
        ids.map((rid) => ({
          userClerkId: rid,
          type: "due_date_request",
          title,
          body,
          relatedId: String(logId),
        })),
      );
      for (const rid of ids) {
        void sendPushToUser(rid, {
          title,
          body,
          data: { type: "due_date_request", logId, propertyId: log.propertyId },
        });
      }
    }
  }

  const enriched = await enrichLog(updated);
  res.json(enriched);
});

router.delete("/logs/:logId/due-date-request", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const rawId = Array.isArray(req.params.logId) ? req.params.logId[0] : req.params.logId;
  const logId = parseInt(rawId, 10);

  const log = await getLogOrFail(logId);
  if (!log) {
    res.status(404).json({ error: "Log not found" });
    return;
  }

  if (log.dueDateRequestedByClerkId !== userId) {
    res.status(403).json({ error: "Only the requester can cancel the request" });
    return;
  }

  const [updated] = await db
    .update(workLogsTable)
    .set({
      dueDateRequestedDate: null,
      dueDateRequestedByClerkId: null,
      dueDateRequestedAt: null,
      dueDateRequestedReason: null,
    })
    .where(eq(workLogsTable.id, logId))
    .returning();

  const enriched = await enrichLog(updated);
  res.json(enriched);
});

router.post("/logs/:logId/due-date-request/respond", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const rawId = Array.isArray(req.params.logId) ? req.params.logId[0] : req.params.logId;
  const logId = parseInt(rawId, 10);
  const { decision, note } = req.body;

  if (decision !== "accept" && decision !== "decline") {
    res.status(400).json({ error: "decision must be 'accept' or 'decline'" });
    return;
  }

  let trimmedNote: string | null = null;
  if (note != null) {
    if (typeof note !== "string") {
      res.status(400).json({ error: "note must be a string" });
      return;
    }
    const t = note.trim();
    if (t.length > 280) {
      res.status(400).json({ error: "note must be 280 characters or fewer" });
      return;
    }
    trimmedNote = t.length > 0 ? t : null;
  }

  const log = await getLogOrFail(logId);
  if (!log) {
    res.status(404).json({ error: "Log not found" });
    return;
  }

  const membership = await isPropertyMember(log.propertyId, userId);
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (!log.dueDateRequestedDate || !log.dueDateRequestedByClerkId) {
    res.status(400).json({ error: "No pending reschedule request" });
    return;
  }

  const proposed = log.dueDateRequestedDate;
  const requesterId = log.dueDateRequestedByClerkId;

  const updates: Record<string, unknown> = {
    dueDateRequestedDate: null,
    dueDateRequestedByClerkId: null,
    dueDateRequestedAt: null,
    dueDateRequestedReason: null,
    dueDateResponseNote: trimmedNote,
  };
  if (decision === "accept") {
    updates.dueDate = proposed;
  }

  const [updated] = await db
    .update(workLogsTable)
    .set(updates)
    .where(eq(workLogsTable.id, logId))
    .returning();

  if (requesterId && requesterId !== userId) {
    const [actor] = await db
      .select(publicUserColumns)
      .from(usersTable)
      .where(eq(usersTable.clerkId, userId));
    const actorName = actor?.name || "Someone";
    const noteSnippet = (log.note || "").slice(0, 60);
    const dateLabel = new Date(proposed).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    const accepted = decision === "accept";
    const title = accepted ? "Reschedule accepted" : "Reschedule declined";
    const responseSnippet = trimmedNote ? trimmedNote.slice(0, 80) : "";
    const baseBody = accepted
      ? noteSnippet
        ? `${actorName} accepted your new due date (${dateLabel}) for: ${noteSnippet}`
        : `${actorName} accepted your new due date (${dateLabel}).`
      : noteSnippet
        ? `${actorName} declined your reschedule request for: ${noteSnippet}`
        : `${actorName} declined your reschedule request.`;
    const body = responseSnippet ? `${baseBody} — “${responseSnippet}”` : baseBody;
    const type = accepted ? "due_date_request_accepted" : "due_date_request_declined";
    if (await shouldNotify(requesterId, type)) {
      await insertNotifications({
        userClerkId: requesterId,
        type,
        title,
        body,
        relatedId: String(logId),
      });
      void sendPushToUser(requesterId, {
        title,
        body,
        data: { type, logId, propertyId: log.propertyId },
      });
    }
  }

  const enriched = await enrichLog(updated);
  res.json(enriched);
});

router.put("/logs/:logId/status", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const rawId = Array.isArray(req.params.logId) ? req.params.logId[0] : req.params.logId;
  const logId = parseInt(rawId, 10);
  const { status } = req.body;

  if (!["open", "in_progress", "done"].includes(status)) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }

  const log = await getLogOrFail(logId);
  if (!log) {
    res.status(404).json({ error: "Log not found" });
    return;
  }

  const membership = await isPropertyMember(log.propertyId, userId);
  if (!membership) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (denyOspLog(res, membership)) return;
  if (denyCollaboratorLogWrite(res, membership)) return;

  const isAuthorized =
    log.authorClerkId === userId ||
    log.assigneeClerkId === userId ||
    ["owner", "admin"].includes(membership.role);

  if (!isAuthorized) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const updates: Record<string, unknown> = { status };
  if (status === "done") updates.completedAt = new Date();

  const [updated] = await db
    .update(workLogsTable)
    .set(updates)
    .where(eq(workLogsTable.id, logId))
    .returning();

  // Reward the assignee for delivering a job (idempotent on logId).
  if (status === "done" && log.status !== "done" && log.assigneeClerkId) {
    await recordPoints({
      userClerkId: log.assigneeClerkId,
      eventType: "job_delivered",
      sourceRef: `log:${logId}`,
    });
  }

  if (
    log.status !== status &&
    (status === "in_progress" || status === "done") &&
    log.assigneeClerkId === userId
  ) {
    const ownersAllStatus = await listMembersForProperty(log.propertyId);
    const owners = ownersAllStatus.filter((m) => m.role === "owner");

    const recipientIds = new Set<string>();
    if (log.authorClerkId && log.authorClerkId !== userId) {
      recipientIds.add(log.authorClerkId);
    }
    for (const o of owners) {
      if (o.userClerkId !== userId) recipientIds.add(o.userClerkId);
    }

    if (recipientIds.size > 0) {
      const [actor] = await db
        .select(publicUserColumns)
        .from(usersTable)
        .where(eq(usersTable.clerkId, userId));
      const actorName = actor?.name || "Someone";
      const noteSnippet = (log.note || "").slice(0, 60);
      const title = status === "done" ? "Job completed" : "Job started";
      const verb = status === "done" ? "finished" : "started";
      const body = noteSnippet
        ? `${actorName} ${verb} a job: ${noteSnippet}`
        : `${actorName} ${verb} a job.`;
      const type = status === "done" ? "job_completed" : "job_started";

      const allIds = [...recipientIds];
      const recipients = await db
        .select({
          clerkId: usersTable.clerkId,
          notifyJobStarted: usersTable.notifyJobStarted,
          notifyJobCompleted: usersTable.notifyJobCompleted,
        })
        .from(usersTable)
        .where(inArray(usersTable.clerkId, allIds));
      const prefByClerk = new Map(recipients.map((r) => [r.clerkId, r]));
      const propertyPrefRows = await listMembershipsForUsersOnProperty(
        log.propertyId,
        allIds,
      );
      const propertyPrefByClerk = new Map(
        propertyPrefRows.map((r) => [
          r.userClerkId,
          {
            userClerkId: r.userClerkId,
            notifyJobStarted: r.notifyJobStarted,
            notifyJobCompleted: r.notifyJobCompleted,
          },
        ]),
      );
      const ids = allIds.filter((rid) => {
        const propPref = propertyPrefByClerk.get(rid);
        const propValue =
          status === "done" ? propPref?.notifyJobCompleted : propPref?.notifyJobStarted;
        if (propValue === false) return false;
        if (propValue === true) return true;
        const pref = prefByClerk.get(rid);
        if (!pref) return true;
        return status === "done" ? pref.notifyJobCompleted : pref.notifyJobStarted;
      });

      if (ids.length > 0) {
        await insertNotifications(
          ids.map((rid) => ({
            userClerkId: rid,
            type,
            title,
            body,
            relatedId: String(logId),
          })),
        );
        for (const rid of ids) {
          void sendPushToUser(rid, {
            title,
            body,
            data: { type, logId, propertyId: log.propertyId },
          });
        }
      }
    }
  }

  const enriched = await enrichLog(updated);
  res.json(enriched);
});

router.delete("/logs/:logId/attachments", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const rawId = Array.isArray(req.params.logId) ? req.params.logId[0] : req.params.logId;
  const logId = parseInt(rawId, 10);
  const rawPath = req.query.path;
  const path =
    typeof rawPath === "string" && rawPath.length > 0
      ? normalizeStoragePath(rawPath)
      : null;

  if (!path) {
    res.status(400).json({ error: "path query parameter is required" });
    return;
  }

  const log = await getLogOrFail(logId);
  if (!log) {
    res.status(404).json({ error: "Log not found" });
    return;
  }

  const membership = await isPropertyMember(log.propertyId, userId);
  if (!membership) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (denyOspLog(res, membership)) return;
  if (denyCollaboratorLogWrite(res, membership)) return;

  const isAuthorized =
    log.authorClerkId === userId || ["owner", "admin"].includes(membership.role);
  if (!isAuthorized) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const currentAttachments = log.attachments ?? [];
  const matchedAttachment = currentAttachments.some((a) => a?.path === path);
  const matchedPhotoUrl = log.photoUrl === path;

  if (!matchedAttachment && !matchedPhotoUrl) {
    res.status(404).json({ error: "Attachment not found on this log" });
    return;
  }

  const nextAttachments = matchedAttachment
    ? currentAttachments.filter((a) => a?.path !== path)
    : currentAttachments;
  const nextPhotoUrl = matchedPhotoUrl ? null : log.photoUrl;

  const [updated] = await db
    .update(workLogsTable)
    .set({ attachments: nextAttachments, photoUrl: nextPhotoUrl })
    .where(eq(workLogsTable.id, logId))
    .returning();

  await objectStorage.deleteObjectEntity(path);

  const enriched = await enrichLog(updated);
  res.json(enriched);
});

router.delete("/logs/:logId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const rawId = Array.isArray(req.params.logId) ? req.params.logId[0] : req.params.logId;
  const logId = parseInt(rawId, 10);

  const log = await getLogOrFail(logId);
  if (!log) {
    res.status(404).json({ error: "Log not found" });
    return;
  }

  const membership = await isPropertyMember(log.propertyId, userId);
  if (!membership) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (denyOspLog(res, membership)) return;
  if (denyCollaboratorLogWrite(res, membership)) return;

  const isAuthorized =
    log.authorClerkId === userId || ["owner", "admin"].includes(membership.role);
  if (!isAuthorized) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await db.delete(jobRatingsTable).where(eq(jobRatingsTable.workLogId, logId));
  await db.delete(workLogsTable).where(eq(workLogsTable.id, logId));

  const paths: string[] = [];
  if (log.photoUrl) paths.push(log.photoUrl);
  for (const a of log.attachments ?? []) {
    const p = typeof a?.path === "string" ? a.path : "";
    if (p) paths.push(p);
  }
  for (const p of paths) {
    await objectStorage.deleteObjectEntity(p);
  }

  res.sendStatus(204);
});

router.post("/logs/:logId/ratings", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const rawId = Array.isArray(req.params.logId) ? req.params.logId[0] : req.params.logId;
  const logId = parseInt(rawId, 10);
  const { stars, comment } = req.body;

  const numericStars = Number(stars);
  if (!Number.isInteger(numericStars) || numericStars < 1 || numericStars > 5) {
    res.status(400).json({ error: "Stars must be an integer 1-5" });
    return;
  }

  const log = await getLogOrFail(logId);
  if (!log) {
    res.status(404).json({ error: "Log not found" });
    return;
  }

  if (!log.assigneeClerkId) {
    res.status(400).json({ error: "Log has no assignee to rate" });
    return;
  }

  const membership = await isPropertyMember(log.propertyId, userId);
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    res.status(403).json({ error: "Only owners or admins can rate" });
    return;
  }

  const existing = await db
    .select()
    .from(jobRatingsTable)
    .where(and(eq(jobRatingsTable.workLogId, logId), eq(jobRatingsTable.ratedByClerkId, userId)));

  let rating;
  if (existing.length > 0) {
    [rating] = await db
      .update(jobRatingsTable)
      .set({ stars: numericStars, comment: comment || null })
      .where(eq(jobRatingsTable.id, existing[0].id))
      .returning();
  } else {
    [rating] = await db
      .insert(jobRatingsTable)
      .values({
        workLogId: logId,
        propertyId: log.propertyId,
        memberClerkId: log.assigneeClerkId,
        ratedByClerkId: userId,
        stars: numericStars,
        comment: comment || null,
      })
      .returning();

    if (
      log.assigneeClerkId !== userId &&
      (await shouldNotify(log.assigneeClerkId, "rating"))
    ) {
      const [rater] = await db.select(publicUserColumns).from(usersTable).where(eq(usersTable.clerkId, userId));
      const raterName = rater?.name || "An owner";
      await insertNotifications({
        userClerkId: log.assigneeClerkId,
        type: "rating",
        title: `${numericStars}-star rating received`,
        body: `${raterName} rated your job ${numericStars}/5.`,
        relatedId: String(logId),
      });
      void sendPushToUser(log.assigneeClerkId, {
        title: `${numericStars}-star rating received`,
        body: `${raterName} rated your job ${numericStars}/5.`,
        data: { type: "rating", logId, propertyId: log.propertyId, stars: numericStars },
      });
    }
    // Award rating points (base + bonus for high stars). Idempotent on (log, rater).
    await recordPoints({
      userClerkId: log.assigneeClerkId,
      eventType: "rating_received",
      sourceRef: `rating:${logId}:${userId}`,
      pointsOverride: numericStars >= 4 ? 25 : numericStars >= 3 ? 15 : 5,
    });
  }

  res.status(201).json(rating);
});

export default router;

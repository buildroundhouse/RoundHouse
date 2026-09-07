import { Router, type IRouter } from "express";
import { eq, and, desc, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  notificationsTable,
  propertiesTable,
  propertyStandardsTable,
  propertyStandardEvidenceTable,
  propertySpecsTable,
  propertyNotesTable,
  workLogsTable,
  jobRatingsTable,
  usersTable,
  type PropertyStandard,
  type WorkLog,
} from "@workspace/db";
import {
  getMembershipForProperty,
  listMembersForProperty,
  listMembershipsForUser,
} from "../lib/propertyAccess";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { requirePaidCapability } from "../lib/capabilities";
import { insertNotifications } from "../lib/insertNotifications";
import { publicUserColumns } from "../lib/userPublic";
import { sendPushToUsers } from "../lib/push";
import { filterRecipientsByPref } from "../lib/notificationPrefs";
import { logger } from "../lib/logger";
import { assertCallerOwnsUploads } from "../lib/objectAccess";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  clearExpiredMutesForProperties,
  clearExpiredMutesForProperty,
  clearExpiredStandardSnoozes,
} from "../lib/expireMutes";

const objectStorage = new ObjectStorageService();

const router: IRouter = Router();

function parseId(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(String(v), 10);
}

async function getMembership(propertyId: number, userId: string) {
  return getMembershipForProperty(propertyId, userId);
}

function canEdit(role?: string) {
  return role === "owner" || role === "admin";
}

function sanitizeQuickPhrases(input: unknown): string[] | "invalid" {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) return "invalid";
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") return "invalid";
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.length > 80) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(trimmed);
    if (cleaned.length >= 12) break;
  }
  return cleaned;
}

async function lastMetForStandard(s: PropertyStandard): Promise<Date | null> {
  const baseFilter = and(
    eq(workLogsTable.propertyId, s.propertyId),
    eq(workLogsTable.status, "done"),
  );
  let rows;
  if (s.keyword && s.keyword.trim().length > 0) {
    const pattern = `%${s.keyword.toLowerCase()}%`;
    rows = await db
      .select({ completedAt: workLogsTable.completedAt, createdAt: workLogsTable.createdAt })
      .from(workLogsTable)
      .where(and(baseFilter, sql`lower(${workLogsTable.note}) like ${pattern}`))
      .orderBy(desc(workLogsTable.createdAt))
      .limit(1);
  } else {
    rows = await db
      .select({ completedAt: workLogsTable.completedAt, createdAt: workLogsTable.createdAt })
      .from(workLogsTable)
      .where(baseFilter)
      .orderBy(desc(workLogsTable.createdAt))
      .limit(1);
  }
  const fromLog = rows.length === 0 ? null : ((rows[0].completedAt ?? rows[0].createdAt) as Date);

  const evidenceRows = await db
    .select({ metAt: propertyStandardEvidenceTable.metAt })
    .from(propertyStandardEvidenceTable)
    .where(eq(propertyStandardEvidenceTable.standardId, s.id))
    .orderBy(desc(propertyStandardEvidenceTable.metAt))
    .limit(1);
  const fromEvidence = evidenceRows.length === 0 ? null : (evidenceRows[0].metAt as Date);

  if (fromLog && fromEvidence) {
    return fromLog.getTime() >= fromEvidence.getTime() ? fromLog : fromEvidence;
  }
  return fromLog ?? fromEvidence;
}

function statusFromLastMet(s: PropertyStandard, lastMet: Date | null) {
  const cadenceMs = s.cadenceDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const lastMs = lastMet ? new Date(lastMet).getTime() : null;
  const overdue = lastMs == null ? true : now - lastMs > cadenceMs;
  const daysSince = lastMs == null ? null : Math.floor((now - lastMs) / (24 * 60 * 60 * 1000));
  return {
    standard: s,
    lastMetAt: lastMet ? new Date(lastMet).toISOString() : null,
    daysSinceLastMet: daysSince,
    overdue,
  };
}

// Overdue predicate aligned with the cadence-based due date for
// notification purposes. For never-met standards, this defers the
// first push until `createdAt + cadence` so owners aren't pinged
// the moment they create a standard.
function isOverdueByCadence(s: PropertyStandard, lastMet: Date | null): boolean {
  const cadenceMs = s.cadenceDays * 24 * 60 * 60 * 1000;
  const base = lastMet ? new Date(lastMet).getTime() : new Date(s.createdAt).getTime();
  return Date.now() >= base + cadenceMs;
}

// ---------- Standards CRUD ----------
router.get("/properties/:propertyId/standards", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const propertyId = parseId(req.params.propertyId);
  const m = await getMembership(propertyId, userId);
  if (!m) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  await clearExpiredStandardSnoozes([propertyId]);
  const standards = await db
    .select()
    .from(propertyStandardsTable)
    .where(eq(propertyStandardsTable.propertyId, propertyId))
    .orderBy(propertyStandardsTable.title);
  res.json({ standards });
});

router.post("/properties/:propertyId/standards", requireAuth, async (req, res): Promise<void> => {
  const ar = req as AuthRequest;
  const { userId } = ar;
  const propertyId = parseId(req.params.propertyId);
  const m = await getMembership(propertyId, userId);
  if (!m || !canEdit(m.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (!(await requirePaidCapability(ar, res, "create_property_records"))) return;
  const { title, description, cadenceDays, evidenceType, keyword, quickPhrases } = req.body;
  if (!title || typeof title !== "string") {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const cadence = Number(cadenceDays);
  if (!Number.isFinite(cadence) || cadence <= 0) {
    res.status(400).json({ error: "cadenceDays must be a positive number" });
    return;
  }
  const phrases = sanitizeQuickPhrases(quickPhrases);
  if (phrases === "invalid") {
    res.status(400).json({ error: "quickPhrases must be an array of strings" });
    return;
  }
  const [standard] = await db
    .insert(propertyStandardsTable)
    .values({
      propertyId,
      title: String(title),
      description: description ? String(description) : "",
      cadenceDays: Math.round(cadence),
      evidenceType: evidenceType ? String(evidenceType) : "log",
      keyword: keyword ? String(keyword) : null,
      quickPhrases: phrases,
      createdBy: userId,
    })
    .returning();
  res.status(201).json(standard);
});

router.put("/properties/:propertyId/standards/:standardId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const propertyId = parseId(req.params.propertyId);
  const standardId = parseId(req.params.standardId);
  const m = await getMembership(propertyId, userId);
  if (!m || !canEdit(m.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { title, description, cadenceDays, evidenceType, keyword, quickPhrases, snoozeUntil } = req.body;
  const updates: Record<string, unknown> = {};
  if (title != null) updates.title = String(title);
  if (description != null) updates.description = String(description);
  if (cadenceDays != null) {
    const c = Number(cadenceDays);
    if (Number.isFinite(c) && c > 0) updates.cadenceDays = Math.round(c);
  }
  if (evidenceType != null) updates.evidenceType = String(evidenceType);
  if (keyword !== undefined) updates.keyword = keyword ? String(keyword) : null;
  if (quickPhrases !== undefined) {
    const phrases = sanitizeQuickPhrases(quickPhrases);
    if (phrases === "invalid") {
      res.status(400).json({ error: "quickPhrases must be an array of strings" });
      return;
    }
    updates.quickPhrases = phrases;
  }
  if (snoozeUntil !== undefined) {
    if (snoozeUntil === null) {
      updates.snoozeUntil = null;
    } else if (typeof snoozeUntil === "string") {
      const parsed = new Date(snoozeUntil);
      if (Number.isNaN(parsed.getTime())) {
        res.status(400).json({ error: "snoozeUntil must be a valid ISO date" });
        return;
      }
      updates.snoozeUntil = parsed;
    } else {
      res.status(400).json({ error: "snoozeUntil must be a string or null" });
      return;
    }
  }
  const [standard] = await db
    .update(propertyStandardsTable)
    .set(updates)
    .where(and(eq(propertyStandardsTable.id, standardId), eq(propertyStandardsTable.propertyId, propertyId)))
    .returning();
  if (!standard) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(standard);
});

router.delete("/properties/:propertyId/standards/:standardId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const propertyId = parseId(req.params.propertyId);
  const standardId = parseId(req.params.standardId);
  const m = await getMembership(propertyId, userId);
  if (!m || !canEdit(m.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { removed, candidatePaths, referencedSet } = await db.transaction(async (tx) => {
    const evidenceRows = await tx
      .select({ photoPath: propertyStandardEvidenceTable.photoPath })
      .from(propertyStandardEvidenceTable)
      .where(eq(propertyStandardEvidenceTable.standardId, standardId));

    const [removedRow] = await tx
      .delete(propertyStandardsTable)
      .where(and(eq(propertyStandardsTable.id, standardId), eq(propertyStandardsTable.propertyId, propertyId)))
      .returning();
    if (!removedRow) {
      return { removed: null, candidatePaths: [] as string[], referencedSet: new Set<string>() };
    }

    await tx
      .delete(propertyStandardEvidenceTable)
      .where(eq(propertyStandardEvidenceTable.standardId, standardId));

    const paths = Array.from(
      new Set(
        evidenceRows
          .map((r) => r.photoPath)
          .filter((p): p is string => typeof p === "string" && p.length > 0),
      ),
    );

    let refSet = new Set<string>();
    if (paths.length) {
      const stillReferenced = await tx
        .select({ photoPath: propertyStandardEvidenceTable.photoPath })
        .from(propertyStandardEvidenceTable)
        .where(inArray(propertyStandardEvidenceTable.photoPath, paths));
      refSet = new Set(
        stillReferenced.map((r) => r.photoPath).filter((p): p is string => typeof p === "string"),
      );
    }

    return { removed: removedRow, candidatePaths: paths, referencedSet: refSet };
  });

  if (!removed) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  for (const p of candidatePaths) {
    if (referencedSet.has(p)) continue;
    try {
      await objectStorage.deleteObjectEntity(p);
    } catch (err) {
      logger.warn({ err, path: p, standardId }, "Failed to delete standard evidence object");
    }
  }

  res.sendStatus(204);
});

// ---------- Standard evidence ----------
router.get(
  "/properties/:propertyId/standards/:standardId/evidence",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const propertyId = parseId(req.params.propertyId);
    const standardId = parseId(req.params.standardId);
    const m = await getMembership(propertyId, userId);
    if (!m) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [standard] = await db
      .select()
      .from(propertyStandardsTable)
      .where(and(eq(propertyStandardsTable.id, standardId), eq(propertyStandardsTable.propertyId, propertyId)));
    if (!standard) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const events = await db
      .select()
      .from(propertyStandardEvidenceTable)
      .where(eq(propertyStandardEvidenceTable.standardId, standardId))
      .orderBy(desc(propertyStandardEvidenceTable.metAt));
    res.json({ events });
  },
);

router.post(
  "/properties/:propertyId/standards/:standardId/evidence",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const propertyId = parseId(req.params.propertyId);
    const standardId = parseId(req.params.standardId);
    const m = await getMembership(propertyId, userId);
    if (!m) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [standard] = await db
      .select()
      .from(propertyStandardsTable)
      .where(and(eq(propertyStandardsTable.id, standardId), eq(propertyStandardsTable.propertyId, propertyId)));
    if (!standard) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const { photoPath, note, metAt } = req.body ?? {};

    let photoPathValue: string | null = null;
    if (photoPath != null) {
      if (typeof photoPath !== "string") {
        res.status(400).json({ error: "photoPath must be a string" });
        return;
      }
      const trimmed = photoPath.trim();
      if (trimmed.length > 1024) {
        res.status(400).json({ error: "photoPath is too long" });
        return;
      }
      photoPathValue = trimmed.length ? trimmed : null;
    }

    let noteValue: string | null = null;
    if (note != null) {
      if (typeof note !== "string") {
        res.status(400).json({ error: "note must be a string" });
        return;
      }
      if (note.length > 2000) {
        res.status(400).json({ error: "note is too long" });
        return;
      }
      noteValue = note.length ? note : null;
    }

    let metDate: Date | undefined = undefined;
    if (metAt != null) {
      if (typeof metAt !== "string") {
        res.status(400).json({ error: "metAt must be an ISO date string" });
        return;
      }
      const parsed = new Date(metAt);
      if (Number.isNaN(parsed.getTime())) {
        res.status(400).json({ error: "metAt must be a valid date" });
        return;
      }
      // Disallow far-future timestamps (more than 1 day ahead).
      if (parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
        res.status(400).json({ error: "metAt cannot be in the future" });
        return;
      }
      metDate = parsed;
    }

    await assertCallerOwnsUploads(userId, [photoPathValue]);
    const [event] = await db
      .insert(propertyStandardEvidenceTable)
      .values({
        standardId,
        propertyId,
        createdBy: userId,
        photoPath: photoPathValue,
        note: noteValue,
        ...(metDate ? { metAt: metDate } : {}),
      })
      .returning();
    res.status(201).json(event);
  },
);

router.put(
  "/properties/:propertyId/standards/:standardId/evidence/:eventId",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const propertyId = parseId(req.params.propertyId);
    const standardId = parseId(req.params.standardId);
    const eventId = parseId(req.params.eventId);
    const m = await getMembership(propertyId, userId);
    if (!m) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const { note } = req.body ?? {};
    let noteValue: string | null = null;
    if (note !== undefined && note !== null) {
      if (typeof note !== "string") {
        res.status(400).json({ error: "note must be a string" });
        return;
      }
      if (note.length > 2000) {
        res.status(400).json({ error: "note is too long" });
        return;
      }
      noteValue = note.length ? note : null;
    }

    const [event] = await db
      .select()
      .from(propertyStandardEvidenceTable)
      .where(
        and(
          eq(propertyStandardEvidenceTable.id, eventId),
          eq(propertyStandardEvidenceTable.standardId, standardId),
          eq(propertyStandardEvidenceTable.propertyId, propertyId),
        ),
      );
    if (!event) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (event.createdBy !== userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const [updated] = await db
      .update(propertyStandardEvidenceTable)
      .set({ note: noteValue })
      .where(eq(propertyStandardEvidenceTable.id, eventId))
      .returning();
    res.json(updated);
  },
);

router.delete(
  "/properties/:propertyId/standards/:standardId/evidence/:eventId",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const propertyId = parseId(req.params.propertyId);
    const standardId = parseId(req.params.standardId);
    const eventId = parseId(req.params.eventId);
    const m = await getMembership(propertyId, userId);
    if (!m) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    type DeleteResult = {
      removed: boolean;
      forbidden: boolean;
      photoPath: string | null;
      stillReferenced: boolean;
    };
    const result: DeleteResult = await db.transaction(async (tx) => {
      const [event] = await tx
        .select()
        .from(propertyStandardEvidenceTable)
        .where(
          and(
            eq(propertyStandardEvidenceTable.id, eventId),
            eq(propertyStandardEvidenceTable.standardId, standardId),
            eq(propertyStandardEvidenceTable.propertyId, propertyId),
          ),
        );
      if (!event) {
        return { removed: false, forbidden: false, photoPath: null, stillReferenced: true };
      }
      const isCreator = event.createdBy === userId;
      if (!isCreator && !canEdit(m.role)) {
        return { removed: false, forbidden: true, photoPath: null, stillReferenced: true };
      }

      await tx
        .delete(propertyStandardEvidenceTable)
        .where(eq(propertyStandardEvidenceTable.id, eventId));

      const photo = event.photoPath;
      let referenced = true;
      if (photo) {
        const others = await tx
          .select({ id: propertyStandardEvidenceTable.id })
          .from(propertyStandardEvidenceTable)
          .where(eq(propertyStandardEvidenceTable.photoPath, photo))
          .limit(1);
        referenced = others.length > 0;
      }
      return { removed: true, forbidden: false, photoPath: photo, stillReferenced: referenced };
    });

    const { removed, forbidden, photoPath, stillReferenced } = result;
    if (!removed) {
      if (forbidden) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      res.status(404).json({ error: "Not found" });
      return;
    }

    if (photoPath && !stillReferenced) {
      try {
        await objectStorage.deleteObjectEntity(photoPath);
      } catch (err) {
        logger.warn({ err, path: photoPath, eventId }, "Failed to delete evidence object");
      }
    }

    res.sendStatus(204);
  },
);

router.delete(
  "/properties/:propertyId/standards/:standardId/evidence/:eventId/photo",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const propertyId = parseId(req.params.propertyId);
    const standardId = parseId(req.params.standardId);
    const eventId = parseId(req.params.eventId);
    const m = await getMembership(propertyId, userId);
    if (!m) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    type PhotoDeleteResult = {
      updated: typeof propertyStandardEvidenceTable.$inferSelect | null;
      forbidden: boolean;
      notFound: boolean;
      removedPath: string | null;
      stillReferenced: boolean;
    };
    const result: PhotoDeleteResult = await db.transaction(async (tx) => {
      const [event] = await tx
        .select()
        .from(propertyStandardEvidenceTable)
        .where(
          and(
            eq(propertyStandardEvidenceTable.id, eventId),
            eq(propertyStandardEvidenceTable.standardId, standardId),
            eq(propertyStandardEvidenceTable.propertyId, propertyId),
          ),
        );
      if (!event) {
        return {
          updated: null,
          forbidden: false,
          notFound: true,
          removedPath: null,
          stillReferenced: true,
        };
      }
      const isCreator = event.createdBy === userId;
      if (!isCreator && !canEdit(m.role)) {
        return {
          updated: null,
          forbidden: true,
          notFound: false,
          removedPath: null,
          stillReferenced: true,
        };
      }
      if (!event.photoPath) {
        return {
          updated: event,
          forbidden: false,
          notFound: false,
          removedPath: null,
          stillReferenced: true,
        };
      }
      const removedPath = event.photoPath;
      const [updated] = await tx
        .update(propertyStandardEvidenceTable)
        .set({ photoPath: null })
        .where(eq(propertyStandardEvidenceTable.id, eventId))
        .returning();
      const others = await tx
        .select({ id: propertyStandardEvidenceTable.id })
        .from(propertyStandardEvidenceTable)
        .where(eq(propertyStandardEvidenceTable.photoPath, removedPath))
        .limit(1);
      return {
        updated,
        forbidden: false,
        notFound: false,
        removedPath,
        stillReferenced: others.length > 0,
      };
    });

    if (result.notFound) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (result.forbidden) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (!result.updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    if (result.removedPath && !result.stillReferenced) {
      try {
        await objectStorage.deleteObjectEntity(result.removedPath);
      } catch (err) {
        logger.warn(
          { err, path: result.removedPath, eventId },
          "Failed to delete evidence photo object",
        );
      }
    }

    res.json(result.updated);
  },
);

// ---------- Drift status ----------
router.get("/properties/:propertyId/standards/status", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const propertyId = parseId(req.params.propertyId);
  const m = await getMembership(propertyId, userId);
  if (!m) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  await clearExpiredStandardSnoozes([propertyId]);
  const standards = await db
    .select()
    .from(propertyStandardsTable)
    .where(eq(propertyStandardsTable.propertyId, propertyId))
    .orderBy(propertyStandardsTable.title);

  const items = await Promise.all(
    standards.map(async (s) => statusFromLastMet(s, await lastMetForStandard(s))),
  );
  const overdueCount = items.filter((i) => i.overdue).length;
  res.json({ items, overdueCount, total: items.length });
});

// ---------- Owner overview (cross-property) ----------
router.get("/overview", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const memberships = await listMembershipsForUser(userId);
  const ownerProps = memberships.filter((m) => m.role === "owner" || m.role === "admin");
  const propertyIds = ownerProps.map((m) => m.propertyId);

  if (propertyIds.length === 0) {
    res.json({ properties: [] });
    return;
  }

  await clearExpiredMutesForProperties(propertyIds);

  const properties = await db
    .select()
    .from(propertiesTable)
    .where(inArray(propertiesTable.id, propertyIds));

  const allStandards = await db
    .select()
    .from(propertyStandardsTable)
    .where(inArray(propertyStandardsTable.propertyId, propertyIds));

  const openLogs = await db
    .select({ propertyId: workLogsTable.propertyId, count: sql<number>`count(*)` })
    .from(workLogsTable)
    .where(and(inArray(workLogsTable.propertyId, propertyIds), inArray(workLogsTable.status, ["open", "in_progress"])))
    .groupBy(workLogsTable.propertyId);
  const openMap: Record<number, number> = {};
  for (const r of openLogs) openMap[r.propertyId] = Number(r.count);

  const lastActivity = await db
    .select({ propertyId: workLogsTable.propertyId, last: sql<Date>`max(${workLogsTable.createdAt})` })
    .from(workLogsTable)
    .where(inArray(workLogsTable.propertyId, propertyIds))
    .groupBy(workLogsTable.propertyId);
  const lastMap: Record<number, string> = {};
  for (const r of lastActivity) lastMap[r.propertyId] = r.last ? new Date(r.last).toISOString() : "";

  const ratings = await db
    .select({
      propertyId: jobRatingsTable.propertyId,
      avg: sql<number>`avg(${jobRatingsTable.stars})`,
      count: sql<number>`count(*)`,
    })
    .from(jobRatingsTable)
    .where(inArray(jobRatingsTable.propertyId, propertyIds))
    .groupBy(jobRatingsTable.propertyId);
  const ratingMap: Record<number, { avg: number; count: number }> = {};
  for (const r of ratings) ratingMap[r.propertyId] = { avg: Number(r.avg), count: Number(r.count) };

  const now = Date.now();
  const result = await Promise.all(
    properties.map(async (p) => {
      const stdsForProp = allStandards.filter((s) => s.propertyId === p.id);
      const statuses = await Promise.all(
        stdsForProp.map(async (s) => statusFromLastMet(s, await lastMetForStandard(s))),
      );
      const propertyMuted =
        !!p.standardsMutedUntil && new Date(p.standardsMutedUntil).getTime() > now;
      const isStandardSnoozed = (s: PropertyStandard) =>
        !!s.snoozeUntil && new Date(s.snoozeUntil).getTime() > now;
      const overdueItems = statuses.filter((i) => i.overdue);
      const mutedOverdueStandards = propertyMuted
        ? overdueItems.length
        : overdueItems.filter((i) => isStandardSnoozed(i.standard)).length;
      const overdueStandards = overdueItems.length - mutedOverdueStandards;
      const snoozedList = stdsForProp.filter(isStandardSnoozed);
      const snoozedStandards = snoozedList.length;
      const earliestSnoozeMs = snoozedList.reduce<number | null>((min, s) => {
        const t = new Date(s.snoozeUntil as Date).getTime();
        return min == null || t < min ? t : min;
      }, null);
      return {
        property: p,
        openWorkOrders: openMap[p.id] || 0,
        overdueStandards,
        mutedOverdueStandards,
        totalStandards: statuses.length,
        snoozedStandards,
        earliestSnoozeUntil:
          earliestSnoozeMs != null ? new Date(earliestSnoozeMs).toISOString() : null,
        standardsAlertsMuted: propertyMuted,
        standardsMutedUntil: propertyMuted
          ? new Date(p.standardsMutedUntil as Date).toISOString()
          : null,
        lastActivityAt: lastMap[p.id] || null,
        avgRating: ratingMap[p.id]?.avg ?? null,
        ratingCount: ratingMap[p.id]?.count ?? 0,
      };
    }),
  );

  res.json({ properties: result });
});

// ---------- Check-in agenda ----------
router.get("/properties/:propertyId/checkin-agenda", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const propertyId = parseId(req.params.propertyId);
  const providerId = req.query.providerId ? String(req.query.providerId) : undefined;

  const m = await getMembership(propertyId, userId);
  if (!m || !canEdit(m.role)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId));
  if (!property) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const provider = providerId
    ? (await db.select(publicUserColumns).from(usersTable).where(eq(usersTable.clerkId, providerId)))[0] || null
    : null;

  // Open work orders
  const openFilter = providerId
    ? and(
        eq(workLogsTable.propertyId, propertyId),
        inArray(workLogsTable.status, ["open", "in_progress"]),
        eq(workLogsTable.assigneeClerkId, providerId),
      )
    : and(eq(workLogsTable.propertyId, propertyId), inArray(workLogsTable.status, ["open", "in_progress"]));
  const openLogsRaw = await db
    .select()
    .from(workLogsTable)
    .where(openFilter)
    .orderBy(desc(workLogsTable.createdAt));

  // Recent completed activity (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentFilter = providerId
    ? and(
        eq(workLogsTable.propertyId, propertyId),
        eq(workLogsTable.assigneeClerkId, providerId),
        sql`${workLogsTable.createdAt} > ${thirtyDaysAgo}`,
      )
    : and(eq(workLogsTable.propertyId, propertyId), sql`${workLogsTable.createdAt} > ${thirtyDaysAgo}`);
  const recentLogsRaw = await db
    .select()
    .from(workLogsTable)
    .where(recentFilter)
    .orderBy(desc(workLogsTable.createdAt))
    .limit(10);

  const allLogs = [...openLogsRaw, ...recentLogsRaw];
  const userIds = [...new Set(allLogs.flatMap((l) => [l.authorClerkId, l.assigneeClerkId].filter(Boolean) as string[]))];
  const users = userIds.length
    ? await db.select(publicUserColumns).from(usersTable).where(inArray(usersTable.clerkId, userIds))
    : [];
  const userMap = Object.fromEntries(users.map((u) => [u.clerkId, u]));
  const enrich = (l: WorkLog) => ({
    ...l,
    author: userMap[l.authorClerkId],
    property,
    assignee: l.assigneeClerkId ? userMap[l.assigneeClerkId] || null : null,
  });

  // Drift alerts
  const standards = await db
    .select()
    .from(propertyStandardsTable)
    .where(eq(propertyStandardsTable.propertyId, propertyId));
  const driftAlerts = (
    await Promise.all(standards.map(async (s) => statusFromLastMet(s, await lastMetForStandard(s))))
  ).filter((d) => d.overdue);

  // Pending ratings (done logs by this provider with no rating from current user)
  const pendingRatingsFilter = providerId
    ? and(
        eq(workLogsTable.propertyId, propertyId),
        eq(workLogsTable.assigneeClerkId, providerId),
        eq(workLogsTable.status, "done"),
      )
    : and(
        eq(workLogsTable.propertyId, propertyId),
        eq(workLogsTable.status, "done"),
        sql`${workLogsTable.assigneeClerkId} is not null`,
      );
  const doneLogs = await db
    .select()
    .from(workLogsTable)
    .where(pendingRatingsFilter)
    .orderBy(desc(workLogsTable.createdAt))
    .limit(20);
  const doneIds = doneLogs.map((l) => l.id);
  const existingRatings = doneIds.length
    ? await db
        .select()
        .from(jobRatingsTable)
        .where(and(inArray(jobRatingsTable.workLogId, doneIds), eq(jobRatingsTable.ratedByClerkId, userId)))
    : [];
  const ratedIds = new Set(existingRatings.map((r) => r.workLogId));
  const pendingRatings = doneLogs.filter((l) => !ratedIds.has(l.id)).slice(0, 5);

  res.json({
    property,
    provider,
    generatedAt: new Date().toISOString(),
    openWorkOrders: openLogsRaw.map(enrich),
    driftAlerts,
    recentActivity: recentLogsRaw.map(enrich),
    pendingRatings: pendingRatings.map(enrich),
  });
});

// ---------- Profile analytics ----------
router.get("/analytics/me", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;

  const memberships = await listMembershipsForUser(userId);
  let propertyIds = memberships.map((m) => m.propertyId);

  // Optional propertyId filter: must be one of the user's memberships
  const filterPropertyIdRaw = req.query.propertyId;
  if (filterPropertyIdRaw != null && filterPropertyIdRaw !== "") {
    const fid = parseId(filterPropertyIdRaw as string | string[]);
    if (Number.isFinite(fid) && propertyIds.includes(fid)) {
      propertyIds = [fid];
    } else {
      res.json({
        logsByPropertyByMonth: [],
        complianceRate: { compliant: 0, total: 0 },
        ratingTrend: [],
        totalsByProperty: [],
      });
      return;
    }
  }

  if (propertyIds.length === 0) {
    res.json({
      logsByPropertyByMonth: [],
      complianceRate: { compliant: 0, total: 0 },
      ratingTrend: [],
      totalsByProperty: [],
    });
    return;
  }

  // Optional date range. Defaults to the last 6 months (matching previous behavior).
  const defaultFrom = new Date();
  defaultFrom.setMonth(defaultFrom.getMonth() - 5);
  defaultFrom.setDate(1);
  defaultFrom.setHours(0, 0, 0, 0);

  function parseDate(raw: unknown): Date | null {
    if (raw == null || raw === "") return null;
    const s = Array.isArray(raw) ? raw[0] : raw;
    const d = new Date(String(s));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const fromDate = parseDate(req.query.from) ?? defaultFrom;
  const toDate = parseDate(req.query.to);

  const properties = await db
    .select()
    .from(propertiesTable)
    .where(inArray(propertiesTable.id, propertyIds));
  const propMap = Object.fromEntries(properties.map((p) => [p.id, p]));

  const logsRangeFilter = toDate
    ? and(
        inArray(workLogsTable.propertyId, propertyIds),
        sql`${workLogsTable.createdAt} >= ${fromDate}`,
        sql`${workLogsTable.createdAt} < ${toDate}`,
      )
    : and(inArray(workLogsTable.propertyId, propertyIds), sql`${workLogsTable.createdAt} >= ${fromDate}`);

  const monthRows = await db
    .select({
      propertyId: workLogsTable.propertyId,
      month: sql<string>`to_char(date_trunc('month', ${workLogsTable.createdAt}), 'YYYY-MM')`,
      count: sql<number>`count(*)`,
    })
    .from(workLogsTable)
    .where(logsRangeFilter)
    .groupBy(workLogsTable.propertyId, sql`date_trunc('month', ${workLogsTable.createdAt})`);

  const logsByPropertyByMonth = monthRows.map((r) => ({
    propertyId: r.propertyId,
    propertyName: propMap[r.propertyId]?.name ?? "",
    month: r.month,
    count: Number(r.count),
  }));

  const totalRows = await db
    .select({ propertyId: workLogsTable.propertyId, count: sql<number>`count(*)` })
    .from(workLogsTable)
    .where(logsRangeFilter)
    .groupBy(workLogsTable.propertyId);
  const totalsByProperty = totalRows.map((r) => ({
    propertyId: r.propertyId,
    propertyName: propMap[r.propertyId]?.name ?? "",
    count: Number(r.count),
  }));

  // Compliance: across all standards on properties owned by user, intersected with the property filter
  const ownerProps = memberships
    .filter((m) => m.role === "owner" || m.role === "admin")
    .map((m) => m.propertyId)
    .filter((id) => propertyIds.includes(id));
  const ownerStandards = ownerProps.length
    ? await db.select().from(propertyStandardsTable).where(inArray(propertyStandardsTable.propertyId, ownerProps))
    : [];
  let compliant = 0;
  for (const s of ownerStandards) {
    const last = await lastMetForStandard(s);
    if (!statusFromLastMet(s, last).overdue) compliant++;
  }
  const complianceRate = { compliant, total: ownerStandards.length };

  // Average provider rating trend (per month) from ratings I gave, scoped to filters
  const ratingsRangeFilter = toDate
    ? and(
        inArray(jobRatingsTable.propertyId, propertyIds),
        sql`${jobRatingsTable.createdAt} >= ${fromDate}`,
        sql`${jobRatingsTable.createdAt} < ${toDate}`,
      )
    : and(inArray(jobRatingsTable.propertyId, propertyIds), sql`${jobRatingsTable.createdAt} >= ${fromDate}`);
  const ratingTrendRows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${jobRatingsTable.createdAt}), 'YYYY-MM')`,
      avg: sql<number>`avg(${jobRatingsTable.stars})`,
      count: sql<number>`count(*)`,
    })
    .from(jobRatingsTable)
    .where(ratingsRangeFilter)
    .groupBy(sql`date_trunc('month', ${jobRatingsTable.createdAt})`)
    .orderBy(sql`date_trunc('month', ${jobRatingsTable.createdAt})`);
  const ratingTrend = ratingTrendRows.map((r) => ({
    month: r.month,
    avg: Number(r.avg),
    count: Number(r.count),
  }));

  res.json({ logsByPropertyByMonth, complianceRate, ratingTrend, totalsByProperty });
});

// ---------- Drift overdue notifications ----------
export async function notifyOverdueStandardsForProperty(propertyId: number): Promise<{ notified: number }> {
  await clearExpiredMutesForProperty(propertyId);
  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId));
  if (property?.standardsMutedUntil && new Date(property.standardsMutedUntil).getTime() > Date.now()) {
    return { notified: 0 };
  }

  const standards = await db
    .select()
    .from(propertyStandardsTable)
    .where(eq(propertyStandardsTable.propertyId, propertyId));
  if (standards.length === 0) return { notified: 0 };

  const allMembers = await listMembersForProperty(propertyId);
  const owners = allMembers.filter((m) => m.role === "owner" || m.role === "admin");
  if (owners.length === 0) return { notified: 0 };
  const ownerIds = owners.map((m) => m.userClerkId);

  const propName = property?.name ?? "your property";

  let notified = 0;
  for (const s of standards) {
    if (s.snoozeUntil && new Date(s.snoozeUntil).getTime() > Date.now()) continue;
    const lastMet = await lastMetForStandard(s);
    if (!isOverdueByCadence(s, lastMet)) continue;

    // The current overdue "cycle" started at the last met date (or at
    // standard creation if it has never been met). If we already sent
    // an overdue notification after that timestamp, this user has been
    // notified for this cycle and we must not notify again until the
    // standard is met (which advances `lastMet`) and lapses again.
    const cycleStart = lastMet ? new Date(lastMet) : new Date(s.createdAt);
    const relatedId = `standard:${s.id}`;

    const prior = await db
      .select({ userClerkId: notificationsTable.userClerkId })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.type, "standard_overdue"),
          eq(notificationsTable.relatedId, relatedId),
          inArray(notificationsTable.userClerkId, ownerIds),
          gte(notificationsTable.createdAt, cycleStart),
        ),
      );
    const alreadyNotified = new Set(prior.map((r) => r.userClerkId));
    const candidates = ownerIds.filter((id) => !alreadyNotified.has(id));
    const targets = await filterRecipientsByPref(candidates, "standard_overdue");
    if (targets.length === 0) continue;

    const title = "Standard overdue";
    const body = `"${s.title}" on ${propName} is past its ${s.cadenceDays}-day cadence.`;
    await insertNotifications(
      targets.map((uid) => ({
        userClerkId: uid,
        type: "standard_overdue",
        title,
        body,
        relatedId,
      })),
    );
    void sendPushToUsers(targets, {
      title,
      body,
      data: { type: "standard_overdue", propertyId, standardId: s.id, tab: "standards" },
    });
    notified += targets.length;
  }
  return { notified };
}

export async function notifyOverdueStandardsAll(): Promise<{ notified: number; properties: number }> {
  const props = await db.select({ id: propertiesTable.id }).from(propertiesTable);
  let notified = 0;
  for (const p of props) {
    try {
      const r = await notifyOverdueStandardsForProperty(p.id);
      notified += r.notified;
    } catch (err) {
      logger.error({ err, propertyId: p.id }, "Failed to check overdue standards");
    }
  }
  return { notified, properties: props.length };
}

// Suppress unused imports
void propertySpecsTable;
void propertyNotesTable;

export default router;

import { Router, type IRouter } from "express";
import { and, asc, eq, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { db, remindersTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { sendPushToUser } from "../lib/push";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function parseId(raw: unknown): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(String(v), 10);
}

function parseDueAt(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function serialize(r: typeof remindersTable.$inferSelect) {
  return {
    id: r.id,
    title: r.title,
    note: r.note,
    dueAt: r.dueAt.toISOString(),
    done: r.done,
    notifyCount: r.notifyCount,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

router.get("/reminders", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const rows = await db
    .select()
    .from(remindersTable)
    .where(eq(remindersTable.userClerkId, userId))
    .orderBy(asc(remindersTable.dueAt));
  res.json({ reminders: rows.map(serialize) });
});

router.post("/reminders", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const { title, note, dueAt } = req.body ?? {};
  const titleStr = typeof title === "string" ? title.trim() : "";
  if (!titleStr) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  const due = parseDueAt(dueAt);
  if (!due) {
    res.status(400).json({ error: "dueAt is required (ISO timestamp)" });
    return;
  }
  const [row] = await db
    .insert(remindersTable)
    .values({
      userClerkId: userId,
      title: titleStr,
      note: typeof note === "string" && note.trim() ? note.trim() : null,
      dueAt: due,
      done: false,
    })
    .returning();
  res.status(201).json(serialize(row));
});

router.patch("/reminders/:reminderId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const id = parseId(req.params.reminderId);
  if (!Number.isFinite(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const updates: Partial<typeof remindersTable.$inferInsert> = {};
  const { title, note, dueAt, done } = req.body ?? {};
  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim()) {
      res.status(400).json({ error: "title must be a non-empty string" });
      return;
    }
    updates.title = title.trim();
  }
  if (note !== undefined) {
    if (note === null) updates.note = null;
    else if (typeof note === "string") updates.note = note.trim() || null;
    else {
      res.status(400).json({ error: "note must be a string or null" });
      return;
    }
  }
  if (dueAt !== undefined) {
    const due = parseDueAt(dueAt);
    if (!due) {
      res.status(400).json({ error: "dueAt must be an ISO timestamp" });
      return;
    }
    updates.dueAt = due;
    // Pushing the due time forward (e.g. snooze) should re-arm the
    // notifier so the reminder pushes again at the new time.
    if (due.getTime() > Date.now()) {
      updates.notifiedAt = null;
      updates.notifyCount = 0;
    }
  }
  if (done !== undefined) {
    if (typeof done !== "boolean") {
      res.status(400).json({ error: "done must be a boolean" });
      return;
    }
    updates.done = done;
    // Re-opening a completed reminder should re-arm the notifier so it
    // pushes again next time it comes due.
    if (done === false) {
      updates.notifiedAt = null;
      updates.notifyCount = 0;
    }
  }
  const [row] = await db
    .update(remindersTable)
    .set(updates)
    .where(and(eq(remindersTable.id, id), eq(remindersTable.userClerkId, userId)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(serialize(row));
});

router.delete("/reminders/:reminderId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const id = parseId(req.params.reminderId);
  if (!Number.isFinite(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [row] = await db
    .delete(remindersTable)
    .where(and(eq(remindersTable.id, id), eq(remindersTable.userClerkId, userId)))
    .returning({ id: remindersTable.id });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.sendStatus(204);
});

function readPositiveNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn({ name, raw, fallback }, "Invalid env value, using fallback");
    return fallback;
  }
  return parsed;
}

/**
 * How long after the first push we wait before resending. If the user's
 * device was offline at the original due time the push is silently
 * dropped, so once this window elapses and the reminder is still not
 * `done`, we send a follow-up.
 */
export const REMINDER_RETRY_WINDOW_MS = readPositiveNumberEnv(
  "REMINDER_RETRY_WINDOW_MS",
  60 * 60 * 1000,
);

/**
 * Hard cap on the number of pushes we'll ever send for a single
 * reminder (initial + retries). Default is 2 — one initial push plus
 * one retry — so a user who never opens the app never gets spammed.
 */
export const REMINDER_MAX_NOTIFY_COUNT = Math.max(
  1,
  Math.floor(readPositiveNumberEnv("REMINDER_MAX_NOTIFY_COUNT", 2)),
);

/**
 * Scan for reminders whose `dueAt` has passed but haven't been pushed
 * yet, send a push to the owning user, and stamp `notifiedAt` /
 * `notifyCount` so subsequent runs skip them. Designed to be run on a
 * short cadence (e.g. every minute) by the API server's scheduler.
 *
 * Two passes run on each sweep:
 *
 *   1. INITIAL — claim due reminders that have never been pushed
 *      (`notified_at IS NULL`). Sets `notified_at = now`,
 *      `notify_count = 1` and pushes once.
 *   2. RETRY  — claim already-pushed reminders that are still
 *      `done = false` more than `REMINDER_RETRY_WINDOW_MS` after the
 *      previous push, and have been pushed fewer than
 *      `REMINDER_MAX_NOTIFY_COUNT` times. This closes the gap when the
 *      user's device was offline / had push disabled at the original
 *      due time so the first push was silently lost. Each retry bumps
 *      `notified_at = now` and `notify_count = notify_count + 1`, so
 *      the cap is enforced even across many sweeps.
 *
 * Both claims use a single UPDATE … RETURNING with the matching
 * predicate as a guard, so two concurrent sweeps can't both stamp the
 * same row — only the run whose UPDATE actually affected the row gets
 * it back in `RETURNING`, and only that run sends the push. This is
 * what keeps the "no duplicate pushes on subsequent runs" guarantee
 * under overlapping sweeps.
 *
 * Reminders that are in the future, already done, or already at the
 * retry cap are ignored. Users who acted on the first push (`done`
 * flipped to true) never get a retry. To re-notify a reminder, callers
 * must clear `notified_at` AND `notify_count` (the PATCH handler does
 * this automatically when `dueAt` is moved to the future or `done`
 * flips back to false).
 */
export async function notifyDueReminders(): Promise<{ notified: number; retried: number }> {
  const now = new Date();
  const retryCutoff = new Date(now.getTime() - REMINDER_RETRY_WINDOW_MS);

  let initial: { id: number; userClerkId: string; title: string; note: string | null }[] = [];
  try {
    initial = await db
      .update(remindersTable)
      .set({ notifiedAt: now, notifyCount: 1 })
      .where(
        and(
          eq(remindersTable.done, false),
          isNull(remindersTable.notifiedAt),
          lte(remindersTable.dueAt, now),
        ),
      )
      .returning({
        id: remindersTable.id,
        userClerkId: remindersTable.userClerkId,
        title: remindersTable.title,
        note: remindersTable.note,
      });
  } catch (err) {
    logger.error({ err }, "Failed to claim due reminders for push");
    return { notified: 0, retried: 0 };
  }

  let retries: { id: number; userClerkId: string; title: string; note: string | null }[] = [];
  try {
    retries = await db
      .update(remindersTable)
      .set({ notifiedAt: now, notifyCount: sql`${remindersTable.notifyCount} + 1` })
      .where(
        and(
          eq(remindersTable.done, false),
          isNotNull(remindersTable.notifiedAt),
          lt(remindersTable.notifiedAt, retryCutoff),
          lt(remindersTable.notifyCount, REMINDER_MAX_NOTIFY_COUNT),
        ),
      )
      .returning({
        id: remindersTable.id,
        userClerkId: remindersTable.userClerkId,
        title: remindersTable.title,
        note: remindersTable.note,
      });
  } catch (err) {
    logger.error({ err }, "Failed to claim reminders for retry push");
  }

  for (const r of [...initial, ...retries]) {
    void sendPushToUser(r.userClerkId, {
      title: r.title || "Reminder",
      body: r.note?.trim() || "Your reminder is due.",
      data: { type: "reminder", reminderId: String(r.id) },
      // Surfaces "Snooze 1h" / "Done" action buttons on the lock-screen
      // notification (task #435) — handled by the app's registered
      // "reminder" notification category.
      categoryId: "reminder",
    });
  }

  return { notified: initial.length, retried: retries.length };
}

export default router;

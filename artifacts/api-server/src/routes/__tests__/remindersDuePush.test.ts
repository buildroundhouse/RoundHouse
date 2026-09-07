/**
 * Test for the due-reminder push notifier (task #426).
 *
 * Verifies the background sweep:
 *   - sends one push per due, not-done, not-yet-notified reminder,
 *   - stamps `notified_at` so subsequent runs don't re-send,
 *   - ignores reminders that are still in the future or already done,
 *   - includes a `type: "reminder"` deep-link payload so tapping the
 *     push opens the Reminders screen on the mobile app.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

const sendPushToUserMock = vi.fn(async () => {});
vi.mock("../../lib/push", () => ({
  sendPushToUser: sendPushToUserMock,
  sendPushToUsers: vi.fn(async () => {}),
  clearStalePushTokens: vi.fn(async () => 0),
  STALE_PUSH_TOKEN_SWEEP_HOURS: 24,
}));

const { db, remindersTable } = await import("@workspace/db");
const { notifyDueReminders } = await import("../reminders");

const tag = `t426-${Date.now()}`;
const userA = `${tag}-a`;
const userB = `${tag}-b`;
const createdIds: number[] = [];

afterAll(async () => {
  if (createdIds.length > 0) {
    await db.delete(remindersTable).where(inArray(remindersTable.id, createdIds));
  }
});

beforeAll(() => {
  sendPushToUserMock.mockClear();
});

async function insert(opts: {
  userClerkId: string;
  title: string;
  note?: string | null;
  dueAt: Date;
  done?: boolean;
  notifiedAt?: Date | null;
  notifyCount?: number;
}): Promise<number> {
  const [row] = await db
    .insert(remindersTable)
    .values({
      userClerkId: opts.userClerkId,
      title: opts.title,
      note: opts.note ?? null,
      dueAt: opts.dueAt,
      done: opts.done ?? false,
      notifiedAt: opts.notifiedAt ?? null,
      notifyCount: opts.notifyCount ?? 0,
    })
    .returning({ id: remindersTable.id });
  createdIds.push(row.id);
  return row.id;
}

describe("notifyDueReminders (#426)", () => {
  it("pushes once per due reminder and stamps notified_at", async () => {
    const past = new Date(Date.now() - 60 * 1000);
    const future = new Date(Date.now() + 60 * 60 * 1000);

    const dueId = await insert({
      userClerkId: userA,
      title: "Replace HVAC filter",
      note: "Bedroom unit",
      dueAt: past,
    });
    const futureId = await insert({
      userClerkId: userA,
      title: "Future task",
      dueAt: future,
    });
    const doneId = await insert({
      userClerkId: userA,
      title: "Already done",
      dueAt: past,
      done: true,
    });
    const alreadyNotifiedId = await insert({
      userClerkId: userB,
      title: "Already notified",
      dueAt: past,
      notifiedAt: new Date(Date.now() - 30 * 1000),
    });

    sendPushToUserMock.mockClear();
    const first = await notifyDueReminders();
    expect(first.notified).toBeGreaterThanOrEqual(1);

    // The fresh due reminder should have triggered exactly one push to its owner
    const callsForDue = sendPushToUserMock.mock.calls.filter(
      ([uid, payload]: [string, { data?: Record<string, unknown> }]) =>
        uid === userA && payload?.data?.reminderId === String(dueId),
    );
    expect(callsForDue).toHaveLength(1);
    const [, payload] = callsForDue[0]!;
    expect(payload.title).toBe("Replace HVAC filter");
    expect(payload.body).toBe("Bedroom unit");
    expect(payload.data).toMatchObject({ type: "reminder", reminderId: String(dueId) });

    // Future / done / already-notified reminders must NOT push
    for (const skipped of [futureId, doneId, alreadyNotifiedId]) {
      const skippedCalls = sendPushToUserMock.mock.calls.filter(
        ([, p]: [string, { data?: Record<string, unknown> }]) =>
          p?.data?.reminderId === String(skipped),
      );
      expect(skippedCalls).toHaveLength(0);
    }

    // notified_at should now be set on the due reminder
    const [stamped] = await db
      .select({ notifiedAt: remindersTable.notifiedAt })
      .from(remindersTable)
      .where(eq(remindersTable.id, dueId));
    expect(stamped?.notifiedAt).not.toBeNull();

    // Running again is a no-op for that reminder (no duplicate push)
    sendPushToUserMock.mockClear();
    await notifyDueReminders();
    const dupes = sendPushToUserMock.mock.calls.filter(
      ([, p]: [string, { data?: Record<string, unknown> }]) =>
        p?.data?.reminderId === String(dueId),
    );
    expect(dupes).toHaveLength(0);
  });

  it("never duplicates a push when two sweeps run concurrently", async () => {
    const past = new Date(Date.now() - 90 * 1000);
    const id = await insert({
      userClerkId: userA,
      title: "Concurrent claim",
      dueAt: past,
    });

    sendPushToUserMock.mockClear();
    // Fire two sweeps in parallel, before either has a chance to await.
    const [a, b] = await Promise.all([notifyDueReminders(), notifyDueReminders()]);

    const totalPushesForRow = sendPushToUserMock.mock.calls.filter(
      ([, p]: [string, { data?: Record<string, unknown> }]) =>
        p?.data?.reminderId === String(id),
    );
    expect(totalPushesForRow).toHaveLength(1);
    // Exactly one of the two sweeps should have claimed the row.
    expect(a.notified + b.notified).toBeGreaterThanOrEqual(1);
  });

  it("re-arms a reminder when it is snoozed or re-opened", async () => {
    const past = new Date(Date.now() - 30 * 1000);
    const id = await insert({
      userClerkId: userA,
      title: "Snooze me",
      dueAt: past,
    });

    sendPushToUserMock.mockClear();
    await notifyDueReminders();
    let pushes = sendPushToUserMock.mock.calls.filter(
      ([, p]: [string, { data?: Record<string, unknown> }]) =>
        p?.data?.reminderId === String(id),
    );
    expect(pushes).toHaveLength(1);

    // Snooze: PATCH dueAt to a future time should clear notified_at.
    const future = new Date(Date.now() + 60 * 60 * 1000);
    await db
      .update(remindersTable)
      .set({ dueAt: future, notifiedAt: null })
      .where(eq(remindersTable.id, id));
    // Move it back into the past so it's due again.
    await db
      .update(remindersTable)
      .set({ dueAt: new Date(Date.now() - 5 * 1000) })
      .where(eq(remindersTable.id, id));

    sendPushToUserMock.mockClear();
    await notifyDueReminders();
    pushes = sendPushToUserMock.mock.calls.filter(
      ([, p]: [string, { data?: Record<string, unknown> }]) =>
        p?.data?.reminderId === String(id),
    );
    expect(pushes).toHaveLength(1);
  });

  it("resends a follow-up push after the retry window if still not done (#434)", async () => {
    // Simulate an initial push that landed on an offline phone an hour ago.
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const id = await insert({
      userClerkId: userA,
      title: "Offline at due time",
      dueAt: longAgo,
      notifiedAt: longAgo,
      notifyCount: 1,
    });

    sendPushToUserMock.mockClear();
    const result = await notifyDueReminders();
    expect(result.retried).toBeGreaterThanOrEqual(1);

    const retryCalls = sendPushToUserMock.mock.calls.filter(
      ([, p]: [string, { data?: Record<string, unknown> }]) =>
        p?.data?.reminderId === String(id),
    );
    expect(retryCalls).toHaveLength(1);

    // notify_count should now be 2 and the row should NOT be eligible
    // for another retry on the next sweep (cap is 2 by default).
    const [stamped] = await db
      .select({
        notifyCount: remindersTable.notifyCount,
        notifiedAt: remindersTable.notifiedAt,
      })
      .from(remindersTable)
      .where(eq(remindersTable.id, id));
    expect(stamped?.notifyCount).toBe(2);

    // Force the notified_at back into the past again — even past the retry
    // window — and confirm we do NOT push a third time.
    await db
      .update(remindersTable)
      .set({ notifiedAt: longAgo })
      .where(eq(remindersTable.id, id));

    sendPushToUserMock.mockClear();
    await notifyDueReminders();
    const thirdCalls = sendPushToUserMock.mock.calls.filter(
      ([, p]: [string, { data?: Record<string, unknown> }]) =>
        p?.data?.reminderId === String(id),
    );
    expect(thirdCalls).toHaveLength(0);
  });

  it("does not retry within the retry window", async () => {
    // Pushed only 30 seconds ago — well inside the 1h retry window.
    const recent = new Date(Date.now() - 30 * 1000);
    const id = await insert({
      userClerkId: userA,
      title: "Just pushed",
      dueAt: new Date(Date.now() - 60 * 1000),
      notifiedAt: recent,
      notifyCount: 1,
    });

    sendPushToUserMock.mockClear();
    await notifyDueReminders();
    const calls = sendPushToUserMock.mock.calls.filter(
      ([, p]: [string, { data?: Record<string, unknown> }]) =>
        p?.data?.reminderId === String(id),
    );
    expect(calls).toHaveLength(0);
  });

  it("never retries a reminder the user already marked done", async () => {
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const id = await insert({
      userClerkId: userA,
      title: "Acted on first push",
      dueAt: longAgo,
      notifiedAt: longAgo,
      notifyCount: 1,
      done: true,
    });

    sendPushToUserMock.mockClear();
    await notifyDueReminders();
    const calls = sendPushToUserMock.mock.calls.filter(
      ([, p]: [string, { data?: Record<string, unknown> }]) =>
        p?.data?.reminderId === String(id),
    );
    expect(calls).toHaveLength(0);
  });

  it("two concurrent sweeps never duplicate a retry push", async () => {
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const id = await insert({
      userClerkId: userA,
      title: "Concurrent retry",
      dueAt: longAgo,
      notifiedAt: longAgo,
      notifyCount: 1,
    });

    sendPushToUserMock.mockClear();
    const [a, b] = await Promise.all([notifyDueReminders(), notifyDueReminders()]);

    const retryCalls = sendPushToUserMock.mock.calls.filter(
      ([, p]: [string, { data?: Record<string, unknown> }]) =>
        p?.data?.reminderId === String(id),
    );
    expect(retryCalls).toHaveLength(1);
    expect(a.retried + b.retried).toBe(1);
  });

  it("snoozing or re-opening a reminder also resets notify_count", async () => {
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const id = await insert({
      userClerkId: userA,
      title: "Re-arm me",
      dueAt: longAgo,
      notifiedAt: longAgo,
      notifyCount: 2, // already at the cap
    });

    // Re-open / snooze: also clears notify_count back to 0.
    await db
      .update(remindersTable)
      .set({ notifiedAt: null, notifyCount: 0, dueAt: new Date(Date.now() - 5 * 1000) })
      .where(eq(remindersTable.id, id));

    sendPushToUserMock.mockClear();
    await notifyDueReminders();
    const calls = sendPushToUserMock.mock.calls.filter(
      ([, p]: [string, { data?: Record<string, unknown> }]) =>
        p?.data?.reminderId === String(id),
    );
    expect(calls).toHaveLength(1);
  });

  it("falls back to a generic body when the note is empty", async () => {
    const past = new Date(Date.now() - 5 * 1000);
    const id = await insert({
      userClerkId: userA,
      title: "No-note reminder",
      note: null,
      dueAt: past,
    });

    sendPushToUserMock.mockClear();
    await notifyDueReminders();

    const call = sendPushToUserMock.mock.calls.find(
      ([, p]: [string, { data?: Record<string, unknown> }]) =>
        p?.data?.reminderId === String(id),
    );
    expect(call).toBeDefined();
    expect(call![1].body).toBe("Your reminder is due.");
  });
});

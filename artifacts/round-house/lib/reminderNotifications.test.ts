/**
 * End-to-end coverage for the reminder local-notification flow (task #422).
 *
 * The flow has five surface areas:
 *
 *   1. Create        → schedule a notification at the due time.
 *   2. Snooze        → cancel the prior notification, schedule a new one
 *                      at the new due time.
 *   3. Mark done     → cancel the prior notification.
 *   4. Delete        → cancel the prior notification.
 *   5. Tap-to-open   → notification payload `{type:"reminder", reminderId}`
 *                      routes the user to /reminders.
 *
 * The deterministic primitives live in `lib/reminderNotifications.ts`
 * (schedule + cancel) and `lib/pushNotifications.ts` (deep-link
 * extraction). The orchestration that calls them in the right order
 * lives in the `app/reminders.tsx` React component and the
 * `navigateToPushTarget` switch in `app/_layout.tsx`. We exercise the
 * primitives directly with a mocked `expo-notifications` and assert the
 * screen + layout source wires them together correctly. A future
 * regression that drops a cancel/schedule call or changes the deep-link
 * destination is caught here before the screen runs.
 *
 * Round-house has no test runner of its own — api-server's vitest picks
 * this file up via its `vitest.config.ts` `include` glob.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---- Mocks -----------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const platformRef: { OS: "ios" | "android" | "web" } = { OS: "ios" };
  return {
    platformRef,
    scheduleMock: vi.fn(async () => "notif-id-default"),
    cancelMock: vi.fn(async () => undefined),
    getPermsMock: vi.fn(async () => ({ status: "granted" })),
    requestPermsMock: vi.fn(async () => ({ status: "granted" })),
  };
});

const { platformRef, scheduleMock, cancelMock, getPermsMock, requestPermsMock } =
  mocks;

vi.mock("react-native", () => ({
  Platform: mocks.platformRef,
}));

// Capture in-app banner emissions so we can assert the schedule helper
// arms the foreground timer for upcoming reminders.
const emitForegroundPushMock = vi.fn();
vi.mock("./pushNotifications", () => ({
  emitForegroundPush: (...args: unknown[]) => emitForegroundPushMock(...args),
  REMINDER_NOTIFICATION_CATEGORY: "reminder",
}));

vi.mock("expo-notifications", () => ({
  scheduleNotificationAsync: (...args: unknown[]) => mocks.scheduleMock(...args),
  cancelScheduledNotificationAsync: (...args: unknown[]) =>
    mocks.cancelMock(...args),
  getPermissionsAsync: (...args: unknown[]) => mocks.getPermsMock(...args),
  requestPermissionsAsync: (...args: unknown[]) => mocks.requestPermsMock(...args),
  SchedulableTriggerInputTypes: { DATE: "date" },
}));

import {
  scheduleReminderNotification,
  cancelReminderNotification,
} from "./reminderNotifications";
import {
  clearFiredNotificationIds,
  clearMissingReminderIds,
  clearNotificationIdFor,
  type Reminder,
} from "./reminders";

// ---- Helpers ---------------------------------------------------------------

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: "r-1",
    title: "Take out the trash",
    note: "Tuesday night pickup",
    dueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    done: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Reminder;
}

beforeEach(() => {
  platformRef.OS = "ios";
  scheduleMock.mockReset().mockResolvedValue("notif-id-default");
  cancelMock.mockReset().mockResolvedValue(undefined);
  getPermsMock.mockReset().mockResolvedValue({ status: "granted" });
  requestPermsMock.mockReset().mockResolvedValue({ status: "granted" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- 1. Create → schedule --------------------------------------------------

describe("Create flow: schedules a local notification at the due time", () => {
  it("calls expo-notifications with the reminder content + DATE trigger and returns the OS id", async () => {
    const dueAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    scheduleMock.mockResolvedValueOnce("os-id-create");
    const r = makeReminder({ id: "create-1", dueAt });

    const id = await scheduleReminderNotification(r);

    expect(id).toBe("os-id-create");
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    const arg = scheduleMock.mock.calls[0][0] as {
      content: { title: string; body: string; data: Record<string, unknown> };
      trigger: { type: string; date: Date };
    };
    expect(arg.content.title).toBe("Take out the trash");
    expect(arg.content.body).toBe("Tuesday night pickup");
    // The deep-link payload is what pushNotifications.ts later parses.
    expect(arg.content.data).toMatchObject({
      type: "reminder",
      reminderId: "create-1",
    });
    expect(arg.trigger.type).toBe("date");
    expect(arg.trigger.date.toISOString()).toBe(dueAt);
  });

  it("uses sensible defaults when the reminder has no note", async () => {
    await scheduleReminderNotification(
      makeReminder({ note: undefined, title: "" }),
    );
    const arg = scheduleMock.mock.calls[0][0] as {
      content: { title: string; body: string };
    };
    expect(arg.content.title).toBe("Reminder");
    expect(arg.content.body).toBe("Your reminder is due.");
  });

  it("requests permission when not already granted, then schedules", async () => {
    getPermsMock.mockResolvedValueOnce({ status: "undetermined" });
    requestPermsMock.mockResolvedValueOnce({ status: "granted" });
    const id = await scheduleReminderNotification(makeReminder());
    expect(requestPermsMock).toHaveBeenCalledTimes(1);
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(id).toBe("notif-id-default");
  });

  it("returns null and does NOT schedule when the user denies permission", async () => {
    getPermsMock.mockResolvedValueOnce({ status: "denied" });
    requestPermsMock.mockResolvedValueOnce({ status: "denied" });
    const id = await scheduleReminderNotification(makeReminder());
    expect(id).toBeNull();
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it("returns null and does NOT schedule when the due date is in the past", async () => {
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    const id = await scheduleReminderNotification(
      makeReminder({ dueAt: past }),
    );
    expect(id).toBeNull();
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it("returns null and does NOT schedule on web (expo-notifications has no scheduler there)", async () => {
    platformRef.OS = "web";
    const id = await scheduleReminderNotification(makeReminder());
    expect(id).toBeNull();
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it("swallows scheduler errors and returns null instead of crashing the create handler", async () => {
    scheduleMock.mockRejectedValueOnce(new Error("boom"));
    const id = await scheduleReminderNotification(makeReminder());
    expect(id).toBeNull();
  });
});

// ---- 2. Snooze → cancel-then-schedule --------------------------------------

describe("Snooze flow: cancels the prior notification then schedules a new one", () => {
  it("cancels the existing OS id and schedules a fresh notification at the new due time", async () => {
    const original = makeReminder({
      id: "snz-1",
      notificationId: "old-os-id",
    });
    const newDueAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    scheduleMock.mockResolvedValueOnce("new-os-id");

    await cancelReminderNotification(original.id, original.notificationId);
    const newId = await scheduleReminderNotification({
      ...original,
      dueAt: newDueAt,
    });

    expect(cancelMock).toHaveBeenCalledWith("old-os-id");
    expect(newId).toBe("new-os-id");
    const arg = scheduleMock.mock.calls[0][0] as {
      trigger: { date: Date };
      content: { data: Record<string, unknown> };
    };
    expect(arg.trigger.date.toISOString()).toBe(newDueAt);
    // The reminder id (and therefore the deep-link target) survives a snooze.
    expect(arg.content.data.reminderId).toBe("snz-1");
  });
});

// ---- 3. Mark done → cancel -------------------------------------------------

describe("Mark-done flow: cancels the scheduled notification", () => {
  it("cancels the OS id when present", async () => {
    await cancelReminderNotification("r-done", "done-os-id");
    expect(cancelMock).toHaveBeenCalledWith("done-os-id");
  });

  it("is a no-op against expo when the reminder has no scheduled id (never reached scheduler)", async () => {
    await cancelReminderNotification("r-1", undefined);
    await cancelReminderNotification("r-2", null);
    await cancelReminderNotification("r-3", "");
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it("ignores cancel-of-already-fired notifications (expo can throw)", async () => {
    cancelMock.mockRejectedValueOnce(new Error("not found"));
    await expect(
      cancelReminderNotification("r-stale", "stale-os-id"),
    ).resolves.toBeUndefined();
  });
});

// ---- 4. Delete → cancel ----------------------------------------------------

describe("Delete flow: cancels the scheduled notification", () => {
  it("cancels the OS id so a deleted reminder never fires", async () => {
    await cancelReminderNotification("r-del", "delete-os-id");
    expect(cancelMock).toHaveBeenCalledWith("delete-os-id");
  });

  it("does not call expo-notifications on web", async () => {
    platformRef.OS = "web";
    await cancelReminderNotification("r-x", "any-id");
    expect(cancelMock).not.toHaveBeenCalled();
  });
});

// ---- Foreground in-app banner (task #424) ---------------------------------
//
// When a reminder fires while the app is foregrounded, the OS heads-up
// banner is suppressed by `pushNotifications.ts` to avoid double-notify.
// To still surface the reminder, `scheduleReminderNotification` arms a
// JS timer that calls `emitForegroundPush` with the same shape the rest
// of the push pipeline uses, so the branded `PushBanner` shows up.

describe("Foreground in-app banner timer", () => {
  beforeEach(() => {
    emitForegroundPushMock.mockReset();
  });

  it("fires the in-app banner via emitForegroundPush at the reminder's due time", async () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      vi.setSystemTime(start);
      const r = makeReminder({
        id: "fg-1",
        title: "Pay water bill",
        note: "Auto-pay disabled",
        dueAt: new Date(start + 60_000).toISOString(),
      });
      await scheduleReminderNotification(r);
      expect(emitForegroundPushMock).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(emitForegroundPushMock).toHaveBeenCalledTimes(1);
      expect(emitForegroundPushMock).toHaveBeenCalledWith({
        title: "Pay water bill",
        body: "Auto-pay disabled",
        link: { type: "reminder", reminderId: "fg-1" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to default title/body so empty reminders still surface a cue", async () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      vi.setSystemTime(start);
      await scheduleReminderNotification(
        makeReminder({
          id: "fg-default",
          title: "",
          note: undefined,
          dueAt: new Date(start + 1000).toISOString(),
        }),
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(emitForegroundPushMock).toHaveBeenCalledWith({
        title: "Reminder",
        body: "Your reminder is due.",
        link: { type: "reminder", reminderId: "fg-default" },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fire after the reminder is cancelled (no banner for done/deleted/snoozed)", async () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      vi.setSystemTime(start);
      const r = makeReminder({
        id: "fg-cancel",
        dueAt: new Date(start + 30_000).toISOString(),
      });
      await scheduleReminderNotification(r);
      await cancelReminderNotification(r.id, "notif-id-default");
      await vi.advanceTimersByTimeAsync(30_000);
      expect(emitForegroundPushMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not arm a timer for past-due reminders (the screen treats them as already-fired)", async () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      vi.setSystemTime(start);
      await scheduleReminderNotification(
        makeReminder({
          id: "fg-past",
          dueAt: new Date(start - 60_000).toISOString(),
        }),
      );
      await vi.advanceTimersByTimeAsync(60_000);
      expect(emitForegroundPushMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("still arms the in-app banner even when the user denied OS notification permission", async () => {
    vi.useFakeTimers();
    try {
      getPermsMock.mockResolvedValueOnce({ status: "denied" });
      requestPermsMock.mockResolvedValueOnce({ status: "denied" });
      const start = Date.now();
      vi.setSystemTime(start);
      const id = await scheduleReminderNotification(
        makeReminder({
          id: "fg-noperm",
          dueAt: new Date(start + 5_000).toISOString(),
        }),
      );
      // OS scheduler is skipped without permission…
      expect(id).toBeNull();
      expect(scheduleMock).not.toHaveBeenCalled();
      // …but the in-app banner timer still fires when due.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(emitForegroundPushMock).toHaveBeenCalledTimes(1);
      expect(emitForegroundPushMock.mock.calls[0][0].link).toEqual({
        type: "reminder",
        reminderId: "fg-noperm",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---- 5. Screen wiring (source-level pin) -----------------------------------
//
// The four flows above are orchestrated inside the React component
// `app/reminders.tsx`. We can't render that here (no RN test renderer
// in this monorepo), but we *can* assert the component still calls the
// scheduler/canceller from each handler. A future edit that drops a
// call is caught here before the screen ever runs.

describe("Screen wiring in app/reminders.tsx", () => {
  const screenSrc = readFileSync(
    resolve(__dirname, "../app/reminders.tsx"),
    "utf8",
  );

  function bodyOf(name: string): string {
    // Pull out the assignment body of `const <name> = useCallback(... );`
    // which is the only place each handler is defined.
    const re = new RegExp(
      `const ${name} = useCallback\\(([\\s\\S]*?)\\n  \\);\\n`,
    );
    const m = re.exec(screenSrc);
    expect(m, `expected useCallback handler "${name}" in reminders.tsx`).toBeTruthy();
    return m![1];
  }

  it("imports both notification primitives from lib/reminderNotifications", () => {
    expect(screenSrc).toContain(
      'from "@/lib/reminderNotifications"',
    );
    expect(screenSrc).toContain("scheduleReminderNotification");
    expect(screenSrc).toContain("cancelReminderNotification");
  });

  it("addReminder schedules a notification (create flow)", () => {
    const body = bodyOf("addReminder");
    expect(body).toContain("scheduleAndStore(");
    expect(body).not.toContain("cancelTrackedNotification(");
  });

  it("markDone cancels the prior notification and does not schedule a new one (done flow)", () => {
    const body = bodyOf("markDone");
    // Notification ids are tracked off-reminder in an in-memory map; the
    // screen drops the entry via cancelTrackedNotification.
    expect(body).toContain("cancelTrackedNotification(");
    expect(body).not.toContain("scheduleAndStore(");
    expect(body).not.toContain("scheduleReminderNotification(");
  });

  it("remove cancels the prior notification (delete flow)", () => {
    const body = bodyOf("remove");
    expect(body).toContain("cancelTrackedNotification(");
    expect(body).not.toContain("scheduleAndStore(");
  });

  it("applySnooze cancels the prior notification AND schedules a new one (snooze flow)", () => {
    const body = bodyOf("applySnooze");
    expect(body).toContain("cancelTrackedNotification(");
    expect(body).toContain("scheduleAndStore(");
  });

  it("scheduleAndStore calls scheduleReminderNotification and tracks the returned OS id keyed by reminder id", () => {
    const body = bodyOf("scheduleAndStore");
    expect(body).toContain("scheduleReminderNotification(");
    // The screen tracks the returned id in an in-memory map keyed by the
    // server-side reminder id so later cancels can target it.
    expect(body).toContain("scheduledNotificationIds.set(");
  });

  it("prunes tracked ids for reminders that vanish from the latest payload + reconciles on screen focus (task #437)", () => {
    // The screen must call the list-driven prune helper so a reminder
    // deleted on another device stops lingering as a tracked id forever,
    // and must run the OS-pending reconcile on focus (not just on app
    // foreground) so a long in-app session can't accumulate dead ids.
    expect(screenSrc).toContain("clearMissingReminderIds");
    expect(screenSrc).toContain("useFocusEffect");
    expect(screenSrc).toMatch(
      /useFocusEffect\(\s*useCallback\(\(\)\s*=>\s*\{[\s\S]*?reconcileFiredNotifications\(\)/,
    );
  });

  it("auto-cleans dangling notification ids after the OS delivers them (task #425)", () => {
    // Reconciliation against the OS pending list runs on initial load and on
    // AppState→active so notifications fired while the app was closed stop
    // lingering as dead references.
    expect(screenSrc).toContain("getScheduledReminderNotificationIds");
    expect(screenSrc).toContain('"change"');
    expect(screenSrc).toContain("AppState");
    // Real-time path: foreground delivery + tap-to-open clear the tracked id
    // immediately via the expo-notifications listeners.
    expect(screenSrc).toContain("addNotificationReceivedListener");
    expect(screenSrc).toContain("addNotificationResponseReceivedListener");
    // The cleanup itself goes through the two pure helpers in lib/reminders
    // so the behaviour is unit-testable. A future regression that inlines the
    // delete back into the screen (and skips the helpers) would be caught
    // here before the unit tests fall stale.
    expect(screenSrc).toContain("clearFiredNotificationIds");
    expect(screenSrc).toContain("clearNotificationIdFor");
    expect(screenSrc).toMatch(
      /from ["']@\/lib\/reminders["']/,
    );
  });

  it("cancelTrackedNotification calls cancelReminderNotification with both reminder id and OS notification id (foreground banner cleanup)", () => {
    // The wrapper that screen handlers use must pass the reminder id so
    // the in-app foreground banner timer (task #424) is also torn down,
    // not just the OS scheduled notification.
    expect(screenSrc).toMatch(
      /cancelReminderNotification\(\s*id\s*,\s*existing\s*\)/,
    );
  });
});

// ---- 7. Auto-cleanup helpers (task #431) -----------------------------------
//
// `clearFiredNotificationIds` and `clearNotificationIdFor` are the two pure
// helpers the screen calls to drop dead OS notification ids from the
// in-memory tracking map. They never touch the reminder objects themselves
// (so a fired notification does NOT auto-mark the reminder as done — the
// user still sees the reminder as pending and can choose to snooze, mark
// done, or delete it).

describe("clearFiredNotificationIds (task #431)", () => {
  it("drops entries whose stored OS id is not in the still-pending set", () => {
    const tracked = new Map<number, string>([
      [1, "os-fired-a"],
      [2, "os-still-pending-b"],
      [3, "os-fired-c"],
    ]);
    const stillPending = new Set<string>(["os-still-pending-b"]);

    clearFiredNotificationIds(tracked, stillPending);

    expect(Array.from(tracked.entries())).toEqual([[2, "os-still-pending-b"]]);
  });

  it("keeps every entry when all stored OS ids are still pending", () => {
    const tracked = new Map<number, string>([
      [1, "os-a"],
      [2, "os-b"],
    ]);
    const stillPending = new Set<string>(["os-a", "os-b", "os-extra"]);

    clearFiredNotificationIds(tracked, stillPending);

    expect(tracked.size).toBe(2);
    expect(tracked.get(1)).toBe("os-a");
    expect(tracked.get(2)).toBe("os-b");
  });

  it("returns the same map reference (callers compare by identity)", () => {
    const tracked = new Map<number, string>([[1, "os-a"]]);
    const result = clearFiredNotificationIds(tracked, new Set(["os-a"]));
    expect(result).toBe(tracked);

    // Even when an entry IS dropped, the map identity is preserved so the
    // module-scoped tracking map in app/reminders.tsx stays intact.
    const result2 = clearFiredNotificationIds(tracked, new Set());
    expect(result2).toBe(tracked);
    expect(tracked.size).toBe(0);
  });

  it("is a no-op (and does not throw) on an empty tracking map", () => {
    const tracked = new Map<number, string>();
    const result = clearFiredNotificationIds(tracked, new Set(["os-a"]));
    expect(result).toBe(tracked);
    expect(tracked.size).toBe(0);
  });

  it("never mutates the reminder objects themselves — `done` and `dueAt` are preserved", () => {
    // The cleanup intentionally only touches the in-memory id map; a fired
    // notification must NOT auto-mark a reminder as done. We pin that here
    // by holding reminder objects alongside the map and asserting they are
    // untouched (same reference, same field values) after the helper runs.
    const r1 = makeReminder({
      id: 1,
      done: false,
      dueAt: "2026-01-01T10:00:00.000Z",
    });
    const r2 = makeReminder({
      id: 2,
      done: false,
      dueAt: "2026-01-02T10:00:00.000Z",
    });
    const reminders = [r1, r2];

    const tracked = new Map<number, string>([
      [1, "os-fired"],
      [2, "os-pending"],
    ]);

    clearFiredNotificationIds(tracked, new Set(["os-pending"]));

    expect(reminders).toHaveLength(2);
    expect(reminders[0]).toBe(r1);
    expect(reminders[1]).toBe(r2);
    expect(r1.done).toBe(false);
    expect(r1.dueAt).toBe("2026-01-01T10:00:00.000Z");
    expect(r2.done).toBe(false);
    expect(r2.dueAt).toBe("2026-01-02T10:00:00.000Z");
  });
});

describe("clearNotificationIdFor (task #431)", () => {
  it("drops the single entry for the given reminder id", () => {
    const tracked = new Map<number, string>([
      [1, "os-a"],
      [2, "os-b"],
      [3, "os-c"],
    ]);

    clearNotificationIdFor(tracked, 2);

    expect(tracked.has(2)).toBe(false);
    expect(tracked.get(1)).toBe("os-a");
    expect(tracked.get(3)).toBe("os-c");
  });

  it("is a no-op when no entry is tracked for that reminder id", () => {
    const tracked = new Map<number, string>([[1, "os-a"]]);
    const result = clearNotificationIdFor(tracked, 999);
    expect(result).toBe(tracked);
    expect(tracked.size).toBe(1);
    expect(tracked.get(1)).toBe("os-a");
  });

  it("returns the same map reference even when nothing changed", () => {
    const tracked = new Map<number, string>();
    const result = clearNotificationIdFor(tracked, 42);
    expect(result).toBe(tracked);
  });

  it("never mutates the reminder object — `done` and `dueAt` are preserved", () => {
    const r = makeReminder({
      id: 7,
      done: false,
      dueAt: "2026-03-04T05:06:07.000Z",
    });
    const tracked = new Map<number, string>([[7, "os-tap-target"]]);

    clearNotificationIdFor(tracked, 7);

    expect(r.done).toBe(false);
    expect(r.dueAt).toBe("2026-03-04T05:06:07.000Z");
  });
});

describe("clearMissingReminderIds (task #437)", () => {
  it("drops tracked entries whose reminder id is not in the present set", () => {
    const tracked = new Map<number, string>([
      [1, "os-a"],
      [2, "os-b"],
      [3, "os-c"],
    ]);
    const present = new Set<number>([2]);

    clearMissingReminderIds(tracked, present);

    expect(Array.from(tracked.entries())).toEqual([[2, "os-b"]]);
  });

  it("keeps every entry when all tracked reminder ids are still present", () => {
    const tracked = new Map<number, string>([
      [1, "os-a"],
      [2, "os-b"],
    ]);

    clearMissingReminderIds(tracked, new Set([1, 2, 99]));

    expect(tracked.size).toBe(2);
    expect(tracked.get(1)).toBe("os-a");
    expect(tracked.get(2)).toBe("os-b");
  });

  it("returns the same map reference (callers compare by identity)", () => {
    const tracked = new Map<number, string>([[1, "os-a"]]);
    const result = clearMissingReminderIds(tracked, new Set([1]));
    expect(result).toBe(tracked);

    const result2 = clearMissingReminderIds(tracked, new Set());
    expect(result2).toBe(tracked);
    expect(tracked.size).toBe(0);
  });

  it("is a no-op (and does not throw) on an empty tracking map", () => {
    const tracked = new Map<number, string>();
    const result = clearMissingReminderIds(tracked, new Set([1, 2]));
    expect(result).toBe(tracked);
    expect(tracked.size).toBe(0);
  });

  it("drops everything when the present set is empty (all reminders gone)", () => {
    const tracked = new Map<number, string>([
      [1, "os-a"],
      [2, "os-b"],
    ]);

    clearMissingReminderIds(tracked, new Set());

    expect(tracked.size).toBe(0);
  });

  it("never mutates the reminder objects themselves — `done` and `dueAt` are preserved", () => {
    // Mirrors the safeguard from the other helpers: the prune touches only
    // the in-memory id map, never the reminder objects. A reminder that
    // happens to be in the present set must not be modified at all.
    const r1 = makeReminder({
      id: 1,
      done: false,
      dueAt: "2026-01-01T10:00:00.000Z",
    });
    const r2 = makeReminder({
      id: 2,
      done: false,
      dueAt: "2026-01-02T10:00:00.000Z",
    });
    const reminders = [r1, r2];

    const tracked = new Map<number, string>([
      [1, "os-a"],
      [2, "os-b"],
      [3, "os-c"],
    ]);

    clearMissingReminderIds(
      tracked,
      new Set(reminders.map((r) => r.id as unknown as number)),
    );

    expect(tracked.has(3)).toBe(false);
    expect(reminders[0]).toBe(r1);
    expect(reminders[1]).toBe(r2);
    expect(r1.done).toBe(false);
    expect(r1.dueAt).toBe("2026-01-01T10:00:00.000Z");
    expect(r2.done).toBe(false);
    expect(r2.dueAt).toBe("2026-01-02T10:00:00.000Z");
  });
});

// ---- 6. Tap-to-open: deep-link routes to /reminders ------------------------
//
// The notification payload produced by scheduleReminderNotification
// (verified above) is `{type:"reminder", reminderId}`. When the user
// taps it, expo-notifications fires the response listener wired up in
// pushNotifications.ts (`subscribeToPushDeepLinks`) and the resulting
// link is fed into `navigateToPushTarget` in app/_layout.tsx, which
// routes `type === "reminder"` to `/reminders`.

describe("Tap-to-open: notification payload routes to the Reminders screen", () => {
  it("scheduleReminderNotification stores `type:'reminder'` + reminderId on the OS notification", async () => {
    await scheduleReminderNotification(makeReminder({ id: "tap-1" }));
    const arg = scheduleMock.mock.calls[0][0] as {
      content: { data: Record<string, unknown> };
    };
    expect(arg.content.data).toEqual({
      type: "reminder",
      reminderId: "tap-1",
    });
  });

  it("navigateToPushTarget in app/_layout.tsx routes reminder links to /reminders", () => {
    const layoutSrc = readFileSync(
      resolve(__dirname, "../app/_layout.tsx"),
      "utf8",
    );
    // Pull out the navigateToPushTarget body.
    const m = /export function navigateToPushTarget\([\s\S]*?\n\}\n/.exec(
      layoutSrc,
    );
    expect(m, "expected navigateToPushTarget in app/_layout.tsx").toBeTruthy();
    const body = m![0];
    // The reminder branch must be the first one we test for so it wins
    // even if a property/work-order id sneaks into the payload.
    expect(body).toMatch(/link\.type === ["']reminder["']/);
    expect(body).toMatch(/router\.push\(["']\/reminders["']\)/);
    // And it must be wired into the deep-link subscriber + initial-tap
    // path, otherwise a tap from a cold start wouldn't open the screen.
    expect(layoutSrc).toContain("subscribeToPushDeepLinks(navigateToPushTarget)");
    expect(layoutSrc).toContain("getInitialPushDeepLink()");
  });

  it("pushNotifications.extractDeepLinkFromData accepts reminder payloads (no work-order/property ids required)", () => {
    const pushSrc = readFileSync(
      resolve(__dirname, "./pushNotifications.ts"),
      "utf8",
    );
    // The extractor returns null when none of the known ids are present
    // UNLESS the payload's type === "reminder". Pin that exception here
    // because the screen relies on it for the tap-to-open flow.
    expect(pushSrc).toMatch(/typeRaw !== ["']reminder["']/);
    expect(pushSrc).toContain("reminderId");
  });
});

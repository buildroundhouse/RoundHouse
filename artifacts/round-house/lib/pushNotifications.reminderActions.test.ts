/**
 * Coverage for the reminder push action buttons (task #435).
 *
 * The due-reminder push (task #426) now includes "Snooze 1h" / "Done"
 * action buttons rendered straight on the lock screen. Tapping either:
 *
 *   - "Snooze" pushes the reminder's `dueAt` forward by 1 hour and
 *     leaves it open so the next sweep re-notifies (the API's PATCH
 *     handler clears `notified_at` whenever `dueAt` is moved into the
 *     future, matching the snooze sheet's behavior).
 *   - "Done" marks the reminder `done = true`.
 *
 * Both actions are registered with `opensAppToForeground: false` so the
 * user stays on the lock screen — no navigation, no app launch. This
 * file pins:
 *
 *   1. The notification category is registered with the right action
 *      identifiers and titles, both with `opensAppToForeground: false`.
 *   2. The response listener routes "snooze" / "done" identifiers to a
 *      `PATCH /reminders/:id` call with the right body, and ignores
 *      non-reminder payloads / default body taps / unknown actions.
 *   3. `subscribeToPushDeepLinks` does NOT navigate when the user taps
 *      an action button (only when the body is tapped).
 *   4. `getInitialPushDeepLink` runs the action and suppresses
 *      navigation when a cold start is triggered by an action tap.
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

const mocks = vi.hoisted(() => {
  const platformRef: { OS: "ios" | "android" | "web" } = { OS: "ios" };
  const appStateRef: { currentState: "active" | "background" | "inactive" } = {
    currentState: "active",
  };
  return {
    platformRef,
    appStateRef,
    setCategoryMock: vi.fn(async () => undefined),
    addResponseListenerMock: vi.fn(),
    addReceivedListenerMock: vi.fn(() => ({ remove: () => {} })),
    getLastResponseMock: vi.fn(async () => null as unknown),
    updateReminderMock: vi.fn(async () => ({ id: 1 })),
    scheduleNotificationMock: vi.fn(async () => "scheduled-id"),
    DEFAULT_ACTION_IDENTIFIER: "expo.modules.notifications.actions.DEFAULT",
    DISMISS_ACTION_IDENTIFIER: "expo.modules.notifications.actions.DISMISS",
  };
});

vi.mock("react-native", () => ({
  Platform: mocks.platformRef,
  AppState: {
    addEventListener: () => ({ remove: () => {} }),
    get currentState() {
      return mocks.appStateRef.currentState;
    },
  },
}));

vi.mock("expo-device", () => ({ isDevice: false }));
vi.mock("expo-constants", () => ({ default: { expoConfig: null } }));

vi.mock("@workspace/api-client-react", () => ({
  updatePushToken: vi.fn(async () => undefined),
  updateReminder: (...args: unknown[]) => mocks.updateReminderMock(...args),
}));

const responseListeners: Array<(response: unknown) => void> = [];
mocks.addResponseListenerMock.mockImplementation(
  (listener: (response: unknown) => void) => {
    responseListeners.push(listener);
    return {
      remove: () => {
        const i = responseListeners.indexOf(listener);
        if (i >= 0) responseListeners.splice(i, 1);
      },
    };
  },
);

vi.mock("expo-notifications", () => ({
  setNotificationHandler: vi.fn(),
  setNotificationChannelAsync: vi.fn(async () => undefined),
  setNotificationCategoryAsync: (...args: unknown[]) =>
    mocks.setCategoryMock(...args),
  addNotificationResponseReceivedListener: (
    listener: (response: unknown) => void,
  ) => mocks.addResponseListenerMock(listener),
  addNotificationReceivedListener: (
    listener: (notification: unknown) => void,
  ) => mocks.addReceivedListenerMock(listener),
  getLastNotificationResponseAsync: (...args: unknown[]) =>
    mocks.getLastResponseMock(...args),
  scheduleNotificationAsync: (...args: unknown[]) =>
    mocks.scheduleNotificationMock(...args),
  getPermissionsAsync: vi.fn(async () => ({ status: "denied" })),
  requestPermissionsAsync: vi.fn(async () => ({ status: "denied" })),
  getExpoPushTokenAsync: vi.fn(async () => ({ data: null })),
  AndroidImportance: { DEFAULT: 3 },
  DEFAULT_ACTION_IDENTIFIER: mocks.DEFAULT_ACTION_IDENTIFIER,
  DISMISS_ACTION_IDENTIFIER: mocks.DISMISS_ACTION_IDENTIFIER,
}));

// ---- Helpers ---------------------------------------------------------------

interface FakeResponse {
  actionIdentifier: string;
  notification: {
    request: {
      identifier: string;
      content: { data: Record<string, unknown> | undefined };
    };
  };
}

let nextRequestId = 0;
function makeResponse(
  actionIdentifier: string,
  data: Record<string, unknown> | undefined = {
    type: "reminder",
    reminderId: "42",
  },
  identifier?: string,
): FakeResponse {
  return {
    actionIdentifier,
    notification: {
      request: {
        identifier: identifier ?? `req-${++nextRequestId}`,
        content: { data },
      },
    },
  };
}

async function flush(): Promise<void> {
  // Let the listener's async work resolve.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(async () => {
  mocks.platformRef.OS = "ios";
  mocks.appStateRef.currentState = "active";
  mocks.setCategoryMock.mockClear();
  mocks.addResponseListenerMock.mockClear();
  mocks.addReceivedListenerMock.mockClear();
  mocks.getLastResponseMock.mockReset().mockResolvedValue(null);
  mocks.updateReminderMock.mockReset().mockResolvedValue({ id: 1 });
  mocks.scheduleNotificationMock
    .mockReset()
    .mockResolvedValue("scheduled-id");
  responseListeners.length = 0;
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- 1. Category registration ---------------------------------------------

describe("Reminder notification category registration", () => {
  it("registers a 'reminder' category with Snooze 1h / Tomorrow / Next week / Done action buttons, all staying on the lock screen", async () => {
    await import("./pushNotifications");
    await flush();

    expect(mocks.setCategoryMock).toHaveBeenCalledTimes(1);
    const [identifier, actions] = mocks.setCategoryMock.mock.calls[0] as [
      string,
      Array<{
        identifier: string;
        buttonTitle: string;
        options: { opensAppToForeground?: boolean };
      }>,
    ];
    expect(identifier).toBe("reminder");
    // Three snooze choices (1h / Tomorrow / Next week) mirror the
    // in-app snooze sheet so people can pick the right deferral
    // straight from the lock screen, plus "Done".
    expect(actions).toHaveLength(4);

    const snooze = actions.find((a) => a.identifier === "snooze");
    const snoozeTomorrow = actions.find(
      (a) => a.identifier === "snooze_tomorrow",
    );
    const snoozeNextWeek = actions.find(
      (a) => a.identifier === "snooze_next_week",
    );
    const done = actions.find((a) => a.identifier === "done");
    expect(snooze).toBeDefined();
    expect(snoozeTomorrow).toBeDefined();
    expect(snoozeNextWeek).toBeDefined();
    expect(done).toBeDefined();
    expect(snooze!.buttonTitle).toBe("Snooze 1h");
    expect(snoozeTomorrow!.buttonTitle).toBe("Tomorrow");
    expect(snoozeNextWeek!.buttonTitle).toBe("Next week");
    expect(done!.buttonTitle).toBe("Done");
    // All actions must keep the user on the lock screen — the whole
    // point of the feature is no app-launch round-trip.
    for (const a of actions) {
      expect(a.options.opensAppToForeground).toBe(false);
    }
  });

  it("does not register categories on web (expo-notifications has no category support there)", async () => {
    mocks.platformRef.OS = "web";
    await import("./pushNotifications");
    await flush();
    expect(mocks.setCategoryMock).not.toHaveBeenCalled();
  });
});

// ---- 2. Action handling ---------------------------------------------------

describe("subscribeToReminderActions: PATCHes the reminder server-side", () => {
  it("Snooze 1h pushes dueAt forward by 1 hour and leaves it open", async () => {
    const mod = await import("./pushNotifications");
    const unsub = mod.subscribeToReminderActions();

    const before = Date.now();
    responseListeners[responseListeners.length - 1](makeResponse("snooze"));
    await flush();
    const after = Date.now();

    expect(mocks.updateReminderMock).toHaveBeenCalledTimes(1);
    const [reminderId, body] = mocks.updateReminderMock.mock.calls[0] as [
      number,
      { dueAt: string; done: boolean },
    ];
    expect(reminderId).toBe(42);
    expect(body.done).toBe(false);
    const due = new Date(body.dueAt).getTime();
    // ~1 hour in the future from "now". Allow a generous window for
    // test scheduler jitter.
    expect(due).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 1_000);
    expect(due).toBeLessThanOrEqual(after + 60 * 60 * 1000 + 1_000);

    unsub();
  });

  it.each([
    ["snooze_tomorrow", 24],
    ["snooze_next_week", 24 * 7],
  ])(
    "%s pushes dueAt forward by %s hours and leaves the reminder open",
    async (actionId, hours) => {
      const mod = await import("./pushNotifications");
      mod.subscribeToReminderActions();

      const before = Date.now();
      responseListeners[responseListeners.length - 1](makeResponse(actionId));
      await flush();
      const after = Date.now();

      expect(mocks.updateReminderMock).toHaveBeenCalledTimes(1);
      const [reminderId, body] = mocks.updateReminderMock.mock.calls[0] as [
        number,
        { dueAt: string; done: boolean },
      ];
      expect(reminderId).toBe(42);
      expect(body.done).toBe(false);
      const due = new Date(body.dueAt).getTime();
      const expected = hours * 60 * 60 * 1000;
      expect(due).toBeGreaterThanOrEqual(before + expected - 1_000);
      expect(due).toBeLessThanOrEqual(after + expected + 1_000);
    },
  );

  it("Done marks the reminder done = true", async () => {
    const mod = await import("./pushNotifications");
    mod.subscribeToReminderActions();
    responseListeners[responseListeners.length - 1](makeResponse("done"));
    await flush();
    expect(mocks.updateReminderMock).toHaveBeenCalledTimes(1);
    const [reminderId, body] = mocks.updateReminderMock.mock.calls[0] as [
      number,
      { done: boolean },
    ];
    expect(reminderId).toBe(42);
    expect(body).toEqual({ done: true });
  });

  it("ignores the default body tap (that's the deep-link path, not an action)", async () => {
    const mod = await import("./pushNotifications");
    mod.subscribeToReminderActions();
    responseListeners[responseListeners.length - 1](
      makeResponse(mocks.DEFAULT_ACTION_IDENTIFIER),
    );
    await flush();
    expect(mocks.updateReminderMock).not.toHaveBeenCalled();
  });

  it("ignores swipe-to-dismiss", async () => {
    const mod = await import("./pushNotifications");
    mod.subscribeToReminderActions();
    responseListeners[responseListeners.length - 1](
      makeResponse(mocks.DISMISS_ACTION_IDENTIFIER),
    );
    await flush();
    expect(mocks.updateReminderMock).not.toHaveBeenCalled();
  });

  it("ignores unknown action identifiers (defensive — future actions we don't recognize yet)", async () => {
    const mod = await import("./pushNotifications");
    mod.subscribeToReminderActions();
    responseListeners[responseListeners.length - 1](makeResponse("archive"));
    await flush();
    expect(mocks.updateReminderMock).not.toHaveBeenCalled();
  });

  it("ignores non-reminder push payloads (e.g. work-order push with no reminder id)", async () => {
    const mod = await import("./pushNotifications");
    mod.subscribeToReminderActions();
    responseListeners[responseListeners.length - 1](
      makeResponse("snooze", { type: "work_order", workOrderId: 7 }),
    );
    await flush();
    expect(mocks.updateReminderMock).not.toHaveBeenCalled();
  });

  it("ignores reminder payloads with a missing or non-numeric id", async () => {
    const mod = await import("./pushNotifications");
    mod.subscribeToReminderActions();
    responseListeners[responseListeners.length - 1](
      makeResponse("snooze", { type: "reminder" }),
    );
    responseListeners[responseListeners.length - 1](
      makeResponse("done", { type: "reminder", reminderId: "not-a-number" }),
    );
    await flush();
    expect(mocks.updateReminderMock).not.toHaveBeenCalled();
  });

  it("dedupes the same action response so cold-start double-delivery doesn't double-snooze", async () => {
    const mod = await import("./pushNotifications");
    mod.subscribeToReminderActions();
    // Same notification request id + same action id arrives twice — once
    // from getLastNotificationResponseAsync() and once from the live
    // listener at cold start. The PATCH must only fire once.
    const r = makeResponse("snooze", { type: "reminder", reminderId: "42" }, "shared-req-id");
    responseListeners[responseListeners.length - 1](r);
    responseListeners[responseListeners.length - 1](r);
    await flush();
    expect(mocks.updateReminderMock).toHaveBeenCalledTimes(1);
  });

  it("swallows network failures so the OS notification handler doesn't crash", async () => {
    mocks.updateReminderMock.mockRejectedValueOnce(new Error("offline"));
    const mod = await import("./pushNotifications");
    mod.subscribeToReminderActions();
    responseListeners[responseListeners.length - 1](makeResponse("done"));
    await flush();
    // Reaching here without an unhandled rejection is the assertion.
    expect(mocks.updateReminderMock).toHaveBeenCalledTimes(1);
  });
});

// ---- 2b. Snooze confirmation receipt (task #450) -------------------------

describe("Snooze confirmation surfaces the server-acknowledged dueAt", () => {
  it("emits an in-app banner when the app is foregrounded, using the server-returned dueAt (not the optimistic one)", async () => {
    // Server bumps dueAt slightly (e.g. rounds to the minute or shifts to
    // a 9 AM default for "Tomorrow"). The confirmation must reflect that.
    const serverDue = new Date(Date.now() + 24 * 60 * 60 * 1000 + 12 * 60 * 1000);
    serverDue.setSeconds(0, 0);
    mocks.updateReminderMock.mockResolvedValue({
      id: 42,
      title: "Take out the trash",
      dueAt: serverDue.toISOString(),
      done: false,
    });
    mocks.appStateRef.currentState = "active";

    const mod = await import("./pushNotifications");
    const banners: Array<{ title: string | null; body: string | null }> = [];
    const unsubBanner = mod.subscribeToForegroundPush((p) =>
      banners.push({ title: p.title, body: p.body }),
    );
    mod.subscribeToReminderActions();

    responseListeners[responseListeners.length - 1](makeResponse("snooze_tomorrow"));
    await flush();

    expect(mocks.scheduleNotificationMock).not.toHaveBeenCalled();
    expect(banners).toHaveLength(1);
    expect(banners[0].title).toBe("Take out the trash");
    expect(banners[0].body).toMatch(/^Snoozed until /);
    // The body must reference the server-returned time (not the optimistic
    // "+24h from now"). We assert by checking the formatted time appears.
    const expectedTime = serverDue.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    expect(banners[0].body).toContain(expectedTime);

    unsubBanner();
  });

  it("schedules an immediate local notification when the app is backgrounded", async () => {
    const serverDue = new Date(Date.now() + 60 * 60 * 1000);
    mocks.updateReminderMock.mockResolvedValue({
      id: 42,
      title: "Water plants",
      dueAt: serverDue.toISOString(),
      done: false,
    });
    mocks.appStateRef.currentState = "background";

    const mod = await import("./pushNotifications");
    const banners: unknown[] = [];
    mod.subscribeToForegroundPush((p) => banners.push(p));
    mod.subscribeToReminderActions();

    responseListeners[responseListeners.length - 1](makeResponse("snooze"));
    await flush();

    expect(banners).toHaveLength(0);
    expect(mocks.scheduleNotificationMock).toHaveBeenCalledTimes(1);
    const [args] = mocks.scheduleNotificationMock.mock.calls[0] as [
      {
        content: {
          title: string;
          body: string;
          sound: boolean;
          data: Record<string, unknown>;
        };
        trigger: unknown;
      },
    ];
    expect(args.content.title).toBe("Water plants");
    expect(args.content.body).toMatch(/^Snoozed until /);
    // No sound — it's a receipt, not a fresh alert.
    expect(args.content.sound).toBe(false);
    // Fires immediately.
    expect(args.trigger).toBeNull();
    // Tagged so consumers can tell it apart from a real reminder push.
    expect(args.content.data).toMatchObject({
      type: "reminder",
      reminderId: "42",
      confirmation: true,
    });
  });

  it("does NOT surface a confirmation for the Done action (only snooze)", async () => {
    mocks.appStateRef.currentState = "background";
    mocks.updateReminderMock.mockResolvedValue({
      id: 42,
      title: "Water plants",
      dueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      done: true,
    });
    const mod = await import("./pushNotifications");
    const banners: unknown[] = [];
    mod.subscribeToForegroundPush((p) => banners.push(p));
    mod.subscribeToReminderActions();

    responseListeners[responseListeners.length - 1](makeResponse("done"));
    await flush();

    expect(banners).toHaveLength(0);
    expect(mocks.scheduleNotificationMock).not.toHaveBeenCalled();
  });

  it("skips the confirmation if the server response is missing/invalid (defensive)", async () => {
    mocks.appStateRef.currentState = "background";
    mocks.updateReminderMock.mockResolvedValue({ id: 42 });
    const mod = await import("./pushNotifications");
    mod.subscribeToReminderActions();

    responseListeners[responseListeners.length - 1](makeResponse("snooze"));
    await flush();

    expect(mocks.updateReminderMock).toHaveBeenCalledTimes(1);
    expect(mocks.scheduleNotificationMock).not.toHaveBeenCalled();
  });
});

describe("formatSnoozeUntil", () => {
  it("renders same-day as just the time", async () => {
    const mod = await import("./pushNotifications");
    const now = new Date(2026, 3, 22, 10, 0, 0);
    const due = new Date(2026, 3, 22, 15, 30, 0);
    expect(mod.formatSnoozeUntil(due, now)).toMatch(/3:30/);
    expect(mod.formatSnoozeUntil(due, now)).not.toMatch(/tomorrow/);
  });

  it("prefixes 'tomorrow' for next-day", async () => {
    const mod = await import("./pushNotifications");
    const now = new Date(2026, 3, 22, 10, 0, 0);
    const due = new Date(2026, 3, 23, 9, 0, 0);
    expect(mod.formatSnoozeUntil(due, now)).toMatch(/^tomorrow /);
    expect(mod.formatSnoozeUntil(due, now)).toMatch(/9:00/);
  });

  it("includes weekday + date for further-out times", async () => {
    const mod = await import("./pushNotifications");
    const now = new Date(2026, 3, 22, 10, 0, 0);
    const due = new Date(2026, 3, 29, 9, 0, 0);
    const out = mod.formatSnoozeUntil(due, now);
    expect(out).not.toMatch(/^tomorrow/);
    expect(out).toMatch(/9:00/);
    // Some sensible date token shows up (weekday or month/day numerals).
    expect(out.length).toBeGreaterThan("9:00 AM".length);
  });

  it("returns empty string for an invalid Date", async () => {
    const mod = await import("./pushNotifications");
    expect(mod.formatSnoozeUntil(new Date("not-a-date"))).toBe("");
  });
});

// ---- 3. Deep-link subscriber must NOT navigate on action taps -------------

describe("subscribeToPushDeepLinks: action taps do NOT route to the screen", () => {
  it("calls the navigation handler for a body tap, but skips it for snooze/done action taps", async () => {
    const mod = await import("./pushNotifications");
    const navHandler = vi.fn();
    mod.subscribeToPushDeepLinks(navHandler);

    // Body tap → navigates.
    responseListeners[responseListeners.length - 1](
      makeResponse(mocks.DEFAULT_ACTION_IDENTIFIER),
    );
    await flush();
    expect(navHandler).toHaveBeenCalledTimes(1);
    expect(navHandler.mock.calls[0][0]).toMatchObject({
      type: "reminder",
      reminderId: "42",
    });

    // Action tap → does NOT navigate.
    navHandler.mockClear();
    responseListeners[responseListeners.length - 1](makeResponse("snooze"));
    responseListeners[responseListeners.length - 1](makeResponse("done"));
    await flush();
    expect(navHandler).not.toHaveBeenCalled();
  });
});

// ---- 4. Cold-start action taps -------------------------------------------

describe("getInitialPushDeepLink: a cold start from an action tap runs the action and suppresses navigation", () => {
  it("returns null and PATCHes the reminder when the launch was via Snooze", async () => {
    mocks.getLastResponseMock.mockResolvedValueOnce(makeResponse("snooze"));
    const mod = await import("./pushNotifications");
    const link = await mod.getInitialPushDeepLink();
    await flush();
    expect(link).toBeNull();
    expect(mocks.updateReminderMock).toHaveBeenCalledTimes(1);
    const [, body] = mocks.updateReminderMock.mock.calls[0] as [
      number,
      { dueAt?: string; done: boolean },
    ];
    expect(body.done).toBe(false);
    expect(typeof body.dueAt).toBe("string");
  });

  it("returns the deep-link (and does NOT call updateReminder) when the launch was via the body tap", async () => {
    mocks.getLastResponseMock.mockResolvedValueOnce(
      makeResponse(mocks.DEFAULT_ACTION_IDENTIFIER),
    );
    const mod = await import("./pushNotifications");
    const link = await mod.getInitialPushDeepLink();
    await flush();
    expect(link).toMatchObject({ type: "reminder", reminderId: "42" });
    expect(mocks.updateReminderMock).not.toHaveBeenCalled();
  });
});

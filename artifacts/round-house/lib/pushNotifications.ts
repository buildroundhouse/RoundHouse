import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { AppState, Platform } from "react-native";
import {
  updatePushToken,
  updateReminder,
  type Reminder,
} from "@workspace/api-client-react";

let lastSyncedToken: string | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // We render our own branded in-app banner while the app is foregrounded,
    // so suppress the OS heads-up alert/banner to avoid double-notifying.
    shouldShowAlert: false,
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Identifier for the reminder notification category. Push payloads sent
// from the API with this `categoryId` (and locally-scheduled reminder
// notifications using this `categoryIdentifier`) render snooze /
// "Done" action buttons on the lock-screen / notification-center push.
export const REMINDER_NOTIFICATION_CATEGORY = "reminder";
export const REMINDER_ACTION_SNOOZE = "snooze";
export const REMINDER_ACTION_SNOOZE_TOMORROW = "snooze_tomorrow";
export const REMINDER_ACTION_SNOOZE_NEXT_WEEK = "snooze_next_week";
export const REMINDER_ACTION_DONE = "done";
// How far forward each snooze action pushes a reminder's due time.
// Mirrors the choices exposed in the in-app snooze sheet so the action
// buttons feel equivalent to tapping the matching sheet entry.
export const REMINDER_SNOOZE_HOURS = 1;
const REMINDER_SNOOZE_HOURS_BY_ACTION: Record<string, number> = {
  [REMINDER_ACTION_SNOOZE]: REMINDER_SNOOZE_HOURS,
  [REMINDER_ACTION_SNOOZE_TOMORROW]: 24,
  [REMINDER_ACTION_SNOOZE_NEXT_WEEK]: 24 * 7,
};

let categoriesEnsured = false;
async function ensureNotificationCategoriesOnce(): Promise<void> {
  if (categoriesEnsured) return;
  categoriesEnsured = true;
  if (Platform.OS === "web") return;
  try {
    await Notifications.setNotificationCategoryAsync(
      REMINDER_NOTIFICATION_CATEGORY,
      [
        {
          identifier: REMINDER_ACTION_SNOOZE,
          buttonTitle: "Snooze 1h",
          // Stay on the lock screen — the action handler runs in JS and
          // PATCHes the reminder server-side, no UI navigation required.
          options: { opensAppToForeground: false },
        },
        {
          identifier: REMINDER_ACTION_SNOOZE_TOMORROW,
          buttonTitle: "Tomorrow",
          options: { opensAppToForeground: false },
        },
        {
          identifier: REMINDER_ACTION_SNOOZE_NEXT_WEEK,
          buttonTitle: "Next week",
          options: { opensAppToForeground: false },
        },
        {
          identifier: REMINDER_ACTION_DONE,
          buttonTitle: "Done",
          options: {
            opensAppToForeground: false,
            isDestructive: false,
            isAuthenticationRequired: false,
          },
        },
      ],
    );
  } catch {
    // Category registration is best-effort — if it fails the push still
    // delivers, just without action buttons.
  }
}
// Fire-and-forget at module load so the categories are registered before
// the first reminder push lands. Safe to call multiple times via the
// `categoriesEnsured` guard.
void ensureNotificationCategoriesOnce();

async function ensureAndroidChannel() {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: "#F59E0B",
    });
  } catch {
    // ignore
  }
}

function getProjectId(): string | undefined {
  const ec = (Constants.expoConfig as { extra?: { eas?: { projectId?: string } } } | null)?.extra
    ?.eas?.projectId;
  const ec2 = (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  return ec || ec2;
}

export async function getDeviceExpoPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null;
  await ensureAndroidChannel();

  let perms = await Notifications.getPermissionsAsync();
  if (perms.status !== "granted") {
    perms = await Notifications.requestPermissionsAsync();
  }
  if (perms.status !== "granted") return null;

  try {
    const projectId = getProjectId();
    const tokenResult = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return tokenResult.data ?? null;
  } catch {
    return null;
  }
}

async function postToken(token: string | null): Promise<boolean> {
  try {
    await updatePushToken({ token });
    return true;
  } catch {
    return false;
  }
}

export type PushSyncResult = "synced" | "unchanged" | "no_token" | "failed";

let syncInFlightResult: Promise<PushSyncResult> | null = null;

export async function syncPushTokenWithServer(): Promise<PushSyncResult> {
  if (syncInFlightResult) return syncInFlightResult;
  syncInFlightResult = (async (): Promise<PushSyncResult> => {
    const token = await getDeviceExpoPushToken();
    if (!token) return "no_token";
    if (token === lastSyncedToken) return "unchanged";

    let attempt = 0;
    let ok = false;
    while (attempt < 3 && !ok) {
      ok = await postToken(token);
      if (!ok) {
        attempt += 1;
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
    if (ok) {
      lastSyncedToken = token;
      return "synced";
    }
    return "failed";
  })();
  try {
    return await syncInFlightResult;
  } finally {
    syncInFlightResult = null;
  }
}

export async function clearPushTokenOnServer(): Promise<void> {
  await postToken(null);
  lastSyncedToken = null;
}

export function clearSyncedToken(): void {
  lastSyncedToken = null;
}

export interface PushDeepLink {
  workOrderId?: number;
  propertyId?: number;
  logId?: number;
  standardId?: number;
  type?: string;
  tab?: string;
  reminderId?: string;
  questionId?: number;
}

function extractDeepLink(
  response: Notifications.NotificationResponse | null | undefined,
): PushDeepLink | null {
  const data = response?.notification?.request?.content?.data as
    | Record<string, unknown>
    | undefined;
  return extractDeepLinkFromData(data);
}

function extractDeepLinkFromData(
  data: Record<string, unknown> | undefined,
): PushDeepLink | null {
  if (!data) return null;
  const typeRaw = typeof data.type === "string" ? data.type : undefined;
  const tabRaw = typeof data.tab === "string" ? data.tab : undefined;
  const woRaw = data.workOrderId;
  const propRaw = data.propertyId;
  const logRaw = data.logId;
  const stdRaw = data.standardId;
  const toNum = (v: unknown): number | undefined =>
    typeof v === "number"
      ? v
      : typeof v === "string" && /^\d+$/.test(v)
      ? parseInt(v, 10)
      : undefined;
  const workOrderId = toNum(woRaw);
  const propertyId = toNum(propRaw);
  const logId = toNum(logRaw);
  const standardId = toNum(stdRaw);
  const reminderId =
    typeof data.reminderId === "string" ? data.reminderId : undefined;
  const questionId = toNum(data.questionId);
  if (
    !workOrderId &&
    !propertyId &&
    !logId &&
    !standardId &&
    !questionId &&
    typeRaw !== "reminder" &&
    typeRaw !== "question" &&
    typeRaw !== "company_notice" &&
    // Team-up request notifications carry no work-order / property /
    // standard ids — the relevant target is the recipient's
    // /invites screen, where Accept / Decline / Ignore live. Without
    // this allow-list entry the extractor would drop the payload
    // and the notification tap would do nothing.
    typeRaw !== "team_up_request"
  )
    return null;
  return {
    workOrderId,
    propertyId,
    logId,
    standardId,
    type: typeRaw,
    tab: tabRaw,
    reminderId,
    questionId,
  };
}

function isCustomAction(actionId: string | null | undefined): boolean {
  if (!actionId) return false;
  if (actionId === Notifications.DEFAULT_ACTION_IDENTIFIER) return false;
  // expo-notifications exposes a "dismiss" pseudo-action on some platforms
  // (when the user swipes the notification away). Treat it as non-custom
  // so we don't accidentally route it through the action handler.
  const dismiss = (
    Notifications as unknown as { DISMISS_ACTION_IDENTIFIER?: string }
  ).DISMISS_ACTION_IDENTIFIER;
  if (dismiss && actionId === dismiss) return false;
  return true;
}

// Tracks notification-request ids whose action has already been handled
// during this app session. At cold start we both consume the launch
// response via `getLastNotificationResponseAsync` AND have a live
// `addNotificationResponseReceivedListener` subscription — without this
// guard the same "Snooze" tap could PATCH the reminder twice (e.g.
// pushing `dueAt` 2h forward instead of 1h). The set is bounded since a
// single session never sees more than a handful of action taps.
const handledActionResponseIds = new Set<string>();

async function handleReminderActionResponse(
  response: Notifications.NotificationResponse | null | undefined,
): Promise<boolean> {
  if (!response) return false;
  const actionId = response.actionIdentifier;
  if (!isCustomAction(actionId)) return false;
  const requestId = response.notification?.request?.identifier;
  if (typeof requestId === "string" && requestId) {
    const dedupeKey = `${requestId}:${actionId}`;
    if (handledActionResponseIds.has(dedupeKey)) return false;
    handledActionResponseIds.add(dedupeKey);
  }
  const data = response.notification?.request?.content?.data as
    | Record<string, unknown>
    | undefined;
  if (!data || data.type !== "reminder") return false;
  const raw = data.reminderId;
  const reminderId =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^\d+$/.test(raw)
        ? parseInt(raw, 10)
        : null;
  if (reminderId == null) return false;
  try {
    const snoozeHours = REMINDER_SNOOZE_HOURS_BY_ACTION[actionId];
    if (snoozeHours != null) {
      const nextDue = new Date(
        Date.now() + snoozeHours * 60 * 60 * 1000,
      ).toISOString();
      // Push `dueAt` forward and re-arm the server-side notifier so the
      // reminder fires again at the new time. The PATCH handler clears
      // `notified_at` automatically when `dueAt` is moved into the future.
      const updated = await updateReminder(reminderId, {
        dueAt: nextDue,
        done: false,
      });
      // Reassure the user the snooze took effect — three buttons make it
      // easy to tap the wrong one. We use the server-acknowledged `dueAt`
      // (rather than `nextDue` above) so the confirmation reflects what
      // actually got persisted, including any server-side rounding.
      void surfaceSnoozeConfirmation(updated);
    } else if (actionId === REMINDER_ACTION_DONE) {
      await updateReminder(reminderId, { done: true });
    } else {
      return false;
    }
    return true;
  } catch {
    // Best-effort: if the network call fails the user can still open the
    // app and act on the reminder manually. Swallow so we don't crash the
    // notification handler.
    return false;
  }
}

// Friendly relative format for the snoozed-until time. Examples:
//   same day  → "3:30 PM"
//   tomorrow  → "tomorrow 9:00 AM"
//   later     → "Mon, Apr 27 9:00 AM"
// Exported for unit-test coverage; not consumed elsewhere.
export function formatSnoozeUntil(due: Date, now: Date = new Date()): string {
  if (isNaN(due.getTime())) return "";
  const time = due.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const sameDay = due.toDateString() === now.toDateString();
  if (sameDay) return time;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (due.toDateString() === tomorrow.toDateString()) {
    return `tomorrow ${time}`;
  }
  const date = due.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${date} ${time}`;
}

async function surfaceSnoozeConfirmation(reminder: Reminder): Promise<void> {
  const due = new Date(reminder.dueAt);
  const when = formatSnoozeUntil(due);
  if (!when) return;
  const title = reminder.title?.trim() || "Reminder";
  const body = `Snoozed until ${when}`;
  const link: PushDeepLink = {
    type: "reminder",
    reminderId: String(reminder.id),
  };
  // Foregrounded → show the in-app banner. Backgrounded / locked → drop a
  // silent local notification so the user gets a quick on-device receipt
  // without leaving the lock screen. We avoid double-surfacing because the
  // banner host only renders when the app is active.
  const isActive = AppState.currentState === "active";
  if (isActive) {
    emitForegroundPush({ title, body, link });
    return;
  }
  if (Platform.OS === "web") return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        // Keep the confirmation unobtrusive — it's a receipt, not a new alert.
        sound: false,
        data: { type: "reminder", reminderId: link.reminderId, confirmation: true },
      },
      trigger: null,
    });
  } catch {
    // Best-effort; swallow so the action handler stays resilient.
  }
}

let consumedInitialPushDeepLink = false;

export async function getInitialPushDeepLink(): Promise<PushDeepLink | null> {
  if (consumedInitialPushDeepLink) return null;
  consumedInitialPushDeepLink = true;
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    // If the cold start was triggered by tapping a notification action
    // (e.g. "Snooze 1h" / "Done"), run the action server-side and
    // suppress the navigation — the user expected the action to clear
    // the reminder from the lock screen, not to deep-link into the app.
    if (isCustomAction(response?.actionIdentifier)) {
      void handleReminderActionResponse(response);
      return null;
    }
    return extractDeepLink(response);
  } catch {
    return null;
  }
}

export interface ForegroundPushPayload {
  title: string | null;
  body: string | null;
  link: PushDeepLink | null;
}

// In-process emitter so non-OS sources (e.g. a foreground reminder timer that
// fires while the app is open) can surface the same branded banner without
// going through the notifications system.
const foregroundEmitter = new Set<(p: ForegroundPushPayload) => void>();

export function emitForegroundPush(payload: ForegroundPushPayload): void {
  for (const handler of Array.from(foregroundEmitter)) {
    try {
      handler(payload);
    } catch {
      // ignore subscriber errors
    }
  }
}

export function subscribeToForegroundPush(
  handler: (payload: ForegroundPushPayload) => void,
): () => void {
  foregroundEmitter.add(handler);
  const sub = Notifications.addNotificationReceivedListener((notification) => {
    const content = notification.request.content;
    const data = content.data as Record<string, unknown> | undefined;
    handler({
      title: content.title ?? null,
      body: content.body ?? null,
      link: extractDeepLinkFromData(data),
    });
  });
  return () => {
    foregroundEmitter.delete(handler);
    sub.remove();
  };
}

export function subscribeToPushDeepLinks(
  handler: (link: PushDeepLink) => void,
): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    // A custom-action tap (e.g. reminder "Snooze 1h" / "Done") must not
    // navigate — the action handler runs the server-side mutation and
    // the user stays on the lock screen.
    if (isCustomAction(response?.actionIdentifier)) return;
    const link = extractDeepLink(response);
    if (link) handler(link);
  });
  return () => {
    sub.remove();
  };
}

/**
 * Subscribe to taps on notification action buttons (e.g. the reminder
 * push's "Snooze 1h" / "Done" buttons). The handler PATCHes the
 * reminder server-side and returns; no navigation occurs because the
 * actions are registered with `opensAppToForeground: false`.
 */
export function subscribeToReminderActions(): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      void handleReminderActionResponse(response);
    },
  );
  return () => sub.remove();
}

let appStateSub: { remove: () => void } | null = null;

export function startPushTokenAutoSync(): () => void {
  // Re-sync on app foreground in case the very first attempt happened
  // before the auth token getter was fully wired up.
  if (appStateSub) appStateSub.remove();
  appStateSub = AppState.addEventListener("change", (state) => {
    if (state === "active") {
      void syncPushTokenWithServer();
    }
  });
  return () => {
    appStateSub?.remove();
    appStateSub = null;
  };
}

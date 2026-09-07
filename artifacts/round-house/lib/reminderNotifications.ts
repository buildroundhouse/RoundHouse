import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { Reminder } from "./reminders";
import {
  emitForegroundPush,
  REMINDER_NOTIFICATION_CATEGORY,
} from "./pushNotifications";

async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    let perms = await Notifications.getPermissionsAsync();
    if (perms.status !== "granted") {
      perms = await Notifications.requestPermissionsAsync();
    }
    return perms.status === "granted";
  } catch {
    return false;
  }
}

// Foreground in-app banner timers, keyed by reminder id. We schedule a JS
// timer for each upcoming reminder so that when it fires while the app is
// open we can surface the same branded banner the rest of the push pipeline
// uses — the OS heads-up alert is suppressed in `pushNotifications.ts`.
type ReminderKey = number | string;
const foregroundTimers = new Map<ReminderKey, ReturnType<typeof setTimeout>>();
// Cap how far ahead we'll keep an in-process timer; long-running timers are
// unreliable when the JS runtime is paused.
const MAX_LEAD_MS = 12 * 60 * 60 * 1000;

function fireForegroundBanner(reminder: Reminder): void {
  emitForegroundPush({
    title: reminder.title || "Reminder",
    body: reminder.note || "Your reminder is due.",
    link: { type: "reminder", reminderId: String(reminder.id) },
  });
}

export function scheduleForegroundReminderBanner(reminder: Reminder): void {
  if (Platform.OS === "web") return;
  cancelForegroundReminderBanner(reminder.id);
  if (reminder.done) return;
  const due = new Date(reminder.dueAt).getTime();
  if (isNaN(due)) return;
  const delay = due - Date.now();
  if (delay <= 0 || delay > MAX_LEAD_MS) return;
  const handle = setTimeout(() => {
    foregroundTimers.delete(reminder.id);
    fireForegroundBanner(reminder);
  }, delay);
  foregroundTimers.set(reminder.id, handle);
}

export function cancelForegroundReminderBanner(reminderId: ReminderKey): void {
  const h = foregroundTimers.get(reminderId);
  if (h !== undefined) {
    clearTimeout(h);
    foregroundTimers.delete(reminderId);
  }
}

export function clearAllForegroundReminderBanners(): void {
  for (const id of Array.from(foregroundTimers.keys())) {
    cancelForegroundReminderBanner(id);
  }
}

export async function scheduleReminderNotification(
  reminder: Reminder,
): Promise<string | null> {
  if (Platform.OS === "web") return null;
  const due = new Date(reminder.dueAt);
  if (isNaN(due.getTime())) return null;
  // expo-notifications won't schedule a date trigger in the past — skip silently.
  if (due.getTime() <= Date.now()) return null;
  // Schedule the in-app banner regardless of OS notification permission so
  // users still get a visible cue while the app is open even if they
  // declined system notifications.
  scheduleForegroundReminderBanner(reminder);
  const granted = await ensurePermission();
  if (!granted) return null;
  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: reminder.title || "Reminder",
        body: reminder.note || "Your reminder is due.",
        sound: true,
        data: { type: "reminder", reminderId: String(reminder.id) },
        // Surfaces "Snooze 1h" / "Done" action buttons on the OS
        // notification (task #435) — handled by the same registered
        // category as remote pushes from the API server.
        categoryIdentifier: REMINDER_NOTIFICATION_CATEGORY,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: due,
      },
    });
  } catch {
    return null;
  }
}

export async function cancelReminderNotification(
  reminderId: ReminderKey,
  notificationId?: string | null,
): Promise<void> {
  if (Platform.OS === "web") return;
  cancelForegroundReminderBanner(reminderId);
  if (!notificationId) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {
    // already fired or removed — ignore
  }
}

// OS-only cancel — used when we need to drop a stale OS notification id
// without touching the in-app foreground banner timer (e.g. the schedule
// generation bumped between scheduleNotificationAsync resolving and our
// callback running, so the OS id is orphaned but the reminder's current
// timer may belong to a newer schedule call).
export async function cancelOsScheduledNotification(
  notificationId: string | null | undefined,
): Promise<void> {
  if (!notificationId || Platform.OS === "web") return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {
    // already fired or removed — ignore
  }
}

// Returns the set of OS notification ids that are currently still pending
// delivery. Anything we previously stored on a reminder that is NOT in this
// set has either fired or been cancelled at the OS level — meaning the
// stored id is now dead and should be cleared from the reminder so future
// snooze/done/delete don't try to cancel a ghost.
export async function getScheduledReminderNotificationIds(): Promise<
  Set<string>
> {
  if (Platform.OS === "web") return new Set();
  try {
    const list = await Notifications.getAllScheduledNotificationsAsync();
    const ids = new Set<string>();
    for (const n of list) {
      if (n && typeof n.identifier === "string" && n.identifier) {
        ids.add(n.identifier);
      }
    }
    return ids;
  } catch {
    return new Set();
  }
}

import type { Reminder } from "@workspace/api-client-react";

export type { Reminder };

export function reminderDueIso(r: Reminder): string {
  return r.dueAt;
}

export function snoozeIso(fromIso: string, hours: number): string {
  const base = new Date(fromIso);
  const t = isNaN(base.getTime()) ? Date.now() : base.getTime();
  return new Date(t + hours * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Auto-cleanup of fired reminder notifications (task #425).
//
// The reminders screen tracks the OS-side scheduled notification id for each
// reminder in an in-memory `Map<number, string>` keyed by reminder id. Once
// the OS delivers (or the user taps) a notification, that stored id is dead
// — it doesn't refer to anything pending anymore — and a future
// snooze/done/delete would otherwise try to cancel a ghost. These two
// helpers drop those stale entries without ever mutating the reminder
// objects themselves (the reminder is NOT auto-marked done).
//
// Both helpers mutate the supplied map in place and return the same map
// reference, so a caller can pass the module-scoped tracking map directly
// without losing identity (callers compare by reference in places).
// ---------------------------------------------------------------------------

// Drop every tracked entry whose stored OS notification id is not in the
// `stillPending` set returned by `getScheduledReminderNotificationIds()`.
// Entries whose OS id IS still pending are left untouched.
export function clearFiredNotificationIds(
  tracked: Map<number, string>,
  stillPending: Set<string>,
): Map<number, string> {
  for (const [reminderId, osId] of Array.from(tracked.entries())) {
    if (!stillPending.has(osId)) {
      tracked.delete(reminderId);
    }
  }
  return tracked;
}

// Drop the single tracked entry for `reminderId`, if any. Used by the
// expo-notifications received/response listeners when the OS hands us the
// reminder id directly so we don't have to wait for the next reconcile pass.
// No-op when nothing is tracked for that reminder.
export function clearNotificationIdFor(
  tracked: Map<number, string>,
  reminderId: number,
): Map<number, string> {
  tracked.delete(reminderId);
  return tracked;
}

// Drop every tracked entry whose reminder id is not present in
// `presentReminderIds`. Used as a safety pass when the latest reminders
// payload no longer contains a reminder we were tracking (deleted on
// another device, expired server-side, etc.) so the in-memory id map
// cannot grow unbounded across a long session. The reminder objects
// themselves are not modified (this helper only sees ids).
export function clearMissingReminderIds(
  tracked: Map<number, string>,
  presentReminderIds: Set<number>,
): Map<number, string> {
  for (const reminderId of Array.from(tracked.keys())) {
    if (!presentReminderIds.has(reminderId)) {
      tracked.delete(reminderId);
    }
  }
  return tracked;
}

export function describeDue(dueIso: string, now: Date): string {
  const due = new Date(dueIso);
  const diffMs = due.getTime() - now.getTime();
  const absMin = Math.round(Math.abs(diffMs) / 60000);
  const overdue = diffMs < 0;

  if (absMin < 1) return overdue ? "Just now" : "In a moment";
  if (absMin < 60) {
    return overdue ? `${absMin}m overdue` : `In ${absMin}m`;
  }
  const absHr = Math.round(absMin / 60);
  if (absHr < 24) {
    return overdue ? `${absHr}h overdue` : `In ${absHr}h`;
  }
  const absDay = Math.round(absHr / 24);
  return overdue ? `${absDay}d overdue` : `In ${absDay}d`;
}

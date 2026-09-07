import { and, eq, inArray } from "drizzle-orm";
import { db, userNotificationPrefsTable } from "@workspace/db";

export const NOTIFICATION_PREF_TYPES = [
  "assignment",
  "unassignment",
  "reassignment",
  "log",
  "rating",
  "work_order_assigned",
  "work_order_requested",
  "work_order_complete",
  "work_order_verified",
  "work_order_approved",
  "work_order_rejected",
  "work_order_comment",
  "message",
  "invite",
  "due_date_changed",
  "due_date_request",
  "due_date_request_accepted",
  "due_date_request_declined",
  "standard_overdue",
  "app_invite_signup",
  "question_asked",
  "request_received",
  "question_answered",
] as const;

export type NotificationPrefType = (typeof NOTIFICATION_PREF_TYPES)[number];

export function isManagedPrefType(type: string): type is NotificationPrefType {
  return (NOTIFICATION_PREF_TYPES as readonly string[]).includes(type);
}

/**
 * Filter recipient clerk IDs by their per-user notification preference for the
 * given type. Returns the subset that has not opted out. Defaults to enabled
 * when no row exists, so brand-new users get every notification by default.
 */
export async function filterRecipientsByPref(
  clerkIds: string[],
  type: string,
): Promise<string[]> {
  if (clerkIds.length === 0) return [];
  if (!isManagedPrefType(type)) return clerkIds.slice();
  const rows = await db
    .select({
      userClerkId: userNotificationPrefsTable.userClerkId,
      enabled: userNotificationPrefsTable.enabled,
    })
    .from(userNotificationPrefsTable)
    .where(
      and(
        eq(userNotificationPrefsTable.notificationType, type),
        inArray(userNotificationPrefsTable.userClerkId, clerkIds),
      ),
    );
  const disabled = new Set(rows.filter((r) => !r.enabled).map((r) => r.userClerkId));
  return clerkIds.filter((id) => !disabled.has(id));
}

/**
 * Returns true when the single recipient should receive a notification of
 * the given type. Defaults to true when no preference row exists.
 */
export async function shouldNotify(clerkId: string, type: string): Promise<boolean> {
  const allowed = await filterRecipientsByPref([clerkId], type);
  return allowed.length > 0;
}

export async function listMyPrefs(clerkId: string): Promise<Record<NotificationPrefType, boolean>> {
  const rows = await db
    .select({
      notificationType: userNotificationPrefsTable.notificationType,
      enabled: userNotificationPrefsTable.enabled,
    })
    .from(userNotificationPrefsTable)
    .where(eq(userNotificationPrefsTable.userClerkId, clerkId));
  const byType = new Map(rows.map((r) => [r.notificationType, r.enabled]));
  const result = {} as Record<NotificationPrefType, boolean>;
  for (const t of NOTIFICATION_PREF_TYPES) {
    result[t] = byType.has(t) ? Boolean(byType.get(t)) : true;
  }
  return result;
}

export async function setMyPref(
  clerkId: string,
  type: NotificationPrefType,
  enabled: boolean,
): Promise<void> {
  await db
    .insert(userNotificationPrefsTable)
    .values({ userClerkId: clerkId, notificationType: type, enabled })
    .onConflictDoUpdate({
      target: [userNotificationPrefsTable.userClerkId, userNotificationPrefsTable.notificationType],
      set: { enabled, updatedAt: new Date() },
    });
}

export async function setMyPrefsBulk(
  clerkId: string,
  types: NotificationPrefType[],
  enabled: boolean,
): Promise<void> {
  if (types.length === 0) return;
  const unique = Array.from(new Set(types));
  const now = new Date();
  await db
    .insert(userNotificationPrefsTable)
    .values(
      unique.map((type) => ({
        userClerkId: clerkId,
        notificationType: type,
        enabled,
      })),
    )
    .onConflictDoUpdate({
      target: [userNotificationPrefsTable.userClerkId, userNotificationPrefsTable.notificationType],
      set: { enabled, updatedAt: now },
    });
}

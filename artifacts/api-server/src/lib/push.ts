import { and, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logger } from "./logger";

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

export const STALE_PUSH_TOKEN_DAYS = readPositiveNumberEnv(
  "STALE_PUSH_TOKEN_DAYS",
  60,
);

export const STALE_PUSH_TOKEN_SWEEP_HOURS = readPositiveNumberEnv(
  "STALE_PUSH_TOKEN_SWEEP_HOURS",
  24,
);

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const RECEIPTS_DELAY_MS = 15_000;

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /**
   * Identifier of a notification category registered on the device with
   * `Notifications.setNotificationCategoryAsync`. When set, the OS renders
   * that category's action buttons (e.g. "Snooze 1h" / "Done" for
   * reminders) directly on the lock-screen / notification-center push.
   */
  categoryId?: string;
}

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoReceipt {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

function isExpoPushToken(token: string | null | undefined): token is string {
  if (!token) return false;
  return token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[");
}

async function clearTokens(tokens: string[]): Promise<void> {
  const unique = [...new Set(tokens)].filter(Boolean);
  if (unique.length === 0) return;
  try {
    await db
      .update(usersTable)
      .set({ expoPushToken: null })
      .where(inArray(usersTable.expoPushToken, unique));
    logger.info({ count: unique.length }, "Cleared stale Expo push tokens");
  } catch (err) {
    logger.error({ err, count: unique.length }, "Failed to clear stale Expo push tokens");
  }
}

async function fetchReceipts(ticketIds: string[], tokenByTicket: Map<string, string>): Promise<void> {
  if (ticketIds.length === 0) return;
  try {
    const res = await fetch(EXPO_RECEIPTS_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids: ticketIds }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn({ status: res.status, text }, "Expo receipts request failed");
      return;
    }
    const json = (await res.json().catch(() => null)) as
      | { data?: Record<string, ExpoReceipt>; errors?: unknown }
      | null;
    if (!json?.data) return;

    const stale: string[] = [];
    for (const [ticketId, receipt] of Object.entries(json.data)) {
      if (receipt.status !== "error") continue;
      const errorCode = receipt.details?.error;
      const token = tokenByTicket.get(ticketId);
      logger.warn(
        { ticketId, errorCode, message: receipt.message, token },
        "Expo push receipt reported error",
      );
      if (errorCode === "DeviceNotRegistered" && token) {
        stale.push(token);
      }
    }
    if (stale.length > 0) {
      await clearTokens(stale);
    }
  } catch (err) {
    logger.error({ err }, "Failed to fetch Expo push receipts");
  }
}

export async function sendPushToUsers(userClerkIds: string[], payload: PushPayload): Promise<void> {
  const ids = [...new Set(userClerkIds)].filter(Boolean);
  if (ids.length === 0) return;

  let users: { clerkId: string; expoPushToken: string | null }[] = [];
  try {
    users = await db
      .select({ clerkId: usersTable.clerkId, expoPushToken: usersTable.expoPushToken })
      .from(usersTable)
      .where(inArray(usersTable.clerkId, ids));
  } catch (err) {
    logger.error({ err }, "Failed to load users for push");
    return;
  }

  const tokens = users.map((u) => u.expoPushToken).filter(isExpoPushToken);
  if (tokens.length === 0) return;

  const messages = tokens.map((to) => ({
    to,
    sound: "default" as const,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    ...(payload.categoryId ? { categoryId: payload.categoryId } : {}),
  }));

  let tickets: ExpoTicket[] = [];
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn({ status: res.status, text }, "Expo push request failed");
      return;
    }
    const json = (await res.json().catch(() => null)) as
      | { data?: ExpoTicket[]; errors?: unknown }
      | null;
    if (json?.errors) {
      logger.warn({ errors: json.errors }, "Expo push response contained top-level errors");
    }
    tickets = Array.isArray(json?.data) ? json!.data! : [];
  } catch (err) {
    logger.error({ err }, "Failed to send Expo push");
    return;
  }

  if (tickets.length === 0) return;

  const stale: string[] = [];
  const ticketIdToToken = new Map<string, string>();

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    const token = tokens[i];
    if (!ticket || !token) continue;

    if (ticket.status === "error") {
      const errorCode = ticket.details?.error;
      logger.warn(
        { errorCode, message: ticket.message, token },
        "Expo push ticket reported error",
      );
      if (errorCode === "DeviceNotRegistered") {
        stale.push(token);
      }
    } else if (ticket.id) {
      ticketIdToToken.set(ticket.id, token);
    }
  }

  if (stale.length > 0) {
    await clearTokens(stale);
  }

  if (ticketIdToToken.size > 0) {
    const ids = [...ticketIdToToken.keys()];
    setTimeout(() => {
      void fetchReceipts(ids, ticketIdToToken);
    }, RECEIPTS_DELAY_MS).unref?.();
  }
}

export function sendPushToUser(userClerkId: string, payload: PushPayload): Promise<void> {
  return sendPushToUsers([userClerkId], payload);
}

/**
 * Clear push tokens that haven't been refreshed in `olderThanDays`.
 * Tokens this stale are likely orphaned (uninstalled app or revoked
 * permission). Affected users will see "Push not registered" until they
 * re-register from the profile.
 */
export async function clearStalePushTokens(
  olderThanDays: number = STALE_PUSH_TOKEN_DAYS,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  try {
    const result = await db
      .update(usersTable)
      .set({ expoPushToken: null, pushTokenUpdatedAt: null })
      .where(
        and(
          isNotNull(usersTable.expoPushToken),
          or(
            isNull(usersTable.pushTokenUpdatedAt),
            lt(usersTable.pushTokenUpdatedAt, cutoff),
          ),
        ),
      )
      .returning({ clerkId: usersTable.clerkId });
    if (result.length > 0) {
      logger.info(
        { count: result.length, olderThanDays, cutoff },
        "Cleared stale push tokens by inactivity",
      );
    }
    return result.length;
  } catch (err) {
    logger.error({ err, olderThanDays }, "Failed to clear stale push tokens by inactivity");
    return 0;
  }
}


import { type Response } from "express";
import type { AuthRequest } from "../middlewares/requireAuth";

/**
 * The closed set of paid capabilities (#309). Today these all map to the
 * single "expanded" capability bundle on a skin, but keeping them named
 * lets the UI explain *which* capability a user just hit, and leaves room
 * for a future tier split without touching every call site.
 *
 * Free actions (connecting, messaging, viewing properties they
 * participate on, commenting, basic photos/notes) are *not* listed and
 * never call into this module.
 */
export const PAID_CAPABILITIES = [
  // Creating/structuring records on properties: work orders, recurring
  // tasks, structured logs, property standards, property specs.
  "create_property_records",
  // Operating with expanded participation permissions and tools on
  // properties — for now: adding/removing members.
  "expanded_participation",
  // AI concierge on the timeline (chat, suggestions, voice input).
  "ai_concierge",
] as const;
export type PaidCapability = (typeof PAID_CAPABILITIES)[number];

/**
 * Single source of truth that answers "is paid capability X available
 * for skin Y?". Reads `outward_accounts.capability_state` and nothing
 * else — the lapse webhook is what keeps that column honest.
 */
export async function isCapabilityAvailable(
  _outwardAccountId: number | null,
  _capability: PaidCapability,
): Promise<boolean> {
  // Paywall disabled: every account has full capabilities. The
  // outward_accounts.capability_state column is left in place so the
  // billing UI and webhooks keep working, but no feature is gated on it.
  return true;
}

export interface CapabilityRequiredPayload {
  error: string;
  capability: PaidCapability;
  outwardAccountId: number | null;
  /**
   * Mobile deep-link the client should open to take the user straight to
   * the billing row for this skin. The mobile app routes this to the
   * private-account billing screen with the skin pre-selected.
   */
  deepLink: string;
}

/**
 * One-line gate at the top of any handler that performs a paid action.
 * Returns true when the active outward account has the capability;
 * otherwise writes a 402 response and returns false so the caller can
 * `return` immediately.
 *
 * The 402 body is structured for the mobile sheet to render a clear
 * "this capability requires payment on this skin" message and offer the
 * deep-link.
 */
export async function requirePaidCapability(
  req: AuthRequest,
  res: Response,
  capability: PaidCapability,
): Promise<boolean> {
  const outwardAccountId = req.activeOutwardAccountId ?? null;
  const ok = await isCapabilityAvailable(outwardAccountId, capability);
  if (ok) return true;
  const payload: CapabilityRequiredPayload = {
    error:
      "This capability requires expanded capabilities on this account. " +
      "Open billing on your private account to enable it for this skin.",
    capability,
    outwardAccountId,
    deepLink: outwardAccountId
      ? `roundhouse://account/billing?accountId=${outwardAccountId}`
      : "roundhouse://account/billing",
  };
  res.status(402).json(payload);
  return false;
}

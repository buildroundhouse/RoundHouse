import { ApiError } from "@workspace/api-client-react";

export type PaidCapability =
  | "create_property_records"
  | "expanded_participation"
  | "ai_concierge";

export interface PaywallPayload {
  capability: PaidCapability;
  outwardAccountId: number | null;
  deepLink: string;
  error?: string;
}

type Listener = (payload: PaywallPayload) => void;

const listeners = new Set<Listener>();

export function subscribePaywall(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function showPaywall(payload: PaywallPayload): void {
  for (const l of listeners) {
    try {
      l(payload);
    } catch {
      // listener errors must not break the emitter
    }
  }
}

function isPaidCapability(value: unknown): value is PaidCapability {
  return (
    value === "create_property_records" ||
    value === "expanded_participation" ||
    value === "ai_concierge"
  );
}

/**
 * If `err` is a 402 from the API with a structured capability payload,
 * surface the global paywall sheet and return true so the caller knows
 * the error was handled (and shouldn't be re-shown as a generic toast).
 */
export function maybeShowPaywallFromError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status !== 402) return false;
  const data = err.data;
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  if (!isPaidCapability(obj.capability)) return false;

  const rawAcct = obj.outwardAccountId;
  const outwardAccountId =
    typeof rawAcct === "number" && Number.isFinite(rawAcct)
      ? rawAcct
      : typeof rawAcct === "string" && rawAcct.trim() !== "" && Number.isFinite(Number(rawAcct))
        ? Number(rawAcct)
        : null;

  const deepLink =
    typeof obj.deepLink === "string" && obj.deepLink.length > 0
      ? obj.deepLink
      : outwardAccountId != null
        ? `roundhouse://account/billing?accountId=${outwardAccountId}`
        : "roundhouse://account/billing";

  showPaywall({
    capability: obj.capability,
    outwardAccountId,
    deepLink,
    error: typeof obj.error === "string" ? obj.error : undefined,
  });
  return true;
}

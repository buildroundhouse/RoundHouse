/**
 * Pure UX helpers for the global paid-action upsell sheet.
 *
 * The bottom sheet itself (`components/PaywallSheet.tsx`) imports the
 * COPY map and `billingHrefFromDeepLink` from here so that both pieces
 * of behaviour can be exercised by the round-house lib test runner
 * without standing up a React Native renderer.
 *
 * If you change capability copy or how the billing deep link is parsed,
 * update this file and `paywallSheet.test.ts` together.
 */
import type { Feather } from "@expo/vector-icons";
import type { PaidCapability } from "./paywallSheet";

export interface CapabilityCopy {
  title: string;
  body: string;
  bullets: string[];
  icon: keyof typeof Feather.glyphMap;
}

export const PAYWALL_COPY: Record<PaidCapability, CapabilityCopy> = {
  create_property_records: {
    title: "Records need expanded capabilities",
    body: "This account is on the free baseline. Turn on expanded capabilities to start creating records on properties.",
    bullets: [
      "Work orders and recurring tasks",
      "Property standards and specs",
      "Structured logs",
    ],
    icon: "file-text",
  },
  expanded_participation: {
    title: "Adding members needs expanded capabilities",
    body: "Bringing teammates onto a property is a paid feature. Turn on expanded capabilities to add or remove members.",
    bullets: [
      "Invite teammates to a property",
      "Adjust who participates over time",
      "Cancel any time — your data stays put",
    ],
    icon: "users",
  },
  ai_concierge: {
    title: "Concierge is part of expanded capabilities",
    body: "Your AI concierge drafts notes, sets reminders, and keeps you on track straight from the timeline. Turn on expanded capabilities to start chatting.",
    bullets: [
      "Streaming chat grounded in your jobs and clients",
      "Voice-to-text and one-tap proposed actions",
      "Proactive nudges and short pep talks",
    ],
    icon: "message-circle",
  },
};

/**
 * Convert the API's `roundhouse://account/billing?accountId=N` deep link
 * into an in-app expo-router path. Falls back to the parsed accountId or
 * the bare billing screen when parsing fails.
 *
 * The billing screen reads `?accountId=` from its search params and
 * highlights (and reorders to top) the matching outward-account row.
 */
export function billingHrefFromDeepLink(
  deepLink: string,
  outwardAccountId: number | null,
): string {
  const idFromLink = (() => {
    const m = /accountId=([^&]+)/.exec(deepLink);
    if (!m) return null;
    const n = Number(decodeURIComponent(m[1]));
    return Number.isFinite(n) ? n : null;
  })();
  const id = idFromLink ?? outwardAccountId;
  return id != null ? `/account/billing?accountId=${id}` : "/account/billing";
}

import type { PaywallPayload } from "./paywallSheet";

export interface PaywallActionDeps {
  /** Mirrors `setPayload(null)` inside the React component. */
  setPayload: (next: PaywallPayload | null) => void;
  /** Mirrors `router.push(href)` from expo-router. */
  push: (href: string) => void;
}

export interface PaywallActions {
  onEnable: () => void;
  onClose: () => void;
}

/**
 * Pure factory mirroring the onEnable/onClose handlers wired up inside
 * `components/PaywallSheet.tsx`. Extracted so the tap behaviour can be
 * exercised end-to-end (Enable navigates, Not now / close does not)
 * without standing up a React Native renderer.
 *
 * If you change either handler in PaywallSheet.tsx, change it here and
 * update `paywallSheet.test.ts` in lockstep.
 */
export function buildPaywallActions(
  payload: PaywallPayload | null,
  deps: PaywallActionDeps,
): PaywallActions {
  return {
    onEnable: () => {
      if (!payload) return;
      const href = billingHrefFromDeepLink(
        payload.deepLink,
        payload.outwardAccountId,
      );
      deps.setPayload(null);
      deps.push(href);
    },
    onClose: () => {
      deps.setPayload(null);
    },
  };
}

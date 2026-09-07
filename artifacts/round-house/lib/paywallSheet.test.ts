/**
 * End-to-end coverage for the global paid-action upsell sheet (task #342).
 *
 * Task #335 wired a single bottom sheet (`components/PaywallSheet.tsx`) to
 * react to any structured 402 from the API:
 *
 *     { capability, outwardAccountId, deepLink }
 *
 * The sheet doesn't pick its own capability — it listens on the
 * `subscribePaywall` channel that `maybeShowPaywallFromError` publishes
 * to from the global query/mutation `onError` hooks in `app/_layout.tsx`.
 * Tapping "Enable" pushes the user to `/account/billing?accountId=…`,
 * where `app/account/billing.tsx` reorders and highlights the matching
 * outward-account row.
 *
 * These tests pin that contract end-to-end by simulating each link in
 * the chain: API throws 402 → publisher fires → sheet copy + Enable
 * destination match what the user expects → dismissal does nothing.
 *
 * Round-house has no test runner of its own — api-server's vitest picks
 * this file up via its `vitest.config.ts` `include` glob.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MutationCache,
  QueryClient,
} from "@tanstack/react-query";
import { ApiError } from "@workspace/api-client-react";
import {
  maybeShowPaywallFromError,
  subscribePaywall,
  type PaywallPayload,
} from "./paywallSheet";
import {
  PAYWALL_COPY,
  billingHrefFromDeepLink,
  buildPaywallActions,
} from "./paywallSheetCopy";
import { isHighlightedRow, orderHighlightedFirst } from "./billingRows";

function make402(payload: Record<string, unknown>): ApiError {
  // Mirrors how the orval-generated client throws on a 402 from
  // POST /api/work-orders or POST /api/properties/:id/members.
  const response = new Response(JSON.stringify(payload), {
    status: 402,
    statusText: "Payment Required",
    headers: { "content-type": "application/json" },
  });
  return new ApiError(response, payload, {
    method: "POST",
    url: "/api/work-orders",
  });
}

/**
 * Subscribes for the duration of one test and returns the captured
 * payloads plus the unsubscribe handle. The PaywallSheet component does
 * essentially the same thing inside its `useEffect`.
 */
function captureNextPaywall(): {
  events: PaywallPayload[];
  unsub: () => void;
} {
  const events: PaywallPayload[] = [];
  const unsub = subscribePaywall((p) => {
    events.push(p);
  });
  return { events, unsub };
}

describe("Paywall sheet — task #342: free user trying to create a work order", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("opens the 'Records need expanded capabilities' sheet", () => {
    const { events, unsub } = captureNextPaywall();
    cleanup = unsub;

    const handled = maybeShowPaywallFromError(
      make402({
        capability: "create_property_records",
        outwardAccountId: 42,
        deepLink: "roundhouse://account/billing?accountId=42",
        error: "This account is on the free baseline.",
      }),
    );

    expect(handled).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].capability).toBe("create_property_records");
    expect(events[0].outwardAccountId).toBe(42);

    const copy = PAYWALL_COPY[events[0].capability];
    expect(copy.title).toBe("Records need expanded capabilities");
    expect(copy.body).toContain("creating records");
    expect(copy.bullets).toContain("Work orders and recurring tasks");
  });

  it("Enable navigates to /account/billing with the right outward-account row highlighted", () => {
    const { events, unsub } = captureNextPaywall();
    cleanup = unsub;

    maybeShowPaywallFromError(
      make402({
        capability: "create_property_records",
        outwardAccountId: 42,
        deepLink: "roundhouse://account/billing?accountId=42",
      }),
    );

    const href = billingHrefFromDeepLink(
      events[0].deepLink,
      events[0].outwardAccountId,
    );
    expect(href).toBe("/account/billing?accountId=42");
  });
});

describe("Paywall sheet — task #342: free user trying to add a property member", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("opens the 'Adding members needs expanded capabilities' sheet", () => {
    const { events, unsub } = captureNextPaywall();
    cleanup = unsub;

    const handled = maybeShowPaywallFromError(
      make402({
        capability: "expanded_participation",
        outwardAccountId: 7,
        deepLink: "roundhouse://account/billing?accountId=7",
      }),
    );

    expect(handled).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].capability).toBe("expanded_participation");
    expect(events[0].outwardAccountId).toBe(7);

    const copy = PAYWALL_COPY[events[0].capability];
    expect(copy.title).toBe("Adding members needs expanded capabilities");
    expect(copy.body).toContain("teammates");
    expect(copy.bullets).toContain("Invite teammates to a property");
  });

  it("Enable routes to /account/billing for the property's outward account", () => {
    const href = billingHrefFromDeepLink(
      "roundhouse://account/billing?accountId=7",
      7,
    );
    expect(href).toBe("/account/billing?accountId=7");
  });
});

describe("Paywall sheet — task #342: deep-link parsing edge cases", () => {
  it("prefers the accountId encoded in the deep link over the structured field", () => {
    // Server is the source of truth for the URL — if for some reason the
    // two disagree we follow the link (mirrors what would happen on iOS
    // when the OS hands the URL straight to the app).
    expect(
      billingHrefFromDeepLink(
        "roundhouse://account/billing?accountId=99",
        42,
      ),
    ).toBe("/account/billing?accountId=99");
  });

  it("falls back to the structured outwardAccountId when the deep link has no id", () => {
    expect(
      billingHrefFromDeepLink("roundhouse://account/billing", 42),
    ).toBe("/account/billing?accountId=42");
  });

  it("falls back to the bare billing screen when both inputs are unusable", () => {
    expect(
      billingHrefFromDeepLink("roundhouse://account/billing", null),
    ).toBe("/account/billing");
    // Non-numeric id in the query string is treated as missing.
    expect(
      billingHrefFromDeepLink(
        "roundhouse://account/billing?accountId=not-a-number",
        null,
      ),
    ).toBe("/account/billing");
  });

  it("decodes percent-encoded ids before parsing", () => {
    expect(
      billingHrefFromDeepLink(
        "roundhouse://account/billing?accountId=%37&foo=bar",
        null,
      ),
    ).toBe("/account/billing?accountId=7");
  });
});

describe("Paywall sheet — task #342: tapping Enable / Not now / close (handler interactions)", () => {
  // These tests drive the exact handlers wired into PaywallSheet.tsx
  // via `buildPaywallActions`. They simulate the user's tap on the
  // sheet's primary and secondary buttons end-to-end: published payload
  // -> tap -> assert navigation + sheet dismissal.
  it("tapping Enable navigates to /account/billing with accountId and clears the sheet", () => {
    const setPayload = vi.fn();
    const push = vi.fn();
    const payload: PaywallPayload = {
      capability: "create_property_records",
      outwardAccountId: 42,
      deepLink: "roundhouse://account/billing?accountId=42",
    };
    const { onEnable } = buildPaywallActions(payload, { setPayload, push });

    onEnable();

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/account/billing?accountId=42");
    // Sheet must dismiss before navigation completes so it doesn't
    // re-show after the user comes back.
    expect(setPayload).toHaveBeenCalledTimes(1);
    expect(setPayload).toHaveBeenCalledWith(null);
  });

  it("Enable for the add-member capability navigates to the member's outward account row", () => {
    const setPayload = vi.fn();
    const push = vi.fn();
    const payload: PaywallPayload = {
      capability: "expanded_participation",
      outwardAccountId: 7,
      deepLink: "roundhouse://account/billing?accountId=7",
    };
    const { onEnable } = buildPaywallActions(payload, { setPayload, push });

    onEnable();

    expect(push).toHaveBeenCalledWith("/account/billing?accountId=7");
  });

  it("tapping 'Not now' / close clears the sheet and never navigates", () => {
    const setPayload = vi.fn();
    const push = vi.fn();
    const payload: PaywallPayload = {
      capability: "create_property_records",
      outwardAccountId: 42,
      deepLink: "roundhouse://account/billing?accountId=42",
    };
    const { onClose } = buildPaywallActions(payload, { setPayload, push });

    onClose();

    expect(setPayload).toHaveBeenCalledTimes(1);
    expect(setPayload).toHaveBeenCalledWith(null);
    expect(push).not.toHaveBeenCalled();
  });

  it("tapping Enable while no payload is mounted is a no-op (defensive)", () => {
    // If the user double-taps and the second tap arrives after the
    // sheet has already cleared, we must not navigate to a stale URL.
    const setPayload = vi.fn();
    const push = vi.fn();
    const { onEnable } = buildPaywallActions(null, { setPayload, push });
    onEnable();
    expect(push).not.toHaveBeenCalled();
    expect(setPayload).not.toHaveBeenCalled();
  });
});

describe("Paywall sheet — task #342: global error hook surfaces sheet from a real mutation failure", () => {
  // Mirrors the QueryClient setup in artifacts/round-house/app/_layout.tsx.
  // We run a real mutation through a real QueryClient and assert that a
  // 402 thrown by the API ends up published on the paywall channel,
  // which is exactly the wiring the bottom sheet listens on.
  it("a mutation that throws a structured 402 publishes a paywall payload", async () => {
    const events: PaywallPayload[] = [];
    const unsub = subscribePaywall((p) => events.push(p));

    const client = new QueryClient({
      mutationCache: new MutationCache({
        onError: (err) => {
          maybeShowPaywallFromError(err);
        },
      }),
    });

    try {
      // Stand-in for `useCreateWorkOrder` calling the API and getting a
      // 402 back. The mutationFn rejects with the same ApiError shape
      // the orval client throws.
      const mutation = client.getMutationCache().build(client, {
        mutationFn: async () => {
          throw make402({
            capability: "create_property_records",
            outwardAccountId: 42,
            deepLink: "roundhouse://account/billing?accountId=42",
            error: "Free baseline.",
          });
        },
      });
      await mutation.execute({}).catch(() => {
        // Swallow — onError is the assertion surface.
      });

      expect(events).toHaveLength(1);
      expect(events[0].capability).toBe("create_property_records");
      expect(events[0].outwardAccountId).toBe(42);
      expect(
        billingHrefFromDeepLink(events[0].deepLink, events[0].outwardAccountId),
      ).toBe("/account/billing?accountId=42");
    } finally {
      unsub();
      client.clear();
    }
  });

  it("a mutation that throws a 500 does NOT publish a paywall payload", async () => {
    const events: PaywallPayload[] = [];
    const unsub = subscribePaywall((p) => events.push(p));

    const client = new QueryClient({
      mutationCache: new MutationCache({
        onError: (err) => {
          maybeShowPaywallFromError(err);
        },
      }),
    });

    try {
      const mutation = client.getMutationCache().build(client, {
        mutationFn: async () => {
          const response = new Response(JSON.stringify({ error: "boom" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
          throw new ApiError(response, { error: "boom" }, {
            method: "POST",
            url: "/api/work-orders",
          });
        },
      });
      await mutation.execute({}).catch(() => undefined);

      expect(events).toHaveLength(0);
    } finally {
      unsub();
      client.clear();
    }
  });
});

describe("Paywall sheet — task #342: billing screen highlights the right outward-account row", () => {
  // The sheet's Enable handler ships the user to
  // /account/billing?accountId=N. The billing screen reorders that
  // row to the top and paints a primary-coloured border around it.
  // These tests pin both behaviours via the extracted helper that
  // billing.tsx delegates to.
  type Row = { outwardAccount: { id: number }; label: string };
  const rows: Row[] = [
    { outwardAccount: { id: 1 }, label: "Tradehouse" },
    { outwardAccount: { id: 7 }, label: "Side hustle" },
    { outwardAccount: { id: 42 }, label: "Main rentals" },
  ];

  it("moves the highlighted outward-account row to the top while preserving the others' order", () => {
    const reordered = orderHighlightedFirst(rows, 42);
    expect(reordered.map((r) => r.outwardAccount.id)).toEqual([42, 1, 7]);
  });

  it("flags only the highlighted row via isHighlightedRow", () => {
    expect(isHighlightedRow(rows[2], 42)).toBe(true);
    expect(isHighlightedRow(rows[0], 42)).toBe(false);
    expect(isHighlightedRow(rows[1], 42)).toBe(false);
  });

  it("returns the rows unchanged when no accountId is supplied", () => {
    const reordered = orderHighlightedFirst(rows, null);
    expect(reordered.map((r) => r.outwardAccount.id)).toEqual([1, 7, 42]);
    expect(rows.every((r) => !isHighlightedRow(r, null))).toBe(true);
  });

  it("returns the rows unchanged (and never throws) when the highlighted id is not in the list", () => {
    const reordered = orderHighlightedFirst(rows, 999);
    expect(reordered.map((r) => r.outwardAccount.id)).toEqual([1, 7, 42]);
  });

  it("does not mutate the input array", () => {
    const before = rows.map((r) => r.outwardAccount.id);
    orderHighlightedFirst(rows, 42);
    expect(rows.map((r) => r.outwardAccount.id)).toEqual(before);
  });
});

describe("Paywall sheet — task #342: non-paywall errors are ignored", () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("does not open the sheet for non-402 ApiErrors", () => {
    const { events, unsub } = captureNextPaywall();
    cleanup = unsub;
    const response = new Response(JSON.stringify({ error: "nope" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
    const err = new ApiError(response, { error: "nope" }, {
      method: "POST",
      url: "/api/work-orders",
    });
    expect(maybeShowPaywallFromError(err)).toBe(false);
    expect(events).toHaveLength(0);
  });

  it("does not open the sheet for a 402 that lacks a known capability", () => {
    const { events, unsub } = captureNextPaywall();
    cleanup = unsub;
    expect(
      maybeShowPaywallFromError(
        make402({
          // Missing `capability` entirely — server should never do this,
          // but we'd rather no-op than crash if it does.
          outwardAccountId: 1,
          deepLink: "roundhouse://account/billing?accountId=1",
        }),
      ),
    ).toBe(false);
    expect(
      maybeShowPaywallFromError(
        make402({
          capability: "definitely-not-real",
          outwardAccountId: 1,
          deepLink: "roundhouse://account/billing?accountId=1",
        }),
      ),
    ).toBe(false);
    expect(events).toHaveLength(0);
  });

  it("does not open the sheet for a non-ApiError thrown value", () => {
    const { events, unsub } = captureNextPaywall();
    cleanup = unsub;
    expect(maybeShowPaywallFromError(new Error("network down"))).toBe(false);
    expect(maybeShowPaywallFromError("string error")).toBe(false);
    expect(maybeShowPaywallFromError(null)).toBe(false);
    expect(events).toHaveLength(0);
  });
});

describe("Paywall sheet — task #342: subscriber lifecycle", () => {
  it("delivers payloads to multiple subscribers and respects unsubscribe", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribePaywall(a);
    const unsubB = subscribePaywall(b);

    maybeShowPaywallFromError(
      make402({
        capability: "create_property_records",
        outwardAccountId: 5,
        deepLink: "roundhouse://account/billing?accountId=5",
      }),
    );
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    unsubA();
    maybeShowPaywallFromError(
      make402({
        capability: "expanded_participation",
        outwardAccountId: 5,
        deepLink: "roundhouse://account/billing?accountId=5",
      }),
    );
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);

    unsubB();
    maybeShowPaywallFromError(
      make402({
        capability: "create_property_records",
        outwardAccountId: 5,
        deepLink: "roundhouse://account/billing?accountId=5",
      }),
    );
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("a throwing subscriber does not break delivery to other subscribers", () => {
    const angry = vi.fn(() => {
      throw new Error("boom");
    });
    const calm = vi.fn();
    const unsubAngry = subscribePaywall(angry);
    const unsubCalm = subscribePaywall(calm);
    try {
      maybeShowPaywallFromError(
        make402({
          capability: "create_property_records",
          outwardAccountId: 1,
          deepLink: "roundhouse://account/billing?accountId=1",
        }),
      );
      expect(angry).toHaveBeenCalledTimes(1);
      expect(calm).toHaveBeenCalledTimes(1);
    } finally {
      unsubAngry();
      unsubCalm();
    }
  });
});

/**
 * UX-side cap test (task #274).
 *
 * The Share Round House modal disables its submit button and surfaces a
 * limit message when the share-context endpoint reports
 * `dailyRemaining === 0`. The relevant logic lives in pure helpers next
 * to the modal so it can be exercised here without standing up a React
 * Native renderer. If you change the modal's gating, update those
 * helpers and these assertions in lockstep.
 *
 * Round-house has no test runner of its own — api-server's vitest picks
 * up this file via its `vitest.config.ts` `include` glob so the test
 * lives next to the helper without crossing TypeScript rootDir bounds.
 */
import { describe, it, expect } from "vitest";
import {
  buildShareInviteLimitHint,
  computeShareInviteCanSubmit,
  isShareInviteLimitReached,
} from "./shareInviteLimit";

describe("Share modal: daily-cap disabled state (e2e check)", () => {
  it("disables submit and shows the limit message when dailyRemaining is 0", () => {
    const dailyLimit = 20;
    const dailyRemaining = 0;

    expect(isShareInviteLimitReached(dailyRemaining)).toBe(true);

    const canSubmit = computeShareInviteCanSubmit({
      name: "Polly Recipient",
      phoneDigits: "5551234567",
      submitting: false,
      dailyRemaining,
    });
    expect(canSubmit).toBe(false);

    const hint = buildShareInviteLimitHint(dailyLimit, dailyRemaining);
    expect(hint).not.toBeNull();
    expect(hint).toContain("daily invite limit");
    expect(hint).toContain("20");
    expect(hint).toContain("24 hours");
    expect(hint).toContain("Try again tomorrow");
  });

  it("keeps submit enabled (and shows no banner) when there is plenty of headroom", () => {
    const canSubmit = computeShareInviteCanSubmit({
      name: "Polly",
      phoneDigits: "5551234567",
      submitting: false,
      dailyRemaining: 17,
    });
    expect(canSubmit).toBe(true);
    expect(buildShareInviteLimitHint(20, 17)).toBeNull();
  });

  it("shows a soft warning when only a few invites remain but still allows submit", () => {
    const remaining = 2;
    const hint = buildShareInviteLimitHint(20, remaining);
    expect(hint).toBe("2 invites left today (max 20 per 24 hours).");
    expect(
      computeShareInviteCanSubmit({
        name: "Polly",
        phoneDigits: "5551234567",
        submitting: false,
        dailyRemaining: remaining,
      }),
    ).toBe(true);
  });

  it("uses singular phrasing when exactly one invite remains", () => {
    expect(buildShareInviteLimitHint(20, 1)).toBe(
      "1 invite left today (max 20 per 24 hours).",
    );
  });

  it("treats unknown counters (null) as no limit info — submit not gated by cap", () => {
    expect(isShareInviteLimitReached(null)).toBe(false);
    expect(buildShareInviteLimitHint(null, null)).toBeNull();
    expect(
      computeShareInviteCanSubmit({
        name: "Polly",
        phoneDigits: "5551234567",
        submitting: false,
        dailyRemaining: null,
      }),
    ).toBe(true);
  });

  it("blocks submit while a request is in flight even if there's headroom", () => {
    expect(
      computeShareInviteCanSubmit({
        name: "Polly",
        phoneDigits: "5551234567",
        submitting: true,
        dailyRemaining: 5,
      }),
    ).toBe(false);
  });

  it("blocks submit when name or phone is missing regardless of cap state", () => {
    expect(
      computeShareInviteCanSubmit({
        name: "",
        phoneDigits: "5551234567",
        submitting: false,
        dailyRemaining: 5,
      }),
    ).toBe(false);
    expect(
      computeShareInviteCanSubmit({
        name: "Polly",
        phoneDigits: "555",
        submitting: false,
        dailyRemaining: 5,
      }),
    ).toBe(false);
  });
});

/**
 * #673 — Pins the per-skin "show last initial only" privacy contract on
 * the two mobile surfaces that bypassed the server-side shortening: the
 * user's own full-profile preview header (FullProfileModal) and the
 * chat thread header in `app/inbox/[otherUserId].tsx`.
 *
 * The selector under test mirrors the server's `formatOwnerNameForSkin`
 * helper so flipping `outward_accounts.last_initial_only` on a skin
 * updates the rendered profile and chat header copy uniformly with the
 * People search row, public profile header, inbox row, and message
 * thread sender attributions established in #640.
 *
 * Round-house has no test runner of its own — api-server's vitest picks
 * this file up via its `vitest.config.ts` `include` glob.
 */
import { describe, expect, it } from "vitest";
import {
  formatOwnerNameForSkin,
  shouldShowSelfPrivacyHint,
} from "./ownerNameDisplay";
import { selectChatHeaderTitle, EMPTY_HEADER_TITLE } from "./chatHeader";

describe("formatOwnerNameForSkin (FullProfileModal self-preview)", () => {
  it("returns the full name unchanged when the privacy flag is OFF", () => {
    expect(formatOwnerNameForSkin("Jane Doe", false)).toBe("Jane Doe");
  });

  it("shortens the last token to an initial when the flag is ON", () => {
    expect(formatOwnerNameForSkin("Jane Doe", true)).toBe("Jane D.");
  });

  it("only initialises the very last token (multi-part last names render as-is up to the last token)", () => {
    expect(formatOwnerNameForSkin("Mary Jo Van Houten", true)).toBe(
      "Mary Jo Van H.",
    );
  });

  it("returns single-token names unchanged so we never collapse to a lone letter", () => {
    expect(formatOwnerNameForSkin("Cher", true)).toBe("Cher");
  });

  it("treats null/undefined/empty input as a no-op", () => {
    expect(formatOwnerNameForSkin(null, true)).toBeNull();
    expect(formatOwnerNameForSkin(undefined, true)).toBeUndefined();
    expect(formatOwnerNameForSkin("   ", true)).toBe("   ");
  });

  it("uppercases the initial letter even when the source last name is lowercase", () => {
    expect(formatOwnerNameForSkin("jane doe", true)).toBe("jane D.");
  });

  it("flipping the flag from OFF→ON changes the rendered string", () => {
    const off = formatOwnerNameForSkin("Jane Doe", false);
    const on = formatOwnerNameForSkin("Jane Doe", true);
    expect(off).toBe("Jane Doe");
    expect(on).toBe("Jane D.");
    expect(off).not.toBe(on);
  });
});

describe("shouldShowSelfPrivacyHint (#694 — explain why the name is shortened)", () => {
  it("hides the hint when the active skin's privacy flag is OFF so the surface stays clean", () => {
    expect(shouldShowSelfPrivacyHint(false)).toBe(false);
  });

  it("shows the hint when the active skin's privacy flag is ON so the user knows why their last name is hidden", () => {
    expect(shouldShowSelfPrivacyHint(true)).toBe(true);
  });

  it("hides the hint for null/undefined (no signal → default off, matches name-shortening contract)", () => {
    expect(shouldShowSelfPrivacyHint(null)).toBe(false);
    expect(shouldShowSelfPrivacyHint(undefined)).toBe(false);
  });

  it("stays in lockstep with formatOwnerNameForSkin: the hint shows iff the name was actually shortened", () => {
    for (const flag of [true, false, null, undefined] as const) {
      const shortened = formatOwnerNameForSkin("Jane Doe", flag);
      const wasShortened = shortened !== "Jane Doe";
      expect(shouldShowSelfPrivacyHint(flag)).toBe(wasShortened);
    }
  });
});

describe("selectChatHeaderTitle (chat thread header copy)", () => {
  const targetClerkId = "user_other";
  const otherClerkId = "user_other";

  it("falls back to the empty-conversation label when the thread has no messages from the other side", () => {
    expect(
      selectChatHeaderTitle({
        messages: [],
        targetClerkId,
        otherClerkId,
        lastInitialOnly: true,
      }),
    ).toBe(EMPTY_HEADER_TITLE);
  });

  it("uses the most recent message sender's name when no privacy flag is supplied (server-shortened pass-through)", () => {
    expect(
      selectChatHeaderTitle({
        messages: [
          { senderClerkId: otherClerkId, sender: { name: "Jane D." } },
        ],
        targetClerkId,
        otherClerkId,
        lastInitialOnly: null,
      }),
    ).toBe("Jane D.");
  });

  it("flipping the recipient skin's lastInitialOnly OFF→ON shortens the header copy from a full name to 'First L.'", () => {
    const args = {
      messages: [{ senderClerkId: otherClerkId, sender: { name: "Jane Doe" } }],
      targetClerkId,
      otherClerkId,
    };
    const off = selectChatHeaderTitle({ ...args, lastInitialOnly: false });
    const on = selectChatHeaderTitle({ ...args, lastInitialOnly: true });
    expect(off).toBe("Jane Doe");
    expect(on).toBe("Jane D.");
  });

  it("ignores messages authored by the viewer (only the other side's name drives the header)", () => {
    expect(
      selectChatHeaderTitle({
        messages: [
          { senderClerkId: "viewer", sender: { name: "Self Name" } },
          { senderClerkId: otherClerkId, sender: { name: "Jane Doe" } },
        ],
        targetClerkId,
        otherClerkId,
        lastInitialOnly: true,
      }),
    ).toBe("Jane D.");
  });

  it("matches either targetClerkId (when /:otherUserId is an outward-account id) or otherClerkId (canonical clerkId)", () => {
    expect(
      selectChatHeaderTitle({
        messages: [
          { senderClerkId: "canonical_clerk", sender: { name: "Jane Doe" } },
        ],
        targetClerkId: "outward-account-or-clerk",
        otherClerkId: "canonical_clerk",
        lastInitialOnly: true,
      }),
    ).toBe("Jane D.");
  });

  it("guards against an empty sender.name by falling back to the empty-conversation label", () => {
    expect(
      selectChatHeaderTitle({
        messages: [{ senderClerkId: otherClerkId, sender: { name: "" } }],
        targetClerkId,
        otherClerkId,
        lastInitialOnly: true,
      }),
    ).toBe(EMPTY_HEADER_TITLE);
  });
});

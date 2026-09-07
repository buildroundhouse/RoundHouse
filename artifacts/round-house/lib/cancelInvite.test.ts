/**
 * UX-side tests for the Cancel action on the People I've invited row
 * (task #279).
 *
 * The screen owns React state and the confirm dialog presentation;
 * `lib/cancelInvite.ts` owns the deterministic logic the screen
 * delegates to. These tests pin that contract:
 *
 *   1. The Cancel pill is only visible on `sent` invites.
 *   2. The confirm dialog uses the recipient name and warns the user
 *      that the invite link will stop working + the daily-cap slot
 *      will free up.
 *   3. A successful cancel calls the API, refetches the list, and
 *      invalidates share-context so the share modal's daily-cap CTA
 *      bounces back.
 *   4. A failing cancel surfaces a friendly error message AND still
 *      invalidates share-context (so the modal reflects the latest
 *      server state — e.g. expired-elsewhere).
 *
 * Round-house has no test runner of its own — api-server's vitest
 * picks this file up via its `vitest.config.ts` `include` glob.
 */
import { describe, it, expect, vi } from "vitest";
import { ApiError } from "@workspace/api-client-react";
import {
  buildCancelConfirmCopy,
  canCancelInvite,
  performCancelInvite,
} from "./cancelInvite";

function makeApiError(status: number, payload: { error: string }): ApiError {
  // Construct a minimal Response-shaped object good enough for ApiError;
  // extractApiErrorMessage only ever reads `data`.
  const response = new Response(JSON.stringify(payload), {
    status,
    statusText: status === 409 ? "Conflict" : "Error",
    headers: { "content-type": "application/json" },
  });
  return new ApiError(response, payload, {
    method: "POST",
    url: "/api/app-invites/7/cancel",
  });
}

describe("Cancel invite row action: visibility (task #279)", () => {
  it("shows the Cancel pill only for invites still in the 'sent' state", () => {
    expect(canCancelInvite("sent")).toBe(true);
    expect(canCancelInvite("signed_up")).toBe(false);
    expect(canCancelInvite("expired")).toBe(false);
    expect(canCancelInvite("cancelled")).toBe(false);
  });
});

describe("Cancel invite row action: confirm dialog copy", () => {
  it("uses the recipient's name and warns about losing the link + freeing the slot", () => {
    const copy = buildCancelConfirmCopy({ recipientName: "Polly Recipient" });
    expect(copy.title).toBe("Cancel invite?");
    expect(copy.message).toContain("Polly Recipient");
    expect(copy.message).toMatch(/won.t be able to use this invite link/);
    expect(copy.message).toContain("daily limit");
    expect(copy.cancelLabel).toBe("Keep invite");
    expect(copy.confirmLabel).toBe("Cancel invite");
  });

  it("falls back to a generic recipient label when the name is missing or blank", () => {
    expect(buildCancelConfirmCopy({ recipientName: "" }).message).toContain(
      "this invite",
    );
    expect(buildCancelConfirmCopy({ recipientName: "   " }).message).toContain(
      "this invite",
    );
  });
});

describe("Cancel invite row action: performCancelInvite", () => {
  it("calls the API, refetches the list, invalidates share-context, and reports ok=true on success", async () => {
    const cancelFn = vi.fn().mockResolvedValue({ invite: { id: 42, status: "cancelled" } });
    const refetchList = vi.fn().mockResolvedValue(undefined);
    const invalidateShareContext = vi.fn();

    const result = await performCancelInvite({
      inviteId: 42,
      cancelFn,
      refetchList,
      invalidateShareContext,
    });

    expect(result).toEqual({ ok: true });
    expect(cancelFn).toHaveBeenCalledTimes(1);
    expect(cancelFn).toHaveBeenCalledWith(42);
    expect(refetchList).toHaveBeenCalledTimes(1);
    expect(invalidateShareContext).toHaveBeenCalledTimes(1);
  });

  it("surfaces a friendly error message and still invalidates share-context when the API fails", async () => {
    // Mirrors how the orval-generated client throws with a server-provided
    // error payload — extractApiErrorMessage should pull the string out.
    const apiError = makeApiError(409, {
      error: "This invite can no longer be cancelled.",
    });
    const cancelFn = vi.fn().mockRejectedValue(apiError);
    const refetchList = vi.fn().mockResolvedValue(undefined);
    const invalidateShareContext = vi.fn();

    const result = await performCancelInvite({
      inviteId: 7,
      cancelFn,
      refetchList,
      invalidateShareContext,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toBe(
        "This invite can no longer be cancelled.",
      );
    }
    // The list refetch is skipped on failure (nothing changed) but the
    // share-context cache is still invalidated so the modal's CTA
    // reflects whatever the server says now.
    expect(refetchList).not.toHaveBeenCalled();
    expect(invalidateShareContext).toHaveBeenCalledTimes(1);
  });

  it("falls back to a generic error message when the thrown value has no usable message", async () => {
    // Non-Error rejections (e.g. an opaque string from a third-party
    // shim) should still surface a friendly user-facing string.
    const cancelFn = vi.fn().mockRejectedValue("boom");
    const refetchList = vi.fn();
    const invalidateShareContext = vi.fn();

    const result = await performCancelInvite({
      inviteId: 9,
      cancelFn,
      refetchList,
      invalidateShareContext,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toBe("Couldn't cancel that invite.");
    }
    expect(invalidateShareContext).toHaveBeenCalledTimes(1);
  });
});

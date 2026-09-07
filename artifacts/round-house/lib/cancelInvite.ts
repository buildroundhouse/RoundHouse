/**
 * Pure helpers backing the Cancel action on the People I've invited
 * screen (task #279). They live in their own module so the row
 * action's UX rules — when Cancel is allowed, what the confirm dialog
 * says, and what happens on success/failure — can be exercised by a
 * standard vitest run instead of standing up a React Native renderer.
 *
 * The screen itself owns the React state and the dialog presentation;
 * these helpers own the deterministic logic the screen delegates to.
 */
import type { AppInvite } from "@workspace/api-client-react";
import { extractApiErrorMessage } from "./apiErrorMessage";

/** A Cancel action only makes sense for invites that are still "sent". */
export function canCancelInvite(status: AppInvite["status"]): boolean {
  return status === "sent";
}

export interface CancelConfirmCopy {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}

/**
 * Copy the screen shows in the confirm dialog. Falls back to a generic
 * recipient label when the invite has no usable recipient name (e.g.
 * legacy rows). Mentions the daily-cap bounce-back so the user
 * understands why they might want to keep it.
 */
export function buildCancelConfirmCopy(
  invite: Pick<AppInvite, "recipientName">,
): CancelConfirmCopy {
  const recipient = invite.recipientName?.trim() || "this invite";
  return {
    title: "Cancel invite?",
    message:
      `${recipient} won't be able to use this invite link anymore, ` +
      `and the slot will free up in your daily limit.`,
    confirmLabel: "Cancel invite",
    cancelLabel: "Keep invite",
  };
}

export interface PerformCancelInviteDeps {
  inviteId: number;
  cancelFn: (inviteId: number) => Promise<unknown>;
  refetchList: () => Promise<unknown> | unknown;
  invalidateShareContext: () => void;
}

export type CancelInviteResult =
  | { ok: true }
  | { ok: false; errorMessage: string };

/**
 * Drives a single cancel attempt. The screen passes its own bound
 * functions in so this stays renderer-agnostic. On both success and
 * failure we invalidate the share-context query so the daily-cap CTA
 * in the share modal bounces back the moment a slot frees (or
 * reflects whatever the server says now after the failure).
 */
export async function performCancelInvite(
  deps: PerformCancelInviteDeps,
): Promise<CancelInviteResult> {
  try {
    await deps.cancelFn(deps.inviteId);
    await deps.refetchList();
    deps.invalidateShareContext();
    return { ok: true };
  } catch (e) {
    deps.invalidateShareContext();
    return {
      ok: false,
      errorMessage: extractApiErrorMessage(e, "Couldn't cancel that invite."),
    };
  }
}

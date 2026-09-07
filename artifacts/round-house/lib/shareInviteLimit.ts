/**
 * Pure helpers for the Share Round House modal's daily-invite-cap UX.
 *
 * Lifted out of `ShareRoundHouseModal.tsx` so the disabled-submit and
 * limit-hint logic can be exercised directly in tests without spinning
 * up a React Native renderer. The modal must continue to import these
 * — keep the modal in sync with any signature change here.
 */

export function buildShareInviteLimitHint(
  limit: number | null,
  remaining: number | null,
): string | null {
  if (limit === null || remaining === null) return null;
  if (remaining <= 0) {
    return (
      `You've hit your daily invite limit (${limit} per 24 hours). ` +
      `Try again tomorrow.`
    );
  }
  if (remaining <= 3) {
    const word = remaining === 1 ? "invite" : "invites";
    return `${remaining} ${word} left today (max ${limit} per 24 hours).`;
  }
  return null;
}

export function isShareInviteLimitReached(
  remaining: number | null,
): boolean {
  return remaining !== null && remaining <= 0;
}

export function computeShareInviteCanSubmit(args: {
  name: string;
  phoneDigits: string;
  submitting: boolean;
  dailyRemaining: number | null;
}): boolean {
  return (
    args.name.trim().length > 0 &&
    args.phoneDigits.length >= 7 &&
    !args.submitting &&
    !isShareInviteLimitReached(args.dailyRemaining)
  );
}

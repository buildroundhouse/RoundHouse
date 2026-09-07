/**
 * #673 — Client mirror of `artifacts/api-server/src/lib/ownerNameDisplay.ts`.
 *
 * The server applies the per-skin "show owner's last initial only" rule
 * before returning name fields on the public-profile, People search,
 * inbox, and message-thread payloads (#640). A few client surfaces still
 * derive names from sources the server can't intercept — most notably:
 *
 *   - The user's *own* full-profile preview screen
 *     (`FullProfileModal.tsx`), which reads `profile.name` from
 *     `/users/me`. The server intentionally does NOT shorten self-view
 *     name, so the client has to apply the rule based on the active
 *     outward account's `lastInitialOnly` flag for the user to preview
 *     what others see.
 *
 *   - The chat thread header (`app/inbox/[otherUserId].tsx`), which
 *     falls back from the (server-shortened) sender name onto a
 *     hard-coded "Conversation" string when the thread is empty. We
 *     pull the helper into the picker so any future call site that
 *     surfaces a raw name can stay consistent.
 *
 * Whitespace-only first/last tokens degrade gracefully — same contract
 * as the server helper:
 *   - Single token (no last name) → returned as-is.
 *   - Empty / null / undefined → returned as-is.
 *   - Multiple middle tokens → only the very last token is initialised
 *     so "Mary Jo Van Houten" → "Mary Jo Van H." (matches how a person
 *     introduces themselves in chat).
 */
export function formatOwnerNameForSkin(
  name: string | null | undefined,
  lastInitialOnly: boolean | null | undefined,
): string | null | undefined {
  if (!lastInitialOnly) return name;
  if (typeof name !== "string") return name;
  const trimmed = name.trim();
  if (!trimmed) return name;
  const tokens = trimmed.split(/\s+/);
  if (tokens.length < 2) return name;
  const last = tokens[tokens.length - 1];
  const lead = tokens.slice(0, -1).join(" ");
  const initial = last.charAt(0).toUpperCase();
  return `${lead} ${initial}.`;
}

/**
 * #694 — Whether the user's own full-profile preview screen
 * (`FullProfileModal.tsx`) should surface the discreet "Privacy: last
 * initial only" hint under the rendered name. The hint exists to
 * explain *why* the name appears shortened in the self-view (the
 * client mirrors the server-side per-skin shortening so the user can
 * preview what others see). The visibility contract is a strict
 * mirror of the same flag that drives `formatOwnerNameForSkin` — when
 * the active outward account opts into "show last initial only", the
 * hint shows; otherwise the surface stays clean for the default case.
 */
export function shouldShowSelfPrivacyHint(
  lastInitialOnly: boolean | null | undefined,
): boolean {
  return !!lastInitialOnly;
}

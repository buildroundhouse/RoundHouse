/**
 * #673 — Pure selector for the chat thread header title.
 *
 * Lifted out of `app/inbox/[otherUserId].tsx` so the per-skin "show last
 * initial only" privacy rule (#640) can be unit-tested without rendering
 * the screen. The selector mirrors the server's `formatOwnerNameForSkin`
 * helper so flipping `outward_accounts.last_initial_only` on the
 * recipient skin updates the rendered chat header copy uniformly with
 * the People search row, public profile header, inbox, and message
 * thread sender attributions.
 */
import { formatOwnerNameForSkin } from "./ownerNameDisplay";

export interface ChatHeaderMessageInput {
  senderClerkId: string;
  sender?: { name?: string | null } | null;
}

export interface SelectChatHeaderTitleArgs {
  messages: readonly ChatHeaderMessageInput[];
  targetClerkId: string;
  otherClerkId: string;
  /**
   * The recipient outward account's `lastInitialOnly` flag. The server
   * already pre-shortens `sender.name` on the conversation payload — we
   * pass the flag through so the selector can re-apply the rule
   * defensively (e.g. if a future call site adds an unshortened name
   * source). `null` means "no signal" → use whatever the server sent.
   */
  lastInitialOnly?: boolean | null;
}

export const EMPTY_HEADER_TITLE = "Conversation";

export function selectChatHeaderTitle({
  messages,
  targetClerkId,
  otherClerkId,
  lastInitialOnly,
}: SelectChatHeaderTitleArgs): string {
  const fromMessage = messages.find(
    (m) =>
      m.senderClerkId === targetClerkId || m.senderClerkId === otherClerkId,
  );
  const rawName = fromMessage?.sender?.name;
  if (!rawName) return EMPTY_HEADER_TITLE;
  const shortened = formatOwnerNameForSkin(rawName, lastInitialOnly);
  return typeof shortened === "string" && shortened.length > 0
    ? shortened
    : rawName;
}

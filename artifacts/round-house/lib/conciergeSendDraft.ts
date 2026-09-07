/**
 * Pure orchestration helpers for the concierge "send drafted client
 * note" flow. Originally extracted from `components/ConciergeSheet.tsx`
 * for task #583 so the Confirm-on-draft contract could be unit-tested
 * without standing up the full Modal + RecipientPicker UI.
 *
 * Task #582 extended the contract to multiple delivery channels: the
 * picker now resolves to a `DraftPick` (recipient + channel + optional
 * phone/email override), the request body carries the channel and any
 * override, and the server may return a `composeUri` (sms: / mailto:)
 * which the client opens in the device's native messages / mail app.
 *
 * The handler in ConciergeSheet calls `performSendDraftAction` with
 * thin adapters for:
 *   - `openRecipientPicker` — promisifies the in-component picker, so
 *     the action card can stay in its pending state until the user
 *     either picks a recipient + channel or cancels.
 *   - `sendDraft` — the orval-generated `usePostConciergeSendDraft`
 *     mutation hook's `mutateAsync`. May return a `composeUri`.
 *   - `openComposeUri` — opens the native compose app for SMS/email
 *     fallbacks (typically `Linking.openURL`).
 *   - `invalidateConciergeHistory` / `invalidateMessages` — react-query
 *     cache invalidations so the system note + recipient inbox refresh.
 *     `invalidateMessages` is only called for the in-app channel since
 *     SMS/email don't insert into the in-app messages table.
 *   - `appendSystemNote` — local optimistic insert into the in-memory
 *     message list so the user sees "Sent draft to …" / "Prepared … draft"
 *     before the next history refetch lands.
 */
import type { ConciergeRecipient } from "@workspace/api-client-react";
import type { ProposedAction } from "./conciergeStream";

export type DraftChannel = "in_app" | "sms" | "email";

export const CHANNEL_LABEL: Record<DraftChannel, string> = {
  in_app: "in-app message",
  sms: "SMS",
  email: "email",
};

export interface DraftClientNotePayload {
  draft: string;
  subject?: string;
}

/**
 * What the picker resolves with: which recipient, which channel, and
 * — when the recipient has no phone/email on file for the chosen
 * channel — the user-provided override the server should send to.
 *
 * Task #587 added the brand-new-contact path: the user can type a name
 * + phone/email right in the picker without first creating a team-up.
 * In that case `isNewContact` is set, the synthetic `recipient` carries
 * the typed name (with `outwardAccountId: 0`), and the request body
 * sends `recipientName` + the override instead of `recipientOutwardAccountId`.
 */
export interface DraftPick {
  recipient: ConciergeRecipient;
  channel: DraftChannel;
  /** When true, this is a brand-new contact with no in-app account. */
  isNewContact?: boolean;
  /** Phone the user typed when the recipient has none (sms only). */
  phoneOverride?: string;
  /** Email the user typed when the recipient has none (email only). */
  emailOverride?: string;
}

export interface SendDraftRequestBody {
  /** Omitted when sending to a brand-new contact. */
  recipientOutwardAccountId?: number;
  /** Sent in lieu of recipientOutwardAccountId for brand-new contacts. */
  recipientName?: string;
  content: string;
  channel: DraftChannel;
  subject?: string;
  recipientPhone?: string;
  recipientEmail?: string;
}

/**
 * Whether tapping Confirm on this action should open the recipient
 * picker instead of completing the action inline.
 */
export function isDraftClientNoteAction(action: ProposedAction): boolean {
  return action.type === "draft_client_note";
}

/**
 * Pulls the draft text + optional subject out of the proposal payload
 * and trims the draft. Throws a user-facing error if the draft is
 * blank — the inline action card surfaces this back as the failure
 * message on the proposal.
 */
export function extractDraftPayload(action: ProposedAction): DraftClientNotePayload {
  const p = action.payload as { draft?: string; subject?: string } | undefined;
  const draft = (p?.draft ?? "").trim();
  if (!draft) {
    throw new Error("This draft is empty — edit it before sending.");
  }
  return { draft, subject: p?.subject };
}

/**
 * Builds the request body for `POST /concierge/send-draft`. Includes
 * any per-channel override (phone for SMS, email for email) so the
 * server can send to a recipient who has no contact info on file.
 */
export function buildSendDraftRequest(
  pick: DraftPick,
  payload: DraftClientNotePayload,
): SendDraftRequestBody {
  return {
    ...(pick.isNewContact
      ? { recipientName: pick.recipient.name }
      : { recipientOutwardAccountId: pick.recipient.outwardAccountId }),
    content: payload.draft,
    channel: pick.channel,
    ...(payload.subject ? { subject: payload.subject } : {}),
    ...(pick.channel === "sms" && pick.phoneOverride
      ? { recipientPhone: pick.phoneOverride }
      : {}),
    ...(pick.channel === "email" && pick.emailOverride
      ? { recipientEmail: pick.emailOverride }
      : {}),
  };
}

/**
 * Mirrors the server's appended system-note copy so the optimistic
 * local insert reads identically to the row that appears after the
 * next /concierge/history refetch.
 *
 * When the server returned a `composeUri`, the actual delivery still
 * has to happen in the device's native compose app — phrase the note
 * as "Prepared … draft" rather than "Sent draft" since we don't yet
 * know the user tapped Send there.
 */
export function buildSentDraftSystemNote(
  pick: DraftPick,
  composeUri?: string | null,
): string {
  if (composeUri) {
    return `Prepared ${CHANNEL_LABEL[pick.channel]} draft for ${pick.recipient.name}.`;
  }
  return `Sent draft to ${pick.recipient.name} via ${CHANNEL_LABEL[pick.channel]}.`;
}

export interface SendDraftResult {
  /** When set, the client should open this URI in the native compose app. */
  composeUri?: string | null;
  [key: string]: unknown;
}

export interface PerformSendDraftDeps {
  /**
   * Opens the recipient picker for the captured draft and resolves
   * with the chosen recipient + channel, or `null` when the user
   * cancels.
   */
  openRecipientPicker: (
    payload: DraftClientNotePayload,
  ) => Promise<DraftPick | null>;
  sendDraft: (body: SendDraftRequestBody) => Promise<SendDraftResult | unknown>;
  /**
   * Opens a `sms:` / `mailto:` URI in the device's native compose app.
   * Optional so unit tests can assert it was called without wiring up
   * `Linking.openURL`.
   */
  openComposeUri?: (uri: string) => void;
  invalidateConciergeHistory: () => void;
  /**
   * Invalidates the in-app messages list. Only called for the in-app
   * channel since SMS/email don't insert into the messages table.
   */
  invalidateMessages: () => void;
  appendSystemNote: (note: string) => void;
}

/**
 * Orchestrates the full Confirm-on-draft flow: validate the payload,
 * open the picker, send the draft if a recipient was chosen, open any
 * native compose URI returned by the server, refresh caches, and
 * locally append the system note. Returns `true` when the draft was
 * sent (or handed off to a native compose app) and `false` when the
 * user cancelled the picker.
 */
export async function performSendDraftAction(
  action: ProposedAction,
  deps: PerformSendDraftDeps,
): Promise<boolean> {
  const payload = extractDraftPayload(action);
  const pick = await deps.openRecipientPicker(payload);
  if (!pick) return false;
  const result = (await deps.sendDraft(
    buildSendDraftRequest(pick, payload),
  )) as SendDraftResult | null | undefined;
  const composeUri = result?.composeUri ?? null;
  if (composeUri && deps.openComposeUri) {
    deps.openComposeUri(composeUri);
  }
  deps.invalidateConciergeHistory();
  if (pick.channel === "in_app") {
    deps.invalidateMessages();
  }
  deps.appendSystemNote(buildSentDraftSystemNote(pick, composeUri));
  return true;
}

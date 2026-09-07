/**
 * Tasks #583 + #582: UI-side coverage for the concierge "send drafted
 * client note" Confirm flow.
 *
 * `components/ConciergeSheet.tsx` delegates the orchestration to
 * `performSendDraftAction` so the contract that fires when the user
 * taps Confirm on a `draft_client_note` proposal can be unit-tested
 * without standing up the full Modal + RecipientPicker UI.
 *
 * These tests pin that contract:
 *   1. Tapping Confirm on a draft_client_note opens the recipient
 *      picker with the captured draft (this is what triggers the
 *      sheet in the component).
 *   2. Picking a recipient + channel calls /concierge/send-draft with
 *      the correct body (channel, recipient outward account, trimmed
 *      draft, optional subject, plus phone/email override when the
 *      recipient lacks contact info), invalidates caches, and locally
 *      appends a system note matching the server's wording.
 *   3. SMS / email sends with a server-returned composeUri are
 *      forwarded to `openComposeUri` so the device's native messages
 *      / mail app opens, and the system note is phrased as
 *      "Prepared … draft" rather than "Sent draft".
 *   4. Cancelling the picker (resolving with null) skips the API call
 *      and the cache + note side-effects entirely.
 *   5. A blank draft surfaces a friendly inline error and never opens
 *      the picker.
 *
 * Round-house has no test runner of its own — api-server's vitest
 * picks this file up via its `vitest.config.ts` `include` glob.
 */
import { describe, it, expect, vi } from "vitest";
import type { ConciergeRecipient } from "@workspace/api-client-react";
import {
  buildSendDraftRequest,
  buildSentDraftSystemNote,
  extractDraftPayload,
  isDraftClientNoteAction,
  performSendDraftAction,
  type DraftPick,
} from "./conciergeSendDraft";
import type { ProposedAction } from "./conciergeStream";

const draftAction: ProposedAction = {
  type: "draft_client_note",
  label: "Send draft",
  payload: {
    draft: "  Hi Pat — quick update on the bathroom job.  ",
    subject: "Bathroom update",
  },
};

const recipient: ConciergeRecipient = {
  outwardAccountId: 42,
  name: "Pat Pro",
  kind: "trade_pro",
  avatarUrl: null,
  companyName: "ACME Plumbing",
  email: "pat@example.com",
  phone: "+15551234567",
};

const recipientNoContact: ConciergeRecipient = {
  outwardAccountId: 42,
  name: "Pat Pro",
  kind: "trade_pro",
  avatarUrl: null,
  companyName: "ACME Plumbing",
  email: null,
  phone: null,
};

const inAppPick: DraftPick = { recipient, channel: "in_app" };

describe("isDraftClientNoteAction (#583)", () => {
  it("only matches draft_client_note proposals (not other action types)", () => {
    expect(isDraftClientNoteAction(draftAction)).toBe(true);
    expect(
      isDraftClientNoteAction({
        type: "create_reminder",
        label: "Add reminder",
        payload: {},
      }),
    ).toBe(false);
  });
});

describe("extractDraftPayload (#583)", () => {
  it("trims the draft and forwards the optional subject", () => {
    expect(extractDraftPayload(draftAction)).toEqual({
      draft: "Hi Pat — quick update on the bathroom job.",
      subject: "Bathroom update",
    });
  });

  it("throws a friendly error when the draft is blank or missing", () => {
    expect(() =>
      extractDraftPayload({
        type: "draft_client_note",
        label: "Send",
        payload: { draft: "   " },
      }),
    ).toThrow(/empty/i);
    expect(() =>
      extractDraftPayload({
        type: "draft_client_note",
        label: "Send",
        payload: {},
      }),
    ).toThrow(/empty/i);
  });
});

describe("buildSendDraftRequest (#583 + #582)", () => {
  it("builds the in-app send body with the recipient outward account, trimmed draft, and subject", () => {
    expect(
      buildSendDraftRequest(inAppPick, {
        draft: "Hi Pat — quick update.",
        subject: "Update",
      }),
    ).toEqual({
      recipientOutwardAccountId: 42,
      content: "Hi Pat — quick update.",
      channel: "in_app",
      subject: "Update",
    });
  });

  it("omits the subject field entirely when none is provided (so it doesn't override server defaults)", () => {
    const body = buildSendDraftRequest(inAppPick, { draft: "Hi" });
    expect(body).toEqual({
      recipientOutwardAccountId: 42,
      content: "Hi",
      channel: "in_app",
    });
    expect("subject" in body).toBe(false);
  });

  it("forwards the phoneOverride only for the SMS channel", () => {
    const smsBody = buildSendDraftRequest(
      {
        recipient: recipientNoContact,
        channel: "sms",
        phoneOverride: "+15559998888",
      },
      { draft: "Hi" },
    );
    expect(smsBody).toEqual({
      recipientOutwardAccountId: 42,
      content: "Hi",
      channel: "sms",
      recipientPhone: "+15559998888",
    });
    // emailOverride is ignored on the SMS channel.
    const stillSms = buildSendDraftRequest(
      {
        recipient: recipientNoContact,
        channel: "sms",
        phoneOverride: "+15559998888",
        emailOverride: "shouldnt@show.up",
      },
      { draft: "Hi" },
    );
    expect("recipientEmail" in stillSms).toBe(false);
  });

  it("forwards the emailOverride only for the email channel", () => {
    const emailBody = buildSendDraftRequest(
      {
        recipient: recipientNoContact,
        channel: "email",
        emailOverride: "lead@example.com",
      },
      { draft: "Hi", subject: "Welcome" },
    );
    expect(emailBody).toEqual({
      recipientOutwardAccountId: 42,
      content: "Hi",
      channel: "email",
      subject: "Welcome",
      recipientEmail: "lead@example.com",
    });
  });

  it("sends recipientName instead of recipientOutwardAccountId for brand-new contacts (#587)", () => {
    const newContactRecipient: ConciergeRecipient = {
      outwardAccountId: 0,
      name: "Jamie Smith",
      kind: null,
      avatarUrl: null,
      companyName: null,
      email: null,
      phone: "+15551112222",
    };
    const body = buildSendDraftRequest(
      {
        recipient: newContactRecipient,
        channel: "sms",
        isNewContact: true,
        phoneOverride: "+15551112222",
      },
      { draft: "Hi Jamie" },
    );
    expect(body).toEqual({
      recipientName: "Jamie Smith",
      content: "Hi Jamie",
      channel: "sms",
      recipientPhone: "+15551112222",
    });
    expect("recipientOutwardAccountId" in body).toBe(false);
  });
});

describe("buildSentDraftSystemNote (#583 + #582)", () => {
  it("matches the server's appended in-app wording", () => {
    expect(buildSentDraftSystemNote(inAppPick)).toBe(
      "Sent draft to Pat Pro via in-app message.",
    );
  });

  it("phrases SMS sends as 'Prepared … draft' since delivery happens in the native Messages app", () => {
    expect(
      buildSentDraftSystemNote(
        { recipient, channel: "sms", phoneOverride: "+15555550000" },
        "sms:+15555550000?body=hi",
      ),
    ).toBe("Prepared SMS draft for Pat Pro.");
  });

  it("phrases email composeUri fallbacks as 'Prepared email draft' but server-side sends as 'Sent draft … via email'", () => {
    expect(
      buildSentDraftSystemNote(
        { recipient, channel: "email" },
        "mailto:pat@example.com?subject=hi",
      ),
    ).toBe("Prepared email draft for Pat Pro.");
    expect(
      buildSentDraftSystemNote({ recipient, channel: "email" }, null),
    ).toBe("Sent draft to Pat Pro via email.");
  });
});

describe("performSendDraftAction in-app happy path (#583)", () => {
  it("opens the picker, sends with the chosen recipient, invalidates caches, and appends the system note", async () => {
    const openRecipientPicker = vi.fn().mockResolvedValue(inAppPick);
    const sendDraft = vi.fn().mockResolvedValue({ ok: true, messageId: 99 });
    const invalidateConciergeHistory = vi.fn();
    const invalidateMessages = vi.fn();
    const appendSystemNote = vi.fn();
    const openComposeUri = vi.fn();

    const sent = await performSendDraftAction(draftAction, {
      openRecipientPicker,
      sendDraft,
      openComposeUri,
      invalidateConciergeHistory,
      invalidateMessages,
      appendSystemNote,
    });

    expect(sent).toBe(true);

    expect(openRecipientPicker).toHaveBeenCalledTimes(1);
    expect(openRecipientPicker).toHaveBeenCalledWith({
      draft: "Hi Pat — quick update on the bathroom job.",
      subject: "Bathroom update",
    });

    expect(sendDraft).toHaveBeenCalledTimes(1);
    expect(sendDraft).toHaveBeenCalledWith({
      recipientOutwardAccountId: 42,
      content: "Hi Pat — quick update on the bathroom job.",
      channel: "in_app",
      subject: "Bathroom update",
    });

    expect(invalidateConciergeHistory).toHaveBeenCalledTimes(1);
    expect(invalidateMessages).toHaveBeenCalledTimes(1);
    expect(openComposeUri).not.toHaveBeenCalled();

    expect(appendSystemNote).toHaveBeenCalledTimes(1);
    expect(appendSystemNote).toHaveBeenCalledWith(
      "Sent draft to Pat Pro via in-app message.",
    );
  });
});

describe("performSendDraftAction SMS path (#582)", () => {
  it("opens the device's Messages app via composeUri and skips the in-app messages cache invalidation", async () => {
    const smsPick: DraftPick = {
      recipient: recipientNoContact,
      channel: "sms",
      phoneOverride: "+15559998888",
    };
    const composeUri = "sms:+15559998888?body=Hi";
    const openRecipientPicker = vi.fn().mockResolvedValue(smsPick);
    const sendDraft = vi.fn().mockResolvedValue({
      ok: true,
      channel: "sms",
      messageId: null,
      composeUri,
    });
    const openComposeUri = vi.fn();
    const invalidateConciergeHistory = vi.fn();
    const invalidateMessages = vi.fn();
    const appendSystemNote = vi.fn();

    const sent = await performSendDraftAction(draftAction, {
      openRecipientPicker,
      sendDraft,
      openComposeUri,
      invalidateConciergeHistory,
      invalidateMessages,
      appendSystemNote,
    });

    expect(sent).toBe(true);
    expect(sendDraft).toHaveBeenCalledWith({
      recipientOutwardAccountId: 42,
      content: "Hi Pat — quick update on the bathroom job.",
      channel: "sms",
      subject: "Bathroom update",
      recipientPhone: "+15559998888",
    });
    expect(openComposeUri).toHaveBeenCalledWith(composeUri);
    expect(invalidateConciergeHistory).toHaveBeenCalledTimes(1);
    // In-app messages cache must NOT be invalidated for SMS sends.
    expect(invalidateMessages).not.toHaveBeenCalled();
    expect(appendSystemNote).toHaveBeenCalledWith(
      "Prepared SMS draft for Pat Pro.",
    );
  });
});

describe("performSendDraftAction cancel path (#583)", () => {
  it("returns false and triggers no API/cache/note side-effects when the picker is dismissed without choosing a recipient", async () => {
    const openRecipientPicker = vi.fn().mockResolvedValue(null);
    const sendDraft = vi.fn();
    const invalidateConciergeHistory = vi.fn();
    const invalidateMessages = vi.fn();
    const appendSystemNote = vi.fn();

    const sent = await performSendDraftAction(draftAction, {
      openRecipientPicker,
      sendDraft,
      invalidateConciergeHistory,
      invalidateMessages,
      appendSystemNote,
    });

    expect(sent).toBe(false);
    expect(openRecipientPicker).toHaveBeenCalledTimes(1);
    expect(sendDraft).not.toHaveBeenCalled();
    expect(invalidateConciergeHistory).not.toHaveBeenCalled();
    expect(invalidateMessages).not.toHaveBeenCalled();
    expect(appendSystemNote).not.toHaveBeenCalled();
  });
});

describe("performSendDraftAction blank-draft guard (#583)", () => {
  it("throws before opening the picker when the draft is empty", async () => {
    const openRecipientPicker = vi.fn();
    const sendDraft = vi.fn();

    await expect(
      performSendDraftAction(
        {
          type: "draft_client_note",
          label: "Send",
          payload: { draft: "   " },
        },
        {
          openRecipientPicker,
          sendDraft,
          invalidateConciergeHistory: vi.fn(),
          invalidateMessages: vi.fn(),
          appendSystemNote: vi.fn(),
        },
      ),
    ).rejects.toThrow(/empty/i);

    expect(openRecipientPicker).not.toHaveBeenCalled();
    expect(sendDraft).not.toHaveBeenCalled();
  });
});

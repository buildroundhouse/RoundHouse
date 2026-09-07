import { Router, type IRouter, type Request } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  messagesTable,
  outwardAccountsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { requirePaidCapability } from "../lib/capabilities";
import {
  appendMessage,
  buildProactiveSuggestions,
  checkConciergeQuota,
  clearMessages,
  conciergeEnabled,
  getOrCreateConversation,
  listMessages,
  loadConciergeContext,
  recordConciergeUsage,
  streamConciergeReply,
  transcribeAudio,
  type ConciergeQuotaCheck,
  type ProposedAction,
} from "../lib/concierge";
import { canParticipateInEntity } from "../lib/entityAccess";
import { insertNotifications } from "../lib/insertNotifications";
import { shouldNotify } from "../lib/notificationPrefs";
import { publicUserColumns } from "../lib/userPublic";
import { logger } from "../lib/logger";
import { sendPushToUser } from "../lib/push";
import {
  EmailNotConfiguredError,
  isEmailConfigured,
  sendEmail,
} from "../lib/email";

const router: IRouter = Router();

function quotaPayload(check: ConciergeQuotaCheck) {
  return {
    error: "Daily concierge usage limit reached.",
    code: "concierge_quota_exceeded",
    used: check.used,
    limit: check.limit,
    resetAt: check.resetAt.toISOString(),
  };
}

function serializeMessage(m: {
  id: number;
  role: string;
  content: string;
  proposedActions: unknown;
  createdAt: Date;
}) {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    proposedActions: (m.proposedActions as ProposedAction[] | null) ?? [],
    createdAt: m.createdAt.toISOString(),
  };
}

router.get("/concierge/history", requireAuth, async (req, res): Promise<void> => {
  const ar = req as AuthRequest;
  if (ar.activeOutwardAccountId == null) {
    res.json({ messages: [] });
    return;
  }
  if (!(await requirePaidCapability(ar, res, "ai_concierge"))) return;
  const conv = await getOrCreateConversation(ar.userId, ar.activeOutwardAccountId);
  const rows = await listMessages(conv.id);
  res.json({ conversationId: conv.id, messages: rows.map(serializeMessage) });
});

router.delete("/concierge/history", requireAuth, async (req, res): Promise<void> => {
  const ar = req as AuthRequest;
  if (ar.activeOutwardAccountId == null) {
    res.status(409).json({ error: "Account not ready" });
    return;
  }
  if (!(await requirePaidCapability(ar, res, "ai_concierge"))) return;
  const conv = await getOrCreateConversation(ar.userId, ar.activeOutwardAccountId);
  await clearMessages(conv.id);
  res.json({ ok: true });
});

router.get("/concierge/suggestions", requireAuth, async (req, res): Promise<void> => {
  const ar = req as AuthRequest;
  if (ar.activeOutwardAccountId == null) {
    res.json({ suggestions: [], pepTalk: null });
    return;
  }
  if (!(await requirePaidCapability(ar, res, "ai_concierge"))) return;
  const ctx = await loadConciergeContext(ar.userId, ar.activeOutwardAccountId);
  res.json(buildProactiveSuggestions(ctx));
});

router.post("/concierge/messages", requireAuth, async (req, res): Promise<void> => {
  const ar = req as AuthRequest;
  if (ar.activeOutwardAccountId == null) {
    res.status(409).json({ error: "Account not ready" });
    return;
  }
  if (!(await requirePaidCapability(ar, res, "ai_concierge"))) return;
  if (!conciergeEnabled()) {
    res.status(503).json({ error: "Concierge is not configured." });
    return;
  }

  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  if (!content) {
    res.status(400).json({ error: "content is required" });
    return;
  }

  const quota = await checkConciergeQuota(ar.userId, "message");
  if (!quota.allowed) {
    res.status(429).json(quotaPayload(quota));
    return;
  }

  const conv = await getOrCreateConversation(ar.userId, ar.activeOutwardAccountId);
  await appendMessage(conv.id, "user", content);
  await recordConciergeUsage(ar.userId, ar.activeOutwardAccountId, "message");

  const history = (await listMessages(conv.id)).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const ctx = await loadConciergeContext(ar.userId, ar.activeOutwardAccountId);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event: { type: string; data: unknown }) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    const reply = await streamConciergeReply(history, ctx, send);
    const saved = await appendMessage(
      conv.id,
      "assistant",
      reply.content,
      reply.proposedActions.length > 0 ? reply.proposedActions : null,
    );
    send({ type: "done", data: serializeMessage(saved) });
  } catch (err) {
    logger.error({ err }, "concierge stream failed");
    send({
      type: "error",
      data: { message: err instanceof Error ? err.message : "Concierge failed" },
    });
  } finally {
    res.end();
  }
});

router.post(
  "/concierge/transcribe",
  requireAuth,
  // The audio body is delivered as raw bytes via fetch upload; use a
  // permissive express.raw() limit so a few seconds of m4a fits.
  (req: Request, res, next) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const max = 25 * 1024 * 1024;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > max) {
        res.status(413).json({ error: "Audio too large" });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      (req as unknown as { rawAudio: Buffer }).rawAudio = Buffer.concat(chunks);
      next();
    });
    req.on("error", () => next());
  },
  async (req, res): Promise<void> => {
    const ar = req as AuthRequest;
    if (!(await requirePaidCapability(ar, res, "ai_concierge"))) return;
    if (!conciergeEnabled()) {
      res.status(503).json({ error: "Concierge is not configured." });
      return;
    }
    const audio = (req as unknown as { rawAudio?: Buffer }).rawAudio;
    if (!audio || audio.length === 0) {
      res.status(400).json({ error: "Audio body is required" });
      return;
    }
    const quota = await checkConciergeQuota(ar.userId, "transcribe");
    if (!quota.allowed) {
      res.status(429).json(quotaPayload(quota));
      return;
    }
    try {
      const filename =
        typeof req.query.filename === "string" && req.query.filename
          ? String(req.query.filename)
          : "voice.m4a";
      const text = await transcribeAudio(audio, filename);
      if (ar.activeOutwardAccountId != null) {
        await recordConciergeUsage(
          ar.userId,
          ar.activeOutwardAccountId,
          "transcribe",
        );
      }
      res.json({ text });
    } catch (err) {
      logger.error({ err }, "concierge transcription failed");
      res
        .status(500)
        .json({ error: err instanceof Error ? err.message : "Transcription failed" });
    }
  },
);

/**
 * List candidate recipients for a concierge-drafted message: every
 * outward-account counterpart the active skin has an accepted, non-
 * archived connection to. This is the source for the recipient picker
 * shown when the user confirms a `draft_client_note` proposal.
 */
router.get("/concierge/recipients", requireAuth, async (req, res): Promise<void> => {
  const ar = req as AuthRequest;
  if (ar.activeOutwardAccountId == null) {
    res.json({ recipients: [] });
    return;
  }
  if (!(await requirePaidCapability(ar, res, "ai_concierge"))) return;

  // Task #663: the concierge "who can I message" recipient list used
  // to be derived from accepted user_connections. With messaging now
  // entity-scoped, the equivalent surface is "people in entities I'm
  // a member of" — built in T007 via the new AddToEntitySheet flow.
  // For now, return an empty list so callers (the concierge composer)
  // degrade gracefully instead of erroring; the UI hides the
  // recipient picker when it comes back empty.
  void ar;
  const ids: number[] = [];
  if (ids.length === 0) {
    res.json({ recipients: [] });
    return;
  }

  const rows = await db
    .select({
      id: outwardAccountsTable.id,
      ownerClerkId: outwardAccountsTable.ownerClerkId,
      title: outwardAccountsTable.title,
      displayName: outwardAccountsTable.displayName,
      companyName: outwardAccountsTable.companyName,
      avatarUrl: outwardAccountsTable.avatarUrl,
      kind: outwardAccountsTable.kind,
    })
    .from(outwardAccountsTable)
    .where(
      and(
        inArray(outwardAccountsTable.id, ids),
        isNull(outwardAccountsTable.archivedAt),
      ),
    );

  // Pull email/phone from the owning user record so the recipient
  // picker can offer SMS / email channels without a second roundtrip.
  const ownerIds = [...new Set(rows.map((r) => r.ownerClerkId))];
  const owners = ownerIds.length
    ? await db
        .select({
          clerkId: usersTable.clerkId,
          email: usersTable.email,
          phone: usersTable.phone,
          cellPhone: usersTable.cellPhone,
          officePhone: usersTable.officePhone,
        })
        .from(usersTable)
        .where(inArray(usersTable.clerkId, ownerIds))
    : [];
  const ownerByClerkId = new Map(owners.map((o) => [o.clerkId, o]));

  const recipients = rows.map((r) => {
    const owner = ownerByClerkId.get(r.ownerClerkId);
    const phone = owner?.cellPhone || owner?.phone || owner?.officePhone || null;
    return {
      outwardAccountId: r.id,
      name: r.title || r.displayName || r.companyName || "Unnamed",
      kind: r.kind ?? null,
      avatarUrl: r.avatarUrl ?? null,
      companyName: r.companyName ?? null,
      email: owner?.email ?? null,
      phone,
    };
  });

  res.json({ recipients });
});

const SUPPORTED_CHANNELS = new Set(["in_app", "sms", "email"]);

/** Strip everything but digits and a leading "+" so a phone is safe to embed in an sms: URI. */
function normalizePhone(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const plus = trimmed.startsWith("+") ? "+" : "";
  return plus + trimmed.replace(/[^\d]/g, "");
}

/** Lightweight email shape check — just enough to reject obvious typos. */
function isEmailish(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim());
}

/**
 * Send a concierge-drafted message via the requested channel.
 *
 * - `in_app`: the message is inserted into the `messages` table so it
 *   appears in the recipient's inbox exactly like any other DM.
 * - `sms`: validates the phone (from the recipient or the body) and
 *   returns an `sms:` compose URI for the client to launch — there is
 *   no server-side SMS provider configured.
 * - `email`: when SendGrid is configured, sends the email server-side.
 *   Otherwise returns a `mailto:` URI for the client to launch.
 *
 * In every case a system note is appended to the concierge thread so
 * the user sees the draft was sent.
 */
router.post(
  "/concierge/send-draft",
  requireAuth,
  async (req, res): Promise<void> => {
    const ar = req as AuthRequest;
    if (ar.activeOutwardAccountId == null) {
      res.status(409).json({ error: "Account not ready" });
      return;
    }
    if (!(await requirePaidCapability(ar, res, "ai_concierge"))) return;

    const body = req.body as {
      recipientOutwardAccountId?: number | null;
      recipientName?: string | null;
      content?: string;
      channel?: string;
      subject?: string;
      recipientPhone?: string | null;
      recipientEmail?: string | null;
      // Task #663 — every in-app message is scoped to an entity. The
      // client picks which shared entity (property / business) the
      // concierge draft belongs to. SMS / email branches don't need
      // it because no `messages` row is written.
      entityId?: number | null;
    };
    const channel = body.channel ?? "in_app";
    const rawRecipientId = body.recipientOutwardAccountId;
    const hasRecipientId =
      rawRecipientId != null && Number.isFinite(Number(rawRecipientId));
    const recipientAccountId = hasRecipientId ? Number(rawRecipientId) : null;
    const rawEntityId = body.entityId;
    const entityId =
      rawEntityId != null && Number.isFinite(Number(rawEntityId))
        ? Number(rawEntityId)
        : null;
    const recipientNameInput =
      typeof body.recipientName === "string" ? body.recipientName.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const subject =
      typeof body.subject === "string" && body.subject.trim()
        ? body.subject.trim()
        : "A note from your Roundhouse concierge";

    if (!SUPPORTED_CHANNELS.has(channel)) {
      res.status(400).json({
        error: "Unsupported channel.",
        code: "channel_unsupported",
      });
      return;
    }
    if (!content) {
      res.status(400).json({ error: "content is required" });
      return;
    }
    // The picker may resolve with either an existing outward-account
    // counterpart or a brand-new contact (name + phone/email). For
    // brand-new contacts we skip the team-up connection check and the
    // recipient-account lookup entirely — they have no in-app account
    // to gate on. In-app sends still require an outward-account id
    // because they insert into the `messages` table.
    const isNewContact = recipientAccountId == null || recipientAccountId <= 0;
    if (isNewContact) {
      if (channel === "in_app") {
        res.status(400).json({
          error:
            "In-app messages need an existing team-up connection. Pick SMS or email to reach a brand-new contact.",
          code: "in_app_requires_recipient",
        });
        return;
      }
      if (!recipientNameInput) {
        res.status(400).json({
          error: "A contact name is required for new recipients.",
          code: "recipient_name_required",
        });
        return;
      }
    }

    // Task #663 — entity-only relationship model. In-app concierge
    // sends must scope to an entity both the sender's avatar and the
    // recipient's avatar already participate in. SMS / email branches
    // are user-to-user direct contact and don't gate here because no
    // `messages` row is written.
    if (channel === "in_app") {
      if (entityId == null) {
        res.status(400).json({
          error:
            "Pick which property or business this message belongs to before sending.",
          code: "entity_required",
        });
        return;
      }
      const senderOk = await canParticipateInEntity(ar.userId, entityId);
      if (!senderOk) {
        res.status(403).json({
          error: "You aren't a member of that entity.",
          code: "entity_membership_required",
        });
        return;
      }
      if (
        recipientAccountId != null &&
        recipientAccountId !== ar.activeOutwardAccountId
      ) {
        // Resolve the recipient's clerk id from their outward account so
        // we can check entity membership by user (any of the recipient's
        // avatars on the entity counts).
        const [recipAcct] = await db
          .select({ ownerClerkId: outwardAccountsTable.ownerClerkId })
          .from(outwardAccountsTable)
          .where(eq(outwardAccountsTable.id, recipientAccountId));
        const recipientOk =
          !!recipAcct &&
          (await canParticipateInEntity(recipAcct.ownerClerkId, entityId));
        if (!recipientOk) {
          res.status(403).json({
            error: "That recipient isn't a member of the chosen entity.",
            code: "recipient_entity_membership_required",
          });
          return;
        }
      }
    }

    type RecipientAccountRow = {
      id: number;
      ownerClerkId: string;
      title: string | null;
      displayName: string | null;
    };
    type RecipientUserRow = Awaited<
      ReturnType<typeof loadRecipientUser>
    >;
    async function loadRecipientUser(clerkId: string) {
      const [usr] = await db
        .select({
          ...publicUserColumns,
          lastActiveModeId: usersTable.lastActiveModeId,
        })
        .from(usersTable)
        .where(eq(usersTable.clerkId, clerkId));
      return usr;
    }
    let recipientAccount: RecipientAccountRow | null = null;
    let recipientUser: RecipientUserRow | null = null;
    if (!isNewContact && recipientAccountId != null) {
      const [acct] = await db
        .select({
          id: outwardAccountsTable.id,
          ownerClerkId: outwardAccountsTable.ownerClerkId,
          title: outwardAccountsTable.title,
          displayName: outwardAccountsTable.displayName,
        })
        .from(outwardAccountsTable)
        .where(
          and(
            eq(outwardAccountsTable.id, recipientAccountId),
            isNull(outwardAccountsTable.archivedAt),
          ),
        );
      if (!acct) {
        res.status(404).json({ error: "Recipient not found" });
        return;
      }
      recipientAccount = acct;
      recipientUser = (await loadRecipientUser(acct.ownerClerkId)) ?? null;
    }

    const recipientLabel =
      recipientAccount?.title ||
      recipientAccount?.displayName ||
      recipientUser?.name ||
      recipientNameInput ||
      "your contact";

    const conv = await getOrCreateConversation(
      ar.userId,
      ar.activeOutwardAccountId,
    );

    // ----- SMS branch ----------------------------------------------------
    if (channel === "sms") {
      const fallbackPhone =
        recipientUser?.cellPhone ||
        recipientUser?.phone ||
        recipientUser?.officePhone ||
        "";
      const rawPhone = (body.recipientPhone ?? fallbackPhone) || "";
      const phone = normalizePhone(rawPhone);
      if (!phone) {
        res.status(400).json({
          error: "A phone number is required to send by SMS.",
          code: "phone_required",
        });
        return;
      }
      const composeUri = `sms:${phone}?body=${encodeURIComponent(content)}`;
      // The actual send happens in the user's native Messages app, so
      // we record this as "prepared" — we don't yet know they tapped Send.
      await appendMessage(
        conv.id,
        "system",
        `Prepared SMS draft for ${recipientLabel} (${phone}).`,
        null,
      );
      res.status(201).json({
        ok: true,
        channel,
        recipientOutwardAccountId: recipientAccountId,
        messageId: null,
        composeUri,
      });
      return;
    }

    // ----- Email branch --------------------------------------------------
    if (channel === "email") {
      const rawEmail = (body.recipientEmail ?? recipientUser?.email ?? "").trim();
      if (!rawEmail || !isEmailish(rawEmail)) {
        res.status(400).json({
          error: "A valid email address is required to send by email.",
          code: "email_required",
        });
        return;
      }
      let composeUri: string | null = null;
      if (isEmailConfigured()) {
        try {
          await sendEmail({ to: rawEmail, subject, text: content });
        } catch (err) {
          if (err instanceof EmailNotConfiguredError) {
            composeUri = `mailto:${encodeURIComponent(rawEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(content)}`;
          } else {
            logger.warn({ err }, "concierge email send failed");
            res.status(502).json({
              error:
                err instanceof Error
                  ? err.message
                  : "Couldn't send the email right now.",
              code: "email_send_failed",
            });
            return;
          }
        }
      } else {
        // No server-side provider — let the client open the user's
        // mail app pre-filled with the draft.
        composeUri = `mailto:${encodeURIComponent(rawEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(content)}`;
      }
      // If we have a composeUri, the user still has to tap Send in
      // their mail app — so phrase this as "prepared" rather than sent.
      const verb = composeUri ? "Prepared email draft for" : "Sent draft to";
      await appendMessage(
        conv.id,
        "system",
        `${verb} ${recipientLabel} (${rawEmail}).`,
        null,
      );
      res.status(201).json({
        ok: true,
        channel,
        recipientOutwardAccountId: recipientAccountId,
        messageId: null,
        composeUri,
      });
      return;
    }

    // ----- In-app branch (default) --------------------------------------
    // The new-contact guard above already short-circuits when there is
    // no outward-account id, so by the time we reach this branch we
    // always have a real recipientAccount + id.
    if (!recipientAccount || recipientAccountId == null) {
      res.status(400).json({ error: "recipientOutwardAccountId is required" });
      return;
    }
    const actedByClerkId = ar.actingAsTeamSeat ? ar.userId : null;

    // Task #663 — entityId was already validated above for in-app
    // sends, so we can stamp it on the row unconditionally here.
    const [msg] = await db
      .insert(messagesTable)
      .values({
        senderClerkId: ar.userId,
        recipientClerkId: recipientAccount.ownerClerkId,
        senderOutwardAccountId: ar.activeOutwardAccountId,
        recipientOutwardAccountId: recipientAccountId,
        entityId: entityId!,
        content,
        actedByClerkId,
        // #585: tag concierge-drafted sends so the inbox can render a
        // "drafted with concierge" badge to set the recipient's
        // expectations about the wording.
        source: "concierge_draft",
        createdInModeId:
          (ar as { activeModeId?: number | null }).activeModeId ?? null,
        toModeId: recipientUser?.lastActiveModeId ?? null,
      })
      .returning();

    const [sender] = await db
      .select(publicUserColumns)
      .from(usersTable)
      .where(eq(usersTable.clerkId, ar.userId));

    if (await shouldNotify(recipientAccount.ownerClerkId, "message")) {
      await insertNotifications({
        userClerkId: recipientAccount.ownerClerkId,
        type: "message",
        title: "New message",
        body: `${sender?.name || "Someone"} sent you a message.`,
        relatedId: String(msg.id),
        outwardAccountId: recipientAccountId,
        createdInModeId: recipientUser?.lastActiveModeId ?? null,
      });

      // Fire a push notification so the recipient's device buzzes. The
      // in-app notification row alone never woke up the phone, so
      // concierge-drafted sends were silently arriving in the inbox.
      void sendPushToUser(recipientAccount.ownerClerkId, {
        title: "New message",
        body: `${sender?.name || "Someone"} sent you a message.`,
        data: {
          type: "message",
          messageId: msg.id,
          senderClerkId: ar.userId,
          senderOutwardAccountId: ar.activeOutwardAccountId,
          recipientOutwardAccountId: recipientAccountId,
          source: "concierge_draft",
        },
      });
    }

    await appendMessage(
      conv.id,
      "system",
      `Sent draft to ${recipientLabel} via in-app message.`,
      null,
    );

    res.status(201).json({
      ok: true,
      channel: "in_app",
      messageId: msg.id,
      recipientOutwardAccountId: recipientAccountId,
      composeUri: null,
    });
  },
);

export default router;

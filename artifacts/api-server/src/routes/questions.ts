import { Router, type IRouter } from "express";
import { and, desc, eq, or } from "drizzle-orm";
import { db, questionsTable, usersTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { recordPoints } from "../lib/rewards";
import { insertNotifications } from "../lib/insertNotifications";
import { sendPushToUser } from "../lib/push";
import { shouldNotify } from "../lib/notificationPrefs";
import { logger } from "../lib/logger";

function truncate(text: string, max = 140): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

async function getSenderName(clerkId: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkId));
    const name = row?.name?.trim();
    return name && name.length > 0 ? name : null;
  } catch (err) {
    logger.warn({ err, clerkId }, "Failed to load sender name for question notification");
    return null;
  }
}

async function notifyQuestionRecipient(params: {
  recipientClerkId: string;
  prefType: "question_asked" | "request_received" | "question_answered";
  title: string;
  body: string;
  questionId: number;
}): Promise<void> {
  const { recipientClerkId, prefType, title, body, questionId } = params;
  if (!(await shouldNotify(recipientClerkId, prefType))) return;
  try {
    await insertNotifications({
      userClerkId: recipientClerkId,
      type: prefType,
      title,
      body,
      relatedId: String(questionId),
    });
  } catch (err) {
    logger.error({ err, recipientClerkId, prefType, questionId }, "Failed to insert question notification");
  }
  void sendPushToUser(recipientClerkId, {
    title,
    body,
    data: { type: "question", questionId },
  });
}

const router: IRouter = Router();

type QuestionRow = typeof questionsTable.$inferSelect;

const ASK_PRO = "ask_pro";
const REQUEST = "request";
const STATUS_OPEN = "open";
const STATUS_ANSWERED = "answered";
const STATUS_WAITING = "waiting";
const STATUS_COMPLETED = "completed";

function parseId(raw: unknown): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(String(v), 10);
}

function serialize(q: QuestionRow) {
  return {
    id: q.id,
    userClerkId: q.userClerkId,
    counterpartyClerkId: q.counterpartyClerkId,
    counterpartyName: q.counterpartyName,
    kind: q.kind,
    status: q.status,
    questionText: q.questionText,
    requestedAction: q.requestedAction,
    responseText: q.responseText,
    nextStep: q.nextStep,
    confirmedAt: q.confirmedAt ? q.confirmedAt.toISOString() : null,
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
  };
}

// List every question that touches the signed-in user — either as the
// owner (their Reminders feed item) or as the counterparty (so a
// provider sees questions clients asked them, and a client sees
// requests providers sent them).
router.get("/questions", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const rows = await db
    .select()
    .from(questionsTable)
    .where(
      or(
        eq(questionsTable.userClerkId, userId),
        eq(questionsTable.counterpartyClerkId, userId),
      ),
    )
    .orderBy(desc(questionsTable.updatedAt));
  res.json({ questions: rows.map(serialize) });
});

router.post("/questions", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const {
    kind,
    questionText,
    counterpartyClerkId,
    counterpartyName,
    requestedAction,
  } = req.body ?? {};
  if (kind !== ASK_PRO && kind !== REQUEST) {
    res.status(400).json({ error: "kind must be 'ask_pro' or 'request'" });
    return;
  }
  const text = typeof questionText === "string" ? questionText.trim() : "";
  if (!text) {
    res.status(400).json({ error: "questionText is required" });
    return;
  }
  const status = kind === ASK_PRO ? STATUS_OPEN : STATUS_WAITING;
  const [row] = await db
    .insert(questionsTable)
    .values({
      userClerkId: userId,
      counterpartyClerkId:
        typeof counterpartyClerkId === "string" && counterpartyClerkId.trim()
          ? counterpartyClerkId.trim()
          : null,
      counterpartyName:
        typeof counterpartyName === "string" && counterpartyName.trim()
          ? counterpartyName.trim()
          : null,
      kind,
      status,
      questionText: text,
      requestedAction:
        kind === REQUEST &&
        typeof requestedAction === "string" &&
        requestedAction.trim()
          ? requestedAction.trim()
          : null,
    })
    .returning();

  // Notify the counterparty that a new question / request arrived for
  // them (Ask-a-Pro → pro receives a "question_asked" push; "What I
  // Need From You" → client receives a "request_received" push). When
  // the question was created without a bound counterparty there is
  // nobody to notify.
  if (row.counterpartyClerkId && row.counterpartyClerkId !== userId) {
    const senderName = await getSenderName(userId);
    if (kind === ASK_PRO) {
      await notifyQuestionRecipient({
        recipientClerkId: row.counterpartyClerkId,
        prefType: "question_asked",
        title: senderName ? `New question from ${senderName}` : "New question for you",
        body: truncate(row.questionText),
        questionId: row.id,
      });
    } else {
      const detail = row.requestedAction?.trim() || row.questionText;
      await notifyQuestionRecipient({
        recipientClerkId: row.counterpartyClerkId,
        prefType: "request_received",
        title: senderName ? `${senderName} needs something from you` : "New request for you",
        body: truncate(detail),
        questionId: row.id,
      });
    }
  }

  res.status(201).json(serialize(row));
});

router.patch("/questions/:questionId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const id = parseId(req.params.questionId);
  if (!Number.isFinite(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [existing] = await db
    .select()
    .from(questionsTable)
    .where(eq(questionsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (
    existing.userClerkId !== userId &&
    existing.counterpartyClerkId !== userId
  ) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const { responseText, confirm, nextStep, complete } = req.body ?? {};
  const updates: Partial<typeof questionsTable.$inferInsert> = {};

  // Provider answers an Ask-a-Pro question.
  let awardedAnswer = false;
  if (typeof responseText === "string") {
    const trimmed = responseText.trim();
    if (!trimmed) {
      res.status(400).json({ error: "responseText must be non-empty" });
      return;
    }
    updates.responseText = trimmed;
    if (existing.kind === ASK_PRO && existing.status === STATUS_OPEN) {
      updates.status = STATUS_ANSWERED;
      awardedAnswer = true;
    }
  }

  // Client confirms the answer was helpful — completes Ask-a-Pro and
  // unlocks the next-step picker on the client side.
  let awardedConfirm = false;
  if (confirm === true && existing.kind === ASK_PRO) {
    if (existing.userClerkId !== userId) {
      res
        .status(403)
        .json({ error: "Only the asker can confirm an Ask-a-Pro question" });
      return;
    }
    updates.status = STATUS_COMPLETED;
    updates.confirmedAt = new Date();
    awardedConfirm = true;
  }

  if (typeof nextStep === "string" && nextStep.trim()) {
    const allowed = new Set(["appointment", "list", "curious"]);
    if (!allowed.has(nextStep.trim())) {
      res
        .status(400)
        .json({ error: "nextStep must be appointment | list | curious" });
      return;
    }
    updates.nextStep = nextStep.trim();
  }

  // Provider→client request marked complete by the client.
  if (complete === true && existing.kind === REQUEST) {
    updates.status = STATUS_COMPLETED;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No supported fields to update" });
    return;
  }

  const [row] = await db
    .update(questionsTable)
    .set(updates)
    .where(eq(questionsTable.id, id))
    .returning();

  // Award points only for Ask-a-Pro flow, only to the responder
  // (provider). The provider is the counterparty when a client owns the
  // question (the common case). If the question was created without a
  // bound counterparty there is nobody to credit.
  if (row && row.kind === ASK_PRO) {
    const responderId = row.counterpartyClerkId;
    if (responderId) {
      if (awardedAnswer) {
        await recordPoints({
          userClerkId: responderId,
          eventType: "question_answered",
          sourceRef: `question:${row.id}`,
        });
      }
      if (awardedConfirm) {
        await recordPoints({
          userClerkId: responderId,
          eventType: "question_confirmed_helpful",
          sourceRef: `question:${row.id}`,
        });
      }
    }
  }

  // Notify the asker when a pro has answered their Ask-a-Pro question.
  // Only fire on the answer transition (open → answered), not on every
  // edit of the response text or on confirm/complete updates.
  if (
    row &&
    awardedAnswer &&
    row.kind === ASK_PRO &&
    row.userClerkId !== userId
  ) {
    const responderName = await getSenderName(userId);
    await notifyQuestionRecipient({
      recipientClerkId: row.userClerkId,
      prefType: "question_answered",
      title: responderName ? `${responderName} answered your question` : "Your question was answered",
      body: truncate(row.responseText ?? ""),
      questionId: row.id,
    });
  }

  res.json(serialize(row));
});

router.delete("/questions/:questionId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const id = parseId(req.params.questionId);
  if (!Number.isFinite(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [row] = await db
    .delete(questionsTable)
    .where(
      and(eq(questionsTable.id, id), eq(questionsTable.userClerkId, userId)),
    )
    .returning({ id: questionsTable.id });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;

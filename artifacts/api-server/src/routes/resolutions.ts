import { Router } from "express";
import { eq, or, inArray, and, isNull } from "drizzle-orm";
import { db, questionsTable, usersTable, entitiesTable, entityMembersTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { resolutionState, changeResolution, ResolutionError } from "../lib/resolutionState";
import { getApprovedMembership, canParticipateInEntity } from "../lib/entityAccess";

const router = Router();
router.get("/resolution-contexts", requireAuth, async (req, res) => {
  const { userId } = req as AuthRequest;
  const memberships = await db.select().from(entityMembersTable).where(and(eq(entityMembersTable.userClerkId, userId), eq(entityMembersTable.status, "approved"), isNull(entityMembersTable.archivedAt)));
  const ids = [...new Set(memberships.filter(m => !["viewer", "collaborator"].includes(m.role)).map(m => m.entityId))];
  if (!ids.length) { res.json({ contexts: [] }); return; }
  const [entities, participants] = await Promise.all([
    db.select().from(entitiesTable).where(and(inArray(entitiesTable.id, ids), isNull(entitiesTable.archivedAt))),
    db.select({ entityId: entityMembersTable.entityId, id: usersTable.clerkId, name: usersTable.name }).from(entityMembersTable)
      .innerJoin(usersTable, eq(usersTable.clerkId, entityMembersTable.userClerkId))
      .where(and(inArray(entityMembersTable.entityId, ids), eq(entityMembersTable.status, "approved"), isNull(entityMembersTable.archivedAt))),
  ]);
  res.json({ contexts: entities.map(e => ({ id: e.id, name: e.name, people: [...new Map(participants.filter(p => p.entityId === e.id && p.id !== userId).map(p => [p.id, { id: p.id, name: p.name || "Team member" }])).values()] })) });
});

router.post("/resolutions", requireAuth, async (req, res) => {
  const { userId } = req as AuthRequest;
  const { entityId, recipientId, question } = req.body ?? {};
  if (!Number.isSafeInteger(entityId) || typeof recipientId !== "string" || recipientId === userId || typeof question !== "string" || !question.trim() || question.length > 10000) {
    res.status(400).json({ error: "Choose a property/business, a participant, and enter the request" }); return;
  }
  const [membership, recipientAllowed] = await Promise.all([getApprovedMembership(userId, entityId), canParticipateInEntity(recipientId, entityId)]);
  if (!membership || ["viewer", "collaborator"].includes(membership.role) || !recipientAllowed) { res.status(403).json({ error: "Both people must belong to this space, and the creator needs permission to contribute" }); return; }
  const [entity] = await db.select().from(entitiesTable).where(and(eq(entitiesTable.id, entityId), isNull(entitiesTable.archivedAt)));
  if (!entity) { res.status(404).json({ error: "Space not found" }); return; }
  const [created] = await db.insert(questionsTable).values({ userClerkId: userId, counterpartyClerkId: recipientId, kind: "request", status: "waiting", questionText: question.trim(), requestedAction: "reply",
    resolutionState: { context: { id: entity.id, name: entity.name }, responsibleId: recipientId, followUps: 0, readBy: [], events: [] },
  }).returning({ id: questionsTable.id });
  res.status(201).json(created);
});

router.get("/resolutions", requireAuth, async (req, res) => {
  const { userId } = req as AuthRequest;
  const rows = await db.select().from(questionsTable).where(or(eq(questionsTable.userClerkId, userId), eq(questionsTable.counterpartyClerkId, userId)));
  const ids = [...new Set(rows.flatMap(q => [q.userClerkId, q.counterpartyClerkId].filter((id): id is string => !!id)))];
  const people = ids.length ? await db.select({ id: usersTable.clerkId, name: usersTable.name }).from(usersTable).where(inArray(usersTable.clerkId, ids)) : [];
  const names = new Map(people.map(p => [p.id, p.name]));
  res.json({ resolutions: rows.map(q => {
    const state = resolutionState(q);
    return { id: q.id, creatorId: q.userClerkId, creatorName: names.get(q.userClerkId) || "Resolution creator",
      otherName: (q.counterpartyClerkId && names.get(q.counterpartyClerkId)) || q.counterpartyName || "Recipient not linked",
      recipientLinked: !!q.counterpartyClerkId, question: q.questionText, requestedAction: q.requestedAction, nextStep: q.nextStep,
      context: state.context?.name ?? null, // Never invent context for legacy questions.
      status: q.status === "completed" ? "resolved" : state.responsibleId === userId ? "attention" : "waiting",
      unread: q.status === "completed" && !state.readBy.includes(userId), followUps: state.followUps,
      createdAt: q.createdAt.toISOString(), updatedAt: q.updatedAt.toISOString(), closedAt: q.confirmedAt?.toISOString() ?? null,
      events: state.events.map(e => ({ ...e, actorName: e.actorId ? names.get(e.actorId) || "Participant" : "Earlier response" })),
    };
  }) });
});

router.post("/resolutions/:id/actions", requireAuth, async (req, res) => {
  const { userId } = req as AuthRequest;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(404).json({ error: "Resolution not found" }); return; }
  try {
    await db.transaction(async tx => {
      // Serialize replies and closeout so simultaneous actions never discard history.
      const [q] = await tx.select().from(questionsTable).where(eq(questionsTable.id, id)).for("update");
      if (!q) throw new ResolutionError(404, "Resolution not found");
      const action = String(req.body?.action || "");
      const text = typeof req.body?.text === "string" ? req.body.text : "";
      const { state, closed } = changeResolution(q, userId, action, text, req.body?.verified === true);
      await tx.update(questionsTable).set({ resolutionState: state,
        ...(action === "read" ? { updatedAt: q.updatedAt } : { updatedAt: new Date(), status: closed ? "completed" : "answered",
          ...(action === "reply" ? { responseText: text.trim() } : {}), ...(closed ? { confirmedAt: new Date() } : {}),
        }),
      }).where(eq(questionsTable.id, id));
    });
    res.status(204).end();
  } catch (error) {
    if (error instanceof ResolutionError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});
export default router;

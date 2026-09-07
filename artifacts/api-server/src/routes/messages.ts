/**
 * Messaging is entity-only after Task #663.
 *
 * - Every send carries an `entityId`; without one the route returns 400.
 * - Every read is gated on an approved `entity_members` row.
 * - Avatar-to-avatar DMs were removed. The legacy DM URLs still
 *   exist as 410 Gone stubs so any straggler client surfaces a loud
 *   failure rather than silently working against the wrong data
 *   model.
 *
 * The legacy `/properties/:propertyId/messages*` endpoints continue to
 * work as thin redirectors — they translate the propertyId to its
 * canonical entityId via the `property_entity_links` side table
 * populated by `migratePropertyEntities` and call the same handlers.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, inArray, sql, ne, isNull, notInArray } from "drizzle-orm";
import {
  db,
  messagesTable,
  usersTable,
  entitiesTable,
  entityMembersTable,
  outwardAccountsTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { insertNotifications } from "../lib/insertNotifications";
import { resolveActiveOutwardAccountId } from "../lib/outwardAccounts";
import { publicUserColumns } from "../lib/userPublic";
import { shouldNotify } from "../lib/notificationPrefs";
import { sendPushToUser } from "../lib/push";
import {
  approvedEntityIdsFor,
  canParticipateInEntity,
} from "../lib/entityAccess";
import {
  entityIdForProperty,
  propertyIdForEntity,
} from "../lib/migratePropertyEntities";
import { formatOwnerNameForSkin } from "../lib/ownerNameDisplay";

const router: IRouter = Router();

async function activeAccountIdFor(req: AuthRequest): Promise<number | null> {
  if (req.activeOutwardAccountId != null) return req.activeOutwardAccountId;
  return resolveActiveOutwardAccountId(req.userId);
}

/**
 * 410-Gone for the legacy avatar-to-avatar DM endpoints. Kept as
 * stubs so any forgotten client caller fails loudly instead of
 * silently degrading.
 */
function dmGone(_req: Request, res: Response): void {
  res.status(410).json({
    error:
      "Direct avatar-to-avatar messaging was removed. Use entity-scoped messaging.",
    code: "dm_removed",
  });
}

// Task #663 — entity-only cutover. Message rows authored by the
// retired avatar-to-avatar handshake (team-up requests, the
// "system_connected" handshake banner, the personal note that piggy-
// backed on a request) are filtered out of every entity-thread read so
// the inbox shows only real entity-scoped chatter. Note that nulls
// (the implicit "user" source) survive `notInArray` because SQL `NOT
// IN` returns NULL for NULL inputs — exactly the behavior we want.
const LEGACY_HIDDEN_MESSAGE_SOURCES = [
  "team_up_request",
  "team_up_note",
  "system_connected",
] as const;
const notLegacyMessageSource = notInArray(
  messagesTable.source,
  LEGACY_HIDDEN_MESSAGE_SOURCES as unknown as string[],
);
/**
 * Aggregate unread count across every entity the caller participates
 * in. Used by the bell / inbox tab badge.
 *
 * Registered BEFORE the `/messages/:otherTarget` 410 stub so Express
 * matches this static path first — otherwise the bell badge route
 * would 410 with `dm_removed` and the badge count would silently
 * always be zero.
 */
router.get(
  "/messages/unanswered-count",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const ids = await approvedEntityIdsFor(userId);
    if (ids.length === 0) {
      res.json({ count: 0 });
      return;
    }
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(messagesTable)
      .where(
        and(
          inArray(messagesTable.entityId, ids),
          ne(messagesTable.senderClerkId, userId),
          eq(messagesTable.isRead, false),
          notLegacyMessageSource,
        ),
      );
    res.json({ count: Number(rows[0]?.count ?? 0) });
  },
);

router.get("/messages", requireAuth, dmGone);
router.get("/messages/:otherTarget", requireAuth, dmGone);
router.post("/messages/:otherTarget", requireAuth, dmGone);

// ---------------------------------------------------------------------------
// Entity-scoped messaging — handlers extracted so the property-id
// aliases below can delegate without a recursive router.handle hop.
// ---------------------------------------------------------------------------

async function listEntityMessages(
  req: Request,
  res: Response,
  entityId: number,
): Promise<void> {
  const { userId } = req as AuthRequest;
  if (!Number.isFinite(entityId) || entityId <= 0) {
    res.status(400).json({ error: "Invalid entityId" });
    return;
  }
  if (!(await canParticipateInEntity(userId, entityId))) {
    res.status(403).json({ error: "Not a member of this entity" });
    return;
  }
  const limit = Math.min(parseInt(String(req.query.limit ?? "100"), 10), 200);
  const offset = parseInt(String(req.query.offset ?? "0"), 10);

  const msgs = await db
    .select()
    .from(messagesTable)
    .where(and(eq(messagesTable.entityId, entityId), notLegacyMessageSource))
    .orderBy(desc(messagesTable.createdAt))
    .limit(limit)
    .offset(offset);

  // Mark inbound rows read for the caller (matches DM behavior — the
  // unread badge clears when the thread is opened).
  await db
    .update(messagesTable)
    .set({ isRead: true })
    .where(
      and(
        eq(messagesTable.entityId, entityId),
        ne(messagesTable.senderClerkId, userId),
        eq(messagesTable.isRead, false),
      ),
    );

  const senderIds = [...new Set(msgs.map((m) => m.senderClerkId))];
  const senders = senderIds.length
    ? await db
        .select(publicUserColumns)
        .from(usersTable)
        .where(inArray(usersTable.clerkId, senderIds))
    : [];
  const senderMap = Object.fromEntries(senders.map((u) => [u.clerkId, u]));

  // #640 — Per-skin "show last initial only" toggle. For each message
  // attributed to an outward account whose owner has the flag ON, the
  // sender's name renders as "First L." in the thread payload. The
  // viewer's own messages keep their full name (the viewer knows their
  // own identity).
  const senderAccountIds = [
    ...new Set(
      msgs
        .map((m) => m.senderOutwardAccountId)
        .filter((id): id is number => typeof id === "number"),
    ),
  ];
  const lastInitialOnlyByAccountId = new Map<number, boolean>();
  if (senderAccountIds.length > 0) {
    const acctRows = await db
      .select({
        id: outwardAccountsTable.id,
        lastInitialOnly: outwardAccountsTable.lastInitialOnly,
      })
      .from(outwardAccountsTable)
      .where(inArray(outwardAccountsTable.id, senderAccountIds));
    for (const r of acctRows) lastInitialOnlyByAccountId.set(r.id, r.lastInitialOnly);
  }

  const enriched = msgs.map((m) => {
    const baseSender = senderMap[m.senderClerkId] ?? null;
    if (!baseSender || !baseSender.name || m.senderClerkId === userId) {
      return { ...m, sender: baseSender };
    }
    const flag =
      m.senderOutwardAccountId != null
        ? lastInitialOnlyByAccountId.get(m.senderOutwardAccountId) ?? false
        : false;
    if (!flag) return { ...m, sender: baseSender };
    const shortened = formatOwnerNameForSkin(baseSender.name, true);
    return {
      ...m,
      sender: { ...baseSender, name: shortened ?? baseSender.name },
    };
  });
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(messagesTable)
    .where(and(eq(messagesTable.entityId, entityId), notLegacyMessageSource));
  res.json({ messages: enriched, total: Number(count) });
}

async function postEntityMessage(
  req: Request,
  res: Response,
  entityId: number,
): Promise<void> {
  const ar = req as AuthRequest;
  const { userId } = ar;
  const accountId = await activeAccountIdFor(ar);
  const { content } = (req.body ?? {}) as { content?: unknown };

  if (!Number.isFinite(entityId) || entityId <= 0) {
    res.status(400).json({ error: "Invalid entityId" });
    return;
  }
  if (typeof content !== "string" || content.trim() === "") {
    res.status(400).json({ error: "Content is required" });
    return;
  }
  if (accountId == null) {
    res.status(409).json({ error: "Account not ready" });
    return;
  }
  if (!(await canParticipateInEntity(userId, entityId))) {
    res.status(403).json({ error: "Not a member of this entity" });
    return;
  }

  const linkedPropertyId = await propertyIdForEntity(entityId);
  const actedByClerkId = ar.actingAsTeamSeat ? userId : null;

  const [msg] = await db
    .insert(messagesTable)
    .values({
      senderClerkId: userId,
      recipientClerkId: null,
      senderOutwardAccountId: accountId,
      recipientOutwardAccountId: null,
      entityId,
      propertyId: linkedPropertyId,
      content,
      actedByClerkId,
      createdInModeId:
        (ar as { activeModeId?: number | null }).activeModeId ?? null,
      toModeId: null,
    })
    .returning();

  const [sender] = await db
    .select(publicUserColumns)
    .from(usersTable)
    .where(eq(usersTable.clerkId, userId));
  const [entity] = await db
    .select({ name: entitiesTable.name })
    .from(entitiesTable)
    .where(eq(entitiesTable.id, entityId));

  void (async () => {
    try {
      const otherMembers = await db
        .select({
          userClerkId: entityMembersTable.userClerkId,
          userOutwardAccountId: entityMembersTable.userOutwardAccountId,
        })
        .from(entityMembersTable)
        .where(
          and(
            eq(entityMembersTable.entityId, entityId),
            eq(entityMembersTable.status, "approved"),
            ne(entityMembersTable.userClerkId, userId),
            isNull(entityMembersTable.archivedAt),
          ),
        );
      for (const m of otherMembers) {
        try {
          if (!(await shouldNotify(m.userClerkId, "message"))) continue;
          await insertNotifications({
            userClerkId: m.userClerkId,
            type: "message",
            title: "New message",
            body: `${sender?.name || "Someone"} posted in ${entity?.name ?? "a thread"}.`,
            relatedId: String(msg.id),
            ...(m.userOutwardAccountId != null
              ? { outwardAccountId: m.userOutwardAccountId }
              : {}),
          });
          void sendPushToUser(m.userClerkId, {
            title: "New message",
            body: `${sender?.name || "Someone"} posted in ${entity?.name ?? "a thread"}.`,
            data: {
              type: "message",
              messageId: msg.id,
              entityId,
              senderClerkId: userId,
              senderOutwardAccountId: accountId,
            },
          });
        } catch (perRecipientErr) {
          req.log?.error?.(
            {
              err: perRecipientErr,
              entityId,
              recipientClerkId: m.userClerkId,
            },
            "entity-thread broadcast: per-recipient delivery failed",
          );
        }
      }
    } catch (broadcastErr) {
      req.log?.error?.(
        { err: broadcastErr, entityId },
        "entity-thread broadcast: fan-out failed",
      );
    }
  })();

  res.status(201).json({ ...msg, sender });
}

async function markEntityRead(
  req: Request,
  res: Response,
  entityId: number,
): Promise<void> {
  const { userId } = req as AuthRequest;
  if (!Number.isFinite(entityId) || entityId <= 0) {
    res.status(400).json({ error: "Invalid entityId" });
    return;
  }
  if (!(await canParticipateInEntity(userId, entityId))) {
    res.status(403).json({ error: "Not a member of this entity" });
    return;
  }
  await db
    .update(messagesTable)
    .set({ isRead: true })
    .where(
      and(
        eq(messagesTable.entityId, entityId),
        ne(messagesTable.senderClerkId, userId),
        eq(messagesTable.isRead, false),
      ),
    );
  res.json({ readAt: new Date().toISOString() });
}

async function listMyEntityThreads(
  req: Request,
  res: Response,
): Promise<void> {
  const { userId } = req as AuthRequest;
  const entityIds = await approvedEntityIdsFor(userId);
  if (entityIds.length === 0) {
    res.json({ threads: [] });
    return;
  }
  const entities = await db
    .select({
      id: entitiesTable.id,
      kind: entitiesTable.kind,
      name: entitiesTable.name,
      coverColor: entitiesTable.coverColor,
      coverPhotoUrl: entitiesTable.coverPhotoUrl,
      logoUrl: entitiesTable.logoUrl,
    })
    .from(entitiesTable)
    .where(
      and(
        inArray(entitiesTable.id, entityIds),
        isNull(entitiesTable.archivedAt),
      ),
    );

  const latest = await db
    .selectDistinctOn([messagesTable.entityId], {
      id: messagesTable.id,
      entityId: messagesTable.entityId,
      content: messagesTable.content,
      createdAt: messagesTable.createdAt,
      senderClerkId: messagesTable.senderClerkId,
      senderOutwardAccountId: messagesTable.senderOutwardAccountId,
      source: messagesTable.source,
    })
    .from(messagesTable)
    .where(and(inArray(messagesTable.entityId, entityIds), notLegacyMessageSource))
    .orderBy(
      messagesTable.entityId,
      desc(messagesTable.createdAt),
      desc(messagesTable.id),
    );
  const latestByEntityId = new Map(latest.map((l) => [l.entityId, l]));

  const unreadRows = await db
    .select({
      entityId: messagesTable.entityId,
      unread: sql<number>`count(*)::int`.as("unread"),
    })
    .from(messagesTable)
    .where(
      and(
        inArray(messagesTable.entityId, entityIds),
        ne(messagesTable.senderClerkId, userId),
        eq(messagesTable.isRead, false),
        notLegacyMessageSource,
      ),
    )
    .groupBy(messagesTable.entityId);
  const unreadByEntityId = new Map(
    unreadRows
      .filter((r): r is { entityId: number; unread: number } =>
        typeof r.entityId === "number",
      )
      .map((r) => [r.entityId, Number(r.unread) || 0]),
  );

  const senderClerkIds = Array.from(
    new Set(
      latest
        .map((m) => m.senderClerkId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  const senders = senderClerkIds.length
    ? await db
        .select(publicUserColumns)
        .from(usersTable)
        .where(inArray(usersTable.clerkId, senderClerkIds))
    : [];
  const senderByClerkId = new Map(senders.map((s) => [s.clerkId, s]));

  // #640 — Per-skin "show last initial only" toggle. The thread row's
  // lastMessage.sender block is shortened to "First L." when the
  // sender's outward account has the flag ON. The viewer's own
  // last-message preview keeps their full name.
  const senderAccountIds = Array.from(
    new Set(
      latest
        .map((m) => m.senderOutwardAccountId)
        .filter((id): id is number => typeof id === "number"),
    ),
  );
  const lastInitialOnlyByAccountId = new Map<number, boolean>();
  if (senderAccountIds.length > 0) {
    const acctRows = await db
      .select({
        id: outwardAccountsTable.id,
        lastInitialOnly: outwardAccountsTable.lastInitialOnly,
      })
      .from(outwardAccountsTable)
      .where(inArray(outwardAccountsTable.id, senderAccountIds));
    for (const r of acctRows) lastInitialOnlyByAccountId.set(r.id, r.lastInitialOnly);
  }

  const threads = entities
    .map((e) => {
      const last = latestByEntityId.get(e.id);
      let senderForLast = last?.senderClerkId
        ? senderByClerkId.get(last.senderClerkId) ?? null
        : null;
      if (
        last &&
        senderForLast &&
        senderForLast.name &&
        last.senderClerkId !== userId
      ) {
        const flag =
          last.senderOutwardAccountId != null
            ? lastInitialOnlyByAccountId.get(last.senderOutwardAccountId) ?? false
            : false;
        if (flag) {
          const shortened = formatOwnerNameForSkin(senderForLast.name, true);
          senderForLast = { ...senderForLast, name: shortened ?? senderForLast.name };
        }
      }
      const lastMessage = last
        ? {
            id: last.id,
            entityId: last.entityId,
            content: last.content,
            createdAt: last.createdAt,
            senderClerkId: last.senderClerkId,
            source: last.source,
            sender: senderForLast,
          }
        : null;
      return {
        entityId: e.id,
        entityKind: e.kind,
        entityName: e.name,
        coverColor: e.coverColor,
        coverPhotoUrl: e.coverPhotoUrl,
        logoUrl: e.logoUrl,
        lastMessage,
        unreadCount: unreadByEntityId.get(e.id) ?? 0,
      };
    })
    .sort((a, b) => {
      const aT = a.lastMessage
        ? new Date(a.lastMessage.createdAt as unknown as string).getTime()
        : 0;
      const bT = b.lastMessage
        ? new Date(b.lastMessage.createdAt as unknown as string).getTime()
        : 0;
      return bT - aT;
    });

  res.json({ threads });
}

router.get(
  "/entities/:entityId/messages",
  requireAuth,
  async (req, res): Promise<void> => {
    const entityId = Number.parseInt(String(req.params.entityId), 10);
    await listEntityMessages(req, res, entityId);
  },
);
router.post(
  "/entities/:entityId/messages",
  requireAuth,
  async (req, res): Promise<void> => {
    const entityId = Number.parseInt(String(req.params.entityId), 10);
    await postEntityMessage(req, res, entityId);
  },
);
router.post(
  "/entities/:entityId/messages/read",
  requireAuth,
  async (req, res): Promise<void> => {
    const entityId = Number.parseInt(String(req.params.entityId), 10);
    await markEntityRead(req, res, entityId);
  },
);
router.get("/entities/me/threads", requireAuth, listMyEntityThreads);

// ---------------------------------------------------------------------------
// Property-scoped aliases. Each one resolves the property's linked
// entity id and delegates to the entity handler. The membership check
// inside the handler reads from `entity_members`.
// ---------------------------------------------------------------------------

async function entityIdForPropertyOr400(
  rawId: unknown,
  res: Response,
): Promise<number | null> {
  const propertyId = Number.parseInt(String(rawId), 10);
  if (!Number.isFinite(propertyId)) {
    res.status(400).json({ error: "Invalid propertyId" });
    return null;
  }
  const entityId = await entityIdForProperty(propertyId);
  if (entityId == null) {
    res
      .status(404)
      .json({ error: "Property has no linked entity yet — try again." });
    return null;
  }
  return entityId;
}

router.get(
  "/properties/:propertyId/messages",
  requireAuth,
  async (req, res): Promise<void> => {
    const entityId = await entityIdForPropertyOr400(req.params.propertyId, res);
    if (entityId == null) return;
    await listEntityMessages(req, res, entityId);
  },
);
router.post(
  "/properties/:propertyId/messages",
  requireAuth,
  async (req, res): Promise<void> => {
    const entityId = await entityIdForPropertyOr400(req.params.propertyId, res);
    if (entityId == null) return;
    await postEntityMessage(req, res, entityId);
  },
);
router.post(
  "/properties/:propertyId/messages/read",
  requireAuth,
  async (req, res): Promise<void> => {
    const entityId = await entityIdForPropertyOr400(req.params.propertyId, res);
    if (entityId == null) return;
    await markEntityRead(req, res, entityId);
  },
);
router.get("/properties/me/threads", requireAuth, listMyEntityThreads);

export default router;

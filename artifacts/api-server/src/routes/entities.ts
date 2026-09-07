/**
 * Entity routes — the canonical workspace primitive.
 *
 * Entities (business, residential_property, commercial_property)
 * represent a workspace that an avatar (outward_account) controls.
 * Avatars participate in entities via `entity_members`. Tasks #663 and
 * #662 made this the only relationship primitive: people don't
 * connect to people; they share entities.
 *
 * Schema reference:
 *   - lib/db/src/schema/entities.ts                  (base entity)
 *   - lib/db/src/schema/entity_business_details.ts   (business sidecar)
 *   - lib/db/src/schema/entity_members.ts            (membership)
 */
import { Router, type IRouter } from "express";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  entitiesTable,
  entityBusinessDetailsTable,
  entityMembersTable,
  messagesTable,
  outwardAccountsTable,
  usersTable,
  type EntityKind,
  type EntityMemberRole,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { resolveActiveOutwardAccountId } from "../lib/outwardAccounts";
import { isAdminDemoClerkId } from "../lib/adminDemo";
import { autoCastMembership, canControlEntity } from "../lib/autoCast";
import { canParticipateInEntity, getApprovedMembership } from "../lib/entityAccess";
import { insertNotifications } from "../lib/insertNotifications";
import { sendPushToUser } from "../lib/push";

const router: IRouter = Router();

const ENTITY_KINDS = new Set<EntityKind>([
  "business",
  "residential_property",
  "commercial_property",
]);

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isManagerRole(role: EntityMemberRole | string | null): boolean {
  return role === "owner" || role === "admin" || role === "manager";
}

/**
 * POST /entities — found a new entity (business / property).
 *
 * The active avatar becomes the controlling avatar. Caller must be
 * acting as an avatar that's allowed to control the chosen entity
 * kind (Trade Pro / Facilities for business, Homeowner for
 * residential, Homeowner / Facility Manager for commercial).
 */
router.post("/entities", requireAuth, async (req, res): Promise<void> => {
  const { userId, activeOutwardAccountId: hdrId } = req as AuthRequest;
  const activeOutwardAccountId =
    hdrId ?? (await resolveActiveOutwardAccountId(userId));

  if (activeOutwardAccountId == null) {
    res
      .status(400)
      .json({ error: "No active outward account — switch into an avatar first." });
    return;
  }

  const [activeAccount] = await db
    .select()
    .from(outwardAccountsTable)
    .where(eq(outwardAccountsTable.id, activeOutwardAccountId));
  if (!activeAccount || activeAccount.ownerClerkId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const kindRaw = (cleanString(req.body?.kind) ?? "business").toLowerCase();
  if (!ENTITY_KINDS.has(kindRaw as EntityKind)) {
    res.status(400).json({ error: "Invalid entity kind" });
    return;
  }
  const entityKind = kindRaw as EntityKind;

  if (!canControlEntity(activeAccount.kind, entityKind)) {
    res.status(400).json({
      error:
        "This avatar can't control an entity of that kind — switch avatars and try again.",
    });
    return;
  }

  const name =
    cleanString(req.body?.displayName) ??
    cleanString(req.body?.name);
  if (!name) {
    res.status(400).json({ error: "displayName is required" });
    return;
  }
  const legalName = cleanString(req.body?.legalName);
  const tagline = cleanString(req.body?.tagline);

  const isDemo = await isAdminDemoClerkId(userId);

  const [entity] = await db
    .insert(entitiesTable)
    .values({
      kind: entityKind,
      name,
      controllerOutwardAccountId: activeOutwardAccountId,
      controllerUserClerkId: userId,
      createdByUserClerkId: userId,
      isAdminDemo: isDemo,
    })
    .returning();

  if (entityKind === "business" && (legalName || tagline)) {
    await db.insert(entityBusinessDetailsTable).values({
      entityId: entity.id,
      companyName: legalName,
      tagline,
    });
  }

  await db.insert(entityMembersTable).values({
    entityId: entity.id,
    userClerkId: userId,
    userOutwardAccountId: activeOutwardAccountId,
    role: "owner",
    status: "approved",
    direction: "invite",
    requestedByOutwardAccountId: activeOutwardAccountId,
    decidedAt: new Date(),
  });

  const [details] = await db
    .select()
    .from(entityBusinessDetailsTable)
    .where(eq(entityBusinessDetailsTable.entityId, entity.id));

  res.status(201).json({ ...entity, businessDetails: details ?? null });
});

/**
 * GET /entities/mine — every entity the active avatar founded or is
 * an approved member of (across all entity kinds).
 */
router.get("/entities/mine", requireAuth, async (req, res): Promise<void> => {
  const { userId, activeOutwardAccountId: hdrId } = req as AuthRequest;
  const activeOutwardAccountId =
    hdrId ?? (await resolveActiveOutwardAccountId(userId));

  if (activeOutwardAccountId == null) {
    res.json({ entities: [] });
    return;
  }

  const memberships = await db
    .select()
    .from(entityMembersTable)
    .where(
      and(
        eq(entityMembersTable.userOutwardAccountId, activeOutwardAccountId),
        eq(entityMembersTable.userClerkId, userId),
        eq(entityMembersTable.status, "approved"),
        isNull(entityMembersTable.archivedAt),
      ),
    );

  const entityIds = memberships.map((m) => m.entityId);
  if (entityIds.length === 0) {
    res.json({ entities: [] });
    return;
  }

  const kindFilter = cleanString(
    typeof req.query.kind === "string" ? req.query.kind : null,
  );

  const where = [
    inArray(entitiesTable.id, entityIds),
    isNull(entitiesTable.archivedAt),
  ];
  if (kindFilter && ENTITY_KINDS.has(kindFilter as EntityKind)) {
    where.push(eq(entitiesTable.kind, kindFilter as EntityKind));
  }

  const entities = await db
    .select()
    .from(entitiesTable)
    .where(and(...where));

  const detailsRows =
    entities.length > 0
      ? await db
          .select()
          .from(entityBusinessDetailsTable)
          .where(
            inArray(
              entityBusinessDetailsTable.entityId,
              entities.map((e) => e.id),
            ),
          )
      : [];
  const detailsMap = new Map(detailsRows.map((d) => [d.entityId, d] as const));
  const memberMap = new Map(memberships.map((m) => [m.entityId, m] as const));

  res.json({
    entities: entities.map((e) => ({
      id: e.id,
      kind: e.kind,
      displayName: e.name,
      bio: e.bio,
      logoUrl: e.logoUrl,
      coverPhotoUrl: e.coverPhotoUrl,
      coverColor: e.coverColor,
      controllerOutwardAccountId: e.controllerOutwardAccountId,
      controllerUserClerkId: e.controllerUserClerkId,
      createdByUserClerkId: e.createdByUserClerkId,
      isAdminDemo: e.isAdminDemo,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      businessDetails: detailsMap.get(e.id) ?? null,
      myMembership: memberMap.get(e.id) ?? null,
    })),
  });
});

/**
 * GET /entities/:id — entity profile (anyone may read public fields,
 * but membership is required for private surfaces). For now we return
 * a flat shape for any caller; route-level authorization will tighten
 * up as private fields are added.
 */
router.get("/entities/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid entity id" });
    return;
  }
  const [entity] = await db
    .select()
    .from(entitiesTable)
    .where(eq(entitiesTable.id, id));
  if (!entity) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }
  const [details] = await db
    .select()
    .from(entityBusinessDetailsTable)
    .where(eq(entityBusinessDetailsTable.entityId, id));
  res.json({ ...entity, businessDetails: details ?? null });
});

/**
 * GET /entities/:id/members — list every membership row on the entity
 * (any status). Caller must already be an approved member.
 */
router.get(
  "/entities/:id/members",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid entity id" });
      return;
    }
    if (!(await canParticipateInEntity(userId, id))) {
      res.status(403).json({ error: "Not a member of this entity" });
      return;
    }
    const rows = await db
      .select()
      .from(entityMembersTable)
      .where(eq(entityMembersTable.entityId, id));
    const userClerkIds = [...new Set(rows.map((r) => r.userClerkId))];
    const accountIds = [
      ...new Set(rows.map((r) => r.userOutwardAccountId)),
    ];
    const [users, accounts] = await Promise.all([
      userClerkIds.length
        ? db
            .select({
              clerkId: usersTable.clerkId,
              name: usersTable.name,
              avatarUrl: usersTable.avatarUrl,
              username: usersTable.username,
            })
            .from(usersTable)
            .where(inArray(usersTable.clerkId, userClerkIds))
        : Promise.resolve([]),
      accountIds.length
        ? db
            .select({
              id: outwardAccountsTable.id,
              kind: outwardAccountsTable.kind,
              displayName: outwardAccountsTable.displayName,
              avatarUrl: outwardAccountsTable.avatarUrl,
              companyName: outwardAccountsTable.companyName,
            })
            .from(outwardAccountsTable)
            .where(inArray(outwardAccountsTable.id, accountIds))
        : Promise.resolve([]),
    ]);
    const userMap = new Map(users.map((u) => [u.clerkId, u]));
    const acctMap = new Map(accounts.map((a) => [a.id, a]));
    res.json({
      members: rows.map((r) => ({
        ...r,
        user: userMap.get(r.userClerkId) ?? null,
        outwardAccount: acctMap.get(r.userOutwardAccountId) ?? null,
      })),
    });
  },
);

interface InvitePayload {
  /**
   * Outward account being invited / requested. The membership row's
   * userOutwardAccountId. Required.
   */
  targetOutwardAccountId?: unknown;
  /**
   * Optional intent — defaults to "invite" (controller adding someone
   * else). Pass "request" to issue a self-request to be added.
   */
  intent?: unknown;
}

/**
 * POST /entities/:id/members — invite a person to (or request access
 * to) an entity. The role + direction are auto-cast from the avatar
 * pair; the client never sends a role.
 *
 * Auto-creates the row with `status='invited'` (controller-initiated)
 * or `status='requested'` (joiner-initiated). Notifies the recipient
 * via the `notifications` table — there is no separate invite table.
 *
 * Idempotent on a (entityId, targetOutwardAccountId) pair: re-inviting
 * a previously-declined or removed row reactivates it.
 */
router.post(
  "/entities/:id/members",
  requireAuth,
  async (req, res): Promise<void> => {
    const ar = req as AuthRequest;
    const { userId } = ar;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid entity id" });
      return;
    }
    const body = (req.body ?? {}) as InvitePayload;
    const targetOutwardAccountId = Number(body.targetOutwardAccountId);
    if (!Number.isFinite(targetOutwardAccountId) || targetOutwardAccountId <= 0) {
      res.status(400).json({ error: "targetOutwardAccountId is required" });
      return;
    }
    const intent: "invite" | "request" =
      body.intent === "request" ? "request" : "invite";

    const inviterAccountId =
      ar.activeOutwardAccountId ??
      (await resolveActiveOutwardAccountId(userId));
    if (inviterAccountId == null) {
      res.status(409).json({ error: "Account not ready" });
      return;
    }

    const [entity] = await db
      .select()
      .from(entitiesTable)
      .where(eq(entitiesTable.id, id));
    if (!entity || entity.archivedAt) {
      res.status(404).json({ error: "Entity not found" });
      return;
    }

    const [inviterAccount] = await db
      .select()
      .from(outwardAccountsTable)
      .where(eq(outwardAccountsTable.id, inviterAccountId));
    if (!inviterAccount || inviterAccount.ownerClerkId !== userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const [targetAccount] = await db
      .select()
      .from(outwardAccountsTable)
      .where(eq(outwardAccountsTable.id, targetOutwardAccountId));
    if (!targetAccount) {
      res.status(404).json({ error: "Target avatar not found" });
      return;
    }
    if (targetAccount.ownerClerkId === userId && intent === "invite") {
      res.status(400).json({ error: "Cannot invite yourself" });
      return;
    }

    // Authorization for invite: caller must be an approved
    // manager-or-better member of the entity.
    //
    // Authorization for request: anyone can request to join an entity
    // they're not on, BUT the requested membership target must be one
    // of the caller's own avatars — you can't create a `requested`
    // row on someone else's behalf, which would otherwise let any
    // authenticated user litter another user's profile with bogus
    // pending requests (and could be auto-approved by an
    // unsuspecting controller).
    if (intent === "invite") {
      const myMembership = await getApprovedMembership(userId, id);
      if (!myMembership || !isManagerRole(myMembership.role)) {
        res.status(403).json({
          error: "Only entity admins can invite members",
        });
        return;
      }
    } else {
      if (targetAccount.ownerClerkId !== userId) {
        res.status(403).json({
          error: "Can only request membership for one of your own avatars",
        });
        return;
      }
    }

    const cast = autoCastMembership({
      inviterAvatarKind:
        intent === "invite" ? inviterAccount.kind : targetAccount.kind,
      targetAvatarKind:
        intent === "invite" ? targetAccount.kind : inviterAccount.kind,
      entityKind: entity.kind,
      intent,
    });

    // Idempotent: look for an existing row for the (entity, target) pair.
    const [existing] = await db
      .select()
      .from(entityMembersTable)
      .where(
        and(
          eq(entityMembersTable.entityId, id),
          eq(
            entityMembersTable.userOutwardAccountId,
            targetOutwardAccountId,
          ),
          eq(entityMembersTable.userClerkId, targetAccount.ownerClerkId),
        ),
      )
      .limit(1);

    let memberRow: typeof entityMembersTable.$inferSelect;
    if (existing) {
      if (
        existing.status === "approved" &&
        existing.archivedAt == null
      ) {
        res.status(409).json({
          error: "Already an active member of this entity",
          code: "already_member",
        });
        return;
      }
      const desiredStatus = intent === "invite" ? "invited" : "requested";
      const [updated] = await db
        .update(entityMembersTable)
        .set({
          role: cast.role,
          status: desiredStatus,
          direction: cast.direction,
          requestedByOutwardAccountId: inviterAccountId,
          decidedAt: null,
          archivedAt: null,
        })
        .where(eq(entityMembersTable.id, existing.id))
        .returning();
      memberRow = updated;
    } else {
      const [inserted] = await db
        .insert(entityMembersTable)
        .values({
          entityId: id,
          userClerkId: targetAccount.ownerClerkId,
          userOutwardAccountId: targetOutwardAccountId,
          role: cast.role,
          status: intent === "invite" ? "invited" : "requested",
          direction: cast.direction,
          requestedByOutwardAccountId: inviterAccountId,
        })
        .returning();
      memberRow = inserted;
    }

    // Notify the recipient. The notification's `relatedId` points at
    // the canonical entity_members row — the bell-tapped invite modal
    // loads the row directly. Dismissing the notification does not
    // delete or alter the underlying invite.
    const [inviterUser] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.clerkId, userId));
    const recipientClerkId =
      intent === "invite" ? targetAccount.ownerClerkId : entity.controllerUserClerkId;
    const notifType = intent === "invite" ? "entity_invite" : "entity_request";
    const inviterName = inviterUser?.name?.trim() || "Someone";
    const title =
      intent === "invite"
        ? inviterName
        : `${inviterName} requests access`;
    const body2 =
      intent === "invite"
        ? `Invited you to ${entity.name}.`
        : `Asked to join ${entity.name}.`;

    await insertNotifications({
      userClerkId: recipientClerkId,
      type: notifType,
      title,
      body: body2,
      relatedId: String(memberRow.id),
      outwardAccountId:
        intent === "invite"
          ? targetOutwardAccountId
          : entity.controllerOutwardAccountId,
    });

    void sendPushToUser(recipientClerkId, {
      title,
      body: body2,
      data: {
        type: notifType,
        entityId: id,
        entityMemberId: memberRow.id,
      },
    });

    res.status(201).json({ member: memberRow });
  },
);

/**
 * POST /entities/members/:memberId/respond — accept or decline an
 * invite (or, for the entity controller, an inbound request). Flips
 * the same `entity_members` row in place — never writes a parallel
 * record.
 */
router.post(
  "/entities/members/:memberId/respond",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const memberId = Number(req.params.memberId);
    if (!Number.isFinite(memberId) || memberId <= 0) {
      res.status(400).json({ error: "Invalid member id" });
      return;
    }
    const action = req.body?.action;
    if (action !== "accept" && action !== "decline") {
      res.status(400).json({ error: "action must be 'accept' or 'decline'" });
      return;
    }

    const [row] = await db
      .select()
      .from(entityMembersTable)
      .where(eq(entityMembersTable.id, memberId));
    if (!row) {
      res.status(404).json({ error: "Membership not found" });
      return;
    }
    const [entity] = await db
      .select()
      .from(entitiesTable)
      .where(eq(entitiesTable.id, row.entityId));
    if (!entity) {
      res.status(404).json({ error: "Entity not found" });
      return;
    }

    // Authorization:
    //  - status='invited' → recipient (the avatar on the row) decides
    //  - status='requested' → an entity admin decides
    if (row.status === "invited") {
      if (row.userClerkId !== userId) {
        res.status(403).json({ error: "Not your invite" });
        return;
      }
    } else if (row.status === "requested") {
      const myMembership = await getApprovedMembership(userId, row.entityId);
      if (!myMembership || !isManagerRole(myMembership.role)) {
        res.status(403).json({
          error: "Only entity admins can respond to access requests",
        });
        return;
      }
    } else {
      res.status(409).json({
        error: "Membership is not awaiting a response",
        code: "not_pending",
      });
      return;
    }

    const now = new Date();
    const newStatus = action === "accept" ? "approved" : "declined";
    const [updated] = await db
      .update(entityMembersTable)
      .set({ status: newStatus, decidedAt: now })
      .where(eq(entityMembersTable.id, memberId))
      .returning();

    // Close-the-loop side effects on accept (mirrors the invite-creation
    // notify pattern above so the inviter learns the invite landed and the
    // shared thread shows a visible join event).
    if (action === "accept") {
      try {
        const [joiner] = await db
          .select({ name: usersTable.name })
          .from(usersTable)
          .where(eq(usersTable.clerkId, row.userClerkId));
        const joinerName = joiner?.name?.trim() || "Someone";

        // 1) System message in the entity thread: "<Name> joined <Entity>."
        //    senderClerkId is the new member; `source = "system_member_joined"`
        //    marks it for any future special rendering. recipientClerkId is
        //    null since entity-thread sends are broadcast (matches the
        //    sendEntityMessage pattern in routes/messages.ts).
        await db.insert(messagesTable).values({
          senderClerkId: row.userClerkId,
          recipientClerkId: null,
          senderOutwardAccountId: row.userOutwardAccountId,
          recipientOutwardAccountId: null,
          entityId: row.entityId,
          propertyId: null,
          content: `${joinerName} joined ${entity.name}.`,
          source: "system_member_joined",
          actedByClerkId: null,
          createdInModeId: null,
          toModeId: null,
        });

        // 2) Notify whoever was waiting on the response.
        //    - row.status === "invited" → recipient accepted; notify inviter
        //      (resolved via requestedByOutwardAccountId → ownerClerkId).
        //    - row.status === "requested" → admin approved; notify the
        //      original requester (row.userClerkId).
        let notifyClerkId: string | null = null;
        let notifyOutwardAccountId: number | null = null;
        let notifTitle = "";
        let notifBody = "";
        if (row.status === "invited") {
          if (row.requestedByOutwardAccountId != null) {
            const [inviterOA] = await db
              .select({ ownerClerkId: outwardAccountsTable.ownerClerkId })
              .from(outwardAccountsTable)
              .where(eq(outwardAccountsTable.id, row.requestedByOutwardAccountId));
            notifyClerkId = inviterOA?.ownerClerkId ?? null;
            notifyOutwardAccountId = row.requestedByOutwardAccountId;
          }
          notifTitle = joinerName;
          notifBody = `Joined ${entity.name}.`;
        } else if (row.status === "requested") {
          notifyClerkId = row.userClerkId;
          notifyOutwardAccountId = row.userOutwardAccountId;
          notifTitle = "Request approved";
          notifBody = `You're in at ${entity.name}.`;
        }

        if (notifyClerkId) {
          await insertNotifications({
            userClerkId: notifyClerkId,
            type: "entity_member_accepted",
            title: notifTitle,
            body: notifBody,
            relatedId: String(memberId),
            ...(notifyOutwardAccountId != null
              ? { outwardAccountId: notifyOutwardAccountId }
              : {}),
          });
          void sendPushToUser(notifyClerkId, {
            title: notifTitle,
            body: notifBody,
            data: {
              type: "entity_member_accepted",
              entityId: row.entityId,
              entityMemberId: memberId,
            },
          });
        }
      } catch (sideEffectErr) {
        req.log?.error?.(
          { err: sideEffectErr, memberId, entityId: row.entityId },
          "respond-to-membership: accept side-effects failed (notification or system message); membership flip already persisted",
        );
      }
    }

    res.json({ member: updated });
  },
);

/**
 * DELETE /entities/:id/members/:memberId — remove a membership.
 * Owners can remove anyone except themselves; members can self-leave.
 */
router.delete(
  "/entities/:id/members/:memberId",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const entityId = Number(req.params.id);
    const memberId = Number(req.params.memberId);
    if (!Number.isFinite(entityId) || !Number.isFinite(memberId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [row] = await db
      .select()
      .from(entityMembersTable)
      .where(
        and(
          eq(entityMembersTable.id, memberId),
          eq(entityMembersTable.entityId, entityId),
        ),
      );
    if (!row) {
      res.status(404).json({ error: "Membership not found" });
      return;
    }
    if (row.role === "owner") {
      res.status(400).json({ error: "Cannot remove the owner" });
      return;
    }
    const isSelf = row.userClerkId === userId;
    if (!isSelf) {
      const myMembership = await getApprovedMembership(userId, entityId);
      if (!myMembership || !isManagerRole(myMembership.role)) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }
    await db
      .update(entityMembersTable)
      .set({ status: "removed", archivedAt: new Date() })
      .where(eq(entityMembersTable.id, memberId));
    res.json({ ok: true });
  },
);

/**
 * GET /entities/me/invites — every `entity_members` row where the
 * viewer is the target and `status='invited'`. The Invites screen
 * reads this directly — no separate invites table.
 */
router.get(
  "/entities/me/invites",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const rows = await db
      .select()
      .from(entityMembersTable)
      .where(
        and(
          eq(entityMembersTable.userClerkId, userId),
          eq(entityMembersTable.status, "invited"),
          isNull(entityMembersTable.archivedAt),
        ),
      );
    if (rows.length === 0) {
      res.json({ invites: [] });
      return;
    }
    const entityIds = [...new Set(rows.map((r) => r.entityId))];
    const inviterAccountIds = [
      ...new Set(
        rows
          .map((r) => r.requestedByOutwardAccountId)
          .filter((v): v is number => v != null),
      ),
    ];
    const [entities, inviterAccounts] = await Promise.all([
      db
        .select()
        .from(entitiesTable)
        .where(inArray(entitiesTable.id, entityIds)),
      inviterAccountIds.length
        ? db
            .select({
              id: outwardAccountsTable.id,
              kind: outwardAccountsTable.kind,
              displayName: outwardAccountsTable.displayName,
              avatarUrl: outwardAccountsTable.avatarUrl,
              companyName: outwardAccountsTable.companyName,
              ownerClerkId: outwardAccountsTable.ownerClerkId,
            })
            .from(outwardAccountsTable)
            .where(inArray(outwardAccountsTable.id, inviterAccountIds))
        : Promise.resolve([]),
    ]);
    const inviterClerkIds = [
      ...new Set(inviterAccounts.map((a) => a.ownerClerkId)),
    ];
    const inviterUsers = inviterClerkIds.length
      ? await db
          .select({
            clerkId: usersTable.clerkId,
            name: usersTable.name,
            avatarUrl: usersTable.avatarUrl,
          })
          .from(usersTable)
          .where(inArray(usersTable.clerkId, inviterClerkIds))
      : [];
    const entMap = new Map(entities.map((e) => [e.id, e]));
    const acctMap = new Map(inviterAccounts.map((a) => [a.id, a]));
    const userMap = new Map(inviterUsers.map((u) => [u.clerkId, u]));
    res.json({
      invites: rows.map((r) => {
        const entity = entMap.get(r.entityId);
        const inviterAccount =
          r.requestedByOutwardAccountId != null
            ? acctMap.get(r.requestedByOutwardAccountId)
            : null;
        const inviterUser = inviterAccount
          ? userMap.get(inviterAccount.ownerClerkId)
          : null;
        return {
          id: r.id,
          entityId: r.entityId,
          status: r.status,
          role: r.role,
          direction: r.direction,
          createdAt: r.createdAt,
          decidedAt: r.decidedAt,
          entity: entity
            ? {
                id: entity.id,
                kind: entity.kind,
                name: entity.name,
                logoUrl: entity.logoUrl,
                coverPhotoUrl: entity.coverPhotoUrl,
                coverColor: entity.coverColor,
              }
            : null,
          inviter: inviterAccount
            ? {
                outwardAccountId: inviterAccount.id,
                kind: inviterAccount.kind,
                displayName:
                  inviterUser?.name ??
                  inviterAccount.displayName ??
                  inviterAccount.companyName ??
                  "Someone",
                avatarUrl:
                  inviterUser?.avatarUrl ?? inviterAccount.avatarUrl ?? null,
              }
            : null,
        };
      }),
    });
  },
);

/**
 * GET /entities/auto-cast/preview — returns the role + direction that
 * `POST /entities/:id/members` would auto-cast given the viewer's
 * active avatar and a (target avatar, entity) pair. The Add-to-entity
 * sheet uses this to show the "Add Sam to Sarah's Dallas Home as
 * worker" preview before the user confirms.
 *
 * Also returns the inviter's viable host entities (kind-aware) so the
 * sheet can decide whether to show the entity picker at all.
 */
router.get(
  "/entities/auto-cast/preview",
  requireAuth,
  async (req, res): Promise<void> => {
    const ar = req as AuthRequest;
    const { userId } = ar;
    const inviterAccountId =
      ar.activeOutwardAccountId ??
      (await resolveActiveOutwardAccountId(userId));
    if (inviterAccountId == null) {
      res.status(409).json({ error: "Account not ready" });
      return;
    }
    const targetOutwardAccountId = Number(req.query.targetOutwardAccountId);
    if (!Number.isFinite(targetOutwardAccountId) || targetOutwardAccountId <= 0) {
      res.status(400).json({ error: "targetOutwardAccountId required" });
      return;
    }
    const [inviterAccount, targetAccount] = await Promise.all([
      db
        .select()
        .from(outwardAccountsTable)
        .where(eq(outwardAccountsTable.id, inviterAccountId))
        .then((r) => r[0]),
      db
        .select()
        .from(outwardAccountsTable)
        .where(eq(outwardAccountsTable.id, targetOutwardAccountId))
        .then((r) => r[0]),
    ]);
    if (!inviterAccount || !targetAccount) {
      res.status(404).json({ error: "Avatar not found" });
      return;
    }

    // Viable host entities: every approved entity the inviter is on
    // where the inviter's role permits invites (manager-or-better).
    const myMemberships = await db
      .select()
      .from(entityMembersTable)
      .where(
        and(
          eq(entityMembersTable.userOutwardAccountId, inviterAccountId),
          eq(entityMembersTable.userClerkId, userId),
          eq(entityMembersTable.status, "approved"),
          isNull(entityMembersTable.archivedAt),
        ),
      );
    const candidateEntityIds = myMemberships
      .filter((m) => isManagerRole(m.role))
      .map((m) => m.entityId);
    if (candidateEntityIds.length === 0) {
      res.json({ entities: [], cast: null });
      return;
    }
    const entities = await db
      .select()
      .from(entitiesTable)
      .where(
        and(
          inArray(entitiesTable.id, candidateEntityIds),
          isNull(entitiesTable.archivedAt),
        ),
      );

    // Filter out entities the target is already on (any active status).
    const existingActive = await db
      .select({
        entityId: entityMembersTable.entityId,
        status: entityMembersTable.status,
      })
      .from(entityMembersTable)
      .where(
        and(
          inArray(entityMembersTable.entityId, candidateEntityIds),
          eq(
            entityMembersTable.userOutwardAccountId,
            targetOutwardAccountId,
          ),
          eq(entityMembersTable.userClerkId, targetAccount.ownerClerkId),
          isNull(entityMembersTable.archivedAt),
        ),
      );
    const blockedEntityIds = new Set(
      existingActive
        .filter((e) => e.status === "approved" || e.status === "invited")
        .map((e) => e.entityId),
    );

    const viable = entities.filter((e) => !blockedEntityIds.has(e.id));

    res.json({
      entities: viable.map((e) => ({
        id: e.id,
        kind: e.kind,
        name: e.name,
        logoUrl: e.logoUrl,
        coverPhotoUrl: e.coverPhotoUrl,
        coverColor: e.coverColor,
        cast: autoCastMembership({
          inviterAvatarKind: inviterAccount.kind,
          targetAvatarKind: targetAccount.kind,
          entityKind: e.kind,
        }),
      })),
    });
  },
);

// Tiny helper expected to exist in @workspace/db for sql tagged template
// — drizzle re-exports it but this file only imports from there.
// (No-op: keep tsc happy — imported above.)
void sql;

export default router;

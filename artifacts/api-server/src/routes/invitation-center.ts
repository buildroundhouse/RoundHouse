import { Router, type IRouter } from "express";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  appInvitesTable,
  entitiesTable,
  entityMembersTable,
  outwardAccountsTable,
  usersTable,
  type EntityMember,
  type EntityMemberPermissions,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { getApprovedMembership } from "../lib/entityAccess";
import {
  listOutwardAccountIdsForUser,
  resolveActiveOutwardAccountId,
} from "../lib/outwardAccounts";
import { insertNotifications } from "../lib/insertNotifications";
import { sendPushToUser } from "../lib/push";

const router: IRouter = Router();

type PermissionScope = Record<string, boolean | string | number | null>;

function memberPermissions(member: EntityMember | null | undefined): EntityMemberPermissions {
  return (member?.permissions ?? {}) as EntityMemberPermissions;
}

function isManagerAuthority(member: EntityMember | null | undefined): boolean {
  if (!member || member.status !== "approved" || member.archivedAt) return false;
  const p = memberPermissions(member);
  return (
    member.role === "owner" ||
    member.role === "admin" ||
    member.role === "manager" ||
    p.manageParticipants === true
  );
}

function canManageBusinessTeam(member: EntityMember | null | undefined): boolean {
  if (!member || member.status !== "approved" || member.archivedAt) return false;
  const p = memberPermissions(member);
  return (
    member.role === "owner" ||
    member.role === "admin" ||
    member.role === "manager" ||
    p.manageTeam === true ||
    p.manageParticipants === true
  );
}

function cleanScope(v: unknown): PermissionScope | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: PermissionScope = {};
  for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
    if (
      typeof value === "boolean" ||
      typeof value === "string" ||
      typeof value === "number" ||
      value === null
    ) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

async function loadEntity(id: number) {
  const [row] = await db
    .select()
    .from(entitiesTable)
    .where(and(eq(entitiesTable.id, id), isNull(entitiesTable.archivedAt)))
    .limit(1);
  return row ?? null;
}

async function loadMember(id: number) {
  const [row] = await db
    .select()
    .from(entityMembersTable)
    .where(eq(entityMembersTable.id, id))
    .limit(1);
  return row ?? null;
}

async function loadOutwardAccount(id: number) {
  const [row] = await db
    .select()
    .from(outwardAccountsTable)
    .where(and(eq(outwardAccountsTable.id, id), isNull(outwardAccountsTable.archivedAt)))
    .limit(1);
  return row ?? null;
}

async function displayNameForUser(clerkId: string): Promise<string> {
  const [row] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId))
    .limit(1);
  return row?.name?.trim() || "Someone";
}

async function notify(
  clerkId: string,
  input: {
    type: string;
    title: string;
    body: string;
    relatedId?: string;
    outwardAccountId?: number | null;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  await insertNotifications({
    userClerkId: clerkId,
    type: input.type,
    title: input.title,
    body: input.body,
    ...(input.relatedId ? { relatedId: input.relatedId } : {}),
    ...(input.outwardAccountId != null
      ? { outwardAccountId: input.outwardAccountId }
      : {}),
  });
  void sendPushToUser(clerkId, {
    title: input.title,
    body: input.body,
    data: input.data ?? { type: input.type },
  });
}

/**
 * GET /invitation-center
 *
 * One user-level snapshot used by the Profile Invitation Center. It combines
 * incoming Entity invitations, outgoing invitations / access requests,
 * approval requests the current user has authority to decide, and Share
 * Roundhouse invitations sent from any of the person's acting identities.
 */
router.get("/invitation-center", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const myAccountIds = await listOutwardAccountIdsForUser(userId);

  const incoming = await db
    .select()
    .from(entityMembersTable)
    .where(
      and(
        eq(entityMembersTable.userClerkId, userId),
        eq(entityMembersTable.status, "invited"),
        isNull(entityMembersTable.archivedAt),
      ),
    );

  const outgoing =
    myAccountIds.length === 0
      ? []
      : await db
          .select()
          .from(entityMembersTable)
          .where(
            and(
              inArray(entityMembersTable.requestedByOutwardAccountId, myAccountIds),
              inArray(entityMembersTable.status, ["invited", "requested"]),
              isNull(entityMembersTable.archivedAt),
            ),
          );

  const myMemberships = await db
    .select()
    .from(entityMembersTable)
    .where(
      and(
        eq(entityMembersTable.userClerkId, userId),
        eq(entityMembersTable.status, "approved"),
        isNull(entityMembersTable.archivedAt),
      ),
    );
  const decisionEntityIds = myMemberships
    .filter((m) => isManagerAuthority(m))
    .map((m) => m.entityId);

  const approvals =
    decisionEntityIds.length === 0
      ? []
      : await db
          .select()
          .from(entityMembersTable)
          .where(
            and(
              inArray(entityMembersTable.entityId, decisionEntityIds),
              eq(entityMembersTable.status, "requested"),
              isNull(entityMembersTable.archivedAt),
            ),
          );

  const shareInvites =
    myAccountIds.length === 0
      ? []
      : await db
          .select({
            id: appInvitesTable.id,
            recipientName: appInvitesTable.recipientName,
            recipientPhone: appInvitesTable.recipientPhone,
            invitedKind: appInvitesTable.invitedKind,
            entityId: appInvitesTable.entityId,
            status: appInvitesTable.status,
            createdAt: appInvitesTable.createdAt,
            sentAt: appInvitesTable.sentAt,
            expiresAt: appInvitesTable.expiresAt,
            signedUpAt: appInvitesTable.signedUpAt,
          })
          .from(appInvitesTable)
          .where(inArray(appInvitesTable.senderOutwardAccountId, myAccountIds));

  const entityIds = [
    ...new Set(
      [...incoming, ...outgoing, ...approvals]
        .map((m) => m.entityId)
        .concat(
          shareInvites
            .map((i) => i.entityId)
            .filter((v): v is number => typeof v === "number"),
        ),
    ),
  ];
  const entities =
    entityIds.length === 0
      ? []
      : await db
          .select({
            id: entitiesTable.id,
            kind: entitiesTable.kind,
            name: entitiesTable.name,
          })
          .from(entitiesTable)
          .where(inArray(entitiesTable.id, entityIds));
  const entityMap = new Map(entities.map((e) => [e.id, e] as const));

  const decorate = (m: EntityMember) => ({
    ...m,
    entity: entityMap.get(m.entityId) ?? null,
  });

  res.json({
    incoming: incoming.map(decorate),
    outgoing: outgoing.map(decorate),
    approvals: approvals.map(decorate),
    shareInvites: shareInvites.map((i) => ({
      ...i,
      entity: i.entityId != null ? entityMap.get(i.entityId) ?? null : null,
    })),
  });
});

/**
 * POST /invitation-center/entities/:entityId/viewers
 *
 * Add a person as a Viewer to a Residential Property or Commercial Facility.
 * Viewer is never a Business Team membership and never a free-floating social
 * connection. The target's neutral Viewer acting identity is used even if the
 * person was found through another public profile.
 */
router.post(
  "/invitation-center/entities/:entityId/viewers",
  requireAuth,
  async (req, res): Promise<void> => {
    const ar = req as AuthRequest;
    const entityId = Number(req.params.entityId);
    const targetOutwardAccountId = Number(req.body?.targetOutwardAccountId);
    if (!Number.isFinite(entityId) || entityId <= 0) {
      res.status(400).json({ error: "Invalid Entity id" });
      return;
    }
    if (!Number.isFinite(targetOutwardAccountId) || targetOutwardAccountId <= 0) {
      res.status(400).json({ error: "targetOutwardAccountId is required" });
      return;
    }

    const entity = await loadEntity(entityId);
    if (!entity) {
      res.status(404).json({ error: "Entity not found" });
      return;
    }
    if (
      entity.kind !== "residential_property" &&
      entity.kind !== "commercial_property"
    ) {
      res.status(400).json({
        error: "Viewer can only be added to a Residential Property or Commercial Facility.",
      });
      return;
    }

    const myMembership = await getApprovedMembership(ar.userId, entityId);
    const isController = entity.controllerUserClerkId === ar.userId;
    if (!isController && !isManagerAuthority(myMembership)) {
      res.status(403).json({
        error: "You do not have authority to invite Viewers to this Entity.",
      });
      return;
    }

    const selectedTarget = await loadOutwardAccount(targetOutwardAccountId);
    if (!selectedTarget) {
      res.status(404).json({ error: "Person not found" });
      return;
    }
    if (selectedTarget.ownerClerkId === ar.userId) {
      res.status(400).json({ error: "You cannot invite yourself as a Viewer." });
      return;
    }

    // Every user is expected to have a neutral baseline OA. Use it so Viewer
    // access is not tied to a Trade/Home/Commercial operating identity.
    const [viewerAccount] = await db
      .select()
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.ownerClerkId, selectedTarget.ownerClerkId),
          eq(outwardAccountsTable.kind, "collab"),
          isNull(outwardAccountsTable.archivedAt),
        ),
      )
      .limit(1);
    if (!viewerAccount) {
      res.status(409).json({
        error: "This person's Viewer profile is not ready yet. Ask them to sign in to Roundhouse once, then resend the invitation.",
      });
      return;
    }

    const [existing] = await db
      .select()
      .from(entityMembersTable)
      .where(
        and(
          eq(entityMembersTable.entityId, entityId),
          eq(entityMembersTable.userClerkId, viewerAccount.ownerClerkId),
          eq(entityMembersTable.userOutwardAccountId, viewerAccount.id),
        ),
      )
      .limit(1);

    if (existing?.status === "approved" && existing.archivedAt == null) {
      res.status(409).json({ error: "This person is already an active Viewer here." });
      return;
    }

    const actingAccountId =
      ar.activeOutwardAccountId ??
      (await resolveActiveOutwardAccountId(ar.userId));
    if (actingAccountId == null) {
      res.status(409).json({ error: "Account not ready" });
      return;
    }

    const permissions: EntityMemberPermissions = {
      ...(existing?.permissions as EntityMemberPermissions | undefined),
      baseRole: "viewer",
      relationshipKind: "viewer",
      permissionSource: "viewer_invite",
      scope: cleanScope(req.body?.scope),
    };

    let member: EntityMember;
    if (existing) {
      [member] = await db
        .update(entityMembersTable)
        .set({
          role: "viewer",
          status: "invited",
          direction: "invite",
          permissions,
          requestedByOutwardAccountId: actingAccountId,
          decidedAt: null,
          archivedAt: null,
        })
        .where(eq(entityMembersTable.id, existing.id))
        .returning();
    } else {
      [member] = await db
        .insert(entityMembersTable)
        .values({
          entityId,
          userClerkId: viewerAccount.ownerClerkId,
          userOutwardAccountId: viewerAccount.id,
          role: "viewer",
          status: "invited",
          direction: "invite",
          permissions,
          requestedByOutwardAccountId: actingAccountId,
        })
        .returning();
    }

    const inviterName = await displayNameForUser(ar.userId);
    await notify(viewerAccount.ownerClerkId, {
      type: "entity_invite",
      title: inviterName,
      body: `Invited you to ${entity.name} as a Viewer.`,
      relatedId: String(member.id),
      outwardAccountId: viewerAccount.id,
      data: {
        type: "entity_invite",
        entityId,
        entityMemberId: member.id,
      },
    });

    res.status(201).json({ member });
  },
);

/**
 * POST /invitation-center/businesses/:businessEntityId/outside-trade
 *
 * Invite an existing Trade Professional into a Business relationship as an
 * outside Trade Professional / subcontractor. They must accept this Business
 * relationship before the Business can bring them forward to a Property.
 */
router.post(
  "/invitation-center/businesses/:businessEntityId/outside-trade",
  requireAuth,
  async (req, res): Promise<void> => {
    const ar = req as AuthRequest;
    const businessEntityId = Number(req.params.businessEntityId);
    const targetOutwardAccountId = Number(req.body?.targetOutwardAccountId);
    if (!Number.isFinite(businessEntityId) || businessEntityId <= 0) {
      res.status(400).json({ error: "Invalid Business id" });
      return;
    }
    if (!Number.isFinite(targetOutwardAccountId) || targetOutwardAccountId <= 0) {
      res.status(400).json({ error: "targetOutwardAccountId is required" });
      return;
    }

    const business = await loadEntity(businessEntityId);
    if (!business || business.kind !== "business") {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    const myBusinessMembership = await getApprovedMembership(ar.userId, businessEntityId);
    if (!canManageBusinessTeam(myBusinessMembership)) {
      res.status(403).json({ error: "You do not have authority to invite Business participants." });
      return;
    }

    const target = await loadOutwardAccount(targetOutwardAccountId);
    if (!target) {
      res.status(404).json({ error: "Trade Professional not found" });
      return;
    }
    if (target.kind !== "trade_pro" && target.kind !== "facilities") {
      res.status(400).json({
        error: "Outside Trade relationships require a Trade Professional / service-provider identity.",
      });
      return;
    }
    if (target.ownerClerkId === ar.userId) {
      res.status(400).json({ error: "You cannot invite yourself." });
      return;
    }

    const actingAccountId =
      ar.activeOutwardAccountId ??
      (await resolveActiveOutwardAccountId(ar.userId));
    if (actingAccountId == null) {
      res.status(409).json({ error: "Account not ready" });
      return;
    }

    const [existing] = await db
      .select()
      .from(entityMembersTable)
      .where(
        and(
          eq(entityMembersTable.entityId, businessEntityId),
          eq(entityMembersTable.userClerkId, target.ownerClerkId),
          eq(entityMembersTable.userOutwardAccountId, target.id),
        ),
      )
      .limit(1);
    if (existing?.status === "approved" && existing.archivedAt == null) {
      res.status(409).json({ error: "This Trade Professional already operates with the Business." });
      return;
    }

    const permissions: EntityMemberPermissions = {
      ...(existing?.permissions as EntityMemberPermissions | undefined),
      baseRole: "trade_professional",
      relationshipKind: "outside_trade",
      permissionSource: "owner_direct",
    };

    let member: EntityMember;
    if (existing) {
      [member] = await db
        .update(entityMembersTable)
        .set({
          role: "worker",
          status: "invited",
          direction: "invite",
          permissions,
          requestedByOutwardAccountId: actingAccountId,
          decidedAt: null,
          archivedAt: null,
        })
        .where(eq(entityMembersTable.id, existing.id))
        .returning();
    } else {
      [member] = await db
        .insert(entityMembersTable)
        .values({
          entityId: businessEntityId,
          userClerkId: target.ownerClerkId,
          userOutwardAccountId: target.id,
          role: "worker",
          status: "invited",
          direction: "invite",
          permissions,
          requestedByOutwardAccountId: actingAccountId,
        })
        .returning();
    }

    const inviterName = await displayNameForUser(ar.userId);
    await notify(target.ownerClerkId, {
      type: "entity_invite",
      title: inviterName,
      body: `Invited you to work with ${business.name} as an Outside Trade Professional.`,
      relatedId: String(member.id),
      outwardAccountId: target.id,
      data: {
        type: "entity_invite",
        entityId: businessEntityId,
        entityMemberId: member.id,
      },
    });

    res.status(201).json({ member });
  },
);

/**
 * POST /invitation-center/properties/:propertyEntityId/business-participants
 *
 * Bring an already-approved Business participant forward to a Property.
 *
 * - If caller controls the Property, or holds delegated participant-management
 *   authority on the Property, approve directly.
 * - Otherwise create an access request for the Property authority to decide.
 * - The Property membership is marked Business-derived so ending the Business
 *   relationship can revoke only access that still depends on that source.
 */
router.post(
  "/invitation-center/properties/:propertyEntityId/business-participants",
  requireAuth,
  async (req, res): Promise<void> => {
    const ar = req as AuthRequest;
    const propertyEntityId = Number(req.params.propertyEntityId);
    const businessEntityId = Number(req.body?.businessEntityId);
    const businessMemberId = Number(req.body?.businessMemberId);
    if (!Number.isFinite(propertyEntityId) || propertyEntityId <= 0) {
      res.status(400).json({ error: "Invalid Property id" });
      return;
    }
    if (!Number.isFinite(businessEntityId) || businessEntityId <= 0) {
      res.status(400).json({ error: "businessEntityId is required" });
      return;
    }
    if (!Number.isFinite(businessMemberId) || businessMemberId <= 0) {
      res.status(400).json({ error: "businessMemberId is required" });
      return;
    }

    const [property, business, businessMember] = await Promise.all([
      loadEntity(propertyEntityId),
      loadEntity(businessEntityId),
      loadMember(businessMemberId),
    ]);
    if (
      !property ||
      (property.kind !== "residential_property" &&
        property.kind !== "commercial_property")
    ) {
      res.status(404).json({ error: "Property / Facility not found" });
      return;
    }
    if (!business || business.kind !== "business") {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    if (
      !businessMember ||
      businessMember.entityId !== businessEntityId ||
      businessMember.status !== "approved" ||
      businessMember.archivedAt
    ) {
      res.status(409).json({
        error: "The participant must first accept the Business relationship.",
      });
      return;
    }

    const myBusinessMembership = await getApprovedMembership(ar.userId, businessEntityId);
    if (!canManageBusinessTeam(myBusinessMembership)) {
      res.status(403).json({
        error: "You do not have authority to assign participants for this Business.",
      });
      return;
    }

    const myPropertyMembership = await getApprovedMembership(ar.userId, propertyEntityId);
    const controllerApproval = property.controllerUserClerkId === ar.userId;
    const managerApproval = !controllerApproval && isManagerAuthority(myPropertyMembership);
    const directApproval = controllerApproval || managerApproval;

    const businessPerms = memberPermissions(businessMember);
    if (businessPerms.baseRole === "viewer") {
      res.status(400).json({
        error: "Viewer is not a Business work relationship and cannot be assigned as a Business participant.",
      });
      return;
    }

    const [existing] = await db
      .select()
      .from(entityMembersTable)
      .where(
        and(
          eq(entityMembersTable.entityId, propertyEntityId),
          eq(entityMembersTable.userClerkId, businessMember.userClerkId),
          eq(
            entityMembersTable.userOutwardAccountId,
            businessMember.userOutwardAccountId,
          ),
        ),
      )
      .limit(1);

    if (existing?.status === "approved" && existing.archivedAt == null) {
      const existingPerms = memberPermissions(existing);
      if (
        existingPerms.permissionSource !== "business_derived" ||
        existingPerms.sourceBusinessEntityId !== businessEntityId ||
        existingPerms.sourceBusinessMemberId !== businessMemberId
      ) {
        // Never overwrite an independent permission source. This is what lets
        // a Homeowner keep a Trade Professional independently after the
        // original Business relationship ends.
        res.status(200).json({
          member: existing,
          approvalMode: "existing_independent_access",
        });
        return;
      }
      res.status(200).json({
        member: existing,
        approvalMode: "already_business_derived",
      });
      return;
    }

    const actingAccountId =
      ar.activeOutwardAccountId ??
      (await resolveActiveOutwardAccountId(ar.userId));
    if (actingAccountId == null) {
      res.status(409).json({ error: "Account not ready" });
      return;
    }

    const permissions: EntityMemberPermissions = {
      ...(existing?.permissions as EntityMemberPermissions | undefined),
      baseRole:
        businessPerms.baseRole === "trade_team_member"
          ? "trade_team_member"
          : businessPerms.baseRole === "supplier"
            ? "supplier"
            : "trade_professional",
      relationshipKind:
        businessPerms.relationshipKind === "supplier" ? "supplier" : "outside_trade",
      permissionSource: "business_derived",
      sourceBusinessEntityId: businessEntityId,
      sourceBusinessMemberId: businessMemberId,
      approvedUnderManagerMemberId: managerApproval
        ? myPropertyMembership?.id ?? null
        : null,
      scope: cleanScope(req.body?.scope),
    };

    const desiredStatus = directApproval ? "approved" : "requested";
    let member: EntityMember;
    if (existing) {
      [member] = await db
        .update(entityMembersTable)
        .set({
          role: "worker",
          status: desiredStatus,
          direction: directApproval ? "invite" : "request",
          permissions,
          requestedByOutwardAccountId: actingAccountId,
          decidedAt: directApproval ? new Date() : null,
          archivedAt: null,
        })
        .where(eq(entityMembersTable.id, existing.id))
        .returning();
    } else {
      [member] = await db
        .insert(entityMembersTable)
        .values({
          entityId: propertyEntityId,
          userClerkId: businessMember.userClerkId,
          userOutwardAccountId: businessMember.userOutwardAccountId,
          role: "worker",
          status: desiredStatus,
          direction: directApproval ? "invite" : "request",
          permissions,
          requestedByOutwardAccountId: actingAccountId,
          decidedAt: directApproval ? new Date() : null,
        })
        .returning();
    }

    const participantName = await displayNameForUser(businessMember.userClerkId);

    if (directApproval) {
      // If the current user is also the Property controller, there is no need
      // to notify themselves. Manager-authorized additions notify the Owner.
      if (property.controllerUserClerkId !== ar.userId) {
        await notify(property.controllerUserClerkId, {
          type: "entity_member_accepted",
          title: business.name,
          body: `Added ${participantName} to ${property.name} under delegated Manager authority.`,
          relatedId: String(member.id),
          outwardAccountId: property.controllerOutwardAccountId,
          data: {
            type: "entity_member_accepted",
            entityId: propertyEntityId,
            entityMemberId: member.id,
            authority: "manager_delegated",
            businessEntityId,
          },
        });
      }
      res.status(201).json({
        member,
        approvalMode: managerApproval
          ? "manager_delegated"
          : "controller_authorized",
      });
      return;
    }

    await notify(property.controllerUserClerkId, {
      type: "entity_request",
      title: business.name,
      body: `Wants to add ${participantName} to ${property.name}.`,
      relatedId: String(member.id),
      outwardAccountId: property.controllerOutwardAccountId,
      data: {
        type: "entity_request",
        entityId: propertyEntityId,
        entityMemberId: member.id,
        businessEntityId,
      },
    });

    res.status(201).json({ member, approvalMode: "owner_approval_required" });
  },
);

/**
 * DELETE /invitation-center/businesses/:businessEntityId/members/:memberId
 *
 * End a Business relationship and automatically remove active Property access
 * that still depends solely on that Business membership. Independent Property
 * authorization is not touched because its permissionSource is different.
 */
router.delete(
  "/invitation-center/businesses/:businessEntityId/members/:memberId",
  requireAuth,
  async (req, res): Promise<void> => {
    const ar = req as AuthRequest;
    const businessEntityId = Number(req.params.businessEntityId);
    const memberId = Number(req.params.memberId);
    if (!Number.isFinite(businessEntityId) || !Number.isFinite(memberId)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const [business, member] = await Promise.all([
      loadEntity(businessEntityId),
      loadMember(memberId),
    ]);
    if (!business || business.kind !== "business") {
      res.status(404).json({ error: "Business not found" });
      return;
    }
    if (!member || member.entityId !== businessEntityId) {
      res.status(404).json({ error: "Business participant not found" });
      return;
    }
    if (member.role === "owner") {
      res.status(400).json({ error: "The Business Owner cannot be removed this way." });
      return;
    }

    const myMembership = await getApprovedMembership(ar.userId, businessEntityId);
    const removingSelf = member.userClerkId === ar.userId;
    if (!removingSelf && !canManageBusinessTeam(myMembership)) {
      res.status(403).json({ error: "You do not have authority to remove this Business participant." });
      return;
    }

    const now = new Date();
    await db
      .update(entityMembersTable)
      .set({ status: "removed", archivedAt: now, decidedAt: now })
      .where(eq(entityMembersTable.id, memberId));

    // Single-source MVP rule: only rows that still explicitly say their
    // permissionSource is business_derived from THIS Business membership are
    // revoked. If the Homeowner established independent access, that flow
    // changes permissionSource and this query intentionally does not touch it.
    const derived = await db
      .select({ id: entityMembersTable.id, entityId: entityMembersTable.entityId })
      .from(entityMembersTable)
      .where(
        and(
          eq(entityMembersTable.userClerkId, member.userClerkId),
          eq(entityMembersTable.userOutwardAccountId, member.userOutwardAccountId),
          eq(entityMembersTable.status, "approved"),
          isNull(entityMembersTable.archivedAt),
          sql`${entityMembersTable.permissions}->>'permissionSource' = 'business_derived'`,
          sql`${entityMembersTable.permissions}->>'sourceBusinessEntityId' = ${String(
            businessEntityId,
          )}`,
          sql`${entityMembersTable.permissions}->>'sourceBusinessMemberId' = ${String(
            memberId,
          )}`,
        ),
      );

    if (derived.length > 0) {
      await db
        .update(entityMembersTable)
        .set({ status: "removed", archivedAt: now, decidedAt: now })
        .where(inArray(entityMembersTable.id, derived.map((d) => d.id)));
    }

    await notify(member.userClerkId, {
      type: "entity_access_removed",
      title: business.name,
      body:
        derived.length > 0
          ? `Your Business relationship ended. ${derived.length} Business-derived Property access${derived.length === 1 ? "" : "es"} also ended.`
          : "Your Business relationship ended.",
      relatedId: String(memberId),
      outwardAccountId: member.userOutwardAccountId,
      data: {
        type: "entity_access_removed",
        entityId: businessEntityId,
        entityMemberId: memberId,
        revokedPropertyEntityIds: derived.map((d) => d.entityId),
      },
    });

    res.json({ ok: true, revokedDerivedPropertyAccess: derived.length });
  },
);

export default router;

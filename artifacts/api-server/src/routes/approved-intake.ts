import { Router, type IRouter } from "express";
import { isDeepStrictEqual } from "node:util";
import { and, eq, ilike, isNull, or, sql } from "drizzle-orm";
import {
  db, entitiesTable, entityBusinessDetailsTable, entityMembersTable,
  outwardAccountsTable, propertiesTable, userModesTable, usersTable, notificationsTable,
  type UserModeKind,
} from "@workspace/db";
import {
  freeLimitMessage, titleAuthority, titleNeedsPersonalPaid,
  validateApprovedActivation, validApprovedTitle,
  type ApprovedIntakeDraft, type ApprovedIntakePath,
} from "@workspace/api-zod";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { personHasPaidAccess } from "../lib/paidAccess";

const router: IRouter = Router();
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const modeFor = (draft: ApprovedIntakeDraft): UserModeKind =>
  draft.path === "property" ? (draft.propertyType === "commercial" ? "facilities" : "home") : "trade_pro";

async function isPaid(tx: any, clerkId: string): Promise<boolean> {
  return personHasPaidAccess(clerkId, tx);
}

router.get("/intake/access-status", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const personalPaid = await personHasPaidAccess(userId);
  const entityId = Number(req.query.entityId);
  const [entity] = Number.isSafeInteger(entityId) && entityId > 0 ? await db.select({ controller: entitiesTable.controllerUserClerkId }).from(entitiesTable)
    .where(and(eq(entitiesTable.id, entityId), isNull(entitiesTable.archivedAt))).limit(1) : [];
  const sharedAccessEligible = personalPaid || (!!entity && await personHasPaidAccess(entity.controller));
  res.json({ personalPaid, sharedAccessEligible });
});

export async function ensureHistory(tx: any, clerkId: string, workingAccountId: number) {
  const existing = await tx.select({ id: entitiesTable.id }).from(entitiesTable)
    .where(and(eq(entitiesTable.kind, "history"), eq(entitiesTable.createdByUserClerkId, clerkId), isNull(entitiesTable.archivedAt))).limit(1);
  if (existing[0]) return existing[0].id;
  let [historyMode] = await tx.select().from(userModesTable)
    .where(and(eq(userModesTable.userClerkId, clerkId), eq(userModesTable.kind, "collab"))).limit(1);
  if (!historyMode) {
    [historyMode] = await tx.insert(userModesTable).values({
      userClerkId: clerkId, kind: "collab", intakeData: { displayName: "History", roleTitle: "History Viewer" }, intakeCompletedAt: new Date(),
    }).returning();
  } else {
    await tx.update(userModesTable).set({
      intakeData: { ...(historyMode.intakeData ?? {}), displayName: "History", roleTitle: "History Viewer" },
      intakeCompletedAt: historyMode.intakeCompletedAt ?? new Date(),
    }).where(eq(userModesTable.id, historyMode.id));
  }
  let [historyAccount] = await tx.select().from(outwardAccountsTable)
    .where(and(eq(outwardAccountsTable.ownerClerkId, clerkId), eq(outwardAccountsTable.kind, "collab"), isNull(outwardAccountsTable.archivedAt))).limit(1);
  if (!historyAccount) {
    [historyAccount] = await tx.insert(outwardAccountsTable).values({
      ownerClerkId: clerkId, kind: "collab", title: "History Viewer", displayName: "History", sourceUserModeId: historyMode.id,
    }).returning();
  } else {
    await tx.update(outwardAccountsTable).set({ title: "History Viewer", displayName: "History", sourceUserModeId: historyMode.id })
      .where(eq(outwardAccountsTable.id, historyAccount.id));
  }
  const [history] = await tx.insert(entitiesTable).values({
    kind: "history", name: "History", controllerOutwardAccountId: historyAccount.id || workingAccountId,
    controllerUserClerkId: clerkId, createdByUserClerkId: clerkId,
  }).returning();
  await tx.insert(entityMembersTable).values({
    entityId: history.id, userClerkId: clerkId, userOutwardAccountId: historyAccount.id,
    role: "viewer", status: "approved", direction: "invite",
    permissions: { baseRole: "viewer", permissionSource: "legacy", scope: { privateHistory: true, roleTitle: "History Viewer" } },
    decidedAt: new Date(),
  });
  return history.id;
}

router.get("/intake/draft", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const [mode] = await db.select().from(userModesTable)
    .where(and(eq(userModesTable.userClerkId, userId), isNull(userModesTable.intakeCompletedAt), sql`${userModesTable.intakeData} ? 'approvedIntake'`))
    .orderBy(userModesTable.id).limit(1);
  const approvedIntake = mode && (mode.intakeData as any)?.approvedIntake;
  res.json({ modeId: approvedIntake ? mode.id : null, draft: approvedIntake ?? null });
});

router.post("/intake/draft", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const draft = req.body?.draft as ApprovedIntakeDraft;
  if (!draft?.path || !["property", "trade", "supplier"].includes(draft.path) || !draft.data || typeof draft.data !== "object" || Array.isArray(draft.data)) {
    res.status(400).json({ error: "Choose PROPERTY, TRADE, or SUPPLIER." }); return;
  }
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`approved-intake:${userId}`}, 0))`);
    const existingId = Number(req.body?.modeId);
    const [existing] = await tx.select().from(userModesTable).where(and(
      eq(userModesTable.userClerkId, userId), isNull(userModesTable.intakeCompletedAt),
      existingId > 0 ? eq(userModesTable.id, existingId) : sql`${userModesTable.intakeData} ? 'approvedIntake'`,
    )).limit(1);
    if (existing) {
      const [pending] = await tx.select({ id: entityMembersTable.id }).from(entityMembersTable)
        .innerJoin(outwardAccountsTable, eq(outwardAccountsTable.id, entityMembersTable.userOutwardAccountId))
        .where(and(eq(outwardAccountsTable.sourceUserModeId, existing.id), eq(entityMembersTable.status, "requested"), isNull(entityMembersTable.archivedAt))).limit(1);
      const saved = (existing.intakeData as any)?.approvedIntake;
      const content = (value: ApprovedIntakeDraft) => { const { currentStep, returnToReview, ...rest } = value; return rest; };
      if (pending && saved && !isDeepStrictEqual(content(saved), content(draft))) return { pending: true };
      const [updated] = await tx.update(userModesTable).set({ kind: modeFor(draft), intakeData: { ...existing.intakeData, approvedIntake: draft } })
        .where(eq(userModesTable.id, existing.id)).returning();
      return { modeId: updated.id, created: false };
    }
    if (existingId > 0) return null;
    const [created] = await tx.insert(userModesTable).values({ userClerkId: userId, kind: modeFor(draft), intakeData: { approvedIntake: draft } }).returning();
    return { modeId: created.id, created: true };
  });
  if (result && "pending" in result) { res.status(409).json({ error: "This access request is awaiting authorization. Its reviewed role and record cannot change while pending." }); return; }
  if (!result) { res.status(409).json({ error: "This draft is unavailable or already activated." }); return; }
  res.status(result.created ? 201 : 200).json({ modeId: result.modeId, draft });
});

router.get("/intake/search", requireAuth, async (req, res): Promise<void> => {
  const path = req.query.path as ApprovedIntakePath;
  const q = clean(req.query.q);
  if (!q || !["property", "trade", "supplier"].includes(path)) { res.json({ results: [] }); return; }
  const pattern = `%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`;
  if (path === "property") {
    const rows = await db.execute<{ id: number; name: string; address: string }>(sql`
      SELECT e.id, e.name, p.address FROM entities e
      JOIN property_entity_links l ON l.entity_id=e.id JOIN properties p ON p.id=l.property_id
      WHERE e.archived_at IS NULL AND (e.name ILIKE ${pattern} OR p.address ILIKE ${pattern}) LIMIT 20`);
    res.json({ results: rows.rows }); return;
  }
  const rows = await db.select({ id: entitiesTable.id, name: entitiesTable.name, address: entityBusinessDetailsTable.address })
    .from(entitiesTable).leftJoin(entityBusinessDetailsTable, eq(entityBusinessDetailsTable.entityId, entitiesTable.id))
    .where(and(eq(entitiesTable.kind, "business"), isNull(entitiesTable.archivedAt), or(ilike(entitiesTable.name, pattern), ilike(entityBusinessDetailsTable.address, pattern)))).limit(20);
  res.json({ results: rows });
});

router.get("/intake/creation-eligibility", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const path = req.query.path as ApprovedIntakePath;
  if (!["property", "trade", "supplier"].includes(path)) { res.status(400).json({ error: "Invalid intake path." }); return; }
  if (await isPaid(db, userId)) { res.json({ allowed: true }); return; }
  const rows = await db.select({ kind: entitiesTable.kind }).from(entitiesTable)
    .where(and(eq(entitiesTable.createdByUserClerkId, userId), isNull(entitiesTable.archivedAt)));
  const count = path === "property" ? rows.filter((r) => r.kind === "residential_property" || r.kind === "commercial_property").length : rows.filter((r) => r.kind === "business").length;
  res.json({ allowed: count < 1, message: count < 1 ? null : freeLimitMessage(path) });
});

// Billing can precede activation, but a billing account grants no membership.
router.post("/intake/billing/:modeId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const modeId = Number(req.params.modeId);
  if (!Number.isSafeInteger(modeId) || modeId < 1) { res.status(400).json({ error: "Save your intake before adding Pro." }); return; }
  const account = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`approved-intake:${userId}`}, 0))`);
    const [identity] = await tx.select({ completed: usersTable.identityCompletedAt }).from(usersTable).where(eq(usersTable.clerkId, userId)).limit(1);
    const [mode] = await tx.select().from(userModesTable).where(and(eq(userModesTable.id, modeId), eq(userModesTable.userClerkId, userId))).limit(1);
    const draft = (mode?.intakeData as any)?.approvedIntake as ApprovedIntakeDraft | undefined;
    if (!identity?.completed || !draft?.path) return null;
    const [existing] = await tx.select().from(outwardAccountsTable).where(and(eq(outwardAccountsTable.ownerClerkId, userId), eq(outwardAccountsTable.sourceUserModeId, modeId), isNull(outwardAccountsTable.archivedAt))).limit(1);
    if (existing) return existing;
    const [created] = await tx.insert(outwardAccountsTable).values({ ownerClerkId: userId, kind: mode.kind,
      title: draft.roleTitle ?? null, displayName: clean(draft.data.businessName) || clean(draft.data.propertyName) || "Intake",
      sourceUserModeId: modeId,
    }).returning();
    return created;
  });
  if (!account) { res.status(409).json({ error: "Complete Identity and save your intake before adding Pro." }); return; }
  res.json({ accountId: account.id });
});

router.post("/intake/activate/:modeId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const modeId = Number(req.params.modeId);
  const draft = req.body?.draft as ApprovedIntakeDraft;
  const validation = validateApprovedActivation(draft);
  if (!Number.isSafeInteger(modeId) || validation) { res.status(400).json({ error: validation ?? "Invalid intake." }); return; }
  try {
    const result = await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`approved-intake:${userId}`}, 0))`);
      const [identity] = await tx.select({ completed: usersTable.identityCompletedAt }).from(usersTable).where(eq(usersTable.clerkId, userId)).limit(1);
      if (!identity?.completed) throw Object.assign(new Error("Complete personal Identity first."), { status: 409 });
      const [mode] = await tx.select().from(userModesTable).where(and(eq(userModesTable.id, modeId), eq(userModesTable.userClerkId, userId))).limit(1);
      if (!mode) throw Object.assign(new Error("Intake draft not found."), { status: 404 });
      const saved = (mode.intakeData as any)?.approvedIntake as ApprovedIntakeDraft | undefined;
      const [already] = await tx.select({ entityId: entityMembersTable.entityId, status: entityMembersTable.status })
        .from(entityMembersTable).innerJoin(outwardAccountsTable, eq(outwardAccountsTable.id, entityMembersTable.userOutwardAccountId))
        .where(and(eq(outwardAccountsTable.sourceUserModeId, modeId), eq(entityMembersTable.userClerkId, userId), isNull(entityMembersTable.archivedAt))).limit(1);
      if (already?.status === "approved" && mode.intakeCompletedAt) return { status: "active", entityId: already.entityId };
      // PostgreSQL JSONB normalizes key order; compare values, not serialized order.
      if (!saved || !isDeepStrictEqual(saved, draft)) throw Object.assign(new Error("Save and review the latest intake before activation."), { status: 409 });
      if (already && ["requested", "invited"].includes(already.status)) return { status: "pending", entityId: already.entityId };
      const paid = await isPaid(tx, userId);
      if (titleNeedsPersonalPaid(draft.roleTitle!) && !paid) throw Object.assign(new Error("ADD PRO is required for this role."), { status: 402 });
      let [account] = await tx.select().from(outwardAccountsTable)
        .where(and(eq(outwardAccountsTable.ownerClerkId, userId), eq(outwardAccountsTable.sourceUserModeId, modeId), isNull(outwardAccountsTable.archivedAt))).limit(1);
      if (!account) {
        const label = clean(draft.data.businessName) || clean(draft.data.propertyName) || clean(draft.data.address);
        [account] = await tx.insert(outwardAccountsTable).values({
          ownerClerkId: userId, kind: mode.kind, title: draft.roleTitle,
          displayName: label, companyName: draft.path === "property" ? null : label,
          avatarUrl: clean(draft.data.photo) || null, sourceUserModeId: modeId,
        }).returning();
      } else {
        await tx.update(outwardAccountsTable).set({ kind: mode.kind, title: draft.roleTitle,
          displayName: clean(draft.data.businessName) || clean(draft.data.propertyName) || clean(draft.data.address),
        }).where(eq(outwardAccountsTable.id, account.id));
      }
      const authority = titleAuthority(draft.roleTitle!);
      const memberRole = authority.owner ? "owner" : authority.admin ? "admin" : authority.manager ? "manager" : authority.viewer ? "viewer" : "worker";
      let entityId: number;
      let status: "approved" | "requested";
      if (draft.creating) {
        const counts = await tx.select({ kind: entitiesTable.kind }).from(entitiesTable)
          .where(and(eq(entitiesTable.createdByUserClerkId, userId), isNull(entitiesTable.archivedAt)));
        const count = draft.path === "property" ? counts.filter((r:any) => r.kind === "residential_property" || r.kind === "commercial_property").length : counts.filter((r:any) => r.kind === "business").length;
        if (!paid && count >= 1) throw Object.assign(new Error(freeLimitMessage(draft.path!)), { status: 402 });
        const name = clean(draft.data.businessName) || clean(draft.data.propertyName) || clean(draft.data.address);
        const address = clean(draft.data.address);
        const dedupeKey = draft.path === "property" ? `property:${address.toLowerCase()}` : `business:${name.toLowerCase()}:${address.toLowerCase()}`;
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${dedupeKey}, 0))`);
        const duplicate = draft.path === "property"
          ? await tx.execute(sql`SELECT e.id FROM entities e JOIN property_entity_links l ON l.entity_id=e.id JOIN properties p ON p.id=l.property_id WHERE e.archived_at IS NULL AND lower(p.address)=lower(${address}) LIMIT 1`)
          : await tx.select({ id: entitiesTable.id }).from(entitiesTable).leftJoin(entityBusinessDetailsTable, eq(entityBusinessDetailsTable.entityId, entitiesTable.id))
              .where(and(eq(entitiesTable.kind, "business"), isNull(entitiesTable.archivedAt), ilike(entitiesTable.name, name), ilike(entityBusinessDetailsTable.address, address))).limit(1);
        const duplicateId = Array.isArray(duplicate) ? duplicate[0]?.id : (duplicate as any).rows?.[0]?.id;
        if (duplicateId) throw Object.assign(new Error("This record already exists. Select it and request authorization."), { status: 409 });
        if (draft.path === "property") {
          const [property] = await tx.insert(propertiesTable).values({
            name, address, type: draft.propertyType === "commercial" ? "commercial" : "home",
            ownerClerkId: userId, ownerOutwardAccountId: account.id, coverPhotoUrl: clean(draft.data.photo) || null,
          }).returning();
          const [entity] = await tx.insert(entitiesTable).values({
            kind: draft.propertyType === "commercial" ? "commercial_property" : "residential_property", name,
            controllerOutwardAccountId: account.id, controllerUserClerkId: userId, createdByUserClerkId: userId,
            coverPhotoUrl: clean(draft.data.photo) || null,
          }).returning();
          await tx.execute(sql`INSERT INTO property_entity_links (property_id, entity_id) VALUES (${property.id}, ${entity.id}) ON CONFLICT (property_id) DO NOTHING`);
          entityId = entity.id;
        } else {
          const [entity] = await tx.insert(entitiesTable).values({
            kind: "business", name, controllerOutwardAccountId: account.id,
            controllerUserClerkId: userId, createdByUserClerkId: userId, logoUrl: clean(draft.data.photo) || null,
          }).returning();
          await tx.insert(entityBusinessDetailsTable).values({ entityId: entity.id, companyName: name, address });
          entityId = entity.id;
        }
        status = "approved";
      } else {
        const [entity] = await tx.select().from(entitiesTable).where(and(eq(entitiesTable.id, draft.existingEntityId!), isNull(entitiesTable.archivedAt))).limit(1);
        if (!entity || (draft.path === "property" ? entity.kind !== (draft.propertyType === "commercial" ? "commercial_property" : "residential_property") : entity.kind !== "business")) {
          throw Object.assign(new Error("Selected record is unavailable."), { status: 404 });
        }
        if (authority.owner && entity.controllerUserClerkId !== userId) {
          throw Object.assign(new Error("Ownership requires the requested-ownership-transfer procedure for this existing record."), { status: 409 });
        }
        const eitherPartyPaid = paid || await isPaid(tx, entity.controllerUserClerkId);
        if (!eitherPartyPaid) {
          throw Object.assign(new Error("At least one participating party must have paid access before this connection can be requested."), { status: 402 });
        }
        entityId = entity.id; status = "requested";
      }
      const [membership] = await tx.insert(entityMembersTable).values({
        entityId, userClerkId: userId, userOutwardAccountId: account.id, role: memberRole,
        status, direction: draft.creating ? "invite" : "request", requestedByOutwardAccountId: account.id,
        decidedAt: status === "approved" ? new Date() : null,
        permissions: {
          baseRole: draft.path === "property" ? "homeowner" : draft.path === "supplier" ? "supplier" : "trade_professional",
          permissionSource: draft.creating ? "independent_property" : null,
          manageTeam: status === "approved" && paid && (authority.owner || authority.admin || authority.manager),
          manageParticipants: status === "approved" && paid && (authority.owner || authority.admin || authority.manager),
          scope: { roleTitle: draft.roleTitle!, lead: authority.lead, ownershipClaimed: authority.owner, unclaimed: !authority.owner },
        },
      }).returning({ id: entityMembersTable.id });
      if (status === "requested") {
        const [destination] = await tx.select().from(entitiesTable).where(eq(entitiesTable.id, entityId)).limit(1);
        await tx.insert(notificationsTable).values({
          userClerkId: destination.controllerUserClerkId, outwardAccountId: destination.controllerOutwardAccountId,
          type: "entity_request", title: "Property or Business access requested",
          body: `An access request for ${destination.name} is awaiting your authorization.`, relatedId: String(membership.id),
        });
        return { status: "pending", entityId };
      }
      await ensureHistory(tx, userId, account.id);
      await tx.update(userModesTable).set({ intakeCompletedAt: new Date(), intakeData: { ...mode.intakeData, approvedIntake: { ...draft, currentStep: "complete" }, entityId, roleTitle: draft.roleTitle } }).where(eq(userModesTable.id, modeId));
      await tx.update(usersTable).set({ lastActiveModeId: modeId, activeOutwardAccountId: account.id }).where(eq(usersTable.clerkId, userId));
      return { status: "active", entityId };
    });
    res.json(result);
  } catch (error) {
    const status = Number((error as any)?.status) || 500;
    res.status(status).json({ error: error instanceof Error ? error.message : "Activation failed." });
  }
});

/** Complete a saved intake only after an invited/requested membership is approved. */
export async function finalizeApprovedIntakeMembership(memberId: number, connection: Pick<typeof db, "transaction"> = db): Promise<void> {
  await connection.transaction(async (tx) => {
    const [row] = await tx.select({
      userClerkId: entityMembersTable.userClerkId,
      userOutwardAccountId: entityMembersTable.userOutwardAccountId,
      entityId: entityMembersTable.entityId,
      status: entityMembersTable.status,
      modeId: outwardAccountsTable.sourceUserModeId,
    }).from(entityMembersTable)
      .innerJoin(outwardAccountsTable, eq(outwardAccountsTable.id, entityMembersTable.userOutwardAccountId))
      .where(eq(entityMembersTable.id, memberId)).limit(1);
    if (!row || row.status !== "approved" || !row.modeId) return;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`approved-intake:${row.userClerkId}`}, 0))`);
    const [mode] = await tx.select().from(userModesTable).where(and(eq(userModesTable.id, row.modeId), eq(userModesTable.userClerkId, row.userClerkId))).limit(1);
    const draft = (mode?.intakeData as any)?.approvedIntake as ApprovedIntakeDraft | undefined;
    if (!mode || mode.intakeCompletedAt || !draft) return;
    const [entity] = await tx.select().from(entitiesTable).where(and(eq(entitiesTable.id, row.entityId), isNull(entitiesTable.archivedAt))).limit(1);
    const paid = await isPaid(tx, row.userClerkId);
    if (!entity || (!paid && !(await isPaid(tx, entity.controllerUserClerkId))) || (titleNeedsPersonalPaid(draft.roleTitle!) && !paid)) {
      throw Object.assign(new Error("Qualifying paid access is required before approval."), { status: 402 });
    }
    await ensureHistory(tx, row.userClerkId, row.userOutwardAccountId);
    await tx.update(userModesTable).set({
      intakeCompletedAt: new Date(),
      intakeData: { ...mode.intakeData, approvedIntake: { ...draft, currentStep: "complete" }, entityId: row.entityId, roleTitle: draft.roleTitle },
    }).where(eq(userModesTable.id, mode.id));
    await tx.update(usersTable).set({ lastActiveModeId: mode.id, activeOutwardAccountId: row.userOutwardAccountId }).where(eq(usersTable.clerkId, row.userClerkId));
  });
}

export default router;

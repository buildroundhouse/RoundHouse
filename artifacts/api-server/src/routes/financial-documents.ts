import { Router } from "express";
import { and, eq, or, inArray, isNull, desc, sql } from "drizzle-orm";
import { db, entitiesTable, entityMembersTable, usersTable, outwardAccountsTable, financialDocumentsTable as documents, type FinancialEvent } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { resolutionAccess } from "../lib/resolutionAccess";
import { financialAuthority, isFinancialOperator, validateDocumentInput, checkDocumentAction, FinancialError } from "../lib/financialDocuments";
const router = Router();
type Document = typeof documents.$inferSelect;
const propertyKind = (kind: string) => ["residential_property", "commercial_property", "property", "facility"].includes(kind);
async function scopeFor(req: AuthRequest) {
  const access = await resolutionAccess(req);
  const ids = access.memberships.map(m => m.entityId);
  const entities = ids.length ? await db.select().from(entitiesTable).where(and(inArray(entitiesTable.id, ids), isNull(entitiesTable.archivedAt))) : [];
  const operator = isFinancialOperator(access.kind);
  const member = (id: number) => access.memberships.find(m => m.entityId === id);
  const issuers = entities.filter(e => e.kind === "business" && operator && financialAuthority(member(e.id)));
  const properties = entities.filter(e => propertyKind(e.kind) && operator && !["viewer", "collaborator"].includes(member(e.id)!.role) && member(e.id)?.permissions.createOnProperties !== false);
  const readable = entities.filter(e => {
    const m = member(e.id)!;
    if (!operator) return propertyKind(e.kind) && m.permissions.seeBilling === true;
    return financialAuthority(m);
  }).map(e => e.id);
  return { ...access, issuers, properties, readable, operator, member };
}
type Scope = Awaited<ReturnType<typeof scopeFor>>;
function permissions(doc: Document, req: AuthRequest, scope: Scope) {
  return {
    manage: scope.operator && scope.issuers.some(e => e.id === doc.issuerEntityId) && scope.properties.some(e => e.id === doc.propertyEntityId),
    approve: scope.operator && req.userId === doc.clientClerkId && req.activeOutwardAccountId === doc.clientAccountId && financialAuthority(scope.member(doc.propertyEntityId)),
  };
}
function visible(doc: Document, req: AuthRequest, scope: Scope) {
  return scope.readable.includes(doc.issuerEntityId) || scope.readable.includes(doc.propertyEntityId)
    || (doc.clientClerkId === req.userId && doc.clientAccountId === req.activeOutwardAccountId)
    || (doc.createdBy === req.userId && doc.issuerAccountId === req.activeOutwardAccountId);
}
function present(doc: Document, req: AuthRequest, scope: Scope) {
  const p = permissions(doc, req, scope);
  return { ...doc, canEdit: p.manage && doc.status === "pending" && !doc.convertedInvoiceId,
    canApprove: p.approve && doc.kind === "estimate" && doc.status === "pending",
    canConvert: p.manage && doc.kind === "estimate" && doc.status === "approved" && !doc.convertedInvoiceId,
    canCollectCheck: p.manage && doc.kind === "invoice" && doc.status === "pending" };
}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function nextNumber(tx: Tx, issuerId: number, kind: "estimate" | "invoice") {
  const result = await tx.execute(sql`INSERT INTO financial_document_counters (issuer_entity_id, kind, last_number)
    VALUES (${issuerId}, ${kind}, ${kind === "invoice" ? 100 : 1})
    ON CONFLICT (issuer_entity_id, kind) DO UPDATE SET last_number = financial_document_counters.last_number + 1 RETURNING last_number`);
  return Number(result.rows[0].last_number);
}
router.get("/financial-documents", requireAuth, async (req, res) => {
  const ar = req as AuthRequest, scope = await scopeFor(ar);
  const account = ar.activeOutwardAccountId ?? -1;
  const own = or(and(eq(documents.createdBy, ar.userId), eq(documents.issuerAccountId, account)), and(eq(documents.clientClerkId, ar.userId), eq(documents.clientAccountId, account)));
  const where = scope.readable.length ? or(own, inArray(documents.issuerEntityId, scope.readable), inArray(documents.propertyEntityId, scope.readable)) : own;
  const rows = await db.select().from(documents).where(where).orderBy(desc(documents.updatedAt), desc(documents.id));
  res.json({ documents: rows.map(d => present(d, ar, scope)) });
});
router.get("/financial-document-contexts", requireAuth, async (req, res) => {
  const ar = req as AuthRequest, scope = await scopeFor(ar);
  if (!scope.issuers.length || !scope.properties.length) { res.json({ issuers: [], properties: [] }); return; }
  const rows = await db.select({ membership: entityMembersTable, name: usersTable.name, kind: outwardAccountsTable.kind }).from(entityMembersTable)
    .innerJoin(usersTable, eq(usersTable.clerkId, entityMembersTable.userClerkId))
    .innerJoin(outwardAccountsTable, eq(outwardAccountsTable.id, entityMembersTable.userOutwardAccountId))
    .where(and(inArray(entityMembersTable.entityId, scope.properties.map(e => e.id)), eq(entityMembersTable.status, "approved"), isNull(entityMembersTable.archivedAt), isNull(outwardAccountsTable.archivedAt)));
  res.json({ issuers: scope.issuers.map(e => ({ id: e.id, name: e.name })), properties: scope.properties.map(e => ({ id: e.id, name: e.name,
    clients: rows.filter(r => r.membership.entityId === e.id && r.membership.userClerkId !== ar.userId && isFinancialOperator(r.kind) && financialAuthority(r.membership))
      .map(r => ({ accountId: r.membership.userOutwardAccountId, name: r.name || "Client" })) })) });
});
router.post("/financial-documents", requireAuth, async (req, res) => {
  try {
    const ar = req as AuthRequest, scope = await scopeFor(ar);
    const input = validateDocumentInput(req.body);
    const { kind, issuerEntityId, propertyEntityId, clientAccountId, requestKey } = req.body;
    if (typeof requestKey !== "string" || !/^[a-zA-Z0-9-]{12,100}$/.test(requestKey)) throw new FinancialError(400, "A valid document request key is required.");
    if (![issuerEntityId, propertyEntityId, clientAccountId].every(Number.isSafeInteger)) throw new FinancialError(400, "Select the Business, Property and client.");
    if (!["estimate", "invoice"].includes(kind)) throw new FinancialError(400, "Choose Estimate or Invoice.");
    const issuer = scope.issuers.find(e => e.id === issuerEntityId), property = scope.properties.find(e => e.id === propertyEntityId);
    if (!issuer || !property || !ar.activeOutwardAccountId) throw new FinancialError(403, "Choose a Business and Property where you have financial permission.");
    const [client] = await db.select({ membership: entityMembersTable, name: usersTable.name, kind: outwardAccountsTable.kind }).from(entityMembersTable)
      .innerJoin(usersTable, eq(usersTable.clerkId, entityMembersTable.userClerkId))
      .innerJoin(outwardAccountsTable, eq(outwardAccountsTable.id, entityMembersTable.userOutwardAccountId))
      .where(and(eq(entityMembersTable.entityId, property.id), eq(entityMembersTable.userOutwardAccountId, Number(clientAccountId) || -1), eq(entityMembersTable.status, "approved"), isNull(entityMembersTable.archivedAt), isNull(outwardAccountsTable.archivedAt)));
    if (!client || !financialAuthority(client.membership) || !isFinancialOperator(client.kind) || client.membership.userClerkId === ar.userId) throw new FinancialError(403, "Select an authorized client for this Property.");
    const result = await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${ar.activeOutwardAccountId!}, hashtext(${requestKey}))`);
      const [existing] = await tx.select().from(documents).where(and(eq(documents.issuerAccountId, ar.activeOutwardAccountId!), eq(documents.requestKey, requestKey)));
      if (existing) return existing;
      const number = await nextNumber(tx, issuer.id, kind);
      const [doc] = await tx.insert(documents).values({ ...input, kind, number, requestKey, issuerEntityId: issuer.id, issuerAccountId: ar.activeOutwardAccountId!, issuerName: issuer.name,
        propertyEntityId: property.id, propertyName: property.name, clientClerkId: client.membership.userClerkId, clientAccountId, clientName: client.name || "Client", createdBy: ar.userId,
        events: [{ action: "created", actorId: ar.userId, at: new Date().toISOString() }] }).returning();
      return doc;
    });
    res.status(201).json(present(result, ar, scope));
  } catch (e) { if (e instanceof FinancialError) { res.status(e.status).json({ error: e.message }); return; } throw e; }
});
router.post("/financial-documents/:id/actions", requireAuth, async (req, res) => {
  try {
    const ar = req as AuthRequest, scope = await scopeFor(ar), id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new FinancialError(404, "Document not found.");
    const result = await db.transaction(async tx => {
      const [doc] = await tx.select().from(documents).where(eq(documents.id, id)).for("update");
      if (!doc || !visible(doc, ar, scope)) throw new FinancialError(404, "Document not found.");
      const action = String(req.body?.action), p = permissions(doc, ar, scope);
      checkDocumentAction(doc, action, p, req.body?.confirmed === true);
      if (action === "convert" && doc.convertedInvoiceId) return { id: doc.convertedInvoiceId }; // retry never creates a duplicate
      const now = new Date();
      const event = (action: FinancialEvent["action"]): FinancialEvent[] => [...doc.events, { action, actorId: ar.userId, at: now.toISOString() }];
      if (action === "convert") {
        const number = await nextNumber(tx, doc.issuerEntityId, "invoice");
        const [invoice] = await tx.insert(documents).values({ kind: "invoice", number, issuerEntityId: doc.issuerEntityId, issuerAccountId: ar.activeOutwardAccountId!, issuerName: doc.issuerName,
          propertyEntityId: doc.propertyEntityId, propertyName: doc.propertyName, clientClerkId: doc.clientClerkId, clientAccountId: doc.clientAccountId, clientName: doc.clientName,
          createdBy: ar.userId, description: doc.description, amountCents: doc.amountCents, sourceEstimateId: doc.id, events: [{ action: "created", actorId: ar.userId, at: now.toISOString() }] }).returning();
        await tx.update(documents).set({ convertedInvoiceId: invoice.id, updatedAt: now, events: event("converted") }).where(eq(documents.id, doc.id));
        return { id: invoice.id };
      }
      const changes = action === "edit" ? { ...validateDocumentInput(req.body), events: event("edited") }
        : action === "approve" ? { status: "approved" as const, approvedAt: now, events: event("approved") }
        : { status: "paid" as const, paidAt: now, paymentMethod: "check_collected", events: event("check_collected") };
      await tx.update(documents).set({ ...changes, updatedAt: now }).where(eq(documents.id, doc.id));
      return { id: doc.id };
    });
    res.json(result);
  } catch (e) { if (e instanceof FinancialError) { res.status(e.status).json({ error: e.message }); return; } throw e; }
});
export default router;

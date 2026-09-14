import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableColumns, getTableName, eq } from "drizzle-orm";
import express from "express";
import request from "supertest";
import * as schema from "../../../../../lib/db/src/schema/index";
import { FINANCIAL_DOCUMENT_STEPS } from "../../../../../lib/db/src/financial-document-schema";
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("@workspace/db", async () => ({ ...await import("../../../../../lib/db/src/schema/index"), get db() { return state.db; } }));
vi.mock("../../middlewares/requireAuth", () => ({ requireAuth: (req: any, res: any, next: any) => {
  if (!req.headers["x-test-user"]) return res.sendStatus(401);
  req.userId = req.headers["x-test-user"]; req.activeOutwardAccountId = Number(req.headers["x-test-account"]); next();
} }));
vi.mock("../../lib/outwardAccounts", () => ({ resolveActiveOutwardAccountId: () => null }));
const pg = new PGlite();
const app = express(); app.use(express.json());
const client = (method: "get" | "post", url: string, user = "trade", account = 10) => request(app)[method]("/api"+url).set("x-test-user", user).set("x-test-account", String(account));
let counter = 0;
const create = (kind = "estimate", extra = {}) => client("post", "/financial-documents").send({ kind, issuerEntityId: 1, propertyEntityId: 2, clientAccountId: 20, description: "Repair and finish entry", amountCents: 25000, requestKey: `test-request-${++counter}`, ...extra });
let estimateId: number, invoiceId: number;
beforeAll(async () => {
  state.db = drizzle(pg);
  // Fixtures use the production columns; financial DDL is the exact deployment migration.
  for (const table of [schema.entitiesTable, schema.entityMembersTable, schema.outwardAccountsTable, schema.usersTable]) {
    const columns = Object.values(getTableColumns(table)).map(c => `"${c.name}" ${c.getSQLType()}`).join(", ");
    await pg.exec(`CREATE TABLE "${getTableName(table)}" (${columns})`);
  }
  for (const step of FINANCIAL_DOCUMENT_STEPS) await pg.exec(step.sql);
  for (const step of FINANCIAL_DOCUMENT_STEPS) await pg.exec(step.sql); // additive migration is repeatable
  await pg.exec(`INSERT INTO users (clerk_id, name) VALUES ('trade','Trade Owner'),('client','Home Client'),('worker','Worker'),('viewer','Viewer'),('outsider','Outsider');
    INSERT INTO outward_accounts (id, owner_clerk_id, kind) VALUES (10,'trade','trade_pro'),(20,'client','home'),(30,'worker','trade_pro_teammate'),(40,'viewer','collab'),(50,'trade','home');
    INSERT INTO entities (id, kind, name) VALUES (1,'business','Workshop'),(2,'residential_property','Oak Home'),(3,'business','Unrelated Business');
    INSERT INTO entity_members (entity_id,user_clerk_id,user_outward_account_id,role,status,permissions) VALUES
      (1,'trade',10,'owner','approved','{}'),(2,'trade',10,'worker','approved','{}'),
      (2,'client',20,'owner','approved','{}'),(1,'worker',30,'employee','approved','{}'),(2,'worker',30,'worker','approved','{}'),
      (2,'viewer',40,'collaborator','approved','{}');`);
  const router = (await import("../financial-documents")).default; app.use("/api", router);
});
afterAll(async () => { await pg.close(); });
describe.sequential("persisted Estimate → Approval → Invoice → Payment", () => {
  it("scopes creation contexts and does not give a worker general financial access", async () => {
    const owner = await client("get", "/financial-document-contexts").expect(200);
    expect(owner.body.issuers.map((e: any) => e.id)).toEqual([1]);
    expect(owner.body.properties[0].clients).toEqual([{ accountId: 20, name: "Home Client" }]);
    for (const [user, account] of [["worker",30],["viewer",40],["client",20]] as const) {
      const r = await client("get", "/financial-document-contexts", user, account).expect(200); expect(r.body.issuers).toEqual([]);
    }
  });
  it("creates sequential estimates without duplicating retried submissions", async () => {
    const first = await create("estimate", { requestKey: "stable-request-001" }).expect(201);
    estimateId = first.body.id; expect(first.body.number).toBe(1);
    const retry = await create("estimate", { requestKey: "stable-request-001" }).expect(201); expect(retry.body.id).toBe(estimateId);
    const second = await create().expect(201); expect(second.body.number).toBe(2);
  });
  it("rejects issuer self-approval, premature conversion and unrelated client selection", async () => {
    await client("post", `/financial-documents/${estimateId}/actions`).send({ action: "approve" }).expect(403);
    await client("post", `/financial-documents/${estimateId}/actions`).send({ action: "convert" }).expect(409);
    await create("invoice", { clientAccountId: 40 }).expect(403);
    await create("invoice", { issuerEntityId: 3 }).expect(403);
  });
  it("records client approval permanently and creates exactly one linked Invoice #100", async () => {
    await client("post", `/financial-documents/${estimateId}/actions`, "client", 20).send({ action: "approve" }).expect(200);
    const conversions = await Promise.all([1, 2].map(() => client("post", `/financial-documents/${estimateId}/actions`).send({ action: "convert" }).expect(200)));
    invoiceId = conversions[0].body.id; expect(conversions[1].body.id).toBe(invoiceId);
    const repeat = await client("post", `/financial-documents/${estimateId}/actions`).send({ action: "convert" }).expect(200); expect(repeat.body.id).toBe(invoiceId);
    const list = await client("get", "/financial-documents", "client", 20).expect(200);
    const estimate = list.body.documents.find((d: any) => d.id === estimateId), invoice = list.body.documents.find((d: any) => d.id === invoiceId);
    expect(estimate.approvedAt).toBeTruthy(); expect(estimate.convertedInvoiceId).toBe(invoiceId); expect(estimate.canEdit).toBe(false);
    expect(invoice.number).toBe(100); expect(invoice.sourceEstimateId).toBe(estimateId); expect(invoice.amountCents).toBe(25000);
    await client("post", `/financial-documents/${estimateId}/actions`).send({ action: "edit", description: "Rewrite agreement", amountCents: 1 }).expect(409);
  });
  it("records confirmed check collection once and rejects fake wallet payments", async () => {
    await client("post", `/financial-documents/${invoiceId}/actions`).send({ action: "apple_pay", confirmed: true }).expect(400);
    await client("post", `/financial-documents/${invoiceId}/actions`).send({ action: "check_collected" }).expect(400);
    await client("post", `/financial-documents/${invoiceId}/actions`, "client", 20).send({ action: "check_collected", confirmed: true }).expect(403);
    await client("post", `/financial-documents/${invoiceId}/actions`).send({ action: "check_collected", confirmed: true }).expect(200);
    const [paid] = await state.db.select().from(schema.financialDocumentsTable).where(eq(schema.financialDocumentsTable.id, invoiceId));
    expect(paid.status).toBe("paid"); expect(paid.paymentMethod).toBe("check_collected"); expect(paid.paidAt).toBeInstanceOf(Date);
    expect(paid.events.at(-1).actorId).toBe("trade");
    await client("post", `/financial-documents/${invoiceId}/actions`).send({ action: "check_collected", confirmed: true }).expect(400);
  });
  it("direct invoices continue the counter and isolate unrelated accounts and Viewers", async () => {
    const invoice = await create("invoice").expect(201); expect(invoice.body.number).toBe(101);
    for (const [user, account] of [["viewer",40],["worker",30],["outsider",99],["trade",50]] as const) {
      const list = await client("get", "/financial-documents", user, account).expect(200); expect(list.body.documents).toEqual([]);
      await client("post", `/financial-documents/${invoice.body.id}/actions`, user, account).send({ action: "check_collected", confirmed: true }).expect(404);
    }
    await request(app).get("/api/financial-documents").expect(401);
  });
  it("honors an explicit financial grant without making a worker an owner", async () => {
    await pg.exec(`UPDATE entity_members SET permissions='{"seeBilling":true}' WHERE entity_id=1 AND user_clerk_id='worker'`);
    const r = await client("get", "/financial-document-contexts", "worker", 30).expect(200); expect(r.body.issuers.length).toBe(1);
    const list = await client("get", "/financial-documents", "worker", 30).expect(200); expect(list.body.documents.length).toBeGreaterThan(0);
  });
  it("retains authored history but ends mutation authority after removal", async () => {
    await pg.exec(`UPDATE entity_members SET status='removed' WHERE user_clerk_id='trade'`);
    const history = await client("get", "/financial-documents").expect(200); expect(history.body.documents.length).toBeGreaterThan(0);
    expect(history.body.documents.every((d: any) => !d.canEdit && !d.canConvert && !d.canCollectCheck)).toBe(true);
  });
});

import { afterAll, beforeAll, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { SQL, sql } from "drizzle-orm";
import * as schema from "../../../../../lib/db/src/schema";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("@workspace/db", async () => ({ ...(await import("../../../../../lib/db/src/schema")), get db() { return state.db; } }));
vi.mock("../../lib/push", () => ({ sendPushToUser: vi.fn(async () => {}) }));
vi.mock("../../middlewares/requireAuth", () => ({ requireAuth: (req: any, res: any, next: any) => {
  req.userId = req.headers["x-test-user"];
  if (!req.userId) return res.status(401).json({ error: "Sign in" });
  next();
} }));
const database = new PGlite();
const app = express();
const user = "intake-integration";
const draft = { path: "property", propertyType: "residential", creating: true, roleTitle: "Homeowner", currentStep: "review", data: { address: "123 Test St", basicInfo: "House", ownershipAssertion: true } };
let modeId: number;

beforeAll(async () => {
  state.db = drizzle(database, { schema });
  const dialect = new PgDialect();
  for (const table of [schema.usersTable, schema.userModesTable, schema.outwardAccountsTable, schema.entitiesTable, schema.entityMembersTable, schema.entityBusinessDetailsTable, schema.propertiesTable, schema.notificationsTable, schema.messagesTable]) {
    const config = getTableConfig(table);
    const columns = config.columns.map((column) => {
      let value = `"${column.name}" ${column.getSQLType()}`;
      if (column.primary) value += " PRIMARY KEY";
      if (column.notNull) value += " NOT NULL";
      if (column.default !== undefined && !column.getSQLType().includes("serial")) {
        const d = column.default;
        value += " DEFAULT " + (d instanceof SQL ? dialect.sqlToQuery(d).sql : typeof d === "object" ? `'${JSON.stringify(d).replaceAll("'", "''")}'::jsonb` : typeof d === "string" ? `'${d.replaceAll("'", "''")}'` : String(d));
      }
      return value;
    });
    await database.exec(`CREATE TABLE "${config.name}" (${columns.join(",")})`);
  }
  await database.exec("CREATE TABLE property_entity_links (property_id integer PRIMARY KEY, entity_id integer NOT NULL)");
  await state.db.insert(schema.usersTable).values({ clerkId: user, name: "Test Person", email: "intake@example.test", username: user, identityCompletedAt: new Date() });
  app.use(express.json());
  app.use((await import("../approved-intake")).default);
  app.use("/api", (await import("../approved-intake")).default);
  app.use("/api", (await import("../entities")).default);
  const { firstConnection } = await import("../../middlewares/firstConnection");
  app.use("/boundary", (req, _res, next) => { Object.assign(req, { userId: req.headers["x-test-user"], activeOutwardAccountId: Number(req.headers["x-test-account"]) }); next(); }, firstConnection);
  app.all("/boundary/logs", (_req, res) => res.json({ allowed: true }));
  app.all("/boundary/entities/:id/messages", (_req, res) => res.json({ allowed: true }));
}, 30000);
afterAll(async () => { await database.close(); });

it("saves and reloads a draft without creating relationships or History", async () => {
  const saved = await request(app).post("/intake/draft").set("x-test-user", user).send({ draft });
  expect(saved.status, JSON.stringify(saved.body)).toBe(201);
  modeId = saved.body.modeId;
  const loaded = await request(app).get("/intake/draft").set("x-test-user", user);
  expect(loaded.body.draft).toEqual(draft);
  expect((await state.db.select().from(schema.entitiesTable))).toHaveLength(0);
});
it("activates the actual route and persists one Property, membership and private History", async () => {
  const result = await request(app).post(`/intake/activate/${modeId}`).set("x-test-user", user).send({ draft });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(result.body.status).toBe("active");
  const entities = await state.db.select().from(schema.entitiesTable);
  expect(entities.filter((e: any) => e.kind === "history")).toHaveLength(1);
  expect(entities.filter((e: any) => e.kind === "residential_property")).toHaveLength(1);
});
it("retries activation without duplicating records", async () => {
  const result = await request(app).post(`/intake/activate/${modeId}`).set("x-test-user", user).send({ draft });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(await state.db.select().from(schema.entitiesTable)).toHaveLength(2);
  expect(await state.db.select().from(schema.entityMembersTable)).toHaveLength(2);
});
it("rejects a direct activation request without authentication", async () => {
  expect((await request(app).post(`/intake/activate/${modeId}`).send({ draft })).status).toBe(401);
});

it("rejects direct operational requests before the first relationship", async () => {
  const result = await request(app).post("/boundary/logs").set("x-test-user", "new-signup").send({ content: "Must not be created" });
  expect(result.status).toBe(409);
  expect(result.body.code).toBe("intake_required");
});

it("allows History reads but rejects History activity creation", async () => {
  const history = (await database.query<{ controller_outward_account_id: number }>("SELECT controller_outward_account_id FROM entities WHERE kind='history' AND created_by_user_clerk_id=$1", [user])).rows[0];
  const account = String(history.controller_outward_account_id);
  expect((await request(app).get("/boundary/logs").set("x-test-user", user).set("x-test-account", account)).status).toBe(200);
  expect((await request(app).post("/boundary/logs").set("x-test-user", user).set("x-test-account", account).send({})).status).toBe(403);
});

it("restores the approved draft even when an older incomplete mode exists", async () => {
  const person = "legacy-draft";
  await state.db.insert(schema.userModesTable).values({ userClerkId: person, kind: "home", intakeData: { old: true } });
  const saved = await request(app).post("/intake/draft").set("x-test-user", person).send({ draft });
  const loaded = await request(app).get("/intake/draft").set("x-test-user", person);
  expect(loaded.body.modeId).toBe(saved.body.modeId);
  expect(loaded.body.draft).toEqual(draft);
});

it("rejects a second free Property and rolls back its account creation", async () => {
  const nextDraft = { ...draft, data: { ...draft.data, address: "456 Test St" } };
  const saved = await request(app).post("/intake/draft").set("x-test-user", user).send({ draft: nextDraft });
  const accountsBefore = await state.db.select().from(schema.outwardAccountsTable);
  const result = await request(app).post(`/intake/activate/${saved.body.modeId}`).set("x-test-user", user).send({ draft: nextDraft });
  expect(result.status).toBe(402);
  expect(result.body.error).toContain("Add Pro to create another Property");
  expect(await state.db.select().from(schema.outwardAccountsTable)).toHaveLength(accountsBefore.length);
});

it("updates the saved mode when Residential changes to Commercial", async () => {
  const person = "changed-path";
  const saved = await request(app).post("/intake/draft").set("x-test-user", person).send({ draft });
  await request(app).post("/intake/draft").set("x-test-user", person).send({ modeId: saved.body.modeId, draft: { ...draft, propertyType: "commercial" } });
  const rows = await database.query<{ kind: string }>("SELECT kind FROM user_modes WHERE id = $1", [saved.body.modeId]);
  expect(rows.rows[0].kind).toBe("facilities");
});

it.each(["trade", "supplier"])("activates the first free %s Business", async (path) => {
  const person = `business-${path}`;
  await state.db.insert(schema.usersTable).values({ clerkId: person, name: person, email: `${person}@example.test`, username: person, identityCompletedAt: new Date() });
  const businessDraft = { path, creating: true, roleTitle: path === "trade" ? "Trade Professional" : "Supplier", currentStep: "review", data: { address: `${path} Test Rd`, businessName: `${path} Test`, yearsInBusiness: "2", services: "Materials", tradePosition: "Carpenter", yearsExperience: "5", supplierPosition: "Sales" } };
  const saved = await request(app).post("/intake/draft").set("x-test-user", person).send({ draft: businessDraft });
  const result = await request(app).post(`/intake/activate/${saved.body.modeId}`).set("x-test-user", person).send({ draft: businessDraft });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(result.body.status).toBe("active");
  const rows = await database.query<{ role: string }>("SELECT permissions->'scope'->>'roleTitle' AS role FROM entity_members WHERE user_clerk_id=$1 AND role <> 'viewer'", [person]);
  expect(rows.rows[0].role).toBe(businessDraft.roleTitle);
});

it("leaves an existing-record request pending when either party is paid", async () => {
  const person = "requester";
  await state.db.insert(schema.usersTable).values({ clerkId: person, name: person, email: `${person}@example.test`, username: person, identityCompletedAt: new Date() });
  const property = (await database.query<{ id: number }>("SELECT id FROM entities WHERE kind='residential_property' LIMIT 1")).rows[0];
  const viewerDraft = { ...draft, creating: false, existingEntityId: property.id, roleTitle: "Home (Viewer)" };
  const saved = await request(app).post("/intake/draft").set("x-test-user", person).send({ draft: viewerDraft });
  const endpoint = `/intake/activate/${saved.body.modeId}`;
  expect((await request(app).post(endpoint).set("x-test-user", person).send({ draft: viewerDraft })).status).toBe(402);
  await database.query("UPDATE outward_accounts SET capability_state='expanded' WHERE owner_clerk_id=$1 AND kind='home'", [user]);
  const result = await request(app).post(endpoint).set("x-test-user", person).send({ draft: viewerDraft });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(result.body.status).toBe("pending");
  expect((await database.query("SELECT id FROM notifications WHERE type='entity_request' AND user_clerk_id=$1", [user])).rows).toHaveLength(1);
  expect((await database.query("SELECT id FROM entities WHERE kind='history' AND created_by_user_clerk_id=$1", [person])).rows).toHaveLength(0);
});

it("Trade and Supplier share the same free Business creation allowance", async () => {
  const person = "business-trade";
  expect((await request(app).get("/intake/creation-eligibility?path=supplier").set("x-test-user", person)).body.allowed).toBe(false);
  const value = { path: "supplier", creating: true, roleTitle: "Supplier", currentStep: "review", data: { businessName: "Second supplier", address: "Second Business Road", yearsInBusiness: "2", services: "Materials", supplierPosition: "Sales" } };
  const saved = await request(app).post("/intake/draft").set("x-test-user", person).send({ draft: value });
  const activated = await request(app).post(`/intake/activate/${saved.body.modeId}`).set("x-test-user", person).send({ draft: value });
  expect(activated.status).toBe(402);
  expect(activated.body.error).toContain("Add Pro to create another Business");
});

it("activates a Commercial Property with the governing Property role catalogue", async () => {
  const person = "commercial-intake";
  await state.db.insert(schema.usersTable).values({ clerkId: person, name: person, username: person, email: `${person}@example.test`, identityCompletedAt: new Date() });
  const value = { ...draft, propertyType: "commercial", data: { ...draft.data, propertyName: "Test Facility", address: "Commercial Test Road" } };
  const saved = await request(app).post("/intake/draft").set("x-test-user", person).send({ draft: value });
  expect((await request(app).post(`/intake/activate/${saved.body.modeId}`).set("x-test-user", person).send({ draft: value })).status).toBe(200);
  expect((await database.query("SELECT id FROM entities WHERE kind='commercial_property' AND created_by_user_clerk_id=$1", [person])).rows).toHaveLength(1);
  expect((await request(app).get("/intake/creation-eligibility?path=property").set("x-test-user", person)).body.allowed).toBe(false);
});

it("freezes the reviewed role while an access request awaits authorization", async () => {
  const saved = await request(app).get("/intake/draft").set("x-test-user", "requester");
  const changed = { ...saved.body.draft, roleTitle: "Home Pro (Manager)" };
  const result = await request(app).post("/intake/draft").set("x-test-user", "requester").send({ modeId: saved.body.modeId, draft: changed });
  expect(result.status).toBe(409);
  expect((await request(app).get("/intake/draft").set("x-test-user", "requester")).body.draft.roleTitle).toBe("Home (Viewer)");
});

it("concurrent retry submissions persist exactly one working record and one History", async () => {
  const person = "concurrent-intake";
  await state.db.insert(schema.usersTable).values({ clerkId: person, name: person, username: person, email: `${person}@example.test`, identityCompletedAt: new Date() });
  const value = { ...draft, data: { ...draft.data, address: "Concurrent Test Road" } };
  const saves = await Promise.all([1, 2].map(() => request(app).post("/intake/draft").set("x-test-user", person).send({ draft: value })));
  expect(saves[0].body.modeId).toBe(saves[1].body.modeId);
  const responses = await Promise.all([1, 2].map(() => request(app).post(`/intake/activate/${saves[0].body.modeId}`).set("x-test-user", person).send({ draft: value })));
  expect(responses.map((response) => response.status)).toEqual([200, 200]);
  expect((await database.query("SELECT id FROM entities WHERE created_by_user_clerk_id=$1", [person])).rows).toHaveLength(2);
  expect((await database.query("SELECT id FROM entity_members WHERE user_clerk_id=$1", [person])).rows).toHaveLength(2);
});

it("prepares billing for a first-time paid role without granting a relationship or History", async () => {
  const person = "billing-before-activation";
  await state.db.insert(schema.usersTable).values({ clerkId: person, name: person, username: person, email: `${person}@example.test`, identityCompletedAt: new Date() });
  const value = { ...draft, roleTitle: "Home Pro (Owner)", data: { ...draft.data, address: "Billing Test Road" } };
  const saved = await request(app).post("/intake/draft").set("x-test-user", person).send({ draft: value });
  const endpoint = `/intake/billing/${saved.body.modeId}`;
  const first = await request(app).post(endpoint).set("x-test-user", person);
  expect(first.status).toBe(200);
  expect((await request(app).post(endpoint).set("x-test-user", person)).body.accountId).toBe(first.body.accountId);
  expect((await database.query("SELECT id FROM entity_members WHERE user_clerk_id=$1", [person])).rows).toHaveLength(0);
  expect((await request(app).post("/boundary/logs").set("x-test-user", person).set("x-test-account", String(first.body.accountId))).status).toBe(409);
  expect((await request(app).post(endpoint).set("x-test-user", "another-person")).status).toBe(409);
  await database.query("UPDATE outward_accounts SET capability_state='expanded' WHERE id=$1", [first.body.accountId]);
  const activated = await request(app).post(`/intake/activate/${saved.body.modeId}`).set("x-test-user", person).send({ draft: value });
  expect(activated.status, JSON.stringify(activated.body)).toBe(200);
  expect((await database.query("SELECT id FROM entities WHERE kind='history' AND created_by_user_clerk_id=$1", [person])).rows).toHaveLength(1);
});

it("a failed History save rolls back activation and the draft can retry successfully", async () => {
  const person = "failed-history-save";
  await state.db.insert(schema.usersTable).values({ clerkId: person, name: person, username: person, email: `${person}@example.test`, identityCompletedAt: new Date() });
  const value = { ...draft, data: { ...draft.data, address: "Failure Test Road" } };
  const saved = await request(app).post("/intake/draft").set("x-test-user", person).send({ draft: value });
  await database.exec("ALTER TABLE entities ADD CONSTRAINT test_history_failure CHECK (NOT (kind='history' AND created_by_user_clerk_id='failed-history-save'))");
  const endpoint = `/intake/activate/${saved.body.modeId}`;
  try {
    expect((await request(app).post(endpoint).set("x-test-user", person).send({ draft: value })).status).toBe(500);
    expect((await database.query("SELECT id FROM entities WHERE created_by_user_clerk_id=$1", [person])).rows).toHaveLength(0);
    expect((await database.query("SELECT id FROM outward_accounts WHERE owner_clerk_id=$1", [person])).rows).toHaveLength(0);
    expect((await request(app).get("/intake/draft").set("x-test-user", person)).body.draft).toEqual(value);
  } finally { await database.exec("ALTER TABLE entities DROP CONSTRAINT test_history_failure"); }
  expect((await request(app).post(endpoint).set("x-test-user", person).send({ draft: value })).body.status).toBe("active");
});

it("rolls back consent and History together if qualifying paid access ends", async () => {
  const { finalizeApprovedIntakeMembership } = await import("../approved-intake");
  const member = (await database.query<{ id: number }>("SELECT id FROM entity_members WHERE user_clerk_id='requester'")).rows[0];
  const endpoint = `/api/entities/members/${member.id}/respond`;
  expect((await request(app).post(endpoint).set("x-test-user", "requester").send({ action: "accept" })).status).toBe(403);
  await database.query("UPDATE outward_accounts SET capability_state='standard' WHERE owner_clerk_id=$1", [user]);
  expect((await request(app).post(endpoint).set("x-test-user", user).send({ action: "accept" })).status).toBe(402);
  expect((await database.query<{ status: string }>("SELECT status FROM entity_members WHERE id=$1", [member.id])).rows[0].status).toBe("requested");
  expect((await database.query("SELECT id FROM entities WHERE kind='history' AND created_by_user_clerk_id='requester'")).rows).toHaveLength(0);
  // The participant's paid access alone now qualifies, with the controller free.
  await database.query("UPDATE outward_accounts SET capability_state='expanded' WHERE owner_clerk_id='requester'");
  const approved = await request(app).post(endpoint).set("x-test-user", user).send({ action: "accept" });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  await finalizeApprovedIntakeMembership(member.id);
  expect((await database.query("SELECT id FROM entities WHERE kind='history' AND created_by_user_clerk_id='requester'")).rows).toHaveLength(1);
  expect((await request(app).get("/intake/draft").set("x-test-user", "requester")).body.draft).toBeNull();
});

it("retains private History after the final working membership ends and rejects the former context", async () => {
  const working = (await database.query<{ user_outward_account_id: number }>("SELECT user_outward_account_id FROM entity_members WHERE user_clerk_id=$1 AND role='owner'", [user])).rows[0];
  await database.query("UPDATE entity_members SET archived_at=now() WHERE user_clerk_id=$1 AND role='owner'", [user]);
  const history = (await database.query<{ controller_outward_account_id: number }>("SELECT controller_outward_account_id FROM entities WHERE kind='history' AND created_by_user_clerk_id=$1", [user])).rows[0];
  expect((await request(app).get("/boundary/logs").set("x-test-user", user).set("x-test-account", String(history.controller_outward_account_id))).status).toBe(200);
  expect((await request(app).post("/boundary/logs").set("x-test-user", user).set("x-test-account", String(working.user_outward_account_id))).status).toBe(403);
});

it("paid capabilities accept either paid party and reject free pairs and private History", async () => {
  const { isCapabilityAvailable } = await import("../../lib/capabilities");
  const account = (await database.query<{ user_outward_account_id: number }>("SELECT user_outward_account_id FROM entity_members WHERE user_clerk_id='requester' AND role='viewer' AND permissions->'scope'->>'privateHistory' IS NULL")).rows[0].user_outward_account_id;
  const history = (await database.query<{ controller_outward_account_id: number }>("SELECT controller_outward_account_id FROM entities WHERE kind='history' AND created_by_user_clerk_id='requester'")).rows[0].controller_outward_account_id;
  expect(await isCapabilityAvailable(account, "expanded_participation")).toBe(true);
  expect(await isCapabilityAvailable(history, "expanded_participation")).toBe(false);
  await database.query("UPDATE outward_accounts SET capability_state='standard' WHERE owner_clerk_id='requester'");
  expect(await isCapabilityAvailable(account, "expanded_participation")).toBe(false);
  await database.query("UPDATE outward_accounts SET capability_state='expanded' WHERE owner_clerk_id=$1", [user]);
  expect(await isCapabilityAvailable(account, "expanded_participation")).toBe(true);
});

it("entity access enforces private History ownership and excludes archived Entities", async () => {
  const { canParticipateInEntity, getApprovedMembership } = await import("../../lib/entityAccess");
  const history = (await database.query<{ id: number }>("SELECT id FROM entities WHERE kind='history' AND created_by_user_clerk_id=$1", [user])).rows[0];
  expect(await canParticipateInEntity(user, history.id)).toBe(true);
  expect(await getApprovedMembership(user, history.id)).toMatchObject({ role: "viewer" });
  expect(await canParticipateInEntity("requester", history.id)).toBe(false);
  expect((await request(app).get(`/api/entities/${history.id}`).set("x-test-user", "requester")).status).toBe(404);
  expect((await request(app).get(`/api/entities/${history.id}`).set("x-test-user", user)).status).toBe(200);
  await database.query("UPDATE entities SET archived_at=now() WHERE id=$1", [history.id]);
  try { expect(await canParticipateInEntity(user, history.id)).toBe(false); }
  finally { await database.query("UPDATE entities SET archived_at=NULL WHERE id=$1", [history.id]); }
});

it("nested Entity messaging requires its own authorized context and either paid party", async () => {
  const membership = (await database.query<{ entity_id: number; user_outward_account_id: number }>("SELECT entity_id,user_outward_account_id FROM entity_members WHERE user_clerk_id='requester' AND permissions->'scope'->>'privateHistory' IS NULL")).rows[0];
  const endpoint = `/boundary/entities/${membership.entity_id}/messages`;
  const send = () => request(app).post(endpoint).set("x-test-user", "requester").set("x-test-account", String(membership.user_outward_account_id)).send({ content: "Test" });
  expect((await send()).status).toBe(200);
  await database.query("UPDATE outward_accounts SET capability_state='standard' WHERE owner_clerk_id=$1", [user]);
  expect((await send()).status).toBe(402);
  expect((await request(app).post(endpoint).set("x-test-user", "brand-new").send({})).status).toBe(409);
  expect((await request(app).post(endpoint).set("x-test-user", "requester").set("x-test-account", "999999").send({})).status).toBe(403);
});

it("browser: actual intake screen saves, goes Back, refreshes and activates through the API", async () => {
  const person = "browser-intake";
  await state.db.insert(schema.usersTable).values({ clerkId: person, name: person, email: `${person}@example.test`, username: person, identityCompletedAt: new Date() });
  const clientRoot = fileURLToPath(new URL("../../../../round-house/", import.meta.url));
  const bundle = await build({
    absWorkingDir: clientRoot,
    resolveExtensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".js", ".json"],
    stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import Screen from "./app/(onboarding)/entry"; createRoot(document.getElementById("root")).render(<Screen/>);', loader: "tsx", resolveDir: clientRoot },
    bundle: true, write: false, format: "iife", platform: "browser", define: { "process.env.NODE_ENV": '"test"', __DEV__: "false" },
    alias: { "react-native": "react-native-web", "@": clientRoot },
    plugins: [{ name: "test-shell", setup(b) {
      b.onResolve({ filter: /^(expo-router|react-native-safe-area-context|@workspace\/api-client-react|@\/lib\/profile)$/ }, (args) => ({ path: args.path, namespace: "test-shell" }));
      b.onLoad({ filter: /.*/, namespace: "test-shell" }, (args) => ({ loader: "js", contents:
        args.path === "expo-router" ? 'export const useRouter = () => ({canGoBack:()=>false,back:()=>{},push:()=>{},replace:()=>{}});' :
        args.path === "react-native-safe-area-context" ? 'export const useSafeAreaInsets = () => ({top:0,bottom:0,left:0,right:0});' :
        args.path === "@/lib/profile" ? `export const useProfile = () => ({profile:{clerkId:new URLSearchParams(location.search).get("person")||"${person}"},refetchProfile:async()=>{},refetchModes:async()=>{},refetchOutwardAccounts:async()=>{}});` :
        `export async function requestUploadUrl() { throw new Error("Storage uploads are not provided by the browser test shell."); } export async function customFetch(url, options={}) { const r=await fetch(url,{...options,headers:{...options.headers,"x-test-user":new URLSearchParams(location.search).get("person")||"${person}"}}); const data=await r.json(); if(!r.ok) throw new Error(data.error); return data; }`
      }));
    } }],
  });
  app.get("/intake-check", (_req, res) => res.type("html").send('<html><body><div id="root"></div><script src="/intake-check.js"></script></body></html>'));
  app.get("/intake-check.js", (_req, res) => res.type("js").send(bundle.outputFiles[0].text));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as { port: number };
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.INTAKE_TEST_BROWSER ? { executablePath: process.env.INTAKE_TEST_BROWSER, args: ["--no-sandbox", "--disable-dev-shm-usage"] } : {}) });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/intake-check`);
    await page.getByRole("button", { name: "PROPERTY", exact: true }).click();
    await page.getByRole("button", { name: "Residential", exact: true }).click();
    await page.getByLabel("Street address").fill("999 Browser Test");
    await page.getByRole("button", { name: "SEARCH", exact: true }).click();
    await page.getByRole("button", { name: /Add a new Property/ }).click();
    await page.getByRole("button", { name: "Homeowner", exact: true }).click();
    await page.getByLabel("Address", { exact: true }).fill("999 Browser Test");
    await page.getByLabel("Basic Property information").fill("Browser integration house");
    await page.getByRole("button", { name: "SAVE & CONTINUE" }).click();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    expect(await page.getByLabel("Address", { exact: true }).inputValue()).toBe("999 Browser Test");
    await page.getByLabel("Basic Property information").fill("Unsaved field survives restart");
    await page.waitForFunction(() => Object.values(localStorage).some((value) => value.includes("Unsaved field survives restart")));
    await page.reload();
    await page.getByLabel("Address", { exact: true }).waitFor();
    expect(await page.getByLabel("Address", { exact: true }).inputValue()).toBe("999 Browser Test");
    expect(await page.getByLabel("Basic Property information").inputValue()).toBe("Unsaved field survives restart");
    await page.getByRole("button", { name: "SAVE & CONTINUE" }).click();
    await page.getByText("I confirm I am the legitimate owner.", { exact: true }).click();
    await page.getByRole("button", { name: "SAVE & CONTINUE" }).click();
    await page.getByRole("button", { name: "Edit Property Profile", exact: true }).click();
    await page.getByLabel("Property name (optional)").fill("Reviewed Home");
    await page.getByRole("button", { name: "SAVE & CONTINUE" }).click();
    await page.getByRole("button", { name: "Edit Role", exact: true }).click();
    await page.getByRole("button", { name: "Home (Viewer)", exact: true }).click();
    await page.getByRole("button", { name: "ACTIVATE", exact: true }).click();
    await page.getByText("That role requires authorization from an existing record.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Edit Role", exact: true }).click();
    await page.getByRole("button", { name: "Homeowner", exact: true }).click();
    await page.getByRole("button", { name: "Edit Role Details", exact: true }).click();
    await page.getByText("I confirm I am the legitimate owner.", { exact: true }).click();
    await page.getByRole("button", { name: "SAVE & CONTINUE" }).click();
    await page.getByRole("button", { name: "ACTIVATE", exact: true }).click();
    await page.getByRole("button", { name: "ENTER COMMAND CENTER" }).waitFor();
    const histories = await database.query("SELECT id FROM entities WHERE kind='history' AND created_by_user_clerk_id=$1", [person]);
    expect(histories.rows).toHaveLength(1);
    for (const path of ["trade", "supplier"]) {
      const businessUser = `browser-${path}`;
      await state.db.insert(schema.usersTable).values({ clerkId: businessUser, name: businessUser, username: businessUser, email: `${businessUser}@example.test`, identityCompletedAt: new Date() });
      await page.goto(`http://127.0.0.1:${address.port}/intake-check?person=${businessUser}`);
      await page.getByRole("button", { name: path.toUpperCase(), exact: true }).click();
      await page.getByLabel("Business name or location").fill(`Browser ${path}`);
      await page.getByRole("button", { name: "SEARCH", exact: true }).click();
      await page.getByRole("button", { name: "Add a new Business", exact: true }).click();
      await page.getByRole("button", { name: path === "trade" ? "Trade Professional" : "Supplier", exact: true }).click();
      await page.getByLabel("Business name", { exact: true }).fill(`Browser ${path}`);
      await page.getByLabel("Address", { exact: true }).fill(`Browser ${path} Road`);
      await page.getByLabel("Years in business").fill("2");
      await page.getByRole("button", { name: "SAVE & CONTINUE" }).click();
      await page.getByLabel("Products and services").fill("Building services");
      await page.getByRole("button", { name: "SAVE & CONTINUE" }).click();
      if (path === "trade") {
        await page.getByLabel("Trade / position").fill("Carpenter");
        await page.getByRole("button", { name: "SAVE & CONTINUE" }).click();
        await page.getByLabel("Years of experience").fill("10");
        await page.getByRole("button", { name: "SAVE & CONTINUE" }).click();
        await page.getByRole("button", { name: "SAVE & CONTINUE" }).click();
      } else {
        await page.getByLabel("Position / responsibility").fill("Sales");
        await page.getByRole("button", { name: "SAVE & CONTINUE" }).click();
      }
      await page.getByRole("button", { name: "ACTIVATE", exact: true }).click();
      await page.getByRole("button", { name: "ENTER COMMAND CENTER" }).waitFor();
      expect((await database.query("SELECT id FROM entities WHERE kind='history' AND created_by_user_clerk_id=$1", [businessUser])).rows).toHaveLength(1);
    }
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
  }, 60000);

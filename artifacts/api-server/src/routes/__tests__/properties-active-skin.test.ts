/**
 * Tests for task #316: GET/POST /properties is scoped to the caller's
 * active outward account (skin). Properties stamped with another of the
 * caller's skins are hidden, and newly created properties are stamped
 * with the active skin.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = String(req.headers["x-test-user"] ?? "");
    if (!req.userId) {
      _res.status(401).json({ error: "missing x-test-user" });
      return;
    }
    next();
  },
}));

const { db, usersTable, outwardAccountsTable, propertiesTable } = await import(
  "@workspace/db"
);
const propertiesRouter = (await import("../properties")).default;
const outwardAccountsRouter = (await import("../outward-accounts")).default;
const { withActiveOutwardAccount } = await import(
  "../../middlewares/withActiveOutwardAccount"
);

function attachTestUserId(req: any, _res: any, next: any) {
  const uid = req.headers["x-test-user"];
  if (uid) req.userId = String(uid);
  next();
}

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", attachTestUserId, withActiveOutwardAccount);
  app.use("/api", outwardAccountsRouter);
  app.use("/api", propertiesRouter);
  return app;
}

const tag = `t316-${Date.now()}`;
const aliceClerk = `${tag}-alice`;
let app: Express;

beforeAll(async () => {
  app = makeApp();
  await db.insert(usersTable).values([
    {
      clerkId: aliceClerk,
      email: `${tag}-alice@example.test`,
      name: "Alice Owner",
      username: `alice_${tag}`,
    },
  ]);
});

afterAll(async () => {
  await db
    .delete(propertiesTable)
    .where(eq(propertiesTable.ownerClerkId, aliceClerk));
  await db
    .delete(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.ownerClerkId, [aliceClerk]));
  await db.delete(usersTable).where(eq(usersTable.clerkId, aliceClerk));
});

describe("properties active outward-account scoping", () => {
  it("hides properties created under a different skin and stamps new ones with the active skin", async () => {
    // Lazy-seed Alice's default skin (skin A).
    const list = await request(app)
      .get("/api/outward-accounts")
      .set("x-test-user", aliceClerk);
    const skinAId: number = list.body.activeOutwardAccountId;
    expect(skinAId).toBeGreaterThan(0);

    // Create a second skin (skin B).
    const created = await request(app)
      .post("/api/outward-accounts")
      .set("x-test-user", aliceClerk)
      .send({ kind: "trade_pro", title: "Alice Trade", displayName: "Alice Trade" });
    expect(created.status).toBe(201);
    const skinBId: number = created.body.id;

    // Create a property while skin A is active.
    const propA = await request(app)
      .post("/api/properties")
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(skinAId))
      .send({ name: `${tag}-house-A` });
    expect(propA.status).toBe(201);
    const propAId: number = propA.body.id;

    // Switch to skin B and create another.
    const propB = await request(app)
      .post("/api/properties")
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(skinBId))
      .send({ name: `${tag}-house-B` });
    expect(propB.status).toBe(201);
    const propBId: number = propB.body.id;

    // Verify DB stamping.
    const rows = await db
      .select({ id: propertiesTable.id, oa: propertiesTable.ownerOutwardAccountId })
      .from(propertiesTable)
      .where(inArray(propertiesTable.id, [propAId, propBId]));
    const byId = new Map(rows.map((r) => [r.id, r.oa]));
    expect(byId.get(propAId)).toBe(skinAId);
    expect(byId.get(propBId)).toBe(skinBId);

    // Listing under skin A: only property A is visible.
    const listA = await request(app)
      .get("/api/properties")
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(skinAId));
    expect(listA.status).toBe(200);
    const listAIds = listA.body.properties.map((p: any) => p.id);
    expect(listAIds).toContain(propAId);
    expect(listAIds).not.toContain(propBId);

    // Listing under skin B: only property B is visible.
    const listB = await request(app)
      .get("/api/properties")
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(skinBId));
    expect(listB.status).toBe(200);
    const listBIds = listB.body.properties.map((p: any) => p.id);
    expect(listBIds).toContain(propBId);
    expect(listBIds).not.toContain(propAId);
  });
});

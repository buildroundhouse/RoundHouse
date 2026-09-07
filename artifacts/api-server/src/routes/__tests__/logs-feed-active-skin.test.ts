/**
 * Tests for task #316: GET /logs/feed is scoped to the caller's active
 * outward account on the owner-side. A log on a property owned by the
 * caller only appears under the skin that was active when the property
 * was created.
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

const {
  db,
  usersTable,
  outwardAccountsTable,
  propertiesTable,
  workLogsTable,
} = await import("@workspace/db");
const { purgeEntitiesForProperties } = await import(
  "../../lib/migratePropertyEntities"
);
const logsRouter = (await import("../logs")).default;
const propertiesRouter = (await import("../properties")).default;
const outwardAccountsRouter = (await import("../outward-accounts")).default;
const { withActiveOutwardAccount } = await import(
  "../../middlewares/withActiveOutwardAccount"
);
const { withActiveMode } = await import("../../middlewares/withActiveMode");

function attachTestUserId(req: any, _res: any, next: any) {
  const uid = req.headers["x-test-user"];
  if (uid) req.userId = String(uid);
  next();
}

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", attachTestUserId, withActiveOutwardAccount, withActiveMode);
  app.use("/api", outwardAccountsRouter);
  app.use("/api", propertiesRouter);
  app.use("/api", logsRouter);
  return app;
}

const tag = `t316f-${Date.now()}`;
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
  const props = await db
    .select({ id: propertiesTable.id })
    .from(propertiesTable)
    .where(eq(propertiesTable.ownerClerkId, aliceClerk));
  const propIds = props.map((p) => p.id);
  if (propIds.length > 0) {
    await db
      .delete(workLogsTable)
      .where(inArray(workLogsTable.propertyId, propIds));
    await purgeEntitiesForProperties(propIds);
    await db
      .delete(propertiesTable)
      .where(inArray(propertiesTable.id, propIds));
  }
  await db
    .delete(outwardAccountsTable)
    .where(eq(outwardAccountsTable.ownerClerkId, aliceClerk));
  await db.delete(usersTable).where(eq(usersTable.clerkId, aliceClerk));
});

describe("/logs/feed active outward-account scoping", () => {
  it("only surfaces logs for owned properties belonging to the active skin", async () => {
    // Lazy-seed Alice's first skin (skin A) and create a second (skin B).
    const list = await request(app)
      .get("/api/outward-accounts")
      .set("x-test-user", aliceClerk);
    const skinAId: number = list.body.activeOutwardAccountId;
    const created = await request(app)
      .post("/api/outward-accounts")
      .set("x-test-user", aliceClerk)
      .send({ kind: "trade_pro", title: "Alice Trade", displayName: "Alice Trade" });
    const skinBId: number = created.body.id;

    // Create a property under each skin.
    const propA = await request(app)
      .post("/api/properties")
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(skinAId))
      .send({ name: `${tag}-houseA` });
    const propB = await request(app)
      .post("/api/properties")
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(skinBId))
      .send({ name: `${tag}-houseB` });
    const propAId: number = propA.body.id;
    const propBId: number = propB.body.id;

    // Add a work log to each property authored by Alice.
    await db.insert(workLogsTable).values([
      {
        propertyId: propAId,
        authorClerkId: aliceClerk,
        note: `${tag}-logA`,
      },
      {
        propertyId: propBId,
        authorClerkId: aliceClerk,
        note: `${tag}-logB`,
      },
    ]);

    // Feed under skin A should include log A but not log B.
    const feedA = await request(app)
      .get("/api/logs/feed")
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(skinAId));
    expect(feedA.status).toBe(200);
    const feedANotes = feedA.body.logs.map((l: any) => l.note);
    expect(feedANotes).toContain(`${tag}-logA`);
    expect(feedANotes).not.toContain(`${tag}-logB`);

    // Feed under skin B should include log B but not log A.
    const feedB = await request(app)
      .get("/api/logs/feed")
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(skinBId));
    expect(feedB.status).toBe(200);
    const feedBNotes = feedB.body.logs.map((l: any) => l.note);
    expect(feedBNotes).toContain(`${tag}-logB`);
    expect(feedBNotes).not.toContain(`${tag}-logA`);
  });
});

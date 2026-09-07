/**
 * Tests for task #312: properties, property memberships, and work orders
 * are scoped to the caller's active outward account ("skin").
 *
 * Covers:
 *   - POST /properties stamps `ownerOutwardAccountId` from the active skin
 *     and creates the owner membership with the same `userOutwardAccountId`.
 *   - GET /properties only returns rows whose owner-membership belongs to
 *     the active skin (legacy NULL rows remain visible during the
 *     transition window so pre-migration data isn't hidden).
 *   - POST /properties/:id/work-orders stamps `createdByOutwardAccountId`
 *     from the active skin and `assigneeOutwardAccountId` from the
 *     assignee's default skin.
 *   - PUT /work-orders/:id reassignment refreshes `assigneeOutwardAccountId`.
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
  entityMembersTable,
  workOrdersTable,
} = await import("@workspace/db");
const {
  upsertPropertyMembership,
  purgeEntitiesForProperties,
  entityIdForProperty,
} = await import("../../lib/migratePropertyEntities");
const propertiesRouter = (await import("../properties")).default;
const workOrdersRouter = (await import("../work-orders")).default;
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
  app.use("/api", workOrdersRouter);
  return app;
}

const tag = `t312-${Date.now()}`;
const ownerClerk = `${tag}-owner`;
const tradeClerk = `${tag}-trade`;

let app: Express;
let skinA: number;
let skinB: number;
let tradeSkin: number;
const createdPropertyIds: number[] = [];

beforeAll(async () => {
  app = makeApp();
  await db.insert(usersTable).values([
    {
      clerkId: ownerClerk,
      email: `${tag}-owner@example.test`,
      name: "Owner",
      username: `owner_${tag}`,
    },
    {
      clerkId: tradeClerk,
      email: `${tag}-trade@example.test`,
      name: "Trade",
      username: `trade_${tag}`,
    },
  ]);
  // Lazy-seed defaults via the outward-accounts endpoint.
  await request(makeApp()).get("/api/outward-accounts").set("x-test-user", ownerClerk);
  await request(makeApp()).get("/api/outward-accounts").set("x-test-user", tradeClerk);
  // Create a second outward account ("skin B") for the owner.
  const second = await request(makeApp())
    .post("/api/outward-accounts")
    .set("x-test-user", ownerClerk)
    .send({ kind: "trade_pro", title: "Owner Side Hustle", displayName: "Owner Side Hustle" });
  expect(second.status).toBe(201);
  const ownerAccounts = await db
    .select({ id: outwardAccountsTable.id })
    .from(outwardAccountsTable)
    .where(eq(outwardAccountsTable.ownerClerkId, ownerClerk))
    .orderBy(outwardAccountsTable.id);
  expect(ownerAccounts.length).toBeGreaterThanOrEqual(2);
  skinA = ownerAccounts[0].id;
  skinB = ownerAccounts[1].id;
  const [tradeRow] = await db
    .select({ id: outwardAccountsTable.id })
    .from(outwardAccountsTable)
    .where(eq(outwardAccountsTable.ownerClerkId, tradeClerk));
  tradeSkin = tradeRow.id;
  // Task #312 only governs skin-stamping; the paid-capability gate added
  // by task #317 is a separate concern. Grant `expanded` on the seeded
  // skins so POST /properties and work-order creation aren't blocked by
  // billing in these isolation tests.
  await db
    .update(outwardAccountsTable)
    .set({ capabilityState: "expanded" })
    .where(inArray(outwardAccountsTable.id, [skinA, skinB, tradeSkin]));
});

afterAll(async () => {
  if (createdPropertyIds.length > 0) {
    await db
      .delete(workOrdersTable)
      .where(inArray(workOrdersTable.propertyId, createdPropertyIds));
    await purgeEntitiesForProperties(createdPropertyIds);
    await db
      .delete(propertiesTable)
      .where(inArray(propertiesTable.id, createdPropertyIds));
  }
  const clerkIds = [ownerClerk, tradeClerk];
  await db
    .delete(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.ownerClerkId, clerkIds));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, clerkIds));
});

describe("owned-data outward-account scoping (task #312)", () => {
  it("creates a property under the active skin and excludes it from other skins' lists", async () => {
    const created = await request(app)
      .post("/api/properties")
      .set("x-test-user", ownerClerk)
      .set("x-active-outward-account-id", String(skinA))
      .send({ name: `Skin A House ${tag}`, address: "1 A St", type: "home" });
    expect(created.status).toBe(201);
    const propIdA: number = created.body.id;
    expect(propIdA).toBeGreaterThan(0);
    createdPropertyIds.push(propIdA);

    const [propRow] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, propIdA));
    expect(propRow.ownerOutwardAccountId).toBe(skinA);
    const entityIdA = await entityIdForProperty(propIdA);
    expect(entityIdA).not.toBeNull();
    const [memberRow] = await db
      .select()
      .from(entityMembersTable)
      .where(eq(entityMembersTable.entityId, entityIdA!));
    expect(memberRow.userOutwardAccountId).toBe(skinA);

    // Listing as skin A includes the new property.
    const listA = await request(app)
      .get("/api/properties")
      .set("x-test-user", ownerClerk)
      .set("x-active-outward-account-id", String(skinA));
    expect(listA.status).toBe(200);
    expect(
      (listA.body.properties as any[]).some((p) => p.id === propIdA),
    ).toBe(true);

    // Listing as skin B excludes it (account-scoped isolation).
    const listB = await request(app)
      .get("/api/properties")
      .set("x-test-user", ownerClerk)
      .set("x-active-outward-account-id", String(skinB));
    expect(listB.status).toBe(200);
    expect(
      (listB.body.properties as any[]).some((p) => p.id === propIdA),
    ).toBe(false);
  });

  it("stamps work-order outward-account columns on create and on reassignment", async () => {
    // Create a property under skin B for this test.
    const created = await request(app)
      .post("/api/properties")
      .set("x-test-user", ownerClerk)
      .set("x-active-outward-account-id", String(skinB))
      .send({ name: `Skin B House ${tag}`, address: "2 B St", type: "home" });
    expect(created.status).toBe(201);
    const propId: number = created.body.id;
    createdPropertyIds.push(propId);

    // Add the trade user as a member so they can be assigned.
    await upsertPropertyMembership({
      propertyId: propId,
      userClerkId: tradeClerk,
      userOutwardAccountId: tradeSkin,
      role: "member",
      tradeType: "general",
    });

    // Create a work order assigned to the trade.
    const wo = await request(app)
      .post(`/api/properties/${propId}/work-orders`)
      .set("x-test-user", ownerClerk)
      .set("x-active-outward-account-id", String(skinB))
      .send({ title: "Fix sink", assigneeClerkId: tradeClerk });
    expect(wo.status).toBe(201);
    const woId: number = wo.body.id;

    const [woRow] = await db
      .select()
      .from(workOrdersTable)
      .where(eq(workOrdersTable.id, woId));
    expect(woRow.createdByOutwardAccountId).toBe(skinB);
    expect(woRow.assigneeOutwardAccountId).toBe(tradeSkin);

    // Unassign — assigneeOutwardAccountId should clear.
    const unassign = await request(app)
      .put(`/api/work-orders/${woId}`)
      .set("x-test-user", ownerClerk)
      .set("x-active-outward-account-id", String(skinB))
      .send({ assigneeClerkId: null });
    expect(unassign.status).toBe(200);
    const [woRow2] = await db
      .select()
      .from(workOrdersTable)
      .where(eq(workOrdersTable.id, woId));
    expect(woRow2.assigneeClerkId).toBeNull();
    expect(woRow2.assigneeOutwardAccountId).toBeNull();

    // Reassign — assigneeOutwardAccountId should be re-stamped.
    const reassign = await request(app)
      .put(`/api/work-orders/${woId}`)
      .set("x-test-user", ownerClerk)
      .set("x-active-outward-account-id", String(skinB))
      .send({ assigneeClerkId: tradeClerk });
    expect(reassign.status).toBe(200);
    const [woRow3] = await db
      .select()
      .from(workOrdersTable)
      .where(eq(workOrdersTable.id, woId));
    expect(woRow3.assigneeClerkId).toBe(tradeClerk);
    expect(woRow3.assigneeOutwardAccountId).toBe(tradeSkin);
  });
});

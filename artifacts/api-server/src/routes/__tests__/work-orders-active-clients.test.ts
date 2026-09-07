/**
 * Test for task #469:
 * "Pull Active Clients into the Reminders hub from open work orders"
 *
 * GET /api/work-orders/active-clients returns one row per client (property
 * owner) where the current user has at least one in-flight work order
 * assigned to them, sorted by most recent activity, with a navigation
 * target pointing at the most recently touched work order.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    const uid = req.headers["x-test-user"];
    if (!uid) {
      _res.status(401).json({ error: "missing x-test-user" });
      return;
    }
    req.userId = String(uid);
    next();
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    normalizeObjectEntityPath(p: string) {
      return p;
    }
    async deleteObjectEntity(_p: string) {}
  },
}));

vi.mock("../../lib/objectAccess", () => ({
  assertCallerOwnsUploads: async () => {},
}));

vi.mock("../../lib/push", () => ({
  sendPushToUser: vi.fn(),
  sendPushToUsers: vi.fn(),
}));

vi.mock("../../lib/notificationPrefs", () => ({
  filterRecipientsByPref: async (ids: string[]) => ids,
  shouldNotify: async () => false,
}));

const {
  db,
  workOrdersTable,
  propertiesTable,
  usersTable,
} = await import("@workspace/db");
const { purgeEntitiesForProperties } = await import(
  "../../lib/migratePropertyEntities"
);
const workOrdersRouter = (await import("../work-orders")).default;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", workOrdersRouter);
  return app;
}

const tag = `t469-${Date.now()}`;
const ids = {
  pro: `${tag}-pro`,
  clientA: `${tag}-client-a`,
  clientB: `${tag}-client-b`,
  clientC: `${tag}-client-c`,
};

let propertyA1: number;
let propertyA2: number;
let propertyB: number;
let propertyC: number;
let woA1Older: number;
let woA1Newer: number;
let woA2: number;
let woB: number;
let woCverified: number;
let app: Express;

beforeAll(async () => {
  app = makeApp();

  await db
    .insert(usersTable)
    .values([
      { clerkId: ids.pro, email: `${ids.pro}@example.test`, name: "Pro Person", username: ids.pro },
      { clerkId: ids.clientA, email: `${ids.clientA}@example.test`, name: "Alice Owner", username: ids.clientA },
      { clerkId: ids.clientB, email: `${ids.clientB}@example.test`, name: "Bob Owner", username: ids.clientB },
      { clerkId: ids.clientC, email: `${ids.clientC}@example.test`, name: "Carol Owner", username: ids.clientC },
    ])
    .onConflictDoNothing();

  const inserted = await db
    .insert(propertiesTable)
    .values([
      { name: `${tag}-a1`, address: "1 A St", type: "home", ownerClerkId: ids.clientA },
      { name: `${tag}-a2`, address: "2 A St", type: "home", ownerClerkId: ids.clientA },
      { name: `${tag}-b`, address: "1 B St", type: "home", ownerClerkId: ids.clientB },
      { name: `${tag}-c`, address: "1 C St", type: "home", ownerClerkId: ids.clientC },
    ])
    .returning();
  propertyA1 = inserted[0].id;
  propertyA2 = inserted[1].id;
  propertyB = inserted[2].id;
  propertyC = inserted[3].id;

  const t0 = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const t1 = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const t2 = new Date(Date.now() - 60 * 60 * 1000);
  const t3 = new Date();

  const wos = await db
    .insert(workOrdersTable)
    .values([
      {
        propertyId: propertyA1,
        title: "A1 older",
        description: "",
        status: "in_progress",
        assigneeClerkId: ids.pro,
        createdByClerkId: ids.clientA,
        createdAt: t0,
        updatedAt: t0,
      },
      {
        propertyId: propertyA1,
        title: "A1 newer",
        description: "",
        status: "open",
        assigneeClerkId: ids.pro,
        createdByClerkId: ids.clientA,
        createdAt: t2,
        updatedAt: t2,
      },
      {
        propertyId: propertyA2,
        title: "A2 only",
        description: "",
        status: "assigned",
        assigneeClerkId: ids.pro,
        createdByClerkId: ids.clientA,
        createdAt: t1,
        updatedAt: t1,
      },
      {
        propertyId: propertyB,
        title: "B latest",
        description: "",
        status: "complete",
        assigneeClerkId: ids.pro,
        createdByClerkId: ids.clientB,
        createdAt: t3,
        updatedAt: t3,
      },
      {
        propertyId: propertyC,
        title: "C verified — must be excluded",
        description: "",
        status: "verified",
        assigneeClerkId: ids.pro,
        createdByClerkId: ids.clientC,
        createdAt: t3,
        updatedAt: t3,
      },
    ])
    .returning();
  woA1Older = wos[0].id;
  woA1Newer = wos[1].id;
  woA2 = wos[2].id;
  woB = wos[3].id;
  woCverified = wos[4].id;
});

afterAll(async () => {
  await db
    .delete(workOrdersTable)
    .where(inArray(workOrdersTable.id, [woA1Older, woA1Newer, woA2, woB, woCverified]));
  await purgeEntitiesForProperties([propertyA1, propertyA2, propertyB, propertyC]);
  await db
    .delete(propertiesTable)
    .where(inArray(propertiesTable.id, [propertyA1, propertyA2, propertyB, propertyC]));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, Object.values(ids)));
});

describe("GET /api/work-orders/active-clients", () => {
  it("rejects unauthenticated callers", async () => {
    const res = await request(app).get("/api/work-orders/active-clients");
    expect(res.status).toBe(401);
  });

  it("groups in-flight work orders by client owner, sorted by most recent activity", async () => {
    const res = await request(app)
      .get("/api/work-orders/active-clients")
      .set("x-test-user", ids.pro);

    expect(res.status).toBe(200);
    const clients: any[] = res.body.clients;
    expect(Array.isArray(clients)).toBe(true);

    const seeded = clients.filter((c) =>
      [ids.clientA, ids.clientB, ids.clientC].includes(c.clientClerkId),
    );
    // Verified-only client C must NOT appear.
    expect(seeded.map((c) => c.clientClerkId).sort()).toEqual([ids.clientA, ids.clientB].sort());

    // Sorted desc by lastActivityAt — Bob (now) should come before Alice (1h ago).
    const bobIdx = seeded.findIndex((c) => c.clientClerkId === ids.clientB);
    const aliceIdx = seeded.findIndex((c) => c.clientClerkId === ids.clientA);
    expect(bobIdx).toBeLessThan(aliceIdx);

    const alice = seeded.find((c) => c.clientClerkId === ids.clientA);
    expect(alice.clientName).toBe("Alice Owner");
    // Alice has 3 active jobs across two properties.
    expect(alice.activeWorkOrderCount).toBe(3);
    // Most recent active work order for Alice is "A1 newer".
    expect(alice.mostRecentWorkOrderId).toBe(woA1Newer);
    expect(alice.mostRecentWorkOrderTitle).toBe("A1 newer");
    expect(alice.propertyId).toBe(propertyA1);

    const bob = seeded.find((c) => c.clientClerkId === ids.clientB);
    expect(bob.activeWorkOrderCount).toBe(1);
    expect(bob.mostRecentWorkOrderId).toBe(woB);
    expect(bob.propertyId).toBe(propertyB);
  });

  it("returns an empty list when the user has no active assignments", async () => {
    const res = await request(app)
      .get("/api/work-orders/active-clients")
      .set("x-test-user", `${tag}-no-assignments`);
    expect(res.status).toBe(200);
    expect(res.body.clients).toEqual([]);
  });
});

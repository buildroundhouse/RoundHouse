/**
 * Tests for paid-capability billing on outward accounts (task #309).
 *
 * Covers:
 *   - GET /billing/me lists every owned outward account row, with the
 *     correct standard/expanded state and a pricing bundle.
 *   - POST /outward-accounts/:id/billing/enable flips capability_state
 *     to "expanded" and records a subscription row owned by the payer
 *     (the personal profile / clerkId), and creates a notification
 *     against the payer.
 *   - The gated handler (POST /properties/:id/work-orders) returns a
 *     402 with the capability + deepLink payload when the active skin
 *     has not paid.
 *   - The webhook lapse path (`payment_failed_lapsed`) flips the
 *     capability back to "standard" without touching the underlying
 *     skin or its data, and re-enabling restores it.
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
  subscriptionsTable,
  notificationsTable,
  propertiesTable,
} = await import("@workspace/db");
const { upsertPropertyMembership, purgeEntityForProperty } = await import(
  "../../lib/migratePropertyEntities"
);
const billingRouter = (await import("../billing")).default;
const outwardAccountsRouter = (await import("../outward-accounts")).default;
const workOrdersRouter = (await import("../work-orders")).default;
const propertiesRouter = (await import("../properties")).default;
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
  app.use("/api", billingRouter);
  app.use("/api", outwardAccountsRouter);
  app.use("/api", workOrdersRouter);
  app.use("/api", propertiesRouter);
  return app;
}

const tag = `t309-${Date.now()}`;
const aliceClerk = `${tag}-alice`;

let app: Express;
let aliceSkinId: number;
let propertyId: number;

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
  // Trigger lazy outward-account seeding through the existing route
  const list = await request(app)
    .get("/api/outward-accounts")
    .set("x-test-user", aliceClerk);
  aliceSkinId = list.body.accounts[0].id;

  // Property owned by alice's skin so the work-order gating endpoint is
  // reachable for her (membership exists, only the capability is missing).
  const [prop] = await db
    .insert(propertiesTable)
    .values({
      ownerClerkId: aliceClerk,
      name: `Test Property ${tag}`,
      address: "1 Test Way",
    })
    .returning();
  propertyId = prop.id;
  await upsertPropertyMembership({
    propertyId,
    userClerkId: aliceClerk,
    userOutwardAccountId: aliceSkinId,
    role: "owner",
  });
});

afterAll(async () => {
  await db.delete(subscriptionsTable).where(eq(subscriptionsTable.payerClerkId, aliceClerk));
  await db.delete(notificationsTable).where(eq(notificationsTable.userClerkId, aliceClerk));
  await purgeEntityForProperty(propertyId);
  await db.delete(propertiesTable).where(eq(propertiesTable.id, propertyId));
  await db.delete(outwardAccountsTable).where(eq(outwardAccountsTable.ownerClerkId, aliceClerk));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, [aliceClerk]));
});

describe("billing for paid capabilities on outward accounts", () => {
  it("starts every owned skin in the standard (free) state", async () => {
    const me = await request(app)
      .get("/api/billing/me")
      .set("x-test-user", aliceClerk);
    expect(me.status).toBe(200);
    expect(me.body.bundle.priceCents).toBeGreaterThan(0);
    expect(me.body.bundle.currency).toBe("USD");
    expect(me.body.rows.length).toBeGreaterThanOrEqual(1);
    const row = me.body.rows.find(
      (r: any) => r.outwardAccount.id === aliceSkinId,
    );
    expect(row.capabilityState).toBe("standard");
    expect(row.subscription).toBeNull();
    expect(me.body.paymentMethod.onFile).toBe(false);
  });

  it("blocks paid actions on a standard skin with a 402 + deepLink payload", async () => {
    const blocked = await request(app)
      .post(`/api/properties/${propertyId}/work-orders`)
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(aliceSkinId))
      .send({ title: "Fix sink", priority: "normal" });
    expect(blocked.status).toBe(402);
    expect(blocked.body.capability).toBe("create_property_records");
    expect(blocked.body.outwardAccountId).toBe(aliceSkinId);
    expect(blocked.body.deepLink).toContain(`accountId=${aliceSkinId}`);
  });

  it("enabling expands the skin, records a subscription, and notifies the payer", async () => {
    const enabled = await request(app)
      .post(`/api/outward-accounts/${aliceSkinId}/billing/enable`)
      .set("x-test-user", aliceClerk);
    expect(enabled.status).toBe(200);
    expect(enabled.body.capabilityState).toBe("expanded");
    expect(enabled.body.subscription.status).toBe("active");

    // Capability column was flipped on the skin
    const [acct] = await db
      .select()
      .from(outwardAccountsTable)
      .where(eq(outwardAccountsTable.id, aliceSkinId));
    expect(acct.capabilityState).toBe("expanded");

    // Subscription row exists with the payer = personal profile (clerkId)
    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.outwardAccountId, aliceSkinId));
    expect(sub.payerClerkId).toBe(aliceClerk);
    expect(sub.status).toBe("active");

    // Notification went to the payer (private account), not to the skin.
    const notifs = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userClerkId, aliceClerk));
    expect(notifs.some((n) => n.type === "billing_capabilities_restored")).toBe(true);

    // Gated endpoint is now reachable
    const allowed = await request(app)
      .post(`/api/properties/${propertyId}/work-orders`)
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(aliceSkinId))
      .send({ title: "Fix sink", priority: "normal" });
    expect(allowed.status).toBe(201);
  });

  it("a payment_failed_lapsed webhook reverts to standard without deleting any data", async () => {
    // Capture pre-state of the skin to assert nothing else changes.
    const [before] = await db
      .select()
      .from(outwardAccountsTable)
      .where(eq(outwardAccountsTable.id, aliceSkinId));

    const lapsed = await request(app)
      .post("/api/billing/webhook")
      .send({ event: "payment_failed_lapsed", outwardAccountId: aliceSkinId });
    expect(lapsed.status).toBe(200);
    expect(lapsed.body.applied).toBe(true);
    expect(lapsed.body.status).toBe("expired");

    const [after] = await db
      .select()
      .from(outwardAccountsTable)
      .where(eq(outwardAccountsTable.id, aliceSkinId));
    expect(after.capabilityState).toBe("standard");
    // Skin identity / data is unchanged
    expect(after.title).toBe(before.title);
    expect(after.displayName).toBe(before.displayName);
    expect(after.archivedAt).toBe(before.archivedAt);

    // Re-enabling restores expanded capabilities (re-payment path).
    const restored = await request(app)
      .post(`/api/outward-accounts/${aliceSkinId}/billing/enable`)
      .set("x-test-user", aliceClerk);
    expect(restored.status).toBe(200);
    expect(restored.body.capabilityState).toBe("expanded");
  });
});

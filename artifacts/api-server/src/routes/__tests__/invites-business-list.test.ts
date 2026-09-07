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

const { db, businessInvitesTable, outwardAccountsTable, usersTable } = await import(
  "@workspace/db"
);
const invitesRouter = (await import("../invites")).default;
const { resolveActiveOutwardAccountId } = await import("../../lib/outwardAccounts");

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", invitesRouter);
  return app;
}

const tag = `t223-${Date.now()}`;
const ownerId = `${tag}-owner`;
const otherId = `${tag}-other`;

let app: Express;

beforeAll(async () => {
  app = makeApp();
  await db.insert(usersTable).values([
    {
      clerkId: ownerId,
      email: `${tag}-owner@example.test`,
      name: "Olive Owner",
      username: `owner_${tag}`,
    },
    {
      clerkId: otherId,
      email: `${tag}-other@example.test`,
      name: "Otto Other",
      username: `other_${tag}`,
    },
  ]);
  // Lazy-seed each user's default outward account so we can sender-stamp
  // the seed invites below.
  const ownerAccountId = await resolveActiveOutwardAccountId(ownerId);
  const otherAccountId = await resolveActiveOutwardAccountId(otherId);
  if (ownerAccountId == null || otherAccountId == null) {
    throw new Error("failed to seed outward accounts");
  }
  await db.insert(businessInvitesTable).values([
    {
      senderOutwardAccountId: ownerAccountId,
      email: `${tag}-sent@example.test`,
      businessName: "Sent Co",
      token: `${tag}-tok-sent`,
      status: "sent",
      sentAt: new Date(Date.now() - 60_000),
    },
    {
      senderOutwardAccountId: ownerAccountId,
      email: `${tag}-fail@example.test`,
      businessName: null,
      token: `${tag}-tok-fail`,
      status: "failed",
      sendError: "SendGrid 429 rate limited",
    },
    {
      senderOutwardAccountId: ownerAccountId,
      email: `${tag}-acc@example.test`,
      businessName: "Acc Co",
      token: `${tag}-tok-acc`,
      status: "accepted",
      sentAt: new Date(Date.now() - 120_000),
      acceptedAt: new Date(Date.now() - 30_000),
      acceptedByClerkId: `${tag}-acceptor`,
    },
    {
      senderOutwardAccountId: otherAccountId,
      email: `${tag}-other@example.test`,
      businessName: "Other Co",
      token: `${tag}-tok-other`,
      status: "sent",
    },
  ]);
});

afterAll(async () => {
  const ownedAccountIds = (
    await db
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(inArray(outwardAccountsTable.ownerClerkId, [ownerId, otherId]))
  ).map((r) => r.id);
  if (ownedAccountIds.length > 0) {
    await db
      .delete(businessInvitesTable)
      .where(inArray(businessInvitesTable.senderOutwardAccountId, ownedAccountIds));
  }
  await db
    .update(usersTable)
    .set({ activeOutwardAccountId: null })
    .where(inArray(usersTable.clerkId, [ownerId, otherId]));
  await db
    .delete(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.ownerClerkId, [ownerId, otherId]));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, [ownerId, otherId]));
});

describe("GET /invites/business", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/invites/business");
    expect(res.status).toBe(401);
  });

  it("returns the caller's invites newest-first with status, timestamps, and sendError", async () => {
    const res = await request(app)
      .get("/api/invites/business")
      .set("x-test-user", ownerId);

    expect(res.status).toBe(200);
    const mine: any[] = res.body.invites;
    const emails = mine.map((i) => i.email);

    expect(emails).not.toContain(`${tag}-other@example.test`);
    expect(emails).toEqual([
      `${tag}-acc@example.test`,
      `${tag}-fail@example.test`,
      `${tag}-sent@example.test`,
    ]);

    const failed = mine.find((i) => i.email === `${tag}-fail@example.test`)!;
    expect(failed.status).toBe("failed");
    expect(failed.sendError).toContain("429");
    expect(failed.sentAt).toBeNull();

    const accepted = mine.find((i) => i.email === `${tag}-acc@example.test`)!;
    expect(accepted.status).toBe("accepted");
    expect(typeof accepted.acceptedAt).toBe("string");
  });

  it("returns an empty list for a user with no invites", async () => {
    const res = await request(app)
      .get("/api/invites/business")
      .set("x-test-user", `${tag}-empty`);
    expect(res.status).toBe(200);
    expect(res.body.invites).toEqual([]);
  });
});

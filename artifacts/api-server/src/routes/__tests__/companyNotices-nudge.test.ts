/**
 * Tests for the company-notice nudge endpoint (task #496).
 *
 * Covers POST /company-notices/:noticeId/nudge:
 *   - Admins can nudge a teammate who hasn't read a notice; the
 *     recipient gets an in-app notification AND a push.
 *   - Non-admin team members can't nudge (403).
 *   - Already-acknowledged members can't be nudged (400).
 *   - The sender can't be nudged for their own notice (400).
 *   - Removed seats / outsiders can't be nudged (404).
 *   - Rate limit: a second nudge to the same member for the same
 *     notice within 24h returns 429 with `nextEligibleAt`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = String(req.headers["x-test-user"] ?? "");
    next();
  },
}));

const sendPushToUsersMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../../lib/push", () => ({
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
  sendPushToUsers: (...args: unknown[]) => sendPushToUsersMock(...args),
}));

const {
  db,
  usersTable,
  outwardAccountsTable,
  teamSeatsTable,
  companyNoticesTable,
  companyNoticeAcksTable,
  notificationsTable,
} = await import("@workspace/db");
const noticesRouter = (await import("../companyNotices")).default;

const tag = `t496-${Date.now()}`;
const owner = `${tag}-owner`;
const admin = `${tag}-admin`;
const slacker = `${tag}-slacker`;
const reader = `${tag}-reader`;
const removed = `${tag}-removed`;
const outsider = `${tag}-outsider`;

let app: Express;
let companyId: number;
let noticeId: number;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use(noticesRouter);

  await db.insert(usersTable).values([
    { clerkId: owner, email: `${owner}@test.local`, name: "Owen Owner", username: owner },
    { clerkId: admin, email: `${admin}@test.local`, name: "Ada Admin", username: admin },
    { clerkId: slacker, email: `${slacker}@test.local`, name: "Sam Slacker", username: slacker },
    { clerkId: reader, email: `${reader}@test.local`, name: "Rita Reader", username: reader },
    { clerkId: removed, email: `${removed}@test.local`, name: "Rex Removed", username: removed },
    { clerkId: outsider, email: `${outsider}@test.local`, name: "Olive Outsider", username: outsider },
  ]);

  const [skin] = await db
    .insert(outwardAccountsTable)
    .values({
      ownerClerkId: owner,
      kind: "trade_pro",
      title: "Acme Plumbing",
      displayName: "Acme Plumbing",
      companyName: "Acme Plumbing LLC",
    })
    .returning();
  companyId = skin.id;

  await db.insert(teamSeatsTable).values([
    {
      companyOutwardAccountId: companyId,
      memberClerkId: admin,
      role: "manager",
      isAdmin: true,
      permissions: { manageTeam: true },
      status: "accepted",
      acceptedAt: new Date(),
    },
    {
      companyOutwardAccountId: companyId,
      memberClerkId: slacker,
      role: "employee",
      isAdmin: false,
      permissions: {},
      status: "accepted",
      acceptedAt: new Date(),
    },
    {
      companyOutwardAccountId: companyId,
      memberClerkId: reader,
      role: "employee",
      isAdmin: false,
      permissions: {},
      status: "accepted",
      acceptedAt: new Date(),
    },
    {
      companyOutwardAccountId: companyId,
      memberClerkId: removed,
      role: "employee",
      isAdmin: false,
      permissions: {},
      status: "accepted",
      acceptedAt: new Date(),
      removedAt: new Date(),
    },
  ]);

  const [n] = await db
    .insert(companyNoticesTable)
    .values({
      companyOutwardAccountId: companyId,
      senderClerkId: admin,
      title: "Office closed Friday",
      body: "Heads up: training day.",
    })
    .returning();
  noticeId = n.id;

  // Reader has already acknowledged; slacker has not.
  await db.insert(companyNoticeAcksTable).values({
    noticeId,
    memberClerkId: reader,
    acknowledgedAt: new Date(),
  });
});

afterAll(async () => {
  const everyone = [owner, admin, slacker, reader, removed, outsider];
  await db
    .delete(companyNoticeAcksTable)
    .where(eq(companyNoticeAcksTable.noticeId, noticeId));
  await db
    .delete(notificationsTable)
    .where(inArray(notificationsTable.userClerkId, everyone));
  await db
    .delete(companyNoticesTable)
    .where(eq(companyNoticesTable.companyOutwardAccountId, companyId));
  await db
    .delete(teamSeatsTable)
    .where(eq(teamSeatsTable.companyOutwardAccountId, companyId));
  await db
    .delete(outwardAccountsTable)
    .where(eq(outwardAccountsTable.id, companyId));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, everyone));
});

beforeEach(async () => {
  sendPushToUsersMock.mockClear();
  // Wipe nudge notifications between cases so the 24h rate limit is
  // applied per-test rather than across the whole file.
  await db
    .delete(notificationsTable)
    .where(
      and(
        eq(notificationsTable.type, "company_notice_nudge"),
        eq(notificationsTable.relatedId, String(noticeId)),
      ),
    );
});

describe("company notice nudge endpoint (#496)", () => {
  it("admin can nudge a pending member; in-app + push are sent", async () => {
    const res = await request(app)
      .post(`/company-notices/${noticeId}/nudge`)
      .set("x-test-user", admin)
      .send({ memberClerkId: slacker });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      noticeId,
      memberClerkId: slacker,
    });
    expect(typeof res.body.nudgedAt).toBe("string");
    expect(typeof res.body.nextEligibleAt).toBe("string");

    // In-app notification was inserted on the recipient with the right
    // outward-account scope and related id.
    const rows = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userClerkId, slacker),
          eq(notificationsTable.type, "company_notice_nudge"),
          eq(notificationsTable.relatedId, String(noticeId)),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].outwardAccountId).toBe(companyId);
    expect(rows[0].body).toContain("Office closed Friday");

    // Push fan-out was attempted to exactly the recipient with a
    // company_notice deep-link payload (so the existing handler routes
    // straight to Reminders).
    expect(sendPushToUsersMock).toHaveBeenCalledTimes(1);
    const [recipients, payload] = sendPushToUsersMock.mock.calls[0]!;
    expect(recipients).toEqual([slacker]);
    expect(payload.data).toMatchObject({
      type: "company_notice",
      noticeId,
      companyOutwardAccountId: companyId,
    });
  });

  it("rate-limits a second nudge to the same member within 24h", async () => {
    const first = await request(app)
      .post(`/company-notices/${noticeId}/nudge`)
      .set("x-test-user", admin)
      .send({ memberClerkId: slacker });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/company-notices/${noticeId}/nudge`)
      .set("x-test-user", owner)
      .send({ memberClerkId: slacker });
    expect(second.status).toBe(429);
    expect(typeof second.body.nextEligibleAt).toBe("string");
  });

  it("rejects non-admin teammates with 403", async () => {
    const res = await request(app)
      .post(`/company-notices/${noticeId}/nudge`)
      .set("x-test-user", reader)
      .send({ memberClerkId: slacker });
    expect(res.status).toBe(403);
    expect(sendPushToUsersMock).not.toHaveBeenCalled();
  });

  it("rejects nudging a member who has already read the notice", async () => {
    const res = await request(app)
      .post(`/company-notices/${noticeId}/nudge`)
      .set("x-test-user", admin)
      .send({ memberClerkId: reader });
    expect(res.status).toBe(400);
    expect(sendPushToUsersMock).not.toHaveBeenCalled();
  });

  it("rejects nudging the notice's own sender", async () => {
    const res = await request(app)
      .post(`/company-notices/${noticeId}/nudge`)
      .set("x-test-user", owner)
      .send({ memberClerkId: admin });
    expect(res.status).toBe(400);
  });

  it("rejects nudging a removed seat (404)", async () => {
    const res = await request(app)
      .post(`/company-notices/${noticeId}/nudge`)
      .set("x-test-user", admin)
      .send({ memberClerkId: removed });
    expect(res.status).toBe(404);
  });

  it("rejects nudging someone who isn't on the team (404)", async () => {
    const res = await request(app)
      .post(`/company-notices/${noticeId}/nudge`)
      .set("x-test-user", admin)
      .send({ memberClerkId: outsider });
    expect(res.status).toBe(404);
  });

  it("requires a memberClerkId in the body", async () => {
    const res = await request(app)
      .post(`/company-notices/${noticeId}/nudge`)
      .set("x-test-user", admin)
      .send({});
    expect(res.status).toBe(400);
  });

  it("exposes lastNudgedAt on pendingMembers so admins see who was reminded", async () => {
    // Establish baseline: before any nudge the pending member's
    // lastNudgedAt is null. This is what the read receipts sheet uses
    // to choose between "Not yet read" and "Reminded <relative time>".
    const before = await request(app)
      .get("/company-notices")
      .set("x-test-user", admin);
    expect(before.status).toBe(200);
    const beforeRow = before.body.notices.find(
      (n: any) => n.id === noticeId,
    );
    const beforeSlacker = beforeRow.pendingMembers.find(
      (p: any) => p.memberClerkId === slacker,
    );
    expect(beforeSlacker.lastNudgedAt).toBeNull();

    // Send a nudge, then re-fetch — slacker's lastNudgedAt should match
    // the nudge response timestamp so an admin returning to the sheet
    // can see who's been reminded today even after closing it.
    const nudgeRes = await request(app)
      .post(`/company-notices/${noticeId}/nudge`)
      .set("x-test-user", admin)
      .send({ memberClerkId: slacker });
    expect(nudgeRes.status).toBe(200);

    const after = await request(app)
      .get("/company-notices")
      .set("x-test-user", admin);
    const afterRow = after.body.notices.find((n: any) => n.id === noticeId);
    const afterSlacker = afterRow.pendingMembers.find(
      (p: any) => p.memberClerkId === slacker,
    );
    expect(typeof afterSlacker.lastNudgedAt).toBe("string");
    // Tolerate sub-second drift between the nudge insert and the list
    // query — both should land within the same second.
    const nudgedMs = new Date(nudgeRes.body.nudgedAt).getTime();
    const lastMs = new Date(afterSlacker.lastNudgedAt).getTime();
    expect(Math.abs(nudgedMs - lastMs)).toBeLessThan(2000);

    // A different un-nudged pending teammate (the owner is the admin's
    // teammate too because admin is the sender here) still reports null.
    const ownerEntry = afterRow.pendingMembers.find(
      (p: any) => p.memberClerkId === owner,
    );
    expect(ownerEntry?.lastNudgedAt ?? null).toBeNull();
  });
});

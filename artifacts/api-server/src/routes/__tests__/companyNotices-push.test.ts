/**
 * Test for the company-notice push fan-out (task #474).
 *
 * Verifies that posting a notice via
 *   POST /outward-accounts/:companyId/company-notices
 * fires a single push to every member of that company except the
 * sender, with the notice title and a body snippet, and includes a
 * `type: "company_notice"` deep-link payload that the mobile app
 * routes to the Reminders hub.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

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
} = await import("@workspace/db");
const noticesRouter = (await import("../companyNotices")).default;

const tag = `t474-${Date.now()}`;
const owner = `${tag}-owner`;
const admin = `${tag}-admin`;
const member = `${tag}-member`;
const removedMember = `${tag}-removed`;
const pendingMember = `${tag}-pending`;

let app: Express;
let companyId: number;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use(noticesRouter);

  await db.insert(usersTable).values([
    { clerkId: owner, email: `${owner}@test.local`, name: "Owen Owner", username: owner },
    { clerkId: admin, email: `${admin}@test.local`, name: "Ada Admin", username: admin },
    { clerkId: member, email: `${member}@test.local`, name: "Mel Member", username: member },
    { clerkId: removedMember, email: `${removedMember}@test.local`, name: "Rex Removed", username: removedMember },
    { clerkId: pendingMember, email: `${pendingMember}@test.local`, name: "Pia Pending", username: pendingMember },
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
      memberClerkId: member,
      role: "employee",
      isAdmin: false,
      permissions: {},
      status: "accepted",
      acceptedAt: new Date(),
    },
    {
      companyOutwardAccountId: companyId,
      memberClerkId: removedMember,
      role: "employee",
      isAdmin: false,
      permissions: {},
      status: "accepted",
      acceptedAt: new Date(),
      removedAt: new Date(),
    },
    {
      companyOutwardAccountId: companyId,
      memberClerkId: pendingMember,
      role: "employee",
      isAdmin: false,
      permissions: {},
      status: "invited",
    },
  ]);
});

afterAll(async () => {
  const everyone = [owner, admin, member, removedMember, pendingMember];
  await db.delete(companyNoticesTable).where(eq(companyNoticesTable.companyOutwardAccountId, companyId));
  await db.delete(teamSeatsTable).where(eq(teamSeatsTable.companyOutwardAccountId, companyId));
  await db.delete(outwardAccountsTable).where(eq(outwardAccountsTable.id, companyId));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, everyone));
});

beforeEach(() => {
  sendPushToUsersMock.mockClear();
});

describe("company notice push fan-out (#474)", () => {
  it("pushes every accepted teammate except the sender when an admin posts", async () => {
    const res = await request(app)
      .post(`/outward-accounts/${companyId}/company-notices`)
      .set("x-test-user", admin)
      .send({
        title: "Office closed Friday",
        body: "We're closing early Friday for staff training. Please plan accordingly.",
      });
    expect(res.status).toBe(201);

    expect(sendPushToUsersMock).toHaveBeenCalledTimes(1);
    const [recipients, payload] = sendPushToUsersMock.mock.calls[0]!;

    // Owner + the non-admin member should get pushed; admin (sender),
    // removed seat, and still-invited seat should not.
    expect(new Set(recipients)).toEqual(new Set([owner, member]));

    expect(payload.title).toContain("Office closed Friday");
    expect(payload.title).toContain("Acme Plumbing LLC");
    expect(payload.body).toContain("closing early Friday");
    expect(payload.data).toMatchObject({
      type: "company_notice",
      noticeId: res.body.id,
      companyOutwardAccountId: companyId,
    });
  });

  it("truncates a long body to a snippet with an ellipsis", async () => {
    const longBody = "Heads up: ".concat("a".repeat(400));
    const res = await request(app)
      .post(`/outward-accounts/${companyId}/company-notices`)
      .set("x-test-user", owner)
      .send({ title: "Long alert", body: longBody });
    expect(res.status).toBe(201);

    expect(sendPushToUsersMock).toHaveBeenCalledTimes(1);
    const [, payload] = sendPushToUsersMock.mock.calls[0]!;
    expect(payload.body.length).toBeLessThanOrEqual(140);
    expect(payload.body.endsWith("…")).toBe(true);
  });

  it("does not push when only the sender is on the team", async () => {
    // Remove every seat so the owner is the lone teammate.
    await db
      .update(teamSeatsTable)
      .set({ removedAt: new Date(), status: "removed" })
      .where(eq(teamSeatsTable.companyOutwardAccountId, companyId));

    const res = await request(app)
      .post(`/outward-accounts/${companyId}/company-notices`)
      .set("x-test-user", owner)
      .send({ title: "Solo post", body: "Anyone home?" });
    expect(res.status).toBe(201);

    expect(sendPushToUsersMock).not.toHaveBeenCalled();
  });
});

/**
 * Tests for #476 — company-notices feature.
 *
 * Covers the four endpoints in artifacts/api-server/src/routes/companyNotices.ts:
 *
 *   POST   /outward-accounts/:companyId/company-notices  (create)
 *   GET    /company-notices                              (list)
 *   POST   /company-notices/:noticeId/acknowledge        (dismiss)
 *   DELETE /company-notices/:noticeId                    (admin take-down)
 *
 * Verified behaviors:
 *   1. Owner of the company skin can post a notice.
 *   2. A team-seat admin (isAdmin / manageTeam) can post a notice.
 *   3. A plain (non-admin) team member cannot post and gets 403.
 *   4. Members see notices for their company in GET /company-notices and
 *      can acknowledge them; the second acknowledgement is idempotent
 *      (no error, same timestamp returned).
 *   5. A plain member cannot delete a notice they did not author.
 *   6. The notice author can delete their own notice; doing so removes
 *      the related ack rows.
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

const {
  db,
  usersTable,
  outwardAccountsTable,
  teamSeatsTable,
  companyNoticesTable,
  companyNoticeAcksTable,
} = await import("@workspace/db");
const companyNoticesRouter = (await import("../companyNotices")).default;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", companyNoticesRouter);
  return app;
}

const tag = `t476-${Date.now()}`;
const ownerClerk = `${tag}-owner`;
const adminMemberClerk = `${tag}-admin`;
const plainMemberClerk = `${tag}-member`;
const outsiderClerk = `${tag}-outsider`;

let app: Express;
let companyId: number;
const createdNoticeIds: number[] = [];

beforeAll(async () => {
  app = makeApp();
  await db.insert(usersTable).values([
    {
      clerkId: ownerClerk,
      email: `${tag}-owner@example.test`,
      name: "Skin Owner",
      username: `owner_${tag}`,
    },
    {
      clerkId: adminMemberClerk,
      email: `${tag}-admin@example.test`,
      name: "Admin Member",
      username: `admin_${tag}`,
    },
    {
      clerkId: plainMemberClerk,
      email: `${tag}-member@example.test`,
      name: "Plain Member",
      username: `member_${tag}`,
    },
    {
      clerkId: outsiderClerk,
      email: `${tag}-outsider@example.test`,
      name: "Outsider",
      username: `outsider_${tag}`,
    },
  ]);
  const [skin] = await db
    .insert(outwardAccountsTable)
    .values({
      ownerClerkId: ownerClerk,
      kind: "trade_pro",
      title: "Acme Plumbing",
      displayName: "Acme Plumbing",
      companyName: "Acme Plumbing LLC",
    })
    .returning();
  companyId = skin.id;
  await db.insert(teamSeatsTable).values([
    {
      // Admin via the `manageTeam` permission only (isAdmin = false) so
      // the test isolates the manageTeam-only authorization branch in
      // canAdministerCompany / loadAdministeredCompanyIds.
      companyOutwardAccountId: companyId,
      memberClerkId: adminMemberClerk,
      role: "manager",
      isAdmin: false,
      permissions: {
        seeBilling: false,
        seeContacts: false,
        createOnProperties: false,
        manageTeam: true,
      } as any,
      status: "accepted",
      acceptedAt: new Date(),
    },
    {
      companyOutwardAccountId: companyId,
      memberClerkId: plainMemberClerk,
      role: "employee",
      isAdmin: false,
      permissions: {
        seeBilling: false,
        seeContacts: false,
        createOnProperties: false,
        manageTeam: false,
      } as any,
      status: "accepted",
      acceptedAt: new Date(),
    },
  ]);
});

afterAll(async () => {
  if (createdNoticeIds.length > 0) {
    await db
      .delete(companyNoticeAcksTable)
      .where(inArray(companyNoticeAcksTable.noticeId, createdNoticeIds));
    await db
      .delete(companyNoticesTable)
      .where(inArray(companyNoticesTable.id, createdNoticeIds));
  }
  await db
    .delete(teamSeatsTable)
    .where(eq(teamSeatsTable.companyOutwardAccountId, companyId));
  await db
    .delete(outwardAccountsTable)
    .where(eq(outwardAccountsTable.id, companyId));
  await db
    .delete(usersTable)
    .where(
      inArray(usersTable.clerkId, [
        ownerClerk,
        adminMemberClerk,
        plainMemberClerk,
        outsiderClerk,
      ]),
    );
});

describe("Company notices (#476)", () => {
  it("requires auth on every endpoint", async () => {
    const a = await request(app).get("/api/company-notices");
    const b = await request(app)
      .post(`/api/outward-accounts/${companyId}/company-notices`)
      .send({ title: "x", body: "y" });
    const c = await request(app).post("/api/company-notices/1/acknowledge");
    const d = await request(app).delete("/api/company-notices/1");
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(c.status).toBe(401);
    expect(d.status).toBe(401);
  });

  it("owner can post a notice", async () => {
    const res = await request(app)
      .post(`/api/outward-accounts/${companyId}/company-notices`)
      .set("x-test-user", ownerClerk)
      .send({ title: "All-hands Friday", body: "9am sharp." });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: "All-hands Friday",
      body: "9am sharp.",
      companyOutwardAccountId: companyId,
      senderClerkId: ownerClerk,
      canDelete: true,
      acknowledgedAt: null,
    });
    expect(typeof res.body.id).toBe("number");
    createdNoticeIds.push(res.body.id);
  });

  it("team-seat admin (manageTeam) can post a notice", async () => {
    const res = await request(app)
      .post(`/api/outward-accounts/${companyId}/company-notices`)
      .set("x-test-user", adminMemberClerk)
      .send({ title: "Safety reminder", body: "Wear gloves on jobs." });
    expect(res.status).toBe(201);
    expect(res.body.senderClerkId).toBe(adminMemberClerk);
    createdNoticeIds.push(res.body.id);
  });

  it("plain member cannot post a notice (403)", async () => {
    const res = await request(app)
      .post(`/api/outward-accounts/${companyId}/company-notices`)
      .set("x-test-user", plainMemberClerk)
      .send({ title: "Nope", body: "Nope." });
    expect(res.status).toBe(403);
  });

  it("rejects empty title / body with 400", async () => {
    const noTitle = await request(app)
      .post(`/api/outward-accounts/${companyId}/company-notices`)
      .set("x-test-user", ownerClerk)
      .send({ title: "   ", body: "Hi" });
    const noBody = await request(app)
      .post(`/api/outward-accounts/${companyId}/company-notices`)
      .set("x-test-user", ownerClerk)
      .send({ title: "Hi", body: "" });
    expect(noTitle.status).toBe(400);
    expect(noBody.status).toBe(400);
  });

  it("plain member sees the company's notices via GET", async () => {
    const res = await request(app)
      .get("/api/company-notices")
      .set("x-test-user", plainMemberClerk);
    expect(res.status).toBe(200);
    const titles: string[] = res.body.notices.map((n: any) => n.title);
    expect(titles).toEqual(
      expect.arrayContaining(["All-hands Friday", "Safety reminder"]),
    );
    // Plain members can never delete notices they didn't write — even
    // ones authored by another non-admin would not be deletable; here
    // both notices are by owner/admin, so canDelete must be false.
    for (const n of res.body.notices) {
      if (createdNoticeIds.includes(n.id)) {
        expect(n.canDelete).toBe(false);
        expect(n.acknowledgedAt).toBeNull();
      }
    }
  });

  it("an outsider sees no notices for this company", async () => {
    const res = await request(app)
      .get("/api/company-notices")
      .set("x-test-user", outsiderClerk);
    expect(res.status).toBe(200);
    const ids: number[] = res.body.notices.map((n: any) => n.id);
    for (const id of createdNoticeIds) {
      expect(ids).not.toContain(id);
    }
  });

  it("member can acknowledge a notice; second ack is idempotent", async () => {
    const noticeId = createdNoticeIds[0];
    const first = await request(app)
      .post(`/api/company-notices/${noticeId}/acknowledge`)
      .set("x-test-user", plainMemberClerk);
    expect(first.status).toBe(200);
    expect(first.body.noticeId).toBe(noticeId);
    expect(typeof first.body.acknowledgedAt).toBe("string");

    const second = await request(app)
      .post(`/api/company-notices/${noticeId}/acknowledge`)
      .set("x-test-user", plainMemberClerk);
    expect(second.status).toBe(200);
    expect(second.body.acknowledgedAt).toBe(first.body.acknowledgedAt);

    // Only one ack row should exist for that (notice, member) pair.
    const rows = await db
      .select()
      .from(companyNoticeAcksTable)
      .where(eq(companyNoticeAcksTable.noticeId, noticeId));
    const mine = rows.filter((r) => r.memberClerkId === plainMemberClerk);
    expect(mine.length).toBe(1);

    // GET reflects the ack timestamp for the acknowledging member.
    const list = await request(app)
      .get("/api/company-notices")
      .set("x-test-user", plainMemberClerk);
    const ackedRow = list.body.notices.find((n: any) => n.id === noticeId);
    expect(ackedRow.acknowledgedAt).toBe(first.body.acknowledgedAt);
  });

  it("acknowledging a notice for a company you don't belong to is 404", async () => {
    const noticeId = createdNoticeIds[0];
    const res = await request(app)
      .post(`/api/company-notices/${noticeId}/acknowledge`)
      .set("x-test-user", outsiderClerk);
    expect(res.status).toBe(404);
  });

  it("admin sees pendingMembers; plain member gets null", async () => {
    // notice[0] is owner-authored; plainMember has acked it earlier
    // in this suite, so pending should be just [adminMemberClerk]
    // (owner is the sender and must never appear in pending).
    const adminRes = await request(app)
      .get("/api/company-notices")
      .set("x-test-user", adminMemberClerk);
    expect(adminRes.status).toBe(200);
    const adminN0 = adminRes.body.notices.find(
      (n: any) => n.id === createdNoticeIds[0],
    );
    expect(Array.isArray(adminN0.pendingMembers)).toBe(true);
    const adminN0Ids: string[] = adminN0.pendingMembers.map(
      (p: any) => p.memberClerkId,
    );
    expect(adminN0Ids).toEqual([adminMemberClerk]);
    expect(adminN0Ids).not.toContain(ownerClerk); // sender excluded
    expect(adminN0Ids).not.toContain(plainMemberClerk); // acked

    // notice[1] is admin-authored; nobody has acked. Sender (admin) is
    // excluded from pending; owner + plain member should both appear.
    const adminN1 = adminRes.body.notices.find(
      (n: any) => n.id === createdNoticeIds[1],
    );
    const adminN1Ids: string[] = adminN1.pendingMembers.map(
      (p: any) => p.memberClerkId,
    );
    expect(adminN1Ids).not.toContain(adminMemberClerk); // sender excluded
    expect(adminN1Ids).toEqual(
      expect.arrayContaining([ownerClerk, plainMemberClerk]),
    );
    expect(adminN1Ids.length).toBe(2);
    // Pending member entries carry profile info for the UI.
    const ownerEntry = adminN1.pendingMembers.find(
      (p: any) => p.memberClerkId === ownerClerk,
    );
    expect(ownerEntry.name).toBe("Skin Owner");

    // Non-admin members must not receive pendingMembers data.
    const plainRes = await request(app)
      .get("/api/company-notices")
      .set("x-test-user", plainMemberClerk);
    const plainN0 = plainRes.body.notices.find(
      (n: any) => n.id === createdNoticeIds[0],
    );
    expect(plainN0.pendingMembers).toBeNull();
    // Even when the plain member is the recipient of an admin's own
    // notice, pendingMembers is admin-gated.
    const plainN1 = plainRes.body.notices.find(
      (n: any) => n.id === createdNoticeIds[1],
    );
    expect(plainN1.pendingMembers).toBeNull();
  });

  it("create-notice response excludes the sender from pendingMembers", async () => {
    const res = await request(app)
      .post(`/api/outward-accounts/${companyId}/company-notices`)
      .set("x-test-user", ownerClerk)
      .send({ title: "Pending sanity check", body: "Body." });
    expect(res.status).toBe(201);
    createdNoticeIds.push(res.body.id);
    const ids: string[] = res.body.pendingMembers.map(
      (p: any) => p.memberClerkId,
    );
    expect(ids).not.toContain(ownerClerk);
    expect(ids).toEqual(
      expect.arrayContaining([adminMemberClerk, plainMemberClerk]),
    );
    expect(ids.length).toBe(2);
  });

  it("plain member cannot delete a notice they did not author (403)", async () => {
    const noticeId = createdNoticeIds[0];
    const res = await request(app)
      .delete(`/api/company-notices/${noticeId}`)
      .set("x-test-user", plainMemberClerk);
    expect(res.status).toBe(403);
    // Notice is still there.
    const [still] = await db
      .select()
      .from(companyNoticesTable)
      .where(eq(companyNoticesTable.id, noticeId));
    expect(still).toBeTruthy();
  });

  it("the author (owner) can delete their own notice and acks are cleared", async () => {
    const noticeId = createdNoticeIds[0];
    const res = await request(app)
      .delete(`/api/company-notices/${noticeId}`)
      .set("x-test-user", ownerClerk);
    expect(res.status).toBe(204);
    const remaining = await db
      .select()
      .from(companyNoticesTable)
      .where(eq(companyNoticesTable.id, noticeId));
    expect(remaining.length).toBe(0);
    const acks = await db
      .select()
      .from(companyNoticeAcksTable)
      .where(eq(companyNoticeAcksTable.noticeId, noticeId));
    expect(acks.length).toBe(0);
    // Drop from cleanup list since the row is already gone.
    createdNoticeIds.splice(createdNoticeIds.indexOf(noticeId), 1);
  });

  it("a different team admin can take down another admin's notice", async () => {
    const noticeId = createdNoticeIds[0]; // posted by adminMemberClerk
    const res = await request(app)
      .delete(`/api/company-notices/${noticeId}`)
      .set("x-test-user", ownerClerk);
    expect(res.status).toBe(204);
    createdNoticeIds.splice(createdNoticeIds.indexOf(noticeId), 1);
  });
});

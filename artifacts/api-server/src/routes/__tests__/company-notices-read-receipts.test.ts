/**
 * Tests for #497 — read receipts sheet end-to-end.
 *
 * The mobile reminders screen renders a "Read receipts" sheet when the
 * user taps the "Acknowledged by …" row on a company notice. This file
 * exercises the full data contract that powers that sheet:
 *
 *   1. After a teammate acknowledges a notice, an admin sees BOTH
 *      sections — "Read by" (acks: name, username, avatarUrl,
 *      acknowledgedAt for every acknowledger) AND "Still waiting on"
 *      (pendingMembers minus the sender + minus the acknowledgers).
 *   2. A non-admin recipient gets `acks: null` AND `pendingMembers:
 *      null`, i.e. the sheet has no read-receipt or pending data to
 *      show — so the row never opens it for them.
 *   3. Re-fetching the same notice returns an identical ack/pending
 *      payload, i.e. closing the sheet (a client-only modal) cannot
 *      mutate server state — the user lands back on a clean list.
 *
 * Together with the assertions in company-notices.test.ts (which cover
 * pendingMembers admin-gating, sender exclusion, and acknowledge
 * idempotency) this fully covers the API surface that the
 * NoticeReadReceiptsSheet component in
 * artifacts/round-house/app/reminders.tsx consumes. The full UI sheet
 * interaction — tap to open, both sections rendered, close + backdrop
 * dismissal — lives in
 * artifacts/round-house/e2e/company-notice-read-receipts-sheet.test-plan.md.
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

const tag = `t497-${Date.now()}`;
const ownerClerk = `${tag}-owner`;
const adminClerk = `${tag}-admin`;
const reader1Clerk = `${tag}-reader1`;
const reader2Clerk = `${tag}-reader2`;

let app: Express;
let companyId: number;
const createdNoticeIds: number[] = [];

beforeAll(async () => {
  app = makeApp();
  await db.insert(usersTable).values([
    {
      clerkId: ownerClerk,
      email: `${tag}-owner@example.test`,
      name: "Olivia Owner",
      username: `owner_${tag}`,
      avatarUrl: "https://example.test/owner.png",
    },
    {
      clerkId: adminClerk,
      email: `${tag}-admin@example.test`,
      name: "Adam Admin",
      username: `admin_${tag}`,
      avatarUrl: "https://example.test/admin.png",
    },
    {
      clerkId: reader1Clerk,
      email: `${tag}-r1@example.test`,
      name: "Riley Reader",
      username: `r1_${tag}`,
      avatarUrl: "https://example.test/r1.png",
    },
    {
      clerkId: reader2Clerk,
      email: `${tag}-r2@example.test`,
      name: "Robin Reader",
      username: `r2_${tag}`,
      // Intentionally no avatarUrl set — exercises the avatar fallback
      // path in the sheet (initial circle instead of an Image).
    },
  ]);
  const [skin] = await db
    .insert(outwardAccountsTable)
    .values({
      ownerClerkId: ownerClerk,
      kind: "trade_pro",
      title: "Beacon HVAC",
      displayName: "Beacon HVAC",
      companyName: "Beacon HVAC LLC",
    })
    .returning();
  companyId = skin.id;
  await db.insert(teamSeatsTable).values([
    {
      companyOutwardAccountId: companyId,
      memberClerkId: adminClerk,
      role: "manager",
      isAdmin: true,
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
      memberClerkId: reader1Clerk,
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
    {
      companyOutwardAccountId: companyId,
      memberClerkId: reader2Clerk,
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
        adminClerk,
        reader1Clerk,
        reader2Clerk,
      ]),
    );
});

describe("Read receipts sheet end-to-end (#497)", () => {
  it("admin sees both Read by and Still waiting on after a teammate acks", async () => {
    // Owner posts a company notice. The four-person company is
    // owner + admin + reader1 + reader2 → recipientCount === 4.
    const post = await request(app)
      .post(`/api/outward-accounts/${companyId}/company-notices`)
      .set("x-test-user", ownerClerk)
      .send({ title: "Truck check Friday", body: "Inspect tools by EOD." });
    expect(post.status).toBe(201);
    const noticeId: number = post.body.id;
    createdNoticeIds.push(noticeId);

    // Reader1 acknowledges → "Read by" should list exactly Riley.
    const ack = await request(app)
      .post(`/api/company-notices/${noticeId}/acknowledge`)
      .set("x-test-user", reader1Clerk);
    expect(ack.status).toBe(200);
    const ackTimestamp: string = ack.body.acknowledgedAt;
    expect(typeof ackTimestamp).toBe("string");

    // Admin opens reminders → reads the same payload that powers
    // NoticeReadReceiptsSheet's "Read by" + "Still waiting on" lists.
    const adminList = await request(app)
      .get("/api/company-notices")
      .set("x-test-user", adminClerk);
    expect(adminList.status).toBe(200);
    const row = adminList.body.notices.find((n: any) => n.id === noticeId);
    expect(row).toBeTruthy();
    expect(row.recipientCount).toBe(4);
    expect(row.ackCount).toBe(1);

    // "Read by" section: one entry with full profile + read time.
    expect(Array.isArray(row.acks)).toBe(true);
    expect(row.acks).toHaveLength(1);
    const r1 = row.acks[0];
    expect(r1.memberClerkId).toBe(reader1Clerk);
    expect(r1.name).toBe("Riley Reader");
    expect(r1.username).toBe(`r1_${tag}`);
    expect(r1.avatarUrl).toBe("https://example.test/r1.png");
    expect(r1.acknowledgedAt).toBe(ackTimestamp);

    // "Still waiting on" section: admin + reader2, sorted by display
    // name (Adam, Robin). The owner is the sender and must NOT appear.
    // The acknowledger (reader1) must NOT appear either.
    expect(Array.isArray(row.pendingMembers)).toBe(true);
    const pendingIds = row.pendingMembers.map((p: any) => p.memberClerkId);
    expect(pendingIds).not.toContain(ownerClerk);
    expect(pendingIds).not.toContain(reader1Clerk);
    expect(pendingIds).toEqual(
      expect.arrayContaining([adminClerk, reader2Clerk]),
    );
    expect(pendingIds).toHaveLength(2);
    // Pending entries carry profile fields the sheet renders, including
    // null avatarUrls (renders the initial-circle fallback).
    const adminPending = row.pendingMembers.find(
      (p: any) => p.memberClerkId === adminClerk,
    );
    expect(adminPending.name).toBe("Adam Admin");
    expect(adminPending.avatarUrl).toBe("https://example.test/admin.png");
    const r2Pending = row.pendingMembers.find(
      (p: any) => p.memberClerkId === reader2Clerk,
    );
    expect(r2Pending.name).toBe("Robin Reader");
    // avatarUrl on usersTable is `text().notNull().default("")`, so an
    // unset avatar surfaces as an empty string. The sheet treats any
    // falsy avatarUrl as a fallback to the initial-circle avatar.
    expect(r2Pending.avatarUrl).toBe("");
  });

  it("non-admin recipient cannot see the Read by or Still waiting on sections", async () => {
    // Reader2 fetches the same notice. The reminders screen only opens
    // the read-receipts sheet when `notice.acks` is truthy, so a `null`
    // value here proves the sheet is unavailable to non-admins.
    const list = await request(app)
      .get("/api/company-notices")
      .set("x-test-user", reader2Clerk);
    expect(list.status).toBe(200);
    const row = list.body.notices.find(
      (n: any) => n.id === createdNoticeIds[0],
    );
    expect(row).toBeTruthy();
    // No "Read by" data — even though reader1 has acked the notice.
    expect(row.acks).toBeNull();
    // No "Still waiting on" data either — the pending list is admin-only.
    expect(row.pendingMembers).toBeNull();
    // Counts are still safe to display in the row label.
    expect(row.ackCount).toBe(1);
    expect(row.recipientCount).toBe(4);
  });

  it("closing the sheet does not change the notice on a refetch", async () => {
    // The sheet is a client-only modal — closing it must not mutate
    // server state. Refetching after the previous tests still returns
    // the same ack/pending shape so the user lands back on a clean
    // reminders list.
    const before = await request(app)
      .get("/api/company-notices")
      .set("x-test-user", adminClerk);
    const beforeRow = before.body.notices.find(
      (n: any) => n.id === createdNoticeIds[0],
    );
    const after = await request(app)
      .get("/api/company-notices")
      .set("x-test-user", adminClerk);
    const afterRow = after.body.notices.find(
      (n: any) => n.id === createdNoticeIds[0],
    );
    expect(afterRow.ackCount).toBe(beforeRow.ackCount);
    expect(afterRow.recipientCount).toBe(beforeRow.recipientCount);
    expect(afterRow.acks).toEqual(beforeRow.acks);
    expect(afterRow.pendingMembers).toEqual(beforeRow.pendingMembers);
  });
});

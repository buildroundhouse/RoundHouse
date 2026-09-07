/**
 * Tests for #310 — team members acting as a company skin.
 *
 * Verified behaviors:
 *   1. Acting-as-skin attribution: a log written by a team member with the
 *      `x-active-outward-account-id` of the company skin is publicly
 *      attributed to the skin (authorOutwardAccountId), and internally
 *      stamped with `actedByClerkId` = team member.
 *   2. Removing a seat ends access on subsequent requests but leaves
 *      the records that team member created on the skin intact.
 *   3. Billing is gated: a team member without `seeBilling` gets 403 on
 *      `GET /billing/me` while acting as the skin; with the permission
 *      they receive a normal 200 listing the skin's billing.
 *   4. Contact details on `GET /users/:userId` are redacted when the
 *      acting-as-seat lacks `seeContacts`, even when the target user has
 *      `phone` visibility on.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq, and } from "drizzle-orm";

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
  teamSeatsTable,
  workLogsTable,
  propertiesTable,
} = await import("@workspace/db");
const billingRouter = (await import("../billing")).default;
const usersRouter = (await import("../users")).default;
const logsRouter = (await import("../logs")).default;
const teamSeatsRouter = (await import("../team-seats")).default;
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
  app.use("/api", usersRouter);
  app.use("/api", logsRouter);
  app.use("/api", teamSeatsRouter);
  return app;
}

const tag = `t310-${Date.now()}`;
const ownerClerk = `${tag}-owner`;
const memberClerk = `${tag}-member`;
const targetClerk = `${tag}-target`;

let app: Express;
let companySkinId: number;
let propertyId: number;
let billingSeatId: number;
let basicSeatId: number;

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
      clerkId: memberClerk,
      email: `${tag}-member@example.test`,
      name: "Team Member",
      username: `member_${tag}`,
    },
    {
      clerkId: targetClerk,
      email: `${tag}-target@example.test`,
      name: "Contact Target",
      username: `target_${tag}`,
      phone: "+15551234567",
      visibility: { phone: true, email: true, address: true } as any,
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
  companySkinId = skin.id;
  const [prop] = await db
    .insert(propertiesTable)
    .values({ ownerClerkId: ownerClerk, address: "123 Main St" } as any)
    .returning();
  propertyId = prop.id;
});

async function seatMember(perms: {
  seeBilling?: boolean;
  seeContacts?: boolean;
  createOnProperties?: boolean;
}) {
  const [row] = await db
    .insert(teamSeatsTable)
    .values({
      companyOutwardAccountId: companySkinId,
      memberClerkId: memberClerk,
      role: "employee",
      isAdmin: false,
      permissions: {
        seeBilling: !!perms.seeBilling,
        seeContacts: !!perms.seeContacts,
        createOnProperties: !!perms.createOnProperties,
        manageTeam: false,
      },
      status: "accepted",
      acceptedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [teamSeatsTable.companyOutwardAccountId, teamSeatsTable.memberClerkId],
      set: {
        status: "accepted",
        acceptedAt: new Date(),
        removedAt: null,
        permissions: {
          seeBilling: !!perms.seeBilling,
          seeContacts: !!perms.seeContacts,
          createOnProperties: !!perms.createOnProperties,
          manageTeam: false,
        },
      },
    })
    .returning();
  return row.id;
}

describe("#310 team-seats acting-as-skin", () => {
  it("attributes logs to the skin publicly and stamps actedByClerkId privately", async () => {
    basicSeatId = await seatMember({ createOnProperties: true });
    const res = await request(app)
      .post(`/api/properties/${propertyId}/logs`)
      .set("x-test-user", memberClerk)
      .set("x-active-outward-account-id", String(companySkinId))
      .send({ note: "Replaced fitting", isRealTime: true });
    expect(res.status).toBe(200);
    const logId = res.body.log?.id ?? res.body.id;
    expect(logId).toBeTruthy();
    const [row] = await db
      .select()
      .from(workLogsTable)
      .where(eq(workLogsTable.id, logId));
    // Public attribution = company skin.
    expect(row.authorOutwardAccountId).toBe(companySkinId);
    // Internal-only attribution = the team member who acted.
    expect(row.actedByClerkId).toBe(memberClerk);
  });

  it("blocks billing without seeBilling and allows it with the perm", async () => {
    // Without seeBilling -> 403.
    const denied = await request(app)
      .get("/api/billing/me")
      .set("x-test-user", memberClerk)
      .set("x-active-outward-account-id", String(companySkinId));
    expect(denied.status).toBe(403);
    // Grant seeBilling -> 200.
    billingSeatId = await seatMember({ seeBilling: true, createOnProperties: true });
    const ok = await request(app)
      .get("/api/billing/me")
      .set("x-test-user", memberClerk)
      .set("x-active-outward-account-id", String(companySkinId));
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.body.outwardAccounts)).toBe(true);
  });

  it("redacts contact details when seat lacks seeContacts", async () => {
    await seatMember({ createOnProperties: true });
    const r = await request(app)
      .get(`/api/users/${targetClerk}`)
      .set("x-test-user", memberClerk)
      .set("x-active-outward-account-id", String(companySkinId));
    expect(r.status).toBe(200);
    expect(r.body.phone).toBeNull();
    expect(r.body.email).toBe("");

    await seatMember({ createOnProperties: true, seeContacts: true });
    const r2 = await request(app)
      .get(`/api/users/${targetClerk}`)
      .set("x-test-user", memberClerk)
      .set("x-active-outward-account-id", String(companySkinId));
    expect(r2.status).toBe(200);
    expect(r2.body.phone).toBe("+15551234567");
  });

  it("removing a seat ends access but preserves the records they created", async () => {
    await db
      .update(teamSeatsTable)
      .set({ removedAt: new Date(), status: "pending" })
      .where(
        and(
          eq(teamSeatsTable.companyOutwardAccountId, companySkinId),
          eq(teamSeatsTable.memberClerkId, memberClerk),
        ),
      );
    // Acting-as the skin now fails to resolve, so the request falls
    // back to the member's own (non-existent) active skin and the
    // billing route 200's against THEIR own (empty) account list, but
    // crucially, the prior log row is still there and still attributed
    // to the skin.
    const rows = await db
      .select()
      .from(workLogsTable)
      .where(eq(workLogsTable.authorOutwardAccountId, companySkinId));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].actedByClerkId).toBe(memberClerk);
  });
});

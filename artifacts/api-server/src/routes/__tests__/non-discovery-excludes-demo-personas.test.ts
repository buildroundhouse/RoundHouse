/**
 * #676 — Demo personas (rows in `admin_demo_profiles`) must stay
 * hidden across the *non-discovery* surfaces too: profile lookups,
 * profile-deeplinked sub-resources, team membership listings, and
 * any "add by handle" path (personal teammates + company-skin seats).
 *
 * Companion to `discovery-excludes-demo-personas.test.ts`, which
 * already pins the behavior on the public discovery surfaces. The
 * helper under test is the same `excludeDemoUsersWhere` /
 * `isAdminDemoClerkId` pair from `src/lib/adminDemo.ts`; this file
 * is the regression net for everywhere else the demo could leak.
 *
 * Surfaces covered:
 *   - `GET /api/users/:userId`                 — profile by clerk id
 *   - `GET /api/users/:userId/success-stories` — profile sub-resource
 *   - `GET /api/users/:userId/team`            — profile sub-resource
 *   - `POST /api/users/me/team`                — invite by handle
 *   - `POST /api/outward-accounts/:id/team`    — seat by handle
 *   - `GET /api/users/me/team`                 — listed teammates
 *   - `GET /api/users/me/team-invites`         — pending lead invites
 *   - `GET /api/users/me/team-seat-invites`    — pending seat invites
 *
 * Each test seeds the demo persona side-by-side with a real "live"
 * user so a missing demo can be distinguished from an empty query
 * (the live user must surface). The profile route is also exercised
 * with an admin viewer to confirm admins still see demo personas —
 * Wardrobe needs that path to inspect the demos it spawned.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    const uid = req.headers["x-test-user"];
    req.userId = String(uid);
    next();
  },
}));

const {
  db,
  usersTable,
  userModesTable,
  outwardAccountsTable,
  adminDemoProfilesTable,
  workLogsTable,
  propertiesTable,
  userTeamMembersTable,
  teamSeatsTable,
} = await import("@workspace/db");
const { upsertPropertyMembership, purgeEntityForProperty } = await import(
  "../../lib/migratePropertyEntities"
);
const usersRouter = (await import("../users")).default;
const teamSeatsRouter = (await import("../team-seats")).default;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", usersRouter);
  app.use("/api", teamSeatsRouter);
  return app;
}

const tag = `t676-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
const callerClerk = `${tag}-caller`;
const adminClerk = `${tag}-admin`;
const liveClerk = `${tag}-live`;
const demoClerk = `${tag}-demo`;
const demoLeadClerk = `${tag}-demo-lead`;
const demoOwnerClerk = `${tag}-demo-owner`;

let app: Express;
let propertyId: number;
let liveSuccessStoryId: number;
let demoSuccessStoryId: number;
let liveTeammateLeadId: number; // userTeamMembersTable row id (caller as lead, live member)
let demoTeammateLeadId: number; // userTeamMembersTable row id (caller as lead, demo member)
let liveTeammateInviteId: number; // pending invite TO caller from live lead
let demoTeammateInviteId: number; // pending invite TO caller from demo lead
let liveCompanySkinId: number;
let demoCompanySkinId: number;
let liveSeatInviteId: number; // pending seat for caller on live company skin
let demoSeatInviteId: number; // pending seat for caller on demo company skin

beforeAll(async () => {
  app = makeApp();

  await db.insert(usersTable).values([
    {
      clerkId: callerClerk,
      email: `${tag}-caller@example.test`,
      name: "Carol Caller",
      username: `caller_${tag}`,
    },
    {
      clerkId: adminClerk,
      email: `${tag}-admin@example.test`,
      name: "Anna Admin",
      username: `admin_${tag}`,
      isAdmin: true,
    },
    {
      // The live "real" user we expect every endpoint to keep
      // surfacing — sanity that the query window was wide enough.
      clerkId: liveClerk,
      email: `${tag}-live@example.test`,
      name: "Liam Live",
      username: `live_${tag}`,
    },
    {
      // The demo persona under test. Identical shape to a real user;
      // only its row in `admin_demo_profiles` distinguishes it.
      clerkId: demoClerk,
      email: `${tag}-demo@example.test`,
      name: "Demo Persona",
      username: `demo_${tag}`,
    },
    {
      // A second demo persona, used as the LEAD on a personal team
      // invite addressed to the caller. The /users/me/team-invites
      // listing must hide it.
      clerkId: demoLeadClerk,
      email: `${tag}-demo-lead@example.test`,
      name: "Demo Lead",
      username: `demolead_${tag}`,
    },
    {
      // A third demo persona, used as the OWNER of a company skin
      // sending a seat invite to the caller. The
      // /users/me/team-seat-invites listing must hide it.
      clerkId: demoOwnerClerk,
      email: `${tag}-demo-owner@example.test`,
      name: "Demo Owner",
      username: `demoowner_${tag}`,
    },
  ]);

  // Stamp the three personas as Wardrobe demos. Provenance is the only
  // fact that drives every filter in this test file.
  await db.insert(adminDemoProfilesTable).values([
    { adminClerkId: adminClerk, demoClerkId: demoClerk, roleKind: "trade_pro", displayName: "Demo Persona" },
    { adminClerkId: adminClerk, demoClerkId: demoLeadClerk, roleKind: "trade_pro", displayName: "Demo Lead" },
    { adminClerkId: adminClerk, demoClerkId: demoOwnerClerk, roleKind: "trade_pro", displayName: "Demo Owner" },
  ]);

  // A property to anchor the success-story rows on (the route reads
  // `assigneeClerkId` and we need real `workLogs` rows for both).
  const [prop] = await db
    .insert(propertiesTable)
    .values({
      name: `Demo Test Home ${tag}`,
      address: `1 Demo Way, Anytown, NY 10676`,
      ownerClerkId: callerClerk,
    })
    .returning();
  propertyId = prop.id;

  // Visibility: opt the live user into analytics so success stories
  // surface to the caller. The demo persona deliberately also opts
  // in — the test must show that the demo gate wins regardless.
  await db
    .update(usersTable)
    .set({ visibility: { analytics: true, team: true } as Record<string, boolean> })
    .where(eq(usersTable.clerkId, liveClerk));
  await db
    .update(usersTable)
    .set({ visibility: { analytics: true, team: true } as Record<string, boolean> })
    .where(eq(usersTable.clerkId, demoClerk));

  // Both pros are members of the property — the success-stories
  // route filters work logs through entity_members so the live
  // user's story actually surfaces (the sanity check). Without these
  // rows the listing would be empty for everyone and we couldn't
  // tell the demo gate apart from "no qualifying memberships".
  // Each user needs an outward account because
  // entity_members.user_outward_account_id is NOT NULL after #681.
  const [liveOwnerSkin, demoOwnerSkin] = await db
    .insert(outwardAccountsTable)
    .values([
      { ownerClerkId: liveClerk, kind: "home", title: liveClerk },
      { ownerClerkId: demoClerk, kind: "home", title: demoClerk },
    ])
    .returning({ id: outwardAccountsTable.id });
  await upsertPropertyMembership({
    propertyId: prop.id,
    userClerkId: liveClerk,
    userOutwardAccountId: liveOwnerSkin.id,
    role: "owner",
  });
  await upsertPropertyMembership({
    propertyId: prop.id,
    userClerkId: demoClerk,
    userOutwardAccountId: demoOwnerSkin.id,
    role: "owner",
  });

  const now = new Date();
  const [liveStory, demoStory] = await db
    .insert(workLogsTable)
    .values([
      {
        propertyId,
        authorClerkId: callerClerk,
        assigneeClerkId: liveClerk,
        status: "done",
        note: `Live story ${tag}`,
        completedAt: now,
        isSuccessStory: true,
        successStoryAt: now,
        successStoryBlurb: `Live story blurb ${tag}`,
        successStoryServiceTag: "plumber",
      },
      {
        propertyId,
        authorClerkId: callerClerk,
        assigneeClerkId: demoClerk,
        status: "done",
        note: `Demo story ${tag}`,
        completedAt: now,
        isSuccessStory: true,
        successStoryAt: now,
        successStoryBlurb: `Demo story blurb ${tag}`,
        successStoryServiceTag: "plumber",
      },
    ])
    .returning();
  liveSuccessStoryId = liveStory.id;
  demoSuccessStoryId = demoStory.id;

  // Both live and demo personas live on the caller's personal team
  // (admin-seeded historical state — what the GET filter has to clean
  // up). The POST gate added in this task prevents new such rows, but
  // these are inserted directly to simulate pre-existing data.
  const [liveLeadRow, demoLeadRow] = await db
    .insert(userTeamMembersTable)
    .values([
      { leadClerkId: callerClerk, memberClerkId: liveClerk, role: "employee", status: "accepted", acceptedAt: now },
      { leadClerkId: callerClerk, memberClerkId: demoClerk, role: "employee", status: "accepted", acceptedAt: now },
    ])
    .returning();
  liveTeammateLeadId = liveLeadRow.id;
  demoTeammateLeadId = demoLeadRow.id;

  // Pending invites TO the caller — one from a live lead, one from a
  // demo lead. /users/me/team-invites must hide the demo one.
  const [liveInviteRow, demoInviteRow] = await db
    .insert(userTeamMembersTable)
    .values([
      { leadClerkId: liveClerk, memberClerkId: callerClerk, role: "employee", status: "pending" },
      { leadClerkId: demoLeadClerk, memberClerkId: callerClerk, role: "employee", status: "pending" },
    ])
    .returning();
  liveTeammateInviteId = liveInviteRow.id;
  demoTeammateInviteId = demoInviteRow.id;

  // Two company skins: one owned by the live user, one by a demo
  // persona. Both send a pending seat invite to the caller. The
  // listing endpoint must drop the demo one.
  const [liveSkin, demoSkin] = await db
    .insert(outwardAccountsTable)
    .values([
      { ownerClerkId: liveClerk, kind: "trade_pro", companyName: `Liveco ${tag}` },
      { ownerClerkId: demoOwnerClerk, kind: "trade_pro", companyName: `Democo ${tag}` },
    ])
    .returning();
  liveCompanySkinId = liveSkin.id;
  demoCompanySkinId = demoSkin.id;

  const [liveSeat, demoSeat] = await db
    .insert(teamSeatsTable)
    .values([
      {
        companyOutwardAccountId: liveCompanySkinId,
        memberClerkId: callerClerk,
        role: "employee",
        isAdmin: false,
        status: "pending",
      },
      {
        companyOutwardAccountId: demoCompanySkinId,
        memberClerkId: callerClerk,
        role: "employee",
        isAdmin: false,
        status: "pending",
      },
    ])
    .returning();
  liveSeatInviteId = liveSeat.id;
  demoSeatInviteId = demoSeat.id;
});

afterAll(async () => {
  const clerkIds = [callerClerk, adminClerk, liveClerk, demoClerk, demoLeadClerk, demoOwnerClerk];
  await db.delete(teamSeatsTable).where(inArray(teamSeatsTable.id, [liveSeatInviteId, demoSeatInviteId]));
  await db
    .delete(userTeamMembersTable)
    .where(inArray(userTeamMembersTable.id, [liveTeammateLeadId, demoTeammateLeadId, liveTeammateInviteId, demoTeammateInviteId]));
  await db.delete(workLogsTable).where(inArray(workLogsTable.id, [liveSuccessStoryId, demoSuccessStoryId]));
  await purgeEntityForProperty(propertyId);
  await db.delete(propertiesTable).where(eq(propertiesTable.id, propertyId));
  await db
    .delete(adminDemoProfilesTable)
    .where(inArray(adminDemoProfilesTable.demoClerkId, [demoClerk, demoLeadClerk, demoOwnerClerk]));
  await db
    .delete(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.ownerClerkId, clerkIds));
  await db.delete(userModesTable).where(inArray(userModesTable.userClerkId, clerkIds));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, clerkIds));
});

function as(uid: string) {
  return { "x-test-user": uid } as Record<string, string>;
}

describe("non-discovery surfaces hide admin Wardrobe demo personas (#676)", () => {
  describe("GET /api/users/:userId", () => {
    it("404s for a non-admin viewer when the target is a demo persona", async () => {
      // Sanity: the live user is reachable, so the route is wired up.
      const live = await request(app).get(`/api/users/${liveClerk}`).set(as(callerClerk));
      expect(live.status).toBe(200);
      expect(live.body.user?.clerkId).toBe(liveClerk);

      // Demo persona is hidden from a normal caller — same shape as
      // "no such user" so the response can't be used to probe demos.
      const demo = await request(app).get(`/api/users/${demoClerk}`).set(as(callerClerk));
      expect(demo.status).toBe(404);
    });

    it("still returns the demo profile for an admin viewer (Wardrobe needs to inspect it)", async () => {
      const admin = await request(app).get(`/api/users/${demoClerk}`).set(as(adminClerk));
      expect(admin.status).toBe(200);
      expect(admin.body.user?.clerkId).toBe(demoClerk);
    });

    it("still returns the demo profile when the demo is acting as itself (self view)", async () => {
      const self = await request(app).get(`/api/users/${demoClerk}`).set(as(demoClerk));
      expect(self.status).toBe(200);
      expect(self.body.isSelf).toBe(true);
    });
  });

  describe("GET /api/users/:userId/success-stories", () => {
    it("404s for a non-admin viewer when the target is a demo persona", async () => {
      const live = await request(app).get(`/api/users/${liveClerk}/success-stories`).set(as(callerClerk));
      expect(live.status).toBe(200);
      const liveIds = (live.body.stories ?? []).map((s: any) => s.id);
      expect(liveIds).toContain(liveSuccessStoryId);

      const demo = await request(app).get(`/api/users/${demoClerk}/success-stories`).set(as(callerClerk));
      expect(demo.status).toBe(404);
    });
  });

  describe("GET /api/users/:userId/team", () => {
    it("404s for a non-admin viewer when the target is a demo persona", async () => {
      // Sanity: the live user's team route resolves (the body shape
      // depends on the lead's `team` visibility, but the status check
      // is what we care about for the gate).
      const live = await request(app).get(`/api/users/${liveClerk}/team`).set(as(callerClerk));
      expect(live.status).toBe(200);

      const demo = await request(app).get(`/api/users/${demoClerk}/team`).set(as(callerClerk));
      expect(demo.status).toBe(404);
    });
  });

  describe("POST /api/users/me/team", () => {
    it("returns the same generic 'not found' when the invitee is a demo persona", async () => {
      // Sanity: a real user can be invited (or re-invited — the
      // upsert path is fine for this assertion). 200 means the
      // pre-flight passed and the row was upserted.
      const live = await request(app)
        .post(`/api/users/me/team`)
        .set(as(callerClerk))
        .send({ role: "employee", username: `live_${tag}` });
      // Real users either succeed (200) or 400 if they're already
      // self/etc — the live user should always succeed here.
      expect(live.status).toBe(200);

      // Inviting by the demo's @username must look identical to
      // "user not found", with the same generic error string.
      const demoByUsername = await request(app)
        .post(`/api/users/me/team`)
        .set(as(callerClerk))
        .send({ role: "employee", username: `demo_${tag}` });
      expect(demoByUsername.status).toBe(404);
      expect(demoByUsername.body.error).toMatch(/couldn't find/i);

      // Inviting by clerkId is the same back-door — also 404.
      const demoByClerk = await request(app)
        .post(`/api/users/me/team`)
        .set(as(callerClerk))
        .send({ role: "employee", clerkId: demoClerk });
      expect(demoByClerk.status).toBe(404);

      // And by email.
      const demoByEmail = await request(app)
        .post(`/api/users/me/team`)
        .set(as(callerClerk))
        .send({ role: "employee", email: `${tag}-demo@example.test` });
      expect(demoByEmail.status).toBe(404);
    });
  });

  describe("POST /api/outward-accounts/:id/team", () => {
    it("returns the same generic 'not found' when the seat invitee is a demo persona", async () => {
      // Caller owns the live company skin (we need that to satisfy
      // the loadAdministeredSkin gate). Re-stamp ownership for the
      // live skin onto the caller so the POST is authorized.
      await db
        .update(outwardAccountsTable)
        .set({ ownerClerkId: callerClerk })
        .where(eq(outwardAccountsTable.id, liveCompanySkinId));

      // Sanity: a real user can be seated (admin succeeds with 200).
      const live = await request(app)
        .post(`/api/outward-accounts/${liveCompanySkinId}/team`)
        .set(as(callerClerk))
        .send({ username: `live_${tag}`, role: "employee" });
      expect(live.status).toBe(200);

      const demoByUsername = await request(app)
        .post(`/api/outward-accounts/${liveCompanySkinId}/team`)
        .set(as(callerClerk))
        .send({ username: `demo_${tag}`, role: "employee" });
      expect(demoByUsername.status).toBe(404);

      const demoByClerk = await request(app)
        .post(`/api/outward-accounts/${liveCompanySkinId}/team`)
        .set(as(callerClerk))
        .send({ clerkId: demoClerk, role: "employee" });
      expect(demoByClerk.status).toBe(404);
    });
  });

  describe("GET /api/users/me/team", () => {
    it("drops members whose clerkId belongs to a demo persona (defensive)", async () => {
      const res = await request(app).get(`/api/users/me/team`).set(as(callerClerk));
      expect(res.status).toBe(200);
      const memberIds = (res.body.members ?? []).map((m: any) => m.memberClerkId);
      expect(memberIds).toContain(liveClerk);
      expect(memberIds).not.toContain(demoClerk);
    });
  });

  describe("GET /api/users/me/team-invites", () => {
    it("drops invites whose lead is a demo persona (defensive)", async () => {
      const res = await request(app).get(`/api/users/me/team-invites`).set(as(callerClerk));
      expect(res.status).toBe(200);
      const leadIds = (res.body.invites ?? []).map((i: any) => i.leadClerkId);
      expect(leadIds).toContain(liveClerk);
      expect(leadIds).not.toContain(demoLeadClerk);
    });
  });

  describe("GET /api/users/me/team-seat-invites", () => {
    it("drops invites whose company-skin owner is a demo persona (defensive)", async () => {
      const res = await request(app).get(`/api/users/me/team-seat-invites`).set(as(callerClerk));
      expect(res.status).toBe(200);
      const skinIds = (res.body.invites ?? []).map((i: any) => i.skinId);
      expect(skinIds).toContain(liveCompanySkinId);
      expect(skinIds).not.toContain(demoCompanySkinId);
    });
  });
});

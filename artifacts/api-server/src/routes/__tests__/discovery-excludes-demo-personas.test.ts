/**
 * #672 — Demo personas (rows in `admin_demo_profiles`) must stay out
 * of every public discovery surface, not just `/users/search`. The
 * shared `excludeDemoUsersWhere` helper lives in
 * `src/lib/adminDemo.ts`; this regression test pins the rule down for
 * each consumer-facing endpoint that funnels users (or jobs / deals
 * authored by users) into a discovery list.
 *
 * Surfaces covered:
 *   - `GET /api/businesses/search` — trade-pro business directory
 *   - `GET /api/pros/search`       — Find-a-Pro
 *   - `GET /api/area-feed`         — In-your-area feed (completed
 *                                    jobs + success stories)
 *   - `GET /api/success-stories/search` — global success-story search
 *   - `GET /api/deals/active`      — local + nationwide deals
 *
 * The same demo persona is seeded once with a public-facing trade
 * profile, an active outward account, a completed job, a public
 * success story, and a live nationwide deal. Each endpoint is then
 * expected to return the live admin's content (sanity check that the
 * query itself was wide enough to have hit the demo) but never the
 * demo persona's clerkId / log id / deal id.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const uid = req.headers["x-test-user"];
    if (!uid) {
      res.status(401).json({ error: "missing x-test-user" });
      return;
    }
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
  dealsTable,
} = await import("@workspace/db");
const usersRouter = (await import("../users")).default;
const discoveryRouter = (await import("../discovery")).default;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", usersRouter);
  app.use("/api", discoveryRouter);
  return app;
}

const tag = `t672-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
const callerClerk = `${tag}-caller`;
const adminClerk = `${tag}-admin`;
const demoClerk = `${tag}-demo`;
const homeownerClerk = `${tag}-homeowner`;
const ZIP = "10672";
const TRADE = "plumber";

let app: Express;
let adminTradeProOutwardId: number;
let demoTradeProOutwardId: number;
let propertyId: number;
let liveCompletedLogId: number;
let demoCompletedLogId: number;
let liveSuccessStoryLogId: number;
let demoSuccessStoryLogId: number;
let liveDealId: number;
let demoDealId: number;

beforeAll(async () => {
  app = makeApp();

  await db.insert(usersTable).values([
    {
      clerkId: callerClerk,
      email: `${tag}-caller@example.test`,
      name: "Carol Caller",
      username: `caller_${tag}`,
      addressZip: ZIP,
    },
    {
      // The live admin owns a real trade-pro skin under the matching
      // public-search tokens (companyName + service zip + trade), so
      // every endpoint we exercise actually returns at least one
      // result for the non-demo user. Without this we couldn't tell
      // "demo correctly excluded" from "query returned nothing at
      // all".
      clerkId: adminClerk,
      email: `${tag}-admin@example.test`,
      name: "Live Admin",
      username: `liveadmin_${tag}`,
      companyName: `Liveco Plumbing ${tag}`,
      serviceZips: [ZIP],
      addressZip: ZIP,
      isAdmin: true,
    },
    {
      // The demo persona is the row whose clerk id appears in
      // `admin_demo_profiles`. Everything else about it is a normal
      // live user — same trade, same zip, same companyName token —
      // which is exactly the situation the helper has to neutralize.
      clerkId: demoClerk,
      email: `${tag}-demo@example.test`,
      name: "Demo Persona",
      username: `demoplumber_${tag}`,
      companyName: `Liveco Plumbing Demo ${tag}`,
      serviceZips: [ZIP],
      addressZip: ZIP,
    },
    {
      clerkId: homeownerClerk,
      email: `${tag}-homeowner@example.test`,
      name: "Henry Homeowner",
      username: `homeowner_${tag}`,
      addressZip: ZIP,
    },
  ]);

  // Trade-pro modes for both. The intake matches the structured
  // primary zip + trade keys that `/businesses/search` and
  // `/pros/search` filter against.
  const [adminMode, demoMode] = await db
    .insert(userModesTable)
    .values([
      {
        userClerkId: adminClerk,
        kind: "trade_pro",
        intakeData: {
          companyName: `Liveco Plumbing ${tag}`,
          trade: TRADE,
          primaryZip: ZIP,
          additionalZips: [],
        },
      },
      {
        userClerkId: demoClerk,
        kind: "trade_pro",
        intakeData: {
          companyName: `Liveco Plumbing Demo ${tag}`,
          trade: TRADE,
          primaryZip: ZIP,
          additionalZips: [],
        },
      },
    ])
    .returning();
  await db
    .update(usersTable)
    .set({ lastActiveModeId: adminMode.id })
    .where(eq(usersTable.clerkId, adminClerk));
  await db
    .update(usersTable)
    .set({ lastActiveModeId: demoMode.id })
    .where(eq(usersTable.clerkId, demoClerk));

  // Both pros own trade-pro outward accounts whose companyName
  // contains the search token. /users/search joins on outward
  // accounts and matches on OA fields, so without an OA the admin
  // wouldn't surface for the search at all and we couldn't tell
  // "demo correctly excluded" from "query was empty for everyone".
  const [adminOA, demoOA] = await db
    .insert(outwardAccountsTable)
    .values([
      {
        ownerClerkId: adminClerk,
        kind: "trade_pro",
        companyName: `Liveco Plumbing ${tag}`,
      },
      {
        ownerClerkId: demoClerk,
        kind: "trade_pro",
        companyName: `Liveco Plumbing Demo ${tag}`,
      },
    ])
    .returning();
  adminTradeProOutwardId = adminOA.id;
  demoTradeProOutwardId = demoOA.id;

  // Mark the demo persona as a Wardrobe demo. This is the only fact
  // that distinguishes it from a real user — the helper's whole job
  // is to filter on this row. #677 — the discovery filter now reads
  // `users.is_demo` (denormalized mirror), so flip both columns the
  // way the production write path does.
  await db.insert(adminDemoProfilesTable).values({
    adminClerkId: adminClerk,
    demoClerkId: demoClerk,
    roleKind: "trade_pro",
    displayName: "Demo Persona",
  });
  await db
    .update(usersTable)
    .set({ isDemo: true })
    .where(eq(usersTable.clerkId, demoClerk));

  // A property in the local zip so the area feed has something to
  // anchor on. Both pros (live + demo) get a completed job + a
  // success story on it.
  const [prop] = await db
    .insert(propertiesTable)
    .values({
      name: `Discover Home ${tag}`,
      address: `1 Discover Way, Anytown, NY ${ZIP}`,
      ownerClerkId: homeownerClerk,
    })
    .returning();
  propertyId = prop.id;

  const now = new Date();

  const [liveCompleted, demoCompleted, liveStory, demoStory] = await db
    .insert(workLogsTable)
    .values([
      {
        propertyId,
        authorClerkId: homeownerClerk,
        assigneeClerkId: adminClerk,
        status: "done",
        note: `Live admin pipe fix ${tag}`,
        completedAt: now,
      },
      {
        propertyId,
        authorClerkId: homeownerClerk,
        assigneeClerkId: demoClerk,
        status: "done",
        note: `Demo persona pipe fix ${tag}`,
        completedAt: now,
      },
      {
        propertyId,
        authorClerkId: homeownerClerk,
        assigneeClerkId: adminClerk,
        status: "done",
        note: `Live admin success ${tag}`,
        completedAt: now,
        isSuccessStory: true,
        successStoryAt: now,
        successStoryBlurb: `Liveco success blurb ${tag}`,
        successStoryServiceTag: TRADE,
      },
      {
        propertyId,
        authorClerkId: homeownerClerk,
        assigneeClerkId: demoClerk,
        status: "done",
        note: `Demo persona success ${tag}`,
        completedAt: now,
        isSuccessStory: true,
        successStoryAt: now,
        successStoryBlurb: `Liveco demo success blurb ${tag}`,
        successStoryServiceTag: TRADE,
      },
    ])
    .returning();
  liveCompletedLogId = liveCompleted.id;
  demoCompletedLogId = demoCompleted.id;
  liveSuccessStoryLogId = liveStory.id;
  demoSuccessStoryLogId = demoStory.id;

  // Live nationwide deal from the admin and from the demo. Either
  // one would normally show up in /deals/active for any zip; the
  // helper has to keep the demo's out.
  const [liveDeal, demoDeal] = await db
    .insert(dealsTable)
    .values([
      {
        proClerkId: adminClerk,
        headline: `Liveco nationwide deal ${tag}`,
        serviceTag: TRADE,
        startDate: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        endDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        zips: [],
        nationwide: true,
      },
      {
        proClerkId: demoClerk,
        headline: `Demo nationwide deal ${tag}`,
        serviceTag: TRADE,
        startDate: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        endDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        zips: [],
        nationwide: true,
      },
    ])
    .returning();
  liveDealId = liveDeal.id;
  demoDealId = demoDeal.id;
});

afterAll(async () => {
  const clerkIds = [callerClerk, adminClerk, demoClerk, homeownerClerk];
  await db.delete(dealsTable).where(inArray(dealsTable.id, [liveDealId, demoDealId]));
  await db
    .delete(workLogsTable)
    .where(
      inArray(workLogsTable.id, [
        liveCompletedLogId,
        demoCompletedLogId,
        liveSuccessStoryLogId,
        demoSuccessStoryLogId,
      ]),
    );
  await db.delete(propertiesTable).where(eq(propertiesTable.id, propertyId));
  await db
    .delete(adminDemoProfilesTable)
    .where(eq(adminDemoProfilesTable.adminClerkId, adminClerk));
  await db
    .delete(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.ownerClerkId, clerkIds));
  await db.delete(userModesTable).where(inArray(userModesTable.userClerkId, clerkIds));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, clerkIds));
});

function as(uid: string) {
  return { "x-test-user": uid } as Record<string, string>;
}

describe("public discovery surfaces exclude admin Wardrobe demo personas (#672)", () => {
  it("/api/users/search keeps demo personas out (sanity — already gated by #636)", async () => {
    // Refactored to use the shared `excludeDemoUsersWhere` helper as
    // part of this task; the existing #636 behavior must still hold.
    const res = await request(app)
      .get(`/api/users/search?q=${encodeURIComponent(`liveco`)}`)
      .set(as(callerClerk));
    expect(res.status).toBe(200);
    const clerkIds = (res.body.users ?? []).map((u: any) => u.clerkId);
    const outwardIds = (res.body.users ?? []).map((u: any) => u.outwardAccountId);
    expect(clerkIds).toContain(adminClerk); // sanity — query was wide enough
    expect(clerkIds).not.toContain(demoClerk);
    expect(outwardIds).not.toContain(demoTradeProOutwardId);
  });

  it("/api/businesses/search excludes demo personas even when their structured trade/zip/name all match", async () => {
    const byZip = await request(app)
      .get(`/api/businesses/search?zip=${ZIP}`)
      .set(as(callerClerk));
    expect(byZip.status).toBe(200);
    const zipIds = (byZip.body.businesses ?? []).map((b: any) => b.clerkId);
    expect(zipIds).toContain(adminClerk);
    expect(zipIds).not.toContain(demoClerk);

    const byTrade = await request(app)
      .get(`/api/businesses/search?tradeType=${TRADE}`)
      .set(as(callerClerk));
    expect(byTrade.status).toBe(200);
    const tradeIds = (byTrade.body.businesses ?? []).map((b: any) => b.clerkId);
    expect(tradeIds).toContain(adminClerk);
    expect(tradeIds).not.toContain(demoClerk);

    const byName = await request(app)
      .get(`/api/businesses/search?name=${encodeURIComponent(`Liveco Plumbing Demo ${tag}`)}`)
      .set(as(callerClerk));
    expect(byName.status).toBe(200);
    const nameIds = (byName.body.businesses ?? []).map((b: any) => b.clerkId);
    // The demo's own companyName is the strongest possible match,
    // and yet the row still must not surface.
    expect(nameIds).not.toContain(demoClerk);
  });

  it("/api/pros/search excludes demo personas under both the trade and zip filters", async () => {
    const byTrade = await request(app)
      .get(`/api/pros/search?trade=${TRADE}`)
      .set(as(callerClerk));
    expect(byTrade.status).toBe(200);
    const tradeIds = (byTrade.body.pros ?? []).map((p: any) => p.clerkId);
    expect(tradeIds).toContain(adminClerk);
    expect(tradeIds).not.toContain(demoClerk);

    const byZip = await request(app)
      .get(`/api/pros/search?zip=${ZIP}`)
      .set(as(callerClerk));
    expect(byZip.status).toBe(200);
    const zipIds = (byZip.body.pros ?? []).map((p: any) => p.clerkId);
    expect(zipIds).toContain(adminClerk);
    expect(zipIds).not.toContain(demoClerk);
  });

  it("/api/area-feed hides completed jobs and success stories owned by demo personas", async () => {
    const res = await request(app)
      .get(`/api/area-feed?zip=${ZIP}&limit=50`)
      .set(as(callerClerk));
    expect(res.status).toBe(200);
    const ids = (res.body.items ?? []).map((i: any) => i.id);
    // Sanity — the live admin's completed job and success story
    // both surface, so we know the query window covered the demo.
    expect(ids).toContain(liveCompletedLogId);
    expect(ids).toContain(liveSuccessStoryLogId);
    // The demo persona's job + story must NOT surface, even though
    // they're on the same property in the same zip.
    expect(ids).not.toContain(demoCompletedLogId);
    expect(ids).not.toContain(demoSuccessStoryLogId);
  });

  it("/api/success-stories/search drops stories whose assigned pro is a demo persona", async () => {
    const res = await request(app)
      .get(`/api/success-stories/search?q=${encodeURIComponent(`liveco success blurb ${tag}`)}`)
      .set(as(callerClerk));
    expect(res.status).toBe(200);
    const ids = (res.body.stories ?? []).map((s: any) => s.id);
    expect(ids).toContain(liveSuccessStoryLogId);
    expect(ids).not.toContain(demoSuccessStoryLogId);
  });

  it("/api/deals/active never returns deals posted by a demo persona", async () => {
    const res = await request(app)
      .get(`/api/deals/active?zip=${ZIP}&limit=50`)
      .set(as(callerClerk));
    expect(res.status).toBe(200);
    const dealIds = (res.body.deals ?? []).map((d: any) => d.id);
    expect(dealIds).toContain(liveDealId);
    expect(dealIds).not.toContain(demoDealId);
  });
});

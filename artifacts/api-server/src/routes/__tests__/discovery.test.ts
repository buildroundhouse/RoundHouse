/**
 * Integration tests for discovery routes (task #206).
 *
 * Covers happy paths and key edge cases for:
 *   - GET  /pros/search                         (synonym expansion, zip ANY(),
 *                                                trade filter, rating sort)
 *   - GET  /area-feed                           (zip-derived properties +
 *                                                success-story union, hidden
 *                                                stories drop the property name)
 *   - GET  /success-stories/search              (synonym expansion: "sheetrock"
 *                                                finds "drywall"; hidden rows
 *                                                are excluded)
 *   - POST /logs/:id/share-success              (only the assignee/author may
 *                                                flip a job into a story)
 *   - POST /logs/:id/hide-from-stories          (only the property owner /
 *                                                admin may hide it)
 *   - GET  /deals/active                        (local zip match + nationwide
 *                                                fallback when local < limit)
 *   - GET  /deals/me                            (only the caller's deals)
 *   - POST/PUT/DELETE /deals[/:id]              (validation, ownership)
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
  workLogsTable,
  propertiesTable,
  jobRatingsTable,
  dealsTable,
} = await import("@workspace/db");
const { upsertPropertyMembership, purgeEntitiesForProperties } = await import(
  "../../lib/migratePropertyEntities"
);
const discoveryRouter = (await import("../discovery")).default;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", discoveryRouter);
  return app;
}

const tag = `t206-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
const id = (suffix: string) => `${tag}-${suffix}`;

const ZIP_LOCAL = "10001";
const ZIP_OTHER = "20002";

const users = {
  caller: id("caller"),
  ownerHomeowner: id("owner"),
  adminMember: id("admin"),
  randomMember: id("random"),
  proPlumber: id("pro-plumber"),
  proHvac: id("pro-hvac"),
  proPainter: id("pro-painter"),
  proFar: id("pro-far"),
  proNational: id("pro-national"),
  proLocalDeal: id("pro-local"),
};

let app: Express;
const createdProperties: number[] = [];
const createdLogs: number[] = [];
const createdDeals: number[] = [];

async function seedUser(
  clerkId: string,
  opts: {
    name?: string;
    companyName?: string | null;
    slogan?: string | null;
    serviceZips?: string[];
    addressZip?: string | null;
  } = {},
) {
  await db
    .insert(usersTable)
    .values({
      clerkId,
      email: `${clerkId}@example.test`,
      name: opts.name ?? clerkId,
      username: clerkId,
      companyName: opts.companyName ?? null,
      slogan: opts.slogan ?? null,
      serviceZips: opts.serviceZips ?? [],
      addressZip: opts.addressZip ?? null,
    })
    .onConflictDoNothing();
}

async function seedTradePro(
  clerkId: string,
  intake: Record<string, unknown>,
) {
  const [mode] = await db
    .insert(userModesTable)
    .values({ userClerkId: clerkId, kind: "trade_pro", intakeData: intake })
    .returning();
  await db
    .update(usersTable)
    .set({ lastActiveModeId: mode.id })
    .where(eq(usersTable.clerkId, clerkId));
}

/**
 * Tests need a real outward_account row for any user that becomes a
 * property member, since `entity_members.user_outward_account_id` is
 * NOT NULL after the task #681 cleanup. Returns the (existing or
 * newly created) personal outward account id for `clerkId`.
 */
async function ensureOutwardAccount(clerkId: string): Promise<number> {
  const [existing] = await db
    .select({ id: outwardAccountsTable.id })
    .from(outwardAccountsTable)
    .where(eq(outwardAccountsTable.ownerClerkId, clerkId))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(outwardAccountsTable)
    .values({ ownerClerkId: clerkId, kind: "home", title: clerkId })
    .returning({ id: outwardAccountsTable.id });
  return created.id;
}

async function seedProperty(opts: {
  name: string;
  address: string;
  ownerClerkId: string;
}): Promise<number> {
  const [row] = await db
    .insert(propertiesTable)
    .values({
      name: opts.name,
      address: opts.address,
      ownerClerkId: opts.ownerClerkId,
    })
    .returning();
  createdProperties.push(row.id);
  return row.id;
}

async function seedLog(values: Partial<typeof workLogsTable.$inferInsert> & {
  propertyId: number;
  authorClerkId: string;
}): Promise<number> {
  const [row] = await db
    .insert(workLogsTable)
    .values({ status: "done", note: "", ...values })
    .returning();
  createdLogs.push(row.id);
  return row.id;
}

async function seedDeal(values: Partial<typeof dealsTable.$inferInsert> & {
  proClerkId: string;
  headline: string;
}): Promise<number> {
  const now = new Date();
  const [row] = await db
    .insert(dealsTable)
    .values({
      serviceTag: "general",
      startDate: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      endDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      zips: [],
      nationwide: false,
      ...values,
    })
    .returning();
  createdDeals.push(row.id);
  return row.id;
}

let propertyOwnerId: number;
let propertyAdminId: number;
let logCompletedByPlumber: number;
let logSuccessStoryHvac: number;
let logHiddenStory: number;
let logUnrelated: number;

beforeAll(async () => {
  app = makeApp();

  // Seed users (including pros). serviceZips is set on the user row because
  // /pros/search filters via `${zip} = ANY(${usersTable.serviceZips})`.
  await Promise.all([
    seedUser(users.caller, { name: "Caller" }),
    seedUser(users.ownerHomeowner, { name: "Owner" }),
    seedUser(users.adminMember, { name: "Admin Member" }),
    seedUser(users.randomMember, { name: "Random" }),
    seedUser(users.proPlumber, {
      name: "Pat Plumber",
      companyName: "Pat's Drywall & Plumbing",
      slogan: "We fix leaks too",
      serviceZips: [ZIP_LOCAL],
    }),
    seedUser(users.proHvac, {
      name: "Holly HVAC",
      companyName: "Holly Air",
      serviceZips: [ZIP_LOCAL, ZIP_OTHER],
    }),
    seedUser(users.proPainter, {
      name: "Penny Painter",
      companyName: "Penny Paints",
      serviceZips: [ZIP_OTHER],
    }),
    seedUser(users.proFar, {
      name: "Far Away Pro",
      companyName: "Distant Co",
      serviceZips: ["99999"],
    }),
    seedUser(users.proNational, { name: "Nat Pro" }),
    seedUser(users.proLocalDeal, { name: "Local Deal Pro" }),
  ]);

  await Promise.all([
    seedTradePro(users.proPlumber, { trade: "plumber", region: "local" }),
    seedTradePro(users.proHvac, { trade: "hvac", region: "local" }),
    seedTradePro(users.proPainter, { trade: "painter", region: "other" }),
    seedTradePro(users.proFar, { trade: "carpenter", region: "far" }),
  ]);

  // Properties — area-feed parses zip from address text.
  propertyOwnerId = await seedProperty({
    name: "Owner Home",
    address: `123 Main St, Anytown, NY ${ZIP_LOCAL}`,
    ownerClerkId: users.ownerHomeowner,
  });
  propertyAdminId = await seedProperty({
    name: "Admin Home",
    address: `45 Side St, Anytown, NY ${ZIP_LOCAL}`,
    ownerClerkId: users.randomMember,
  });
  // Add admin member to the second property so we can test admin-role hide.
  const adminSkinId = await ensureOutwardAccount(users.adminMember);
  await upsertPropertyMembership({
    propertyId: propertyAdminId,
    userClerkId: users.adminMember,
    userOutwardAccountId: adminSkinId,
    role: "admin",
  });
  // Property out of the area (different zip).
  const propOther = await seedProperty({
    name: "Other Home",
    address: `99 Far Ave, Othertown, NY ${ZIP_OTHER}`,
    ownerClerkId: users.ownerHomeowner,
  });

  // Work logs:
  // - completed plumbing job in the local area (visible in area-feed via prop)
  logCompletedByPlumber = await seedLog({
    propertyId: propertyOwnerId,
    authorClerkId: users.ownerHomeowner,
    assigneeClerkId: users.proPlumber,
    status: "done",
    note: "Fixed a drywall leak\nDetails…",
    completedAt: new Date(),
  });
  // - success story by the HVAC pro (visible globally via isSuccessStory)
  logSuccessStoryHvac = await seedLog({
    propertyId: propOther,
    authorClerkId: users.ownerHomeowner,
    assigneeClerkId: users.proHvac,
    status: "done",
    note: "AC tune-up",
    completedAt: new Date(Date.now() - 60_000),
    isSuccessStory: true,
    successStoryAt: new Date(Date.now() - 60_000),
    successStoryBlurb: "Blew the cobwebs out of an old AC unit",
    successStoryServiceTag: "hvac",
  });
  // - hidden success story (must be excluded from /success-stories/search)
  logHiddenStory = await seedLog({
    propertyId: propertyOwnerId,
    authorClerkId: users.ownerHomeowner,
    assigneeClerkId: users.proPainter,
    status: "done",
    note: "Painted the trim",
    completedAt: new Date(Date.now() - 120_000),
    isSuccessStory: true,
    successStoryAt: new Date(Date.now() - 120_000),
    successStoryHidden: true,
    successStoryBlurb: "Top-quality trim painting",
    successStoryServiceTag: "painting",
  });
  // - an unrelated open log used for the share-success / hide tests.
  logUnrelated = await seedLog({
    propertyId: propertyOwnerId,
    authorClerkId: users.ownerHomeowner,
    assigneeClerkId: users.proPlumber,
    status: "done",
    note: "Cleaned out the gutters",
    completedAt: new Date(),
  });

  // Ratings — proPlumber gets a 5★, proHvac gets nothing → plumber sorts first.
  await db.insert(jobRatingsTable).values({
    workLogId: logCompletedByPlumber,
    propertyId: propertyOwnerId,
    memberClerkId: users.proPlumber,
    ratedByClerkId: users.ownerHomeowner,
    stars: 5,
  });

  // Deals — one local (matching ZIP_LOCAL), one nationwide (fallback).
  await seedDeal({
    proClerkId: users.proLocalDeal,
    headline: "Local plumbing special",
    serviceTag: "plumbing",
    zips: [ZIP_LOCAL],
  });
  await seedDeal({
    proClerkId: users.proNational,
    headline: "Nationwide HVAC tune-up",
    serviceTag: "hvac",
    nationwide: true,
  });
});

afterAll(async () => {
  if (createdDeals.length > 0) {
    await db.delete(dealsTable).where(inArray(dealsTable.id, createdDeals));
  }
  await db
    .delete(jobRatingsTable)
    .where(inArray(jobRatingsTable.memberClerkId, Object.values(users)));
  if (createdLogs.length > 0) {
    await db.delete(workLogsTable).where(inArray(workLogsTable.id, createdLogs));
  }
  if (createdProperties.length > 0) {
    await purgeEntitiesForProperties(createdProperties);
    await db.delete(propertiesTable).where(inArray(propertiesTable.id, createdProperties));
  }
  await db
    .delete(userModesTable)
    .where(inArray(userModesTable.userClerkId, Object.values(users)));
  await db
    .delete(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.ownerClerkId, Object.values(users)));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, Object.values(users)));
});

function as(uid: string) {
  return { "x-test-user": uid } as Record<string, string>;
}

describe("GET /pros/search", () => {
  it("filters by trade and excludes the caller", async () => {
    const res = await request(app)
      .get("/api/pros/search")
      .query({ trade: "plumber" })
      .set(as(users.caller));
    expect(res.status).toBe(200);
    const ids = (res.body.pros ?? []).map((p: { clerkId: string }) => p.clerkId);
    expect(ids).toContain(users.proPlumber);
    expect(ids).not.toContain(users.proHvac);
    expect(ids).not.toContain(users.caller);
  });

  it("filters by zip via the serviceZips ANY() match", async () => {
    const res = await request(app)
      .get("/api/pros/search")
      .query({ zip: ZIP_LOCAL })
      .set(as(users.caller));
    expect(res.status).toBe(200);
    const ids = (res.body.pros ?? []).map((p: { clerkId: string }) => p.clerkId);
    expect(ids).toEqual(expect.arrayContaining([users.proPlumber, users.proHvac]));
    expect(ids).not.toContain(users.proFar);
    expect(ids).not.toContain(users.proPainter);
  });

  it("expands synonyms ('sheetrock' matches the plumber's drywall slogan)", async () => {
    const res = await request(app)
      .get("/api/pros/search")
      .query({ q: "sheetrock" })
      .set(as(users.caller));
    expect(res.status).toBe(200);
    const ids = (res.body.pros ?? []).map((p: { clerkId: string }) => p.clerkId);
    expect(ids).toContain(users.proPlumber);
  });

  it("sorts higher-rated pros first", async () => {
    const res = await request(app)
      .get("/api/pros/search")
      .query({ zip: ZIP_LOCAL })
      .set(as(users.caller));
    expect(res.status).toBe(200);
    const ids = (res.body.pros ?? []).map((p: { clerkId: string }) => p.clerkId);
    const plumberIdx = ids.indexOf(users.proPlumber);
    const hvacIdx = ids.indexOf(users.proHvac);
    expect(plumberIdx).toBeGreaterThanOrEqual(0);
    expect(hvacIdx).toBeGreaterThanOrEqual(0);
    expect(plumberIdx).toBeLessThan(hvacIdx);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/pros/search");
    expect(res.status).toBe(401);
  });
});

describe("GET /area-feed", () => {
  it("returns success stories and completed jobs in the area", async () => {
    const res = await request(app)
      .get("/api/area-feed")
      .query({ zip: ZIP_LOCAL })
      .set(as(users.caller));
    expect(res.status).toBe(200);
    const items = res.body.items as Array<{ id: number; kind: string; propertyName: string | null }>;
    const ids = items.map((i) => i.id);
    expect(ids).toContain(logCompletedByPlumber);
    // Success stories show up regardless of zip on the property.
    expect(ids).toContain(logSuccessStoryHvac);
    const completed = items.find((i) => i.id === logCompletedByPlumber);
    expect(completed?.kind).toBe("completed_job");
    expect(completed?.propertyName).toBe("Owner Home");
  });

  it("hides the property name for hidden success stories", async () => {
    // Use a high limit so the hidden story (which is older than the others)
    // is not pushed off the page by ordering.
    const res = await request(app)
      .get("/api/area-feed")
      .query({ zip: ZIP_LOCAL, limit: 50 })
      .set(as(users.caller));
    expect(res.status).toBe(200);
    const items = res.body.items as Array<{ id: number; propertyName: string | null }>;
    const hidden = items.find((i) => i.id === logHiddenStory);
    expect(hidden).toBeDefined();
    expect(hidden!.propertyName).toBeNull();
  });
});

describe("GET /success-stories/search", () => {
  it("returns visible stories and excludes hidden ones", async () => {
    const res = await request(app)
      .get("/api/success-stories/search")
      .set(as(users.caller));
    expect(res.status).toBe(200);
    const ids = (res.body.stories ?? []).map((s: { id: number }) => s.id);
    expect(ids).toContain(logSuccessStoryHvac);
    expect(ids).not.toContain(logHiddenStory);
  });

  it("expands synonyms in q (drywall ↔ sheetrock)", async () => {
    // Seed a story whose blurb uses 'drywall'; search 'sheetrock' must find it.
    const propId = await seedProperty({
      name: "Synonym Home",
      address: `1 Z St, NY ${ZIP_LOCAL}`,
      ownerClerkId: users.ownerHomeowner,
    });
    const drywallLogId = await seedLog({
      propertyId: propId,
      authorClerkId: users.ownerHomeowner,
      assigneeClerkId: users.proPlumber,
      status: "done",
      note: "Patched drywall in the hallway",
      completedAt: new Date(),
      isSuccessStory: true,
      successStoryAt: new Date(),
      successStoryBlurb: "Beautiful drywall patch job",
      successStoryServiceTag: "drywall",
    });

    const res = await request(app)
      .get("/api/success-stories/search")
      .query({ q: "sheetrock" })
      .set(as(users.caller));
    expect(res.status).toBe(200);
    const ids = (res.body.stories ?? []).map((s: { id: number }) => s.id);
    expect(ids).toContain(drywallLogId);
  });
});

describe("POST /logs/:logId/share-success", () => {
  it("rejects callers who are neither the assignee nor the author", async () => {
    const res = await request(app)
      .post(`/api/logs/${logUnrelated}/share-success`)
      .set(as(users.randomMember))
      .send({ blurb: "hi", serviceTag: "plumbing" });
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown log id", async () => {
    const res = await request(app)
      .post(`/api/logs/9999999/share-success`)
      .set(as(users.proPlumber))
      .send({});
    expect(res.status).toBe(404);
  });

  it("flips the log into a success story when called by the assigned pro", async () => {
    const res = await request(app)
      .post(`/api/logs/${logUnrelated}/share-success`)
      .set(as(users.proPlumber))
      .send({ blurb: "Cleaned the gutters spotless", serviceTag: "gutters" });
    expect(res.status).toBe(200);
    expect(res.body.isSuccessStory).toBe(true);
    expect(res.body.successStoryBlurb).toBe("Cleaned the gutters spotless");
    expect(res.body.successStoryServiceTag).toBe("gutters");
  });

  it("also lets the log author (not just the assignee) flip it into a story", async () => {
    // Author = ownerHomeowner here; assignee is left null so the only path
    // that can succeed is the author branch.
    const authorOnlyLog = await seedLog({
      propertyId: propertyOwnerId,
      authorClerkId: users.ownerHomeowner,
      assigneeClerkId: null,
      status: "done",
      note: "DIY win",
      completedAt: new Date(),
    });
    const res = await request(app)
      .post(`/api/logs/${authorOnlyLog}/share-success`)
      .set(as(users.ownerHomeowner))
      .send({ blurb: "Did it myself", serviceTag: "diy" });
    expect(res.status).toBe(200);
    expect(res.body.isSuccessStory).toBe(true);
    expect(res.body.successStoryBlurb).toBe("Did it myself");
  });
});

describe("POST /logs/:logId/hide-from-stories", () => {
  it("rejects non-owners / non-admins", async () => {
    const res = await request(app)
      .post(`/api/logs/${logCompletedByPlumber}/hide-from-stories`)
      .set(as(users.randomMember))
      .send({});
    expect(res.status).toBe(403);
  });

  it("allows the property owner to hide", async () => {
    const res = await request(app)
      .post(`/api/logs/${logCompletedByPlumber}/hide-from-stories`)
      .set(as(users.ownerHomeowner))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.successStoryHidden).toBe(true);
  });

  it("allows a property admin member to hide", async () => {
    // logUnrelated is on propertyOwnerId; create a separate log on the
    // admin-managed property and have the admin hide it.
    const adminLog = await seedLog({
      propertyId: propertyAdminId,
      authorClerkId: users.randomMember,
      assigneeClerkId: users.proPlumber,
      status: "done",
      note: "x",
      completedAt: new Date(),
      isSuccessStory: true,
      successStoryAt: new Date(),
    });
    const res = await request(app)
      .post(`/api/logs/${adminLog}/hide-from-stories`)
      .set(as(users.adminMember))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.successStoryHidden).toBe(true);
  });
});

describe("GET /deals/active", () => {
  it("returns local deals for the requested zip and falls back to nationwide", async () => {
    const res = await request(app)
      .get("/api/deals/active")
      .query({ zip: ZIP_LOCAL })
      .set(as(users.caller));
    expect(res.status).toBe(200);
    const headlines = (res.body.deals ?? []).map((d: { headline: string }) => d.headline);
    expect(headlines).toContain("Local plumbing special");
    expect(headlines).toContain("Nationwide HVAC tune-up");
  });

  it("returns only nationwide deals for a zip with no local matches", async () => {
    const res = await request(app)
      .get("/api/deals/active")
      .query({ zip: "77777" })
      .set(as(users.caller));
    expect(res.status).toBe(200);
    const headlines = (res.body.deals ?? []).map((d: { headline: string }) => d.headline);
    expect(headlines).not.toContain("Local plumbing special");
    expect(headlines).toContain("Nationwide HVAC tune-up");
  });

  it("excludes expired deals", async () => {
    const expiredDealId = await seedDeal({
      proClerkId: users.proLocalDeal,
      headline: "Expired thing",
      serviceTag: "plumbing",
      zips: [ZIP_LOCAL],
      startDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    const res = await request(app)
      .get("/api/deals/active")
      .query({ zip: ZIP_LOCAL })
      .set(as(users.caller));
    expect(res.status).toBe(200);
    const ids = (res.body.deals ?? []).map((d: { id: number }) => d.id);
    expect(ids).not.toContain(expiredDealId);
  });
});

describe("GET /deals/me", () => {
  it("returns only the caller's own deals", async () => {
    const res = await request(app).get("/api/deals/me").set(as(users.proLocalDeal));
    expect(res.status).toBe(200);
    const deals = res.body.deals ?? [];
    expect(deals.length).toBeGreaterThan(0);
    for (const d of deals) {
      expect(d.proClerkId).toBe(users.proLocalDeal);
    }
  });

  it("returns an empty list for a pro with no deals", async () => {
    const res = await request(app).get("/api/deals/me").set(as(users.proPainter));
    expect(res.status).toBe(200);
    expect(res.body.deals).toEqual([]);
  });
});

describe("POST/PUT/DELETE /deals", () => {
  it("rejects bodies that are missing required fields", async () => {
    const res = await request(app)
      .post("/api/deals")
      .set(as(users.proPainter))
      .send({ headline: "" });
    expect(res.status).toBe(400);
  });

  it("rejects deals that are neither nationwide nor scoped to a zip", async () => {
    const start = new Date().toISOString();
    const end = new Date(Date.now() + 86_400_000).toISOString();
    const res = await request(app)
      .post("/api/deals")
      .set(as(users.proPainter))
      .send({
        headline: "Painting promo",
        serviceTag: "painting",
        startDate: start,
        endDate: end,
        zips: [],
        nationwide: false,
      });
    expect(res.status).toBe(400);
  });

  it("creates a deal owned by the caller and lets the owner update and delete it", async () => {
    const start = new Date().toISOString();
    const end = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const create = await request(app)
      .post("/api/deals")
      .set(as(users.proPainter))
      .send({
        headline: "Spring paint sale",
        description: "20% off",
        serviceTag: "painting",
        startDate: start,
        endDate: end,
        zips: [ZIP_OTHER],
      });
    expect(create.status).toBe(201);
    expect(create.body.headline).toBe("Spring paint sale");
    expect(create.body.proClerkId).toBe(users.proPainter);
    const dealId = create.body.id as number;
    createdDeals.push(dealId);

    // Non-owner cannot update.
    const forbidden = await request(app)
      .put(`/api/deals/${dealId}`)
      .set(as(users.proPlumber))
      .send({ headline: "Hijack" });
    expect(forbidden.status).toBe(403);

    // Owner can update.
    const update = await request(app)
      .put(`/api/deals/${dealId}`)
      .set(as(users.proPainter))
      .send({
        headline: "Spring paint sale — extended",
        serviceTag: "painting",
        startDate: start,
        endDate: end,
        zips: [ZIP_OTHER],
      });
    expect(update.status).toBe(200);
    expect(update.body.headline).toBe("Spring paint sale — extended");

    // Non-owner cannot delete.
    const delForbidden = await request(app)
      .delete(`/api/deals/${dealId}`)
      .set(as(users.proPlumber));
    expect(delForbidden.status).toBe(403);

    // Owner can delete.
    const del = await request(app).delete(`/api/deals/${dealId}`).set(as(users.proPainter));
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);

    const [gone] = await db.select().from(dealsTable).where(eq(dealsTable.id, dealId));
    expect(gone).toBeUndefined();
  });

  it("returns 404 when updating or deleting an unknown deal", async () => {
    const upd = await request(app)
      .put("/api/deals/9999999")
      .set(as(users.proPainter))
      .send({ headline: "x" });
    expect(upd.status).toBe(404);
    const del = await request(app)
      .delete("/api/deals/9999999")
      .set(as(users.proPainter));
    expect(del.status).toBe(404);
  });
});

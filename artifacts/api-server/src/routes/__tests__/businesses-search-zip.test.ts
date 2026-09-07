/**
 * End-to-end tests for ZIP-based business search.
 *
 * Covers task #203: lock in the strict structured-ZIP matching behavior of
 * GET /api/businesses/search?zip=... so a future regression (e.g. losing the
 * additionalZips JSONB array branch, dropping the startup backfill, or
 * silently re-introducing a substring fallback against freeform region text)
 * is caught by tests.
 *
 * What this exercises:
 *   - Exact match against the structured `primaryZip` field
 *   - Membership match against the structured `additionalZips` JSONB array
 *   - Non-numeric / too-short / too-long ZIPs return zero matches (no
 *     freeform substring fallback)
 *   - A trade pro that has no structured ZIP at all is excluded from results,
 *     even if its freeform `region` text contains the digits being searched
 *   - The startup backfill (`backfillTradeProZips`) scrapes a 5-digit ZIP out
 *     of existing freeform `region` text and writes it to `primaryZip`,
 *     making the row discoverable via the strict ZIP search afterward.
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

const { db, usersTable, userModesTable } = await import("@workspace/db");
const usersRouter = (await import("../users")).default;
const { backfillTradeProZips } = await import("../../lib/backfillTradeProZips");

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", usersRouter);
  return app;
}

const tag = `t203-${Date.now()}`;
const ids = {
  caller: `${tag}-caller`,
  primaryMatch: `${tag}-primary`,
  additionalMatch: `${tag}-additional`,
  noMatch: `${tag}-nomatch`,
  unstructured: `${tag}-unstructured`,
  backfill: `${tag}-backfill`,
};

let app: Express;

async function seedUser(clerkId: string, name: string) {
  await db
    .insert(usersTable)
    .values({
      clerkId,
      email: `${clerkId}@example.test`,
      name,
      username: clerkId,
    })
    .onConflictDoNothing();
}

async function seedTradePro(
  clerkId: string,
  intake: Record<string, unknown>,
) {
  await db
    .insert(userModesTable)
    .values({
      userClerkId: clerkId,
      kind: "trade_pro",
      intakeData: intake,
    })
    .onConflictDoNothing();
}

beforeAll(async () => {
  app = makeApp();

  await Promise.all(
    Object.entries(ids).map(([role, id]) => seedUser(id, `${role}-${tag}`)),
  );

  // Pro whose primaryZip exactly matches the searched ZIP.
  await seedTradePro(ids.primaryMatch, {
    companyName: "Primary Plumbing",
    trade: "plumber",
    region: "Anytown area",
    primaryZip: "10001",
    additionalZips: ["20002"],
  });

  // Pro whose primaryZip differs but whose additionalZips array contains the
  // searched ZIP — this branch is the one most likely to regress silently.
  await seedTradePro(ids.additionalMatch, {
    companyName: "Additional HVAC",
    trade: "hvac",
    region: "Greater metro",
    primaryZip: "30003",
    additionalZips: ["40004", "10001", "50005"],
  });

  // Pro with structured ZIPs that don't match what we'll search for.
  await seedTradePro(ids.noMatch, {
    companyName: "Unrelated Electric",
    trade: "electrician",
    region: "Far away",
    primaryZip: "99999",
    additionalZips: ["88888"],
  });

  // Pro with no structured ZIPs at all — only freeform region text that
  // happens to contain the digits "10001". Must NOT show up: the endpoint
  // no longer falls back to substring matching on freeform text.
  await seedTradePro(ids.unstructured, {
    companyName: "Freeform Carpentry",
    trade: "carpenter",
    region: "Serves the 10001 area broadly",
    // primaryZip intentionally absent
  });

  // Pro that the backfill should later rescue: only freeform region text
  // contains a 5-digit ZIP, with no primaryZip stored.
  await seedTradePro(ids.backfill, {
    companyName: "Backfill Painting",
    trade: "painter",
    region: "Based out of 60606, downtown",
  });
});

afterAll(async () => {
  const clerkIds = Object.values(ids);
  await db.delete(userModesTable).where(inArray(userModesTable.userClerkId, clerkIds));
  for (const clerkId of clerkIds) {
    await db.delete(usersTable).where(eq(usersTable.clerkId, clerkId));
  }
});

function searchByZip(zip: string) {
  return request(app)
    .get("/api/businesses/search")
    .query({ zip })
    .set("x-test-user", ids.caller);
}

describe("GET /api/businesses/search?zip=... — strict structured ZIP matching", () => {
  it("matches a pro whose primaryZip equals the searched ZIP", async () => {
    const res = await searchByZip("10001");
    expect(res.status).toBe(200);
    const clerkIdsReturned = (res.body.businesses ?? []).map((b: { clerkId: string }) => b.clerkId);
    expect(clerkIdsReturned).toContain(ids.primaryMatch);
  });

  it("matches a pro whose additionalZips array contains the searched ZIP", async () => {
    const res = await searchByZip("10001");
    expect(res.status).toBe(200);
    const clerkIdsReturned = (res.body.businesses ?? []).map((b: { clerkId: string }) => b.clerkId);
    expect(clerkIdsReturned).toContain(ids.additionalMatch);
  });

  it("excludes a pro with no structured ZIPs even if the freeform region text contains the digits", async () => {
    const res = await searchByZip("10001");
    expect(res.status).toBe(200);
    const clerkIdsReturned = (res.body.businesses ?? []).map((b: { clerkId: string }) => b.clerkId);
    expect(clerkIdsReturned).not.toContain(ids.unstructured);
  });

  it("excludes pros whose structured ZIPs don't match", async () => {
    const res = await searchByZip("10001");
    expect(res.status).toBe(200);
    const clerkIdsReturned = (res.body.businesses ?? []).map((b: { clerkId: string }) => b.clerkId);
    expect(clerkIdsReturned).not.toContain(ids.noMatch);
  });

  it("returns no results for a non-numeric ZIP (no substring fallback)", async () => {
    const res = await searchByZip("abcde");
    expect(res.status).toBe(200);
    const clerkIdsReturned = (res.body.businesses ?? []).map((b: { clerkId: string }) => b.clerkId);
    for (const id of Object.values(ids)) {
      expect(clerkIdsReturned).not.toContain(id);
    }
  });

  it("returns no results for a too-short ZIP (e.g. 4 digits)", async () => {
    const res = await searchByZip("1000");
    expect(res.status).toBe(200);
    const clerkIdsReturned = (res.body.businesses ?? []).map((b: { clerkId: string }) => b.clerkId);
    for (const id of Object.values(ids)) {
      expect(clerkIdsReturned).not.toContain(id);
    }
  });

  it("returns no results for a too-long ZIP that is not a valid ZIP+4 (e.g. 6 raw digits)", async () => {
    // Important: "100016" must NOT be silently truncated to "10001" — the
    // route only accepts exactly 5 digits or full ZIP+4 form.
    const res = await searchByZip("100016");
    expect(res.status).toBe(200);
    const clerkIdsReturned = (res.body.businesses ?? []).map((b: { clerkId: string }) => b.clerkId);
    for (const id of Object.values(ids)) {
      expect(clerkIdsReturned).not.toContain(id);
    }
  });
});

describe("backfillTradeProZips — startup scrape from freeform region text", () => {
  it("scrapes a 5-digit ZIP out of freeform region text into primaryZip and makes the row discoverable", async () => {
    // Sanity check: before the backfill runs, the freeform-only pro is not
    // discoverable via strict ZIP search.
    const before = await searchByZip("60606");
    const beforeIds = (before.body.businesses ?? []).map((b: { clerkId: string }) => b.clerkId);
    expect(beforeIds).not.toContain(ids.backfill);

    const result = await backfillTradeProZips();
    expect(result.scanned).toBeGreaterThanOrEqual(1);
    expect(result.updated).toBeGreaterThanOrEqual(1);

    const [row] = await db
      .select({ intakeData: userModesTable.intakeData })
      .from(userModesTable)
      .where(eq(userModesTable.userClerkId, ids.backfill));
    const intake = (row?.intakeData ?? {}) as Record<string, unknown>;
    expect(intake.primaryZip).toBe("60606");
    expect(Array.isArray(intake.additionalZips)).toBe(true);

    // Now the same pro should be discoverable via strict ZIP search.
    const after = await searchByZip("60606");
    const afterIds = (after.body.businesses ?? []).map((b: { clerkId: string }) => b.clerkId);
    expect(afterIds).toContain(ids.backfill);
  });

  it("is idempotent: a second run does not re-touch rows that already have a primaryZip", async () => {
    // Capture the row state before the second run.
    const [before] = await db
      .select({ intakeData: userModesTable.intakeData })
      .from(userModesTable)
      .where(eq(userModesTable.userClerkId, ids.backfill));
    const beforeJson = JSON.stringify(before?.intakeData ?? {});

    await backfillTradeProZips();

    // The row already has a primaryZip, so the backfill must skip it entirely
    // — its intakeData must be byte-for-byte identical to before.
    const [after] = await db
      .select({ intakeData: userModesTable.intakeData })
      .from(userModesTable)
      .where(eq(userModesTable.userClerkId, ids.backfill));
    const afterJson = JSON.stringify(after?.intakeData ?? {});
    expect(afterJson).toBe(beforeJson);
    const intake = (after?.intakeData ?? {}) as Record<string, unknown>;
    expect(intake.primaryZip).toBe("60606");
  });
});

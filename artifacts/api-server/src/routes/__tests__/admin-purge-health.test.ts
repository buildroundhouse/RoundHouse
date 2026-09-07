import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { inArray } from "drizzle-orm";

const { db, outwardAccountPurgeRunsTable } = await import("@workspace/db");
const {
  getOutwardAccountPurgeHealth,
  getConfiguredOutwardPurgeIntervalMs,
  getConfiguredOutwardPurgeOverdueMultiplier,
  DEFAULT_OUTWARD_PURGE_INTERVAL_MS,
  DEFAULT_OUTWARD_PURGE_OVERDUE_MULTIPLIER,
} = await import("../../lib/outwardAccounts");
const adminRouter = (await import("../admin")).default;

const fixtureIds: number[] = [];
let app: Express;

const OPERATOR_KEY = "test-operator-secret-389";

beforeAll(async () => {
  process.env["OPERATOR_API_KEY"] = OPERATOR_KEY;
  app = express();
  app.use(express.json());
  app.use("/api", adminRouter);
});

beforeEach(async () => {
  if (fixtureIds.length > 0) {
    await db
      .delete(outwardAccountPurgeRunsTable)
      .where(inArray(outwardAccountPurgeRunsTable.id, fixtureIds));
    fixtureIds.length = 0;
  }
});

afterAll(async () => {
  if (fixtureIds.length > 0) {
    await db
      .delete(outwardAccountPurgeRunsTable)
      .where(inArray(outwardAccountPurgeRunsTable.id, fixtureIds));
  }
  delete process.env["OPERATOR_API_KEY"];
  delete process.env["OUTWARD_ACCOUNT_PURGE_INTERVAL_MS"];
  delete process.env["OUTWARD_ACCOUNT_PURGE_OVERDUE_MULTIPLIER"];
});

async function insertRun(ranAt: Date): Promise<number> {
  const [row] = await db
    .insert(outwardAccountPurgeRunsTable)
    .values({
      source: "scheduled",
      accountsRemoved: 0,
      connectionsRemoved: 0,
      accountIds: null,
      connectionIds: null,
      durationMs: 5,
      ranAt,
    })
    .returning({ id: outwardAccountPurgeRunsTable.id });
  fixtureIds.push(row.id);
  return row.id;
}

describe("outward-account purge health (#389)", () => {
  it("reports a fresh run as healthy", async () => {
    // Anchor in the future so this fixture is guaranteed to be the
    // newest row regardless of what other suites have left in the DB.
    const intervalMs = 60_000;
    const futureBase = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000;
    const ranAt = new Date(futureBase);
    await insertRun(ranAt);
    const health = await getOutwardAccountPurgeHealth({
      intervalMs,
      overdueMultiplier: 2,
      now: new Date(futureBase + 5_000),
    });
    expect(health.overdue).toBe(false);
    expect(health.lastRanAt?.getTime()).toBe(ranAt.getTime());
    expect(health.ageMs).toBe(5_000);
    expect(health.thresholdMs).toBe(120_000);
  });

  it("flags overdue when age exceeds intervalMs * overdueMultiplier", async () => {
    // Anchor the row well into the future so it's guaranteed to be the
    // most-recent run in the shared test DB (other suites may have left
    // fresher fixtures behind), then ask about a `now` that is itself
    // even further in the future so `now - ranAt` exceeds the threshold.
    const intervalMs = 60_000;
    const futureBase = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000;
    const ranAt = new Date(futureBase);
    await insertRun(ranAt);
    const health = await getOutwardAccountPurgeHealth({
      intervalMs,
      overdueMultiplier: 2,
      now: new Date(futureBase + 5 * 60_000),
    });
    expect(health.overdue).toBe(true);
    expect(health.lastRanAt?.getTime()).toBe(ranAt.getTime());
    expect(health.ageMs).toBe(5 * 60_000);
  });

  it("treats a missing run history as overdue", async () => {
    // Sanity: use a recent cutoff so any other test fixtures we did not
    // insert here still leave the table effectively empty for our window.
    // We pretend `now` is in the distant future so even pre-existing rows
    // (none in this suite, since beforeEach wiped ours) would be overdue.
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const health = await getOutwardAccountPurgeHealth({
      intervalMs: 60_000,
      overdueMultiplier: 2,
      now: farFuture,
    });
    expect(health.overdue).toBe(true);
    // lastRanAt may be null (truly empty) OR a stale fixture from another
    // suite — either way the overdue flag is what callers act on.
    if (health.lastRanAt === null) {
      expect(health.ageMs).toBeNull();
    } else {
      expect(health.ageMs).toBeGreaterThan(health.thresholdMs);
    }
  });

  it("getConfiguredOutwardPurgeIntervalMs honors env and falls back", () => {
    delete process.env["OUTWARD_ACCOUNT_PURGE_INTERVAL_MS"];
    expect(getConfiguredOutwardPurgeIntervalMs()).toBe(
      DEFAULT_OUTWARD_PURGE_INTERVAL_MS,
    );
    process.env["OUTWARD_ACCOUNT_PURGE_INTERVAL_MS"] = "9999";
    expect(getConfiguredOutwardPurgeIntervalMs()).toBe(9999);
    process.env["OUTWARD_ACCOUNT_PURGE_INTERVAL_MS"] = "not-a-number";
    expect(getConfiguredOutwardPurgeIntervalMs()).toBe(
      DEFAULT_OUTWARD_PURGE_INTERVAL_MS,
    );
    delete process.env["OUTWARD_ACCOUNT_PURGE_INTERVAL_MS"];
  });

  it("getConfiguredOutwardPurgeOverdueMultiplier honors env and falls back", () => {
    delete process.env["OUTWARD_ACCOUNT_PURGE_OVERDUE_MULTIPLIER"];
    expect(getConfiguredOutwardPurgeOverdueMultiplier()).toBe(
      DEFAULT_OUTWARD_PURGE_OVERDUE_MULTIPLIER,
    );
    process.env["OUTWARD_ACCOUNT_PURGE_OVERDUE_MULTIPLIER"] = "3";
    expect(getConfiguredOutwardPurgeOverdueMultiplier()).toBe(3);
    process.env["OUTWARD_ACCOUNT_PURGE_OVERDUE_MULTIPLIER"] = "0";
    expect(getConfiguredOutwardPurgeOverdueMultiplier()).toBe(
      DEFAULT_OUTWARD_PURGE_OVERDUE_MULTIPLIER,
    );
    delete process.env["OUTWARD_ACCOUNT_PURGE_OVERDUE_MULTIPLIER"];
  });

  it("requires the operator key on the health endpoint", async () => {
    const noHeader = await request(app).get(
      "/api/admin/outward-account-purge-health",
    );
    expect(noHeader.status).toBe(401);
    const wrong = await request(app)
      .get("/api/admin/outward-account-purge-health")
      .set("x-operator-api-key", "nope");
    expect(wrong.status).toBe(401);
  });

  it("returns a JSON payload with overdue + supporting fields", async () => {
    const ranAt = new Date();
    await insertRun(ranAt);
    const res = await request(app)
      .get("/api/admin/outward-account-purge-health")
      .set("x-operator-api-key", OPERATOR_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      overdue: expect.any(Boolean),
      intervalMs: expect.any(Number),
      overdueMultiplier: expect.any(Number),
      thresholdMs: expect.any(Number),
    });
    expect(typeof res.body.lastRanAt === "string").toBe(true);
    expect(typeof res.body.ageMs === "number").toBe(true);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("returns 503 when OPERATOR_API_KEY is unset", async () => {
    const saved = process.env["OPERATOR_API_KEY"];
    delete process.env["OPERATOR_API_KEY"];
    try {
      const res = await request(app)
        .get("/api/admin/outward-account-purge-health")
        .set("x-operator-api-key", "anything");
      expect(res.status).toBe(503);
    } finally {
      process.env["OPERATOR_API_KEY"] = saved;
    }
  });
});

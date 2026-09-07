import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { inArray, eq } from "drizzle-orm";

const { db, outwardAccountPurgeRunsTable } = await import("@workspace/db");
const {
  listRecentOutwardAccountPurgeRuns,
  purgeExpiredOutwardAccounts,
  PURGE_RUN_RETENTION_DAYS_DEFAULT,
} = await import("../../lib/outwardAccounts");
const adminRouter = (await import("../admin")).default;

const fixtureIds: number[] = [];
let app: Express;

beforeAll(async () => {
  process.env["OPERATOR_API_KEY"] = "test-operator-secret-364";

  const now = Date.now();
  const rows = await db
    .insert(outwardAccountPurgeRunsTable)
    .values([
      {
        source: "scheduled",
        accountsRemoved: 0,
        connectionsRemoved: 0,
        accountIds: null,
        connectionIds: null,
        durationMs: 12,
        ranAt: new Date(now - 60_000),
      },
      {
        source: "script",
        accountsRemoved: 2,
        connectionsRemoved: 3,
        accountIds: [101, 102],
        connectionIds: [201, 202, 203],
        durationMs: 47,
        ranAt: new Date(now - 30_000),
      },
      {
        source: "api",
        accountsRemoved: 1,
        connectionsRemoved: 0,
        accountIds: [103],
        connectionIds: null,
        durationMs: 8,
        ranAt: new Date(now),
      },
    ])
    .returning({ id: outwardAccountPurgeRunsTable.id });
  fixtureIds.push(...rows.map((r) => r.id));

  app = express();
  app.use(express.json());
  app.use("/api", adminRouter);
});

afterAll(async () => {
  if (fixtureIds.length > 0) {
    await db
      .delete(outwardAccountPurgeRunsTable)
      .where(inArray(outwardAccountPurgeRunsTable.id, fixtureIds));
  }
  delete process.env["OPERATOR_API_KEY"];
});

describe("outward-account purge run history (#364)", () => {
  it("lists runs newest-first with persisted ids round-tripping through jsonb", async () => {
    const runs = await listRecentOutwardAccountPurgeRuns(500);
    const ours = runs.filter((r) => fixtureIds.includes(r.id));
    expect(ours).toHaveLength(3);
    for (let i = 1; i < ours.length; i++) {
      expect(ours[i - 1].ranAt.getTime()).toBeGreaterThanOrEqual(
        ours[i].ranAt.getTime(),
      );
    }
    const scriptRow = ours.find((r) => r.source === "script")!;
    expect(scriptRow.accountIds).toEqual([101, 102]);
    expect(scriptRow.connectionIds).toEqual([201, 202, 203]);
    expect(scriptRow.accountsRemoved).toBe(2);
    expect(scriptRow.connectionsRemoved).toBe(3);

    const noopRow = ours.find((r) => r.source === "scheduled")!;
    expect(noopRow.accountIds).toBeNull();
    expect(noopRow.connectionIds).toBeNull();
  });

  it("clamps the limit to a sane range", async () => {
    const tiny = await listRecentOutwardAccountPurgeRuns(0);
    expect(tiny.length).toBe(1);
  });

  it("requires the operator API key", async () => {
    const noHeader = await request(app).get("/api/admin/outward-account-purge-runs");
    expect(noHeader.status).toBe(401);

    const wrong = await request(app)
      .get("/api/admin/outward-account-purge-runs")
      .set("x-operator-api-key", "nope");
    expect(wrong.status).toBe(401);
  });

  it("returns recent runs when authenticated", async () => {
    const res = await request(app)
      .get("/api/admin/outward-account-purge-runs?limit=500")
      .set("x-operator-api-key", "test-operator-secret-364");
    expect(res.status).toBe(200);
    const ours = res.body.runs.filter((r: { id: number }) =>
      fixtureIds.includes(r.id),
    );
    expect(ours.length).toBe(3);
    for (let i = 1; i < ours.length; i++) {
      expect(new Date(ours[i - 1].ranAt).getTime()).toBeGreaterThanOrEqual(
        new Date(ours[i].ranAt).getTime(),
      );
    }
    const sample = ours[0];
    expect(sample).toMatchObject({
      id: expect.any(Number),
      source: expect.any(String),
      accountsRemoved: expect.any(Number),
      connectionsRemoved: expect.any(Number),
      runsTrimmed: expect.any(Number),
      durationMs: expect.any(Number),
    });
    expect(sample.ranAt).toBeTruthy();
  });

  it("persists per-run runsTrimmed and surfaces it through the list endpoint (#394)", async () => {
    // Seed an ancient row that the next sweep is guaranteed to trim,
    // so we can assert the resulting audit row records a non-zero
    // runsTrimmed and that the same value is visible through the
    // operator list endpoint.
    const ancientAt = new Date(
      Date.now() - (PURGE_RUN_RETENTION_DAYS_DEFAULT + 30) * 24 * 60 * 60 * 1000,
    );
    const [ancient] = await db
      .insert(outwardAccountPurgeRunsTable)
      .values({
        source: "scheduled",
        accountsRemoved: 0,
        connectionsRemoved: 0,
        accountIds: null,
        connectionIds: null,
        durationMs: 1,
        ranAt: ancientAt,
      })
      .returning({ id: outwardAccountPurgeRunsTable.id });

    let newRunId: number | undefined;
    try {
      const result = await purgeExpiredOutwardAccounts({ source: "scheduled" });
      newRunId = result.runId;
      expect(result.runsTrimmed).toBeGreaterThanOrEqual(1);

      // Round-trip via the lib helper.
      const [persisted] = await db
        .select()
        .from(outwardAccountPurgeRunsTable)
        .where(eq(outwardAccountPurgeRunsTable.id, result.runId));
      expect(persisted.runsTrimmed).toBe(result.runsTrimmed);

      // Round-trip via the HTTP list endpoint operators actually hit.
      const res = await request(app)
        .get("/api/admin/outward-account-purge-runs?limit=500")
        .set("x-operator-api-key", "test-operator-secret-364");
      expect(res.status).toBe(200);
      const surfaced = res.body.runs.find(
        (r: { id: number }) => r.id === result.runId,
      );
      expect(surfaced).toBeDefined();
      expect(surfaced.runsTrimmed).toBe(result.runsTrimmed);
    } finally {
      if (newRunId != null) {
        await db
          .delete(outwardAccountPurgeRunsTable)
          .where(eq(outwardAccountPurgeRunsTable.id, newRunId));
      }
      await db
        .delete(outwardAccountPurgeRunsTable)
        .where(eq(outwardAccountPurgeRunsTable.id, ancient.id));
    }
  });

  it("rejects a non-numeric limit", async () => {
    const res = await request(app)
      .get("/api/admin/outward-account-purge-runs?limit=abc")
      .set("x-operator-api-key", "test-operator-secret-364");
    expect(res.status).toBe(400);
  });

  it("trims audit rows older than the retention window and reports the count", async () => {
    // Seed two rows: one safely inside the default retention window
    // (yesterday) and one well past it (200 days back). After a sweep
    // with the default retention, the old row should be gone and the
    // recent one should remain.
    const now = Date.now();
    const seeded = await db
      .insert(outwardAccountPurgeRunsTable)
      .values([
        {
          source: "scheduled",
          accountsRemoved: 0,
          connectionsRemoved: 0,
          accountIds: null,
          connectionIds: null,
          durationMs: 1,
          ranAt: new Date(now - 24 * 60 * 60 * 1000),
        },
        {
          source: "scheduled",
          accountsRemoved: 0,
          connectionsRemoved: 0,
          accountIds: null,
          connectionIds: null,
          durationMs: 1,
          ranAt: new Date(
            now - (PURGE_RUN_RETENTION_DAYS_DEFAULT + 110) * 24 * 60 * 60 * 1000,
          ),
        },
      ])
      .returning({ id: outwardAccountPurgeRunsTable.id });
    const recentId = seeded[0].id;
    const ancientId = seeded[1].id;

    try {
      const result = await purgeExpiredOutwardAccounts({ source: "scheduled" });
      expect(result.runsTrimmed).toBeGreaterThanOrEqual(1);
      expect(typeof result.runId).toBe("number");

      const remaining = await db
        .select({ id: outwardAccountPurgeRunsTable.id })
        .from(outwardAccountPurgeRunsTable)
        .where(inArray(outwardAccountPurgeRunsTable.id, [recentId, ancientId]));
      const remainingIds = new Set(remaining.map((r) => r.id));
      expect(remainingIds.has(recentId)).toBe(true);
      expect(remainingIds.has(ancientId)).toBe(false);

      // The new audit row this sweep wrote should also be present.
      const newRow = await db
        .select({ id: outwardAccountPurgeRunsTable.id })
        .from(outwardAccountPurgeRunsTable)
        .where(eq(outwardAccountPurgeRunsTable.id, result.runId));
      expect(newRow).toHaveLength(1);

      // Cleanup the new row this sweep wrote so we don't leak fixtures.
      await db
        .delete(outwardAccountPurgeRunsTable)
        .where(eq(outwardAccountPurgeRunsTable.id, result.runId));
    } finally {
      await db
        .delete(outwardAccountPurgeRunsTable)
        .where(inArray(outwardAccountPurgeRunsTable.id, [recentId, ancientId]));
    }
  });

  it("respects an explicit runRetentionDays override", async () => {
    // Two rows: one 5 days old (should survive a 10-day window) and
    // one 30 days old (should be trimmed by a 10-day window).
    const now = Date.now();
    const seeded = await db
      .insert(outwardAccountPurgeRunsTable)
      .values([
        {
          source: "scheduled",
          accountsRemoved: 0,
          connectionsRemoved: 0,
          accountIds: null,
          connectionIds: null,
          durationMs: 1,
          ranAt: new Date(now - 5 * 24 * 60 * 60 * 1000),
        },
        {
          source: "scheduled",
          accountsRemoved: 0,
          connectionsRemoved: 0,
          accountIds: null,
          connectionIds: null,
          durationMs: 1,
          ranAt: new Date(now - 30 * 24 * 60 * 60 * 1000),
        },
      ])
      .returning({ id: outwardAccountPurgeRunsTable.id });
    const youngId = seeded[0].id;
    const oldId = seeded[1].id;

    try {
      const result = await purgeExpiredOutwardAccounts({
        source: "scheduled",
        runRetentionDays: 10,
      });
      expect(result.runsTrimmed).toBeGreaterThanOrEqual(1);

      const remaining = await db
        .select({ id: outwardAccountPurgeRunsTable.id })
        .from(outwardAccountPurgeRunsTable)
        .where(inArray(outwardAccountPurgeRunsTable.id, [youngId, oldId]));
      const remainingIds = new Set(remaining.map((r) => r.id));
      expect(remainingIds.has(youngId)).toBe(true);
      expect(remainingIds.has(oldId)).toBe(false);

      await db
        .delete(outwardAccountPurgeRunsTable)
        .where(eq(outwardAccountPurgeRunsTable.id, result.runId));
    } finally {
      await db
        .delete(outwardAccountPurgeRunsTable)
        .where(inArray(outwardAccountPurgeRunsTable.id, [youngId, oldId]));
    }
  });

  it("serves the operator dashboard HTML page when authenticated (#391)", async () => {
    const res = await request(app)
      .get("/api/admin/dashboard")
      .set("x-operator-api-key", "test-operator-secret-364");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.text).toContain("Outward-account purge runs");
    expect(res.text).toContain("outward-account-purge-runs");
  });

  it("also accepts HTTP Basic auth on the dashboard page (#391)", async () => {
    const basic = Buffer.from("ops:test-operator-secret-364").toString("base64");
    const res = await request(app)
      .get("/api/admin/dashboard")
      .set("authorization", "Basic " + basic);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Outward-account purge runs");
  });

  it("rejects the dashboard page without operator credentials (#391)", async () => {
    const noHeader = await request(app).get("/api/admin/dashboard");
    expect(noHeader.status).toBe(401);
    // Browsers need this header to know to prompt for credentials.
    expect(noHeader.headers["www-authenticate"]).toMatch(/^Basic /);

    const wrongHeader = await request(app)
      .get("/api/admin/dashboard")
      .set("x-operator-api-key", "nope");
    expect(wrongHeader.status).toBe(401);

    const wrongBasic = Buffer.from("ops:wrong").toString("base64");
    const wrongBasicRes = await request(app)
      .get("/api/admin/dashboard")
      .set("authorization", "Basic " + wrongBasic);
    expect(wrongBasicRes.status).toBe(401);
  });

  it("returns 503 from the dashboard page when OPERATOR_API_KEY is unset", async () => {
    const saved = process.env["OPERATOR_API_KEY"];
    delete process.env["OPERATOR_API_KEY"];
    try {
      const res = await request(app)
        .get("/api/admin/dashboard")
        .set("x-operator-api-key", "anything");
      expect(res.status).toBe(503);
    } finally {
      process.env["OPERATOR_API_KEY"] = saved;
    }
  });

  it("returns 503 when OPERATOR_API_KEY is unset", async () => {
    const saved = process.env["OPERATOR_API_KEY"];
    delete process.env["OPERATOR_API_KEY"];
    try {
      const res = await request(app)
        .get("/api/admin/outward-account-purge-runs")
        .set("x-operator-api-key", "anything");
      expect(res.status).toBe(503);
    } finally {
      process.env["OPERATOR_API_KEY"] = saved;
    }
  });
});

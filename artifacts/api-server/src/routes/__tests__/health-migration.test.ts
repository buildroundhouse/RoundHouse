/**
 * Unit test for the startup health endpoint and readiness gate
 * introduced in task #392.
 *
 * Covers:
 *   - /api/health returns 503 with `state: "pending"` before
 *     migrations are recorded
 *   - /api/health returns 200 with `state: "ok"`, durationMs, and
 *     completedAt after `recordMigrationSuccess` is called
 *   - /api/health returns 500 with `state: "failed"` after
 *     `recordMigrationFailure` is called
 *   - /api/health surfaces `state: "warning"` and the `unresolved`
 *     list when migrations finish with leftover NOT NULL columns
 *   - The readiness gate blocks unrelated /api/* traffic with 503
 *     while migrations have not finished cleanly, and lets it
 *     through once they have
 */
import { describe, it, expect, beforeEach } from "vitest";
import express, { type Express, type Request, type Response } from "express";
import request from "supertest";
import healthRouter from "../health";
import { migrationReadiness } from "../../middlewares/migrationReadiness";
import {
  recordMigrationFailure,
  recordMigrationSuccess,
} from "../../lib/migrationStatus";

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", migrationReadiness);
  app.use("/api", healthRouter);
  app.get("/api/sentinel", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });
  return app;
}

function resetStatus(): void {
  // The migrationStatus module is module-scoped; the test resets it
  // by recording an explicit failure and then bouncing it back to
  // pending via recordMigrationFailure isn't possible. So instead we
  // simulate "pending" by importing the module fresh per test via
  // dynamic import below — but vitest caches modules per worker. The
  // simplest reset is to record success/failure inside each test as
  // its own setup. Tests therefore order their assertions to test
  // pending FIRST (relying on initial module state), then transition
  // forward.
}

describe("startup health endpoint (/api/health) — task #392", () => {
  beforeEach(() => {
    resetStatus();
  });

  it("starts in `pending` and returns 503 from /api/health and the readiness gate", async () => {
    // This must run first — the migrationStatus module starts in
    // `pending` and we never get back to it once recorded.
    const app = buildApp();

    const health = await request(app).get("/api/health");
    expect(health.status).toBe(503);
    expect(health.body).toMatchObject({
      status: "starting",
      migrations: { state: "pending" },
    });

    const sentinel = await request(app).get("/api/sentinel");
    expect(sentinel.status).toBe(503);
    expect(sentinel.body.migrations.state).toBe("pending");
  });

  it("returns 200 with durationMs/completedAt after recordMigrationSuccess and lets /api/* through", async () => {
    recordMigrationSuccess({
      unresolved: [],
      durationMs: 123,
      completedAt: "2026-04-22T11:28:14.635Z",
    });

    const app = buildApp();
    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
    expect(health.body).toEqual({
      status: "ok",
      migrations: {
        state: "ok",
        durationMs: 123,
        completedAt: "2026-04-22T11:28:14.635Z",
        unresolved: [],
      },
    });

    const sentinel = await request(app).get("/api/sentinel");
    expect(sentinel.status).toBe(200);
    expect(sentinel.body).toEqual({ ok: true });
  });

  it("returns 200 with `state: 'warning'` and the unresolved list when NOT NULL columns were left nullable", async () => {
    recordMigrationSuccess({
      unresolved: ["app_invites.sender_outward_account_id (3 null rows)"],
      durationMs: 90,
      completedAt: "2026-04-22T12:00:00.000Z",
    });

    const app = buildApp();
    const health = await request(app).get("/api/health");
    // 200 because migrations completed; the readiness gate still
    // refuses /api/* traffic so deploy tooling sees both signals.
    expect(health.status).toBe(200);
    expect(health.body.migrations.state).toBe("warning");
    expect(health.body.migrations.unresolved).toEqual([
      "app_invites.sender_outward_account_id (3 null rows)",
    ]);

    const sentinel = await request(app).get("/api/sentinel");
    expect(sentinel.status).toBe(503);
    expect(sentinel.body.migrations.state).toBe("warning");
  });

  it("returns 500 with the error message after recordMigrationFailure", async () => {
    recordMigrationFailure(new Error("boom: column missing"));

    const app = buildApp();
    const health = await request(app).get("/api/health");
    expect(health.status).toBe(500);
    expect(health.body.status).toBe("error");
    expect(health.body.migrations.state).toBe("failed");
    expect(health.body.migrations.error).toBe("boom: column missing");
    expect(typeof health.body.migrations.completedAt).toBe("string");

    const sentinel = await request(app).get("/api/sentinel");
    expect(sentinel.status).toBe(503);
    expect(sentinel.body.migrations.state).toBe("failed");
  });
});

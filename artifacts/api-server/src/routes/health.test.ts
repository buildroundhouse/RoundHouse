import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const migration = vi.hoisted(() => ({ state: "pending" }));
vi.mock("../lib/migrationStatus", () => ({ getMigrationStatus: () => migration }));
import healthRouter from "./health";
import { migrationReadiness } from "../middlewares/migrationReadiness";

describe("hosted readiness matches the API gate", () => {
  it.each([
    ["pending", 503, 503],
    ["failed", 500, 503],
    ["warning", 503, 503],
    ["ok", 200, 200],
  ] as const)("reports %s consistently", async (state, healthCode, apiCode) => {
    migration.state = state;
    const app = express();
    app.use("/api", migrationReadiness);
    app.use("/api", healthRouter);
    app.get("/api/ready-example", (_req, res) => res.json({ ready: true }));
    const response = await request(app).get("/api/health").expect(healthCode);
    expect(response.body.migrations.state).toBe(state);
    await request(app).get("/api/ready-example").expect(apiCode);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

const adminRouter = (await import("../admin")).default;

const OPERATOR_KEY = "test-operator-secret-401";
let app: Express;
const PRIOR_OPERATOR_KEY = process.env["OPERATOR_API_KEY"];

beforeAll(() => {
  process.env["OPERATOR_API_KEY"] = OPERATOR_KEY;
  app = express();
  app.use(express.json());
  app.use("/api", adminRouter);
});

afterAll(() => {
  if (PRIOR_OPERATOR_KEY === undefined) {
    delete process.env["OPERATOR_API_KEY"];
  } else {
    process.env["OPERATOR_API_KEY"] = PRIOR_OPERATOR_KEY;
  }
});

describe("operator purge dashboard runsTrimmed column (#401)", () => {
  it("requires the operator credential to view the dashboard", async () => {
    // The dashboard page itself sits behind the same operator gate as
    // the JSON endpoints (#391), so an unauthenticated request must
    // get a 401 with a Basic challenge — not the HTML.
    const res = await request(app).get("/api/admin/dashboard");
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toMatch(/Basic/i);
  });

  it("renders the dashboard HTML when authenticated", async () => {
    const res = await request(app)
      .get("/api/admin/dashboard")
      .set("x-operator-api-key", OPERATOR_KEY);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.text).toMatch(/<!doctype html>/i);
    expect(res.text).toContain("Outward-account purge runs");
  });

  it("includes a 'Trimmed' column wired to the runsTrimmed JSON field", async () => {
    // The whole point of #401: surface the per-run runsTrimmed count
    // the API persists, alongside the existing accounts/connections
    // columns. This guards against silently regressing back to the
    // pre-#401 layout that hid the field.
    const res = await request(app)
      .get("/api/admin/dashboard")
      .set("x-operator-api-key", OPERATOR_KEY);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/data-key="runsTrimmed"/);
    expect(res.text).toContain(">Trimmed<");
    // The renderer must read the same field name the JSON endpoint
    // emits, so a rename on either side breaks this test rather than
    // silently rendering blanks.
    expect(res.text).toContain("r.runsTrimmed");
  });

  it("renders zero/empty trimmed counts cleanly via fmtTrimmed", async () => {
    // Acceptance criterion from the task: empty/zero values render
    // cleanly. The fmtTrimmed helper is what does that, so its
    // presence (and its zero-collapsing branch) is what we assert.
    const res = await request(app)
      .get("/api/admin/dashboard")
      .set("x-operator-api-key", OPERATOR_KEY);
    expect(res.status).toBe(200);
    expect(res.text).toContain("function fmtTrimmed");
    expect(res.text).toMatch(/\(n \| 0\) === 0/);
  });

  it("redirects the legacy /dashboard/purge-runs URL to the canonical dashboard (#407)", async () => {
    // The legacy URL used to reference an undefined constant and 500
    // on every hit. It must now permanently redirect to /admin/dashboard
    // so existing operator bookmarks/docs keep working. The redirect
    // itself is unauthenticated — the destination is what enforces the
    // operator gate.
    const res = await request(app).get("/api/admin/dashboard/purge-runs");
    expect(res.status).toBe(301);
    expect(res.headers["location"]).toBe("/api/admin/dashboard");

    // Same URL with the operator credential must also redirect (not
    // 500), matching the task's acceptance criterion that authenticated
    // operators get 200/301 from the legacy URL.
    const authed = await request(app)
      .get("/api/admin/dashboard/purge-runs")
      .set("x-operator-api-key", OPERATOR_KEY);
    expect(authed.status).toBe(301);
    expect(authed.headers["location"]).toBe("/api/admin/dashboard");
  });

  it("keeps the table colspan in sync with the new column count", async () => {
    // The empty-state and detail rows used colspan="6" before #401.
    // Adding a 7th column requires bumping both, otherwise the empty
    // state and the expand-detail row visually break.
    const res = await request(app)
      .get("/api/admin/dashboard")
      .set("x-operator-api-key", OPERATOR_KEY);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('colspan="6"');
    expect(res.text).toContain('colspan="7"');
  });
});

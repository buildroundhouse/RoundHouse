import type { RequestHandler } from "express";
import { getMigrationStatus } from "../lib/migrationStatus";

/**
 * Readiness gate: when boot-time migrations have not finished cleanly,
 * reject all `/api/*` traffic with 503 so we never serve responses
 * against a degraded schema. The two health probes (`/healthz` and
 * `/health`) are explicitly allowed through so deploy tooling can still
 * observe what state the server is in. See task #392.
 */
const ALLOW = new Set(["/healthz", "/health"]);

export const migrationReadiness: RequestHandler = (req, res, next) => {
  if (ALLOW.has(req.path)) {
    next();
    return;
  }
  const status = getMigrationStatus();
  if (status.state === "ok") {
    next();
    return;
  }
  if (status.state === "pending") {
    res
      .status(503)
      .set("Retry-After", "5")
      .json({
        error: "Server is still starting; database migrations have not finished",
        migrations: status,
      });
    return;
  }
  // failed | warning — both indicate a degraded schema we refuse to
  // serve traffic against. /api/health will still return the detail.
  res.status(503).json({
    error: "Server is degraded; database migrations did not complete cleanly",
    migrations: status,
  });
};

import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getMigrationStatus } from "../lib/migrationStatus";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Startup health endpoint (#392). Surfaces whether the boot-time
// database migration succeeded, how long it took, and any "left
// nullable" warnings the migrate step reported. Deliberately lives
// outside the OpenAPI spec — deploy tooling and uptime checks probe
// it directly. The endpoint returns:
//   200 — migrations completed cleanly (`state: "ok"`)
//   503 — migrations are still running (`state: "pending"`)
//   500 — migrations failed during startup (`state: "failed"`)
// Note: index.ts refuses to start the server when any required
// NOT NULL column was left nullable, so a reachable /health will
// always show `unresolved: []`.
router.get("/health", (_req, res) => {
  const migrations = getMigrationStatus();
  if (migrations.state === "pending") {
    res.status(503).json({ status: "starting", migrations });
    return;
  }
  if (migrations.state === "failed") {
    res.status(500).json({ status: "error", migrations });
    return;
  }
  res.status(200).json({ status: "ok", migrations });
});

export default router;

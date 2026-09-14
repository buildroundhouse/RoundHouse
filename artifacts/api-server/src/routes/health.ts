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
// Schema warnings also return 503: the API gate refuses traffic until
// required backfills are resolved. Only a clean schema is ready.
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
  if (migrations.state === "warning") {
    res.status(503).json({ status: "degraded", migrations });
    return;
  }
  res.status(200).json({ status: "ok", migrations });
});

export default router;

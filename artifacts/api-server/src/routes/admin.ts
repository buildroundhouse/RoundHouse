import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  getOutwardAccountPurgeHealth,
  listRecentOutwardAccountPurgeRuns,
  purgeExpiredOutwardAccounts,
} from "../lib/outwardAccounts";
import { renderPurgeDashboardHtml } from "./adminDashboardHtml";

const router: IRouter = Router();

/**
 * Operator/admin routes are gated by a shared secret rather than the
 * normal Clerk-based auth because they're called by humans on the ops
 * side (CLI, dashboard, monitoring) and don't have a per-user session.
 *
 * Set OPERATOR_API_KEY in the environment to enable these endpoints.
 * If unset, every admin route returns 503 — that's intentional, so a
 * misconfigured deploy fails closed instead of silently exposing
 * operator data.
 *
 * Credentials are accepted via either the dedicated `x-operator-api-key`
 * header (for scripts, curl, and the dashboard's fetch calls) or HTTP
 * Basic auth (so an operator can paste the dashboard URL into a browser
 * and get the native auth prompt; the browser then automatically replays
 * those credentials on subsequent same-origin fetches). For Basic auth
 * the username is ignored; only the password is checked.
 */
function extractOperatorCredential(req: Request): string | null {
  const headerVal = req.header("x-operator-api-key");
  if (typeof headerVal === "string" && headerVal.length > 0) return headerVal;
  const auth = req.header("authorization");
  if (typeof auth === "string" && auth.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(auth.slice(6).trim(), "base64").toString(
        "utf8",
      );
      const idx = decoded.indexOf(":");
      if (idx >= 0) return decoded.slice(idx + 1);
    } catch {
      return null;
    }
  }
  return null;
}

function requireOperator(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env["OPERATOR_API_KEY"];
  if (!expected) {
    res.status(503).json({
      error: "Operator API is not configured. Set OPERATOR_API_KEY to enable.",
    });
    return;
  }
  const provided = extractOperatorCredential(req);
  if (provided !== expected) {
    // Advertise Basic so browsers know to prompt for credentials when
    // an operator visits the dashboard URL directly.
    res.setHeader("WWW-Authenticate", 'Basic realm="Operator", charset="UTF-8"');
    res.status(401).json({ error: "Invalid operator credentials" });
    return;
  }
  next();
}

/**
 * Recent history of outward-account purge runs (#364). Replaces the
 * "grep INFO lines across hosts" workflow operators had to do after
 * #344 added the sweep — they hit this endpoint and see when each
 * run fired, what triggered it, and exactly which rows were removed.
 *
 * Optional `?limit=N` query (default 50, capped at 500).
 */
router.get(
  "/admin/outward-account-purge-runs",
  requireOperator,
  async (req, res): Promise<void> => {
    const rawLimit = req.query["limit"];
    let limit: number | undefined;
    if (typeof rawLimit === "string" && rawLimit.length > 0) {
      const parsed = Number(rawLimit);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        res.status(400).json({ error: "limit must be a positive number" });
        return;
      }
      limit = parsed;
    }
    const runs = await listRecentOutwardAccountPurgeRuns(limit);
    res.setHeader("Cache-Control", "no-store");
    res.json({ runs });
  },
);

/**
 * Trigger an on-demand purge sweep from the operator dashboard. Mirrors
 * the script in src/scripts/purge-outward-accounts.ts but is reachable
 * over HTTP so an operator doesn't need shell access on the API host.
 * The new run is recorded in the same history table.
 */
router.post(
  "/admin/outward-account-purge-runs",
  requireOperator,
  async (_req, res): Promise<void> => {
    const result = await purgeExpiredOutwardAccounts({ source: "api" });
    res.status(201).json(result);
  },
);

/**
 * Health probe for the outward-account purge sweep (#389). Returns an
 * `overdue` flag plus the supporting numbers (last `ranAt`, age, the
 * cadence and the threshold) so an external uptime check or the
 * operator dashboard can detect a stuck sweep without having to fetch
 * the full run history and reason about it.
 *
 * The endpoint itself stays 200 so callers can branch on the JSON
 * payload — flipping a stuck sweep into an HTTP 5xx would also flip the
 * generic uptime monitors that ping this host, which is too coarse for
 * what is meaningfully a logical/data freshness signal.
 */
/**
 * Legacy alias for the operator purge-run dashboard (#407). The real
 * dashboard now lives at `/admin/dashboard` and is rendered by
 * `renderPurgeDashboardHtml()`. The previous handler here referenced an
 * undefined `PURGE_RUNS_DASHBOARD_HTML` constant and 500'd on every
 * request. Operator docs/bookmarks still point at this URL, so we
 * permanently redirect it to the canonical dashboard rather than break
 * existing links.
 */
router.get("/admin/dashboard/purge-runs", (_req, res): void => {
  res.redirect(301, "/api/admin/dashboard");
});

router.get(
  "/admin/outward-account-purge-health",
  requireOperator,
  async (_req, res): Promise<void> => {
    const health = await getOutwardAccountPurgeHealth();
    res.setHeader("Cache-Control", "no-store");
    res.json({
      overdue: health.overdue,
      lastRanAt: health.lastRanAt ? health.lastRanAt.toISOString() : null,
      ageMs: health.ageMs,
      intervalMs: health.intervalMs,
      overdueMultiplier: health.overdueMultiplier,
      thresholdMs: health.thresholdMs,
    });
  },
);

/**
 * Operator dashboard page (#391). Self-contained HTML/JS that fetches
 * from the JSON endpoints above. Gated by the same operator credential
 * — paste the dashboard URL into a browser and the Basic auth prompt
 * that fires asks for the operator key as the password (any username);
 * the browser then auto-includes those credentials on the dashboard's
 * fetch calls so the JSON endpoints accept them too.
 */
router.get("/admin/dashboard", requireOperator, (_req, res): void => {
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(renderPurgeDashboardHtml());
});

export default router;

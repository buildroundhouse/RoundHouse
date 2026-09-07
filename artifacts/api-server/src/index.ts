import { migrate } from "@workspace/db/migrate";
import app from "./app";
import { logger } from "./lib/logger";
import {
  recordMigrationFailure,
  recordMigrationSuccess,
} from "./lib/migrationStatus";
import { generateRecurringWorkOrders } from "./routes/work-orders";
import { notifyOverdueStandardsAll } from "./routes/standards";
import { notifyDueReminders } from "./routes/reminders";
import { clearStalePushTokens, STALE_PUSH_TOKEN_SWEEP_HOURS } from "./lib/push";
import { clearExpiredMutesForProperties } from "./lib/expireMutes";
import { backfillTradeProZips } from "./lib/backfillTradeProZips";
import { migratePropertyEntities } from "./lib/migratePropertyEntities";
import { initStripeIntegration } from "./lib/initStripe";
import {
  getOutwardAccountPurgeHealth,
  purgeExpiredOutwardAccounts,
} from "./lib/outwardAccounts";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// #392: start the HTTP listener BEFORE running migrations so the
// /api/health endpoint stays reachable while migrations run, and —
// critically — when they fail. The readiness-gate middleware in
// app.ts blocks all other /api/* traffic with 503 until
// `migrationStatus.state === "ok"`, so deploy tooling can probe
// /api/health, observe `state: "pending" | "failed" | "warning"`,
// and decide what to do, without us silently serving traffic
// against a degraded schema.
async function start() {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening (migrations pending)");
    runStartupMigrationsAndJobs();
  });
}

function runStartupMigrationsAndJobs() {
  logger.info("Running database migrations");
  migrate()
    .then((migrateResult) => {
      recordMigrationSuccess(migrateResult);

      if (migrateResult.unresolved.length > 0) {
        // Required NOT NULL columns were left nullable because
        // backfill rows are still missing. We keep the listener up
        // so /api/health surfaces the warning to deploy tooling,
        // but the readiness gate keeps refusing /api/* traffic
        // until an operator backfills and restarts.
        logger.error(
          { unresolved: migrateResult.unresolved },
          "Database migration completed with warnings — server is degraded; refusing /api/* traffic until backfilled and restarted.",
        );
        return;
      }

      logger.info(
        {
          durationMs: migrateResult.durationMs,
          completedAt: migrateResult.completedAt,
        },
        "Database migrations complete",
      );
      startScheduledJobs();
    })
    .catch((err) => {
      recordMigrationFailure(err);
      logger.error(
        { err },
        "Database migration failed — server is degraded; /api/health will report the failure and /api/* traffic is refused.",
      );
    });
}

function startScheduledJobs() {
  initStripeIntegration().catch((e) =>
    logger.error({ err: e }, "Stripe integration init failed"),
  );

  generateRecurringWorkOrders()
    .then(({ created }) => {
      if (created > 0) logger.info({ created }, "Generated recurring work orders on startup");
    })
    .catch((e) => logger.error({ err: e }, "Failed to generate recurring work orders on startup"));

  setInterval(() => {
    generateRecurringWorkOrders()
      .then(({ created }) => {
        if (created > 0) logger.info({ created }, "Generated recurring work orders");
      })
      .catch((e) => logger.error({ err: e }, "Recurring generator error"));
  }, 60 * 60 * 1000);

  notifyOverdueStandardsAll()
    .then(({ notified, properties }) => {
      if (notified > 0) logger.info({ notified, properties }, "Sent overdue standards notifications on startup");
    })
    .catch((e) => logger.error({ err: e }, "Failed to notify overdue standards on startup"));

  setInterval(() => {
    notifyOverdueStandardsAll()
      .then(({ notified, properties }) => {
        if (notified > 0) logger.info({ notified, properties }, "Sent overdue standards notifications");
      })
      .catch((e) => logger.error({ err: e }, "Overdue standards notifier error"));
  }, 60 * 60 * 1000);

  notifyDueReminders()
    .then(({ notified, retried }) => {
      if (notified > 0 || retried > 0)
        logger.info({ notified, retried }, "Sent due-reminder pushes on startup");
    })
    .catch((e) => logger.error({ err: e }, "Failed to notify due reminders on startup"));

  setInterval(() => {
    notifyDueReminders()
      .then(({ notified, retried }) => {
        if (notified > 0 || retried > 0)
          logger.info({ notified, retried }, "Sent due-reminder pushes");
      })
      .catch((e) => logger.error({ err: e }, "Due-reminder notifier error"));
  }, 60 * 1000);

  clearStalePushTokens()
    .then((cleared) => {
      if (cleared > 0) logger.info({ cleared }, "Cleared stale push tokens on startup");
    })
    .catch((e) => logger.error({ err: e }, "Failed to clear stale push tokens on startup"));

  setInterval(() => {
    clearStalePushTokens()
      .then((cleared) => {
        if (cleared > 0) logger.info({ cleared }, "Cleared stale push tokens");
      })
      .catch((e) => logger.error({ err: e }, "Stale push token sweep error"));
  }, STALE_PUSH_TOKEN_SWEEP_HOURS * 60 * 60 * 1000);

  clearExpiredMutesForProperties()
    .then(({ properties, standards }) => {
      logger.info({ properties, standards }, "Expired mutes sweep completed on startup");
    })
    .catch((e) => logger.error({ err: e }, "Failed to clear expired mutes on startup"));

  backfillTradeProZips()
    .catch((e) => logger.error({ err: e }, "Failed to backfill trade-pro primary ZIPs on startup"));

  // Task #663 — ensure every property has a matching `entities` row
  // (and an `entity_members` row for each property membership).
  // Idempotent; runs once on startup so the entity-only data layer
  // is always coherent before requests come in. Task #681 dropped
  // the legacy property-members table; on databases that still have
  // it, this also mirrors any remaining rows into `entity_members`
  // before retiring the table.
  migratePropertyEntities()
    .then((r) => {
      if (
        r.entitiesCreated > 0 ||
        r.membersCreated > 0 ||
        r.membersUpdated > 0
      ) {
        logger.info(r, "Backfilled property entities + memberships");
      }
      // Surface an incomplete cutover prominently. If a database
      // still has a legacy property-members table with rows that
      // haven't been mirrored into `entity_members`, the legacy
      // table will NOT be dropped and reads will silently miss
      // those memberships. Operators need to see this on every
      // boot until the orphans are gone.
      if (r.legacyOrphanRows > 0) {
        logger.warn(
          { legacyOrphanRows: r.legacyOrphanRows },
          "legacy property-members table still has orphan rows; refusing to drop — backfill required",
        );
      }
    })
    .catch((e) =>
      logger.error({ err: e }, "Failed to backfill property entities"),
    );

  const DEFAULT_EXPIRED_MUTES_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const MAX_EXPIRED_MUTES_SWEEP_INTERVAL_MS = 2_147_483_647; // Node setInterval 32-bit signed max
  const rawExpiredMutesSweepInterval = process.env["EXPIRED_MUTES_SWEEP_INTERVAL_MS"];
  let expiredMutesSweepIntervalMs = DEFAULT_EXPIRED_MUTES_SWEEP_INTERVAL_MS;
  if (rawExpiredMutesSweepInterval !== undefined && rawExpiredMutesSweepInterval !== "") {
    const parsed = Number(rawExpiredMutesSweepInterval);
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= MAX_EXPIRED_MUTES_SWEEP_INTERVAL_MS) {
      expiredMutesSweepIntervalMs = parsed;
    } else {
      logger.warn(
        {
          value: rawExpiredMutesSweepInterval,
          defaultMs: DEFAULT_EXPIRED_MUTES_SWEEP_INTERVAL_MS,
          maxMs: MAX_EXPIRED_MUTES_SWEEP_INTERVAL_MS,
        },
        "Invalid EXPIRED_MUTES_SWEEP_INTERVAL_MS value; falling back to default",
      );
    }
  }
  logger.info({ intervalMs: expiredMutesSweepIntervalMs }, "Scheduled expired mutes sweep");

  setInterval(() => {
    clearExpiredMutesForProperties()
      .then(({ properties, standards }) => {
        logger.info({ properties, standards }, "Expired mutes sweep completed");
      })
      .catch((e) => logger.error({ err: e }, "Expired mutes sweep error"));
  }, expiredMutesSweepIntervalMs);

  // #344: hard-delete soft-deleted outward accounts (and their archived
  // connections) once they fall out of the recovery window. Same shape
  // as the expired-mutes sweep above: run once on startup, then on a
  // configurable cadence, and always log how many rows came out.
  const DEFAULT_OUTWARD_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const MAX_OUTWARD_PURGE_INTERVAL_MS = 2_147_483_647;
  const rawOutwardPurgeInterval = process.env["OUTWARD_ACCOUNT_PURGE_INTERVAL_MS"];
  let outwardPurgeIntervalMs = DEFAULT_OUTWARD_PURGE_INTERVAL_MS;
  if (rawOutwardPurgeInterval !== undefined && rawOutwardPurgeInterval !== "") {
    const parsed = Number(rawOutwardPurgeInterval);
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= MAX_OUTWARD_PURGE_INTERVAL_MS) {
      outwardPurgeIntervalMs = parsed;
    } else {
      logger.warn(
        {
          value: rawOutwardPurgeInterval,
          defaultMs: DEFAULT_OUTWARD_PURGE_INTERVAL_MS,
          maxMs: MAX_OUTWARD_PURGE_INTERVAL_MS,
        },
        "Invalid OUTWARD_ACCOUNT_PURGE_INTERVAL_MS value; falling back to default",
      );
    }
  }
  logger.info({ intervalMs: outwardPurgeIntervalMs }, "Scheduled outward-account purge sweep");

  purgeExpiredOutwardAccounts({ source: "startup" })
    .then(({ accounts, connections, runsTrimmed, runId }) => {
      logger.info({ accounts, connections, runsTrimmed, runId }, "Outward-account purge sweep completed on startup");
    })
    .catch((e) => logger.error({ err: e }, "Failed to purge expired outward accounts on startup"));

  setInterval(() => {
    purgeExpiredOutwardAccounts({ source: "scheduled" })
      .then(({ accounts, connections, runsTrimmed, runId }) => {
        logger.info({ accounts, connections, runsTrimmed, runId }, "Outward-account purge sweep completed");
      })
      .catch((e) => logger.error({ err: e }, "Outward-account purge sweep error"));
  }, outwardPurgeIntervalMs);

  // #389: scheduled freshness check for the purge sweep above. If the
  // most-recent run is older than `intervalMs * overdueMultiplier`, log
  // a single "OUTWARD_ACCOUNT_PURGE_OVERDUE" error so on-call hooks /
  // log-based alerting can page. We poll on a tighter cadence than the
  // sweep itself (default ~1/4 of the interval, capped at 1h, floored at
  // 5min) so we don't have to wait a full sweep cycle to notice a stuck
  // one. Runs in addition to the on-demand /admin/outward-account-purge-health
  // endpoint, which exposes the same signal to operators on demand.
  const purgeMonitorIntervalMs = Math.max(
    5 * 60 * 1000,
    Math.min(60 * 60 * 1000, Math.floor(outwardPurgeIntervalMs / 4)),
  );
  function checkOutwardPurgeFreshness(): void {
    getOutwardAccountPurgeHealth({ intervalMs: outwardPurgeIntervalMs })
      .then((health) => {
        if (health.overdue) {
          logger.error(
            {
              event: "OUTWARD_ACCOUNT_PURGE_OVERDUE",
              lastRanAt: health.lastRanAt
                ? health.lastRanAt.toISOString()
                : null,
              ageMs: health.ageMs,
              intervalMs: health.intervalMs,
              overdueMultiplier: health.overdueMultiplier,
              thresholdMs: health.thresholdMs,
            },
            "Outward-account purge sweep is overdue",
          );
        }
      })
      .catch((e) =>
        logger.error({ err: e }, "Outward-account purge freshness check error"),
      );
  }
  logger.info(
    { intervalMs: purgeMonitorIntervalMs },
    "Scheduled outward-account purge freshness monitor",
  );
  setInterval(checkOutwardPurgeFreshness, purgeMonitorIntervalMs);
}

start().catch((err) => {
  logger.fatal({ err }, "Server startup failed");
  process.exit(1);
});

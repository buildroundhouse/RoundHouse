/**
 * On-demand operator script for #344. Hard-deletes outward accounts
 * whose soft-delete fell out of the recovery window, plus the archived
 * connection rows that pointed at them. Logs a summary line so the
 * operator has a record of how many rows were purged.
 *
 * Usage (from repo root):
 *   pnpm --filter @workspace/api-server exec tsx \
 *     src/scripts/purge-outward-accounts.ts
 *
 * Or via the convenience npm script:
 *   pnpm --filter @workspace/api-server run purge:outward-accounts
 */
import { logger } from "../lib/logger";
import { purgeExpiredOutwardAccounts } from "../lib/outwardAccounts";

async function main(): Promise<void> {
  const started = Date.now();
  const { accounts, connections, runsTrimmed, runId } =
    await purgeExpiredOutwardAccounts({ source: "script" });
  const durationMs = Date.now() - started;
  logger.info(
    { accounts, connections, runsTrimmed, runId, durationMs },
    "Outward-account purge script completed",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "Outward-account purge script failed");
    process.exit(1);
  });

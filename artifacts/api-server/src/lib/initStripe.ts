import { runMigrations } from "stripe-replit-sync";
import { getStripeSync, stripeEnabled } from "./stripeClient";
import { logger } from "./logger";

/**
 * Boot-time hook for the Stripe integration. Runs the stripe schema
 * migrations, registers a managed webhook against this deployment's
 * /api/stripe/webhook endpoint, and kicks off a background backfill so
 * the local stripe.* tables reflect what's currently in Stripe.
 *
 * No-op when the Stripe connection is not configured — the rest of the
 * billing flow falls back to the mock processor in that case.
 */
export async function initStripeIntegration(): Promise<void> {
  if (!stripeEnabled()) {
    logger.info("Stripe integration not connected; using mock billing path");
    return;
  }
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    logger.warn("Stripe integration enabled but DATABASE_URL missing; skipping init");
    return;
  }
  try {
    await runMigrations({ databaseUrl });
    logger.info("Stripe schema migrations complete");
  } catch (err) {
    logger.error({ err }, "Stripe schema migrations failed");
    return;
  }

  let stripeSync;
  try {
    stripeSync = await getStripeSync();
  } catch (err) {
    logger.error({ err }, "Failed to construct Stripe sync client");
    return;
  }

  const baseDomain = process.env["BILLING_WEBHOOK_BASE_URL"]
    ?? `https://${process.env["REPLIT_DOMAINS"]?.split(",")[0] ?? ""}`;
  if (baseDomain && baseDomain !== "https://") {
    try {
      const result = await stripeSync.findOrCreateManagedWebhook(
        `${baseDomain}/api/stripe/webhook`,
      );
      logger.info(
        { url: (result as { url?: string } | null | undefined)?.url ?? null },
        "Stripe managed webhook ready",
      );
    } catch (err) {
      logger.warn({ err }, "Stripe managed webhook setup failed");
    }
  } else {
    logger.warn("BILLING_WEBHOOK_BASE_URL/REPLIT_DOMAINS missing; skipping managed webhook setup");
  }

  // Run the initial backfill in the background so server startup isn't
  // blocked by a potentially long Stripe pull.
  stripeSync
    .syncBackfill()
    .then(() => logger.info("Stripe data backfill complete"))
    .catch((err) => logger.error({ err }, "Stripe data backfill failed"));
}

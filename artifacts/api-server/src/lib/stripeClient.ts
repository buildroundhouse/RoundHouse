import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";

/**
 * Read server-side Stripe credentials from the hosting environment.
 * The sync library operates against Stripe/Postgres directly; it does not
 * need a Replit session or the Replit connection API.
 */
async function getStripeCredentials(): Promise<{
  secretKey: string;
  webhookSecret?: string;
}> {
  const secretKey = process.env["STRIPE_SECRET_KEY"];
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not configured on the server.");
  return { secretKey, webhookSecret: process.env["STRIPE_WEBHOOK_SECRET"] };
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey);
}

export async function getStripeSync(): Promise<StripeSync> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  const { secretKey, webhookSecret } = await getStripeCredentials();
  if (!webhookSecret) {
    throw new Error(
      "Stripe webhook signing secret is not configured. " +
        "Webhook signature verification cannot proceed without it. " +
        "Set STRIPE_WEBHOOK_SECRET on the server.",
    );
  }
  return new StripeSync({
    poolConfig: { connectionString: databaseUrl },
    stripeSecretKey: secretKey,
    stripeWebhookSecret: webhookSecret,
  });
}

/**
 * True iff a direct Stripe secret key is configured. Callers use this as
 * a feature flag — when false the
 * billing routes fall back to the original mock processor so local tests
 * still pass without needing live Stripe credentials.
 */
export function stripeEnabled(): boolean {
  if (process.env["BILLING_DISABLE_STRIPE"] === "1") return false;
  if (process.env["NODE_ENV"] === "test" || process.env["VITEST"]) return false;
  return Boolean(process.env["STRIPE_SECRET_KEY"]);
}

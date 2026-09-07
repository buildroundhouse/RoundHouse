import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";

/**
 * Stripe credentials are pulled from the Replit connection API. Tokens
 * may rotate, so we fetch fresh on every call (the official Replit
 * pattern — never cache the client itself).
 */
async function getStripeCredentials(): Promise<{
  secretKey: string;
  webhookSecret?: string;
}> {
  const hostname = process.env["REPLIT_CONNECTORS_HOSTNAME"];
  const xReplitToken = process.env["REPL_IDENTITY"]
    ? "repl " + process.env["REPL_IDENTITY"]
    : process.env["WEB_REPL_RENEWAL"]
      ? "depl " + process.env["WEB_REPL_RENEWAL"]
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error(
      "Missing Replit environment variables. " +
        "Ensure the Stripe integration is connected via the Integrations tab.",
    );
  }

  const resp = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
    {
      headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!resp.ok) {
    throw new Error(
      `Failed to fetch Stripe credentials: ${resp.status} ${resp.statusText}`,
    );
  }

  const data = (await resp.json()) as {
    items?: Array<{
      settings?: { secret_key?: string; webhook_secret?: string };
    }>;
  };
  const settings = data.items?.[0]?.settings;

  if (!settings?.secret_key) {
    throw new Error(
      "Stripe integration not connected or missing secret key. " +
        "Connect Stripe via the Integrations tab first.",
    );
  }

  return {
    secretKey: settings.secret_key,
    webhookSecret: settings.webhook_secret,
  };
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
        "Set the webhook secret in the Stripe integration settings.",
    );
  }
  return new StripeSync({
    poolConfig: { connectionString: databaseUrl },
    stripeSecretKey: secretKey,
    stripeWebhookSecret: webhookSecret,
  });
}

/**
 * True iff the Stripe integration looks reachable (Replit connector env
 * vars are present). Callers use this as a feature flag — when false the
 * billing routes fall back to the original mock processor so local tests
 * still pass without needing live Stripe credentials.
 */
export function stripeEnabled(): boolean {
  if (process.env["BILLING_DISABLE_STRIPE"] === "1") return false;
  if (process.env["NODE_ENV"] === "test" || process.env["VITEST"]) return false;
  const hostname = process.env["REPLIT_CONNECTORS_HOSTNAME"];
  const token = process.env["REPL_IDENTITY"] ?? process.env["WEB_REPL_RENEWAL"];
  return Boolean(hostname && token);
}

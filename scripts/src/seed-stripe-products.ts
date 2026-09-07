/**
 * Seed the Stripe catalog with the "Expanded capabilities" bundle used
 * by the per-skin billing flow. Idempotent: safe to run repeatedly.
 *
 * Run with:
 *   pnpm --filter @workspace/scripts exec tsx src/seed-stripe-products.ts
 *
 * Requires the Stripe integration to be connected to this Repl.
 */
import Stripe from "stripe";

const BUNDLE_NAME = "Expanded capabilities";
const BUNDLE_DESCRIPTION =
  "Per-skin paid bundle: create property records, expand member participation, and unlock pro tools.";
const BUNDLE_METADATA_KEY = "bundle";
const BUNDLE_METADATA_VALUE = "expanded_capabilities";
const PRICE_CENTS = 2900;
const PRICE_CURRENCY = "usd";

async function getStripeCredentials(): Promise<{ secretKey: string }> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;
  if (!hostname || !xReplitToken) {
    throw new Error(
      "Missing Replit env. Connect Stripe via the Integrations tab first.",
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
    throw new Error(`Stripe creds fetch failed: ${resp.status} ${resp.statusText}`);
  }
  const data = (await resp.json()) as {
    items?: Array<{ settings?: { secret_key?: string } }>;
  };
  const key = data.items?.[0]?.settings?.secret_key;
  if (!key) throw new Error("Stripe connection has no secret_key");
  return { secretKey: key };
}

async function main(): Promise<void> {
  const { secretKey } = await getStripeCredentials();
  const stripe = new Stripe(secretKey);

  // Find existing bundle product by metadata tag (Stripe search supports
  // metadata equality queries).
  const search = await stripe.products.search({
    query: `metadata['${BUNDLE_METADATA_KEY}']:'${BUNDLE_METADATA_VALUE}' AND active:'true'`,
  });

  let product = search.data[0];
  if (!product) {
    product = await stripe.products.create({
      name: BUNDLE_NAME,
      description: BUNDLE_DESCRIPTION,
      metadata: { [BUNDLE_METADATA_KEY]: BUNDLE_METADATA_VALUE },
    });
    console.log(`Created product ${product.id} (${product.name})`);
  } else {
    console.log(`Product already exists: ${product.id} (${product.name})`);
  }

  // Find a matching active recurring price; if not present, create it.
  const prices = await stripe.prices.list({
    product: product.id,
    active: true,
    limit: 100,
  });
  const match = prices.data.find(
    (p) =>
      p.unit_amount === PRICE_CENTS &&
      (p.currency ?? "").toLowerCase() === PRICE_CURRENCY &&
      p.recurring?.interval === "month",
  );
  if (match) {
    console.log(`Price already exists: ${match.id}`);
  } else {
    const created = await stripe.prices.create({
      product: product.id,
      unit_amount: PRICE_CENTS,
      currency: PRICE_CURRENCY,
      recurring: { interval: "month" },
    });
    console.log(`Created price ${created.id} ($${(PRICE_CENTS / 100).toFixed(2)}/mo)`);
  }

  console.log("Done. Webhooks will sync this catalog into the local stripe schema.");
}

main().catch((err) => {
  console.error("seed-stripe-products failed:", err);
  process.exit(1);
});

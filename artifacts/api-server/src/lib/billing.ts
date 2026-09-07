import { and, eq, sql } from "drizzle-orm";
import {
  db,
  outwardAccountsTable,
  subscriptionsTable,
  usersTable,
  type Subscription,
} from "@workspace/db";
import { insertNotifications } from "./insertNotifications";
import { getUncachableStripeClient, stripeEnabled } from "./stripeClient";
import { logger } from "./logger";

/**
 * Default placeholder pricing — used only when the Stripe catalog has
 * not been seeded yet OR the Stripe integration is not connected. With
 * Stripe configured, the live price comes from the bundle product
 * tagged `metadata.bundle = "expanded_capabilities"`.
 */
export const FALLBACK_EXPANDED_PRICE_CENTS = 2900;
export const FALLBACK_EXPANDED_CURRENCY = "USD";
export const EXPANDED_BUNDLE_LABEL = "Expanded capabilities";

/**
 * Metadata tag used to identify the bundle product+price in Stripe. The
 * seed-products script tags exactly one product+price with this and we
 * pick whichever active recurring price has the lowest unit_amount when
 * multiple are present (e.g. monthly vs yearly).
 */
export const EXPANDED_BUNDLE_METADATA_KEY = "bundle";
export const EXPANDED_BUNDLE_METADATA_VALUE = "expanded_capabilities";

export interface BundlePricing {
  label: string;
  priceCents: number;
  currency: string;
  /** Stripe price id when sourced from the catalog. */
  priceId: string | null;
}

/**
 * Read the bundle pricing from the synced `stripe.prices` schema. Falls
 * back to constants if the row isn't there yet (happens before the
 * seed-products script has run, or when Stripe isn't connected).
 */
export async function getExpandedBundlePricing(): Promise<BundlePricing> {
  if (!stripeEnabled()) return fallbackBundle();
  try {
    const rows = await db.execute<{
      price_id: string;
      unit_amount: string | number | null;
      currency: string;
      product_name: string | null;
    }>(sql`
      SELECT pr.id AS price_id,
             pr.unit_amount AS unit_amount,
             pr.currency AS currency,
             p.name AS product_name
      FROM stripe.prices pr
      JOIN stripe.products p ON p.id = pr.product
      WHERE pr.active = true
        AND p.active = true
        AND p.metadata->>${EXPANDED_BUNDLE_METADATA_KEY} = ${EXPANDED_BUNDLE_METADATA_VALUE}
        AND pr.recurring IS NOT NULL
      ORDER BY pr.unit_amount ASC
      LIMIT 1
    `);
    const row = rows.rows?.[0];
    if (!row || row.unit_amount == null) return fallbackBundle();
    return {
      label: row.product_name ?? EXPANDED_BUNDLE_LABEL,
      priceCents: Number(row.unit_amount),
      currency: (row.currency ?? "USD").toUpperCase(),
      priceId: row.price_id,
    };
  } catch (err) {
    // Most often: stripe schema not yet created (sync hasn't run, or
    // Stripe not connected). Treat as fallback.
    logger.debug({ err }, "Bundle pricing lookup failed; using fallback");
    return fallbackBundle();
  }
}

function fallbackBundle(): BundlePricing {
  return {
    label: EXPANDED_BUNDLE_LABEL,
    priceCents: FALLBACK_EXPANDED_PRICE_CENTS,
    currency: FALLBACK_EXPANDED_CURRENCY,
    priceId: null,
  };
}

function thirtyDaysFromNow(): Date {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

function mockProcessorId(prefix: string, key: string): string {
  return `${prefix}_mock_${Buffer.from(key).toString("hex").slice(0, 16)}`;
}

export interface ProcessorEnableResult {
  customerId: string;
  subscriptionId: string;
  currentPeriodEnd: Date;
  priceCents: number;
  currency: string;
}

/**
 * Look up — and create if needed — the Stripe customer for this payer.
 * The customer id is cached on any of the payer's existing subscription
 * rows so we don't create a new customer per skin.
 */
async function ensureStripeCustomer(
  payerClerkId: string,
): Promise<{ customerId: string }> {
  const stripe = await getUncachableStripeClient();

  // 1) Persisted on the user row — the canonical source. Set on first use
  // and reused forever after, so the card-attach customer and the
  // subscription-creation customer are always the same identity.
  const [user] = await db
    .select({
      email: usersTable.email,
      name: usersTable.name,
      stripeCustomerId: usersTable.stripeCustomerId,
    })
    .from(usersTable)
    .where(eq(usersTable.clerkId, payerClerkId));
  if (user?.stripeCustomerId) {
    return { customerId: user.stripeCustomerId };
  }

  // 2) Legacy fallback — older rows captured the customer id only on the
  // subscriptions row. Promote it onto the user row so future calls hit
  // the fast path above.
  const [legacySub] = await db
    .select({ customer: subscriptionsTable.processorCustomerId })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.payerClerkId, payerClerkId));
  if (legacySub?.customer && !legacySub.customer.startsWith("cus_mock_")) {
    await db
      .update(usersTable)
      .set({ stripeCustomerId: legacySub.customer })
      .where(eq(usersTable.clerkId, payerClerkId));
    return { customerId: legacySub.customer };
  }

  // 3) Try to recover an already-created Stripe customer with this
  // clerkId in metadata before creating a new one (defense in depth in
  // case persistence failed on a prior attempt).
  try {
    const search = await stripe.customers.search({
      query: `metadata['clerkId']:'${payerClerkId.replace(/'/g, "")}'`,
      limit: 1,
    });
    const found = search.data[0];
    if (found) {
      await db
        .update(usersTable)
        .set({ stripeCustomerId: found.id })
        .where(eq(usersTable.clerkId, payerClerkId));
      return { customerId: found.id };
    }
  } catch (err) {
    // Search isn't available on every account/API version — fall through
    // to creating a fresh customer. Worst case we create a duplicate
    // that the persisted column then locks in for all future calls.
    logger.warn(
      { err, payerClerkId },
      "Stripe customer search failed; falling back to create",
    );
  }

  const created = await stripe.customers.create({
    email: user?.email ?? undefined,
    name: user?.name ?? undefined,
    metadata: { clerkId: payerClerkId },
  });
  await db
    .update(usersTable)
    .set({ stripeCustomerId: created.id })
    .where(eq(usersTable.clerkId, payerClerkId));
  return { customerId: created.id };
}

/**
 * Public helper used by the routes layer to create a Stripe Checkout
 * session in `setup` mode so the mobile app can collect a real card on
 * Stripe's hosted page (Expo Go can't ship native Stripe Elements).
 */
export async function createPaymentMethodSetupSession(
  payerClerkId: string,
  returnUrl: string,
): Promise<{ url: string; sessionId: string; customerId: string }> {
  const stripe = await getUncachableStripeClient();
  const { customerId } = await ensureStripeCustomer(payerClerkId);
  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    customer: customerId,
    payment_method_types: ["card"],
    success_url: `${returnUrl}?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${returnUrl}?status=cancel`,
    metadata: { clerkId: payerClerkId, kind: "setup_payment_method" },
  });
  if (!session.url) {
    throw new Error("Stripe Checkout did not return a session url");
  }
  return { url: session.url, sessionId: session.id, customerId };
}

/**
 * Returns whether the given clerk-id payer has at least one card on file
 * in Stripe. Drives the "Add payment method" vs "Card on file" UI.
 */
export async function loadPaymentMethodView(payerClerkId: string): Promise<{
  onFile: boolean;
  summary: string | null;
}> {
  if (!stripeEnabled()) {
    // Legacy path used by tests: presence of any subscription row implies
    // the mock "customer" was created.
    const [anyPayer] = await db
      .select({ customer: subscriptionsTable.processorCustomerId })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.payerClerkId, payerClerkId));
    return anyPayer
      ? { onFile: true, summary: "Card on file (placeholder)" }
      : { onFile: false, summary: null };
  }
  try {
    const stripe = await getUncachableStripeClient();
    // Canonical source: the Stripe customer id persisted on the user
    // row when they first opened Checkout. This is the same customer
    // the card was attached to, so it's the only identity guaranteed
    // to have payment methods we care about.
    const [user] = await db
      .select({
        email: usersTable.email,
        stripeCustomerId: usersTable.stripeCustomerId,
      })
      .from(usersTable)
      .where(eq(usersTable.clerkId, payerClerkId));
    let customerId: string | null = user?.stripeCustomerId ?? null;

    // Legacy fallback: subscription row, then email lookup. Used only
    // when the user row hasn't been backfilled yet.
    if (!customerId) {
      const [existing] = await db
        .select({ customer: subscriptionsTable.processorCustomerId })
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.payerClerkId, payerClerkId));
      const candidate = existing?.customer ?? null;
      if (candidate && !candidate.startsWith("cus_mock_")) {
        customerId = candidate;
      }
    }
    if (!customerId && user?.email) {
      const search = await stripe.customers.list({
        email: user.email,
        limit: 1,
      });
      customerId = search.data[0]?.id ?? null;
    }
    if (!customerId) return { onFile: false, summary: null };
    const methods = await stripe.paymentMethods.list({
      customer: customerId,
      type: "card",
      limit: 1,
    });
    const pm = methods.data[0];
    if (!pm) return { onFile: false, summary: null };
    const card = pm.card;
    const summary = card
      ? `${(card.brand ?? "Card").toUpperCase()} ···· ${card.last4}`
      : "Card on file";
    return { onFile: true, summary };
  } catch (err) {
    logger.warn({ err }, "Stripe payment-method lookup failed");
    return { onFile: false, summary: null };
  }
}

/**
 * Real Stripe enable path: create (or look up) the Stripe customer,
 * find the current bundle price, and create a recurring subscription
 * billed against the customer's default payment method.
 */
async function processorEnableStripe(
  payerClerkId: string,
  outwardAccountId: number,
  idempotencyKey: string,
): Promise<ProcessorEnableResult> {
  const stripe = await getUncachableStripeClient();
  const { customerId } = await ensureStripeCustomer(payerClerkId);

  // Verify the customer has a card on file. We do not store cards
  // server-side — they were attached via the Checkout setup session.
  const methods = await stripe.paymentMethods.list({
    customer: customerId,
    type: "card",
    limit: 1,
  });
  const card = methods.data[0];
  if (!card) {
    throw new BillingClientError(
      "no_payment_method",
      "Add a payment method before enabling expanded capabilities.",
    );
  }
  // Make sure the card is the default for invoices.
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: card.id },
  });

  const bundle = await getExpandedBundlePricing();
  if (!bundle.priceId) {
    throw new BillingClientError(
      "missing_bundle_price",
      "The expanded-capabilities price has not been set up in Stripe yet. Run scripts/seed-stripe-products.ts.",
    );
  }

  const sub = await stripe.subscriptions.create(
    {
      customer: customerId,
      items: [{ price: bundle.priceId }],
      payment_behavior: "error_if_incomplete",
      expand: ["latest_invoice"],
      metadata: { payerClerkId, outwardAccountId: String(outwardAccountId) },
    },
    { idempotencyKey },
  );
  const periodEnd =
    typeof (sub as unknown as { current_period_end?: number }).current_period_end ===
    "number"
      ? new Date(
          (sub as unknown as { current_period_end: number }).current_period_end *
            1000,
        )
      : thirtyDaysFromNow();
  return {
    customerId,
    subscriptionId: sub.id,
    currentPeriodEnd: periodEnd,
    priceCents: bundle.priceCents,
    currency: bundle.currency,
  };
}

function processorEnableMock(
  payerClerkId: string,
  outwardAccountId: number,
): ProcessorEnableResult {
  return {
    customerId: mockProcessorId("cus", payerClerkId),
    subscriptionId: mockProcessorId(
      "sub",
      `${payerClerkId}:${outwardAccountId}`,
    ),
    currentPeriodEnd: thirtyDaysFromNow(),
    priceCents: FALLBACK_EXPANDED_PRICE_CENTS,
    currency: FALLBACK_EXPANDED_CURRENCY,
  };
}

export class BillingClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BillingClientError";
  }
}

/**
 * Enable expanded capabilities on a skin owned by the caller. The
 * caller is the personal profile (clerkId); they are the payer.
 */
export async function enableExpandedCapabilities(
  payerClerkId: string,
  outwardAccountId: number,
): Promise<{ subscription: Subscription }> {
  const [existing] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.outwardAccountId, outwardAccountId));

  // Idempotency: if a local "active" subscription already exists for this
  // skin, do NOT create a second Stripe subscription. Reconcile against
  // Stripe (when enabled) and reuse the existing processor subscription
  // if it is still in a billable state. This prevents duplicate charges
  // on retries / double-taps.
  if (
    existing &&
    existing.status === "active" &&
    existing.payerClerkId === payerClerkId &&
    existing.processorSubscriptionId
  ) {
    if (stripeEnabled()) {
      try {
        const stripe = await getUncachableStripeClient();
        const remote = await stripe.subscriptions.retrieve(
          existing.processorSubscriptionId,
        );
        if (
          remote.status === "active" ||
          remote.status === "trialing" ||
          remote.status === "past_due"
        ) {
          await db
            .update(outwardAccountsTable)
            .set({ capabilityState: "expanded" })
            .where(eq(outwardAccountsTable.id, outwardAccountId));
          return { subscription: existing };
        }
      } catch (err) {
        logger.warn(
          { err, outwardAccountId },
          "Stripe subscription lookup failed during enable; will recreate",
        );
      }
    } else {
      // Mock mode: local-only state is the source of truth.
      await db
        .update(outwardAccountsTable)
        .set({ capabilityState: "expanded" })
        .where(eq(outwardAccountsTable.id, outwardAccountId));
      return { subscription: existing };
    }
  }

  // Stable idempotency key: tied to (payer, skin, local row id+updatedAt).
  // After a lapse the local row's updatedAt changes, yielding a new key
  // so a fresh subscription can be created for the new billing cycle.
  const idempotencyKey = `enable-${payerClerkId}-${outwardAccountId}-${
    existing?.id ?? "new"
  }-${existing?.updatedAt?.getTime() ?? 0}`;

  const proc = stripeEnabled()
    ? await processorEnableStripe(payerClerkId, outwardAccountId, idempotencyKey)
    : processorEnableMock(payerClerkId, outwardAccountId);

  let subscription: Subscription;
  if (existing) {
    [subscription] = await db
      .update(subscriptionsTable)
      .set({
        payerClerkId,
        status: "active",
        processorCustomerId: proc.customerId,
        processorSubscriptionId: proc.subscriptionId,
        currentPeriodEnd: proc.currentPeriodEnd,
        priceCents: proc.priceCents,
        currency: proc.currency,
      })
      .where(eq(subscriptionsTable.id, existing.id))
      .returning();
  } else {
    [subscription] = await db
      .insert(subscriptionsTable)
      .values({
        outwardAccountId,
        payerClerkId,
        status: "active",
        processorCustomerId: proc.customerId,
        processorSubscriptionId: proc.subscriptionId,
        currentPeriodEnd: proc.currentPeriodEnd,
        priceCents: proc.priceCents,
        currency: proc.currency,
      })
      .returning();
  }
  await db
    .update(outwardAccountsTable)
    .set({ capabilityState: "expanded" })
    .where(eq(outwardAccountsTable.id, outwardAccountId));
  await notifyPayer(payerClerkId, {
    title: "Expanded capabilities enabled",
    body: "Paid capabilities are now active on this account.",
    relatedId: String(outwardAccountId),
    type: "billing_capabilities_restored",
  });
  return { subscription };
}

/**
 * User-initiated cancel. Marks the subscription cancelled and reverts
 * the capability state immediately so the change is visible in the UI
 * without waiting for the webhook.
 */
export async function cancelExpandedCapabilities(
  payerClerkId: string,
  outwardAccountId: number,
): Promise<{ subscription: Subscription | null }> {
  const [existing] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.outwardAccountId, outwardAccountId));
  if (!existing) return { subscription: null };

  // Cancel at the processor FIRST. We must never mark the local
  // subscription as cancelled while Stripe keeps billing — that would
  // mislead the user and continue charging their card. If Stripe
  // returns "no such subscription" the remote side is already gone, so
  // it's safe to proceed; any other error is surfaced to the route.
  if (
    stripeEnabled() &&
    existing.processorSubscriptionId &&
    !existing.processorSubscriptionId.startsWith("sub_mock_")
  ) {
    try {
      const stripe = await getUncachableStripeClient();
      await stripe.subscriptions.cancel(existing.processorSubscriptionId);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "resource_missing") {
        logger.error(
          { err, processorSubscriptionId: existing.processorSubscriptionId },
          "Stripe subscription cancel failed; refusing to mark local cancelled",
        );
        throw new BillingClientError(
          "processor_cancel_failed",
          "Couldn't cancel the subscription with the payment processor. Please try again.",
        );
      }
      logger.warn(
        { processorSubscriptionId: existing.processorSubscriptionId },
        "Stripe subscription already gone; treating cancel as a no-op",
      );
    }
  }

  const [subscription] = await db
    .update(subscriptionsTable)
    .set({ status: "cancelled" })
    .where(eq(subscriptionsTable.id, existing.id))
    .returning();
  await db
    .update(outwardAccountsTable)
    .set({ capabilityState: "standard" })
    .where(eq(outwardAccountsTable.id, outwardAccountId));
  await notifyPayer(payerClerkId, {
    title: "Expanded capabilities cancelled",
    body: "This account is back to the free baseline. Your data is untouched.",
    relatedId: String(outwardAccountId),
    type: "billing_capabilities_reduced",
  });
  return { subscription };
}

/**
 * Webhook-driven status updates. Real processors call into this with
 * `payment_succeeded`, `payment_failed`, `subscription_cancelled`, etc.
 * Each event maps onto one of four states and either unlocks or reverts
 * the gating column. NEVER deletes, hides, or archives any data.
 */
export type WebhookEvent =
  | "payment_succeeded"
  | "payment_failed_grace"
  | "payment_failed_lapsed"
  | "subscription_cancelled";

export async function applyWebhookEvent(
  outwardAccountId: number,
  event: WebhookEvent,
): Promise<{ subscription: Subscription | null }> {
  const [existing] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.outwardAccountId, outwardAccountId));
  if (!existing) return { subscription: null };

  let nextStatus: Subscription["status"] = existing.status;
  let nextCapabilityState: "standard" | "expanded" | null = null;
  let notif: { title: string; body: string; type: string } | null = null;
  let nextPeriodEnd: Date | null | undefined = undefined;

  switch (event) {
    case "payment_succeeded":
      nextStatus = "active";
      nextCapabilityState = "expanded";
      nextPeriodEnd = thirtyDaysFromNow();
      notif = {
        title: "Payment received",
        body: "Expanded capabilities are active for the next 30 days.",
        type: "billing_payment_succeeded",
      };
      break;
    case "payment_failed_grace":
      nextStatus = "past_due";
      notif = {
        title: "We couldn't charge your card",
        body: "We'll keep retrying. If it doesn't go through, this account will return to the free baseline.",
        type: "billing_payment_failed_grace",
      };
      break;
    case "payment_failed_lapsed":
      nextStatus = "expired";
      nextCapabilityState = "standard";
      notif = {
        title: "Capabilities reduced",
        body: "Payment didn't go through. This account is back to the free baseline. Your data is intact.",
        type: "billing_capabilities_reduced",
      };
      break;
    case "subscription_cancelled":
      nextStatus = "cancelled";
      nextCapabilityState = "standard";
      notif = {
        title: "Expanded capabilities cancelled",
        body: "This account is back to the free baseline.",
        type: "billing_capabilities_reduced",
      };
      break;
  }

  const [subscription] = await db
    .update(subscriptionsTable)
    .set({
      status: nextStatus,
      ...(nextPeriodEnd !== undefined ? { currentPeriodEnd: nextPeriodEnd } : {}),
    })
    .where(eq(subscriptionsTable.id, existing.id))
    .returning();
  if (nextCapabilityState != null) {
    await db
      .update(outwardAccountsTable)
      .set({ capabilityState: nextCapabilityState })
      .where(eq(outwardAccountsTable.id, outwardAccountId));
  }
  if (notif) {
    await notifyPayer(existing.payerClerkId, {
      title: notif.title,
      body: notif.body,
      type: notif.type,
      relatedId: String(outwardAccountId),
    });
  }
  return { subscription };
}

export async function loadOwnedOutwardAccount(
  callerClerkId: string,
  outwardAccountId: number,
) {
  const [row] = await db
    .select()
    .from(outwardAccountsTable)
    .where(
      and(
        eq(outwardAccountsTable.id, outwardAccountId),
        eq(outwardAccountsTable.ownerClerkId, callerClerkId),
      ),
    );
  return row ?? null;
}

async function notifyPayer(
  payerClerkId: string,
  body: { title: string; body: string; type: string; relatedId: string },
): Promise<void> {
  const [u] = await db
    .select({ clerkId: usersTable.clerkId })
    .from(usersTable)
    .where(eq(usersTable.clerkId, payerClerkId));
  if (!u) return;
  await insertNotifications([
    {
      userClerkId: payerClerkId,
      type: body.type,
      title: body.title,
      body: body.body,
      relatedId: body.relatedId,
    },
  ]);
}

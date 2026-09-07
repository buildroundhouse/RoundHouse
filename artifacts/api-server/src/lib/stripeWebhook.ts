import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, subscriptionsTable } from "@workspace/db";
import { getStripeSync, getUncachableStripeClient } from "./stripeClient";
import { applyWebhookEvent, type WebhookEvent } from "./billing";
import { logger } from "./logger";

/**
 * Verify the Stripe signature, hand the event to stripe-replit-sync so
 * the local `stripe` schema stays in sync, and then translate the
 * subset of events we care about into our internal capability state
 * machine (see lib/billing.ts → applyWebhookEvent).
 *
 * Mapping:
 *   invoice.payment_succeeded              -> payment_succeeded
 *   invoice.payment_failed                 -> payment_failed_grace
 *   customer.subscription.deleted          -> subscription_cancelled
 *   customer.subscription.updated          -> payment_failed_lapsed when
 *                                             status flips to "unpaid" or
 *                                             "incomplete_expired".
 */
export async function processStripeWebhook(
  payload: Buffer,
  signature: string,
): Promise<void> {
  if (!Buffer.isBuffer(payload)) {
    throw new Error(
      "STRIPE WEBHOOK ERROR: req.body is not a Buffer. Register the " +
        "/api/stripe/webhook route BEFORE app.use(express.json()).",
    );
  }
  const sync = await getStripeSync();
  // sync.processWebhook verifies signature + persists to stripe schema.
  await sync.processWebhook(payload, signature);

  // Re-parse the (now-trusted) payload to dispatch our own side-effects.
  let event: Stripe.Event;
  try {
    event = JSON.parse(payload.toString("utf8")) as Stripe.Event;
  } catch (err) {
    logger.warn({ err }, "Stripe webhook: payload not parseable as JSON");
    return;
  }
  await dispatchInternalEvent(event);
}

async function dispatchInternalEvent(event: Stripe.Event): Promise<void> {
  const handler = INTERNAL_EVENT_MAP[event.type];
  if (!handler) return;
  const mapped = await handler(event);
  if (!mapped) return;
  const { outwardAccountId, internalEvent } = mapped;
  try {
    await applyWebhookEvent(outwardAccountId, internalEvent);
  } catch (err) {
    logger.error(
      { err, outwardAccountId, internalEvent, stripeType: event.type },
      "Failed applying Stripe-derived capability webhook",
    );
  }
}

type InternalMapping = {
  outwardAccountId: number;
  internalEvent: WebhookEvent;
};

type EventHandler = (event: Stripe.Event) => Promise<InternalMapping | null>;

const INTERNAL_EVENT_MAP: Record<string, EventHandler> = {
  "invoice.payment_succeeded": async (event) => {
    const sub = await resolveSubscriptionIdFromInvoice(event);
    if (!sub) return null;
    const acctId = await lookupOutwardAccountId(sub);
    return acctId ? { outwardAccountId: acctId, internalEvent: "payment_succeeded" } : null;
  },
  "invoice.payment_failed": async (event) => {
    const sub = await resolveSubscriptionIdFromInvoice(event);
    if (!sub) return null;
    const acctId = await lookupOutwardAccountId(sub);
    return acctId ? { outwardAccountId: acctId, internalEvent: "payment_failed_grace" } : null;
  },
  "customer.subscription.deleted": async (event) => {
    const sub = event.data.object as Stripe.Subscription;
    const acctId = await lookupOutwardAccountId(sub.id);
    return acctId
      ? { outwardAccountId: acctId, internalEvent: "subscription_cancelled" }
      : null;
  },
  "customer.subscription.updated": async (event) => {
    const sub = event.data.object as Stripe.Subscription;
    if (sub.status !== "unpaid" && sub.status !== "incomplete_expired") return null;
    const acctId = await lookupOutwardAccountId(sub.id);
    return acctId
      ? { outwardAccountId: acctId, internalEvent: "payment_failed_lapsed" }
      : null;
  },
};

async function resolveSubscriptionIdFromInvoice(
  event: Stripe.Event,
): Promise<string | null> {
  const invoice = event.data.object as Stripe.Invoice;
  const sub = (invoice as unknown as { subscription?: string | Stripe.Subscription })
    .subscription;
  if (!sub) {
    // Some Stripe API versions only expose the subscription via a fetch.
    if (invoice.id) {
      try {
        const stripe = await getUncachableStripeClient();
        const fresh = await stripe.invoices.retrieve(invoice.id);
        const freshSub = (fresh as unknown as { subscription?: string | Stripe.Subscription })
          .subscription;
        if (typeof freshSub === "string") return freshSub;
        if (freshSub && typeof freshSub === "object") return freshSub.id;
      } catch (err) {
        logger.warn({ err, invoiceId: invoice.id }, "Failed to fetch invoice for subscription id");
      }
    }
    return null;
  }
  return typeof sub === "string" ? sub : sub.id;
}

async function lookupOutwardAccountId(
  processorSubscriptionId: string,
): Promise<number | null> {
  const [row] = await db
    .select({ outwardAccountId: subscriptionsTable.outwardAccountId })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.processorSubscriptionId, processorSubscriptionId));
  return row?.outwardAccountId ?? null;
}

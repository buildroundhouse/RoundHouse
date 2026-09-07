import { Router, type IRouter } from "express";
import { eq, and, isNull, inArray } from "drizzle-orm";
import {
  db,
  outwardAccountsTable,
  subscriptionsTable,
  type OutwardAccount,
  type Subscription,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import {
  enableExpandedCapabilities,
  cancelExpandedCapabilities,
  loadOwnedOutwardAccount,
  applyWebhookEvent,
  createPaymentMethodSetupSession,
  loadPaymentMethodView,
  getExpandedBundlePricing,
  EXPANDED_BUNDLE_LABEL,
  BillingClientError,
  type WebhookEvent,
} from "../lib/billing";
import { stripeEnabled } from "../lib/stripeClient";

/**
 * Per #310: a team member acting as a company skin can only see/touch
 * billing if their seat carries the `seeBilling` permission. The skin's
 * owner (the payer) always sees their own billing.
 */
function denyForLackOfBillingPerm(ar: AuthRequest): boolean {
  if (!ar.actingAsTeamSeat) return false;
  if (ar.actingAsTeamSeat.isAdmin) return false;
  return !ar.actingAsTeamSeat.permissions.seeBilling;
}

const router: IRouter = Router();

interface BillingRow {
  outwardAccount: OutwardAccount;
  capabilityState: "standard" | "expanded";
  subscription:
    | (Pick<
        Subscription,
        "id" | "status" | "currentPeriodEnd" | "priceCents" | "currency"
      > & { bundleLabel: string })
    | null;
}

router.get("/billing/me", requireAuth, async (req, res): Promise<void> => {
  const ar = req as AuthRequest;
  if (denyForLackOfBillingPerm(ar)) {
    res.status(403).json({ error: "Your team role doesn't include billing access." });
    return;
  }
  const { userId } = ar;
  const accounts = await db
    .select()
    .from(outwardAccountsTable)
    .where(
      and(
        eq(outwardAccountsTable.ownerClerkId, userId),
        isNull(outwardAccountsTable.archivedAt),
      ),
    )
    .orderBy(outwardAccountsTable.id);
  const subs = accounts.length
    ? await db
        .select()
        .from(subscriptionsTable)
        .where(
          inArray(
            subscriptionsTable.outwardAccountId,
            accounts.map((a) => a.id),
          ),
        )
    : [];
  const subByAccount = new Map(subs.map((s) => [s.outwardAccountId, s]));
  const [paymentMethod, bundle] = await Promise.all([
    loadPaymentMethodView(userId),
    getExpandedBundlePricing(),
  ]);

  const rows: BillingRow[] = accounts.map((acct) => {
    const sub = subByAccount.get(acct.id) ?? null;
    return {
      outwardAccount: acct,
      capabilityState: acct.capabilityState,
      subscription: sub
        ? {
            id: sub.id,
            status: sub.status,
            currentPeriodEnd: sub.currentPeriodEnd,
            priceCents: sub.priceCents,
            currency: sub.currency,
            bundleLabel: bundle.label,
          }
        : null,
    };
  });

  res.json({
    paymentMethod,
    bundle: {
      label: bundle.label,
      priceCents: bundle.priceCents,
      currency: bundle.currency,
    },
    rows,
  });
});

/**
 * Returns a hosted Stripe Checkout setup-mode URL the mobile app opens
 * to collect a real card. When Stripe is not connected this falls back
 * to a no-op success response so local tests keep their existing
 * placeholder behavior.
 */
router.post(
  "/billing/payment-method",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    if (!stripeEnabled()) {
      res.json({ ok: true, payerClerkId: userId, checkoutUrl: null });
      return;
    }
    const returnUrl =
      process.env["BILLING_RETURN_URL"] ??
      `https://${process.env["REPLIT_DOMAINS"]?.split(",")[0] ?? "example.com"}/billing/return`;
    try {
      const session = await createPaymentMethodSetupSession(userId, returnUrl);
      res.json({
        ok: true,
        payerClerkId: userId,
        checkoutUrl: session.url,
        sessionId: session.sessionId,
      });
    } catch (err) {
      req.log?.error({ err }, "Failed to create Stripe setup session");
      res
        .status(502)
        .json({ error: "Couldn't start the payment-method setup session." });
    }
  },
);

router.post(
  "/outward-accounts/:id/billing/enable",
  requireAuth,
  async (req, res): Promise<void> => {
    const ar = req as AuthRequest;
    if (denyForLackOfBillingPerm(ar)) {
      res.status(403).json({ error: "Your team role doesn't include billing access." });
      return;
    }
    const { userId } = ar;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid outward account id" });
      return;
    }
    const acct = await loadOwnedOutwardAccount(userId, id);
    if (!acct || acct.archivedAt) {
      res.status(404).json({ error: "Outward account not found" });
      return;
    }
    try {
      const { subscription } = await enableExpandedCapabilities(userId, id);
      res.json({ subscription, capabilityState: "expanded" as const });
    } catch (err) {
      if (err instanceof BillingClientError) {
        res.status(409).json({ error: err.message, code: err.code });
        return;
      }
      req.log?.error({ err }, "Failed to enable expanded capabilities");
      res.status(502).json({ error: "Couldn't enable expanded capabilities." });
    }
  },
);

router.post(
  "/outward-accounts/:id/billing/cancel",
  requireAuth,
  async (req, res): Promise<void> => {
    const ar = req as AuthRequest;
    if (denyForLackOfBillingPerm(ar)) {
      res.status(403).json({ error: "Your team role doesn't include billing access." });
      return;
    }
    const { userId } = ar;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid outward account id" });
      return;
    }
    const acct = await loadOwnedOutwardAccount(userId, id);
    if (!acct) {
      res.status(404).json({ error: "Outward account not found" });
      return;
    }
    try {
      const { subscription } = await cancelExpandedCapabilities(userId, id);
      res.json({ subscription, capabilityState: "standard" as const });
    } catch (err) {
      if (err instanceof BillingClientError) {
        res.status(409).json({ error: err.message, code: err.code });
        return;
      }
      req.log?.error({ err }, "Failed to cancel expanded capabilities");
      res.status(502).json({ error: "Couldn't cancel expanded capabilities." });
    }
  },
);

const VALID_WEBHOOK_EVENTS: WebhookEvent[] = [
  "payment_succeeded",
  "payment_failed_grace",
  "payment_failed_lapsed",
  "subscription_cancelled",
];

/**
 * Internal/test webhook entry point. Real Stripe events arrive at
 * `/api/stripe/webhook` (registered in app.ts so it can read the raw
 * request body for signature verification). This route remains for
 * tests that simulate state transitions directly. Only enabled outside
 * production unless explicitly opted in.
 */
const TEST_WEBHOOK_ENABLED =
  process.env["BILLING_TEST_WEBHOOK"] === "1" ||
  process.env["NODE_ENV"] !== "production";

if (TEST_WEBHOOK_ENABLED) {
  router.post("/billing/webhook", async (req, res): Promise<void> => {
    const event = req.body?.event;
    const outwardAccountId = Number(req.body?.outwardAccountId);
    if (
      !VALID_WEBHOOK_EVENTS.includes(event) ||
      !Number.isFinite(outwardAccountId) ||
      outwardAccountId <= 0
    ) {
      res.status(400).json({ error: "Invalid webhook payload" });
      return;
    }
    const { subscription } = await applyWebhookEvent(outwardAccountId, event);
    if (!subscription) {
      res.json({ ok: true, applied: false });
      return;
    }
    res.json({ ok: true, applied: true, status: subscription.status });
  });
}

export default router;

import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  swagClaimsTable,
  brandDealOffersTable,
  dealsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import {
  buildRewardsState,
  TIERS,
  PERKS,
  BADGES,
  POINT_VALUES,
  tierForPoints,
  getPoints,
  recordPoints,
  awardDailyLogin,
} from "../lib/rewards";

const router: IRouter = Router();

router.get("/users/me/rewards", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const state = await buildRewardsState(userId);
  res.json({
    points: state.points,
    tier: state.tier,
    nextTier: state.nextTier,
    pointsToNext: state.pointsToNext,
    badges: state.badges,
    perks: state.perks,
    swagClaim: state.swagClaim,
    brandOffers: state.brandOffers,
    boostedDealId: state.boostedDealId,
    catalog: { tiers: TIERS, perks: PERKS, badges: BADGES, pointValues: POINT_VALUES },
  });
});

const STATE_RE = /^[A-Za-z]{2}$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;

router.post("/users/me/swag-claim", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const points = await getPoints(userId);
  const tier = tierForPoints(points);
  const tierOrder = TIERS.findIndex((t) => t.key === tier.key);
  const silverIdx = TIERS.findIndex((t) => t.key === "silver");
  if (tierOrder < silverIdx) {
    res.status(403).json({ error: "Reach Silver tier to claim swag" });
    return;
  }

  const body = req.body ?? {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const street = typeof body.street === "string" ? body.street.trim() : "";
  const city = typeof body.city === "string" ? body.city.trim() : "";
  const state = typeof body.state === "string" ? body.state.trim() : "";
  const zip = typeof body.zip === "string" ? body.zip.trim() : "";

  if (!name) return void res.status(400).json({ error: "Name is required" });
  if (!street) return void res.status(400).json({ error: "Street is required" });
  if (!city) return void res.status(400).json({ error: "City is required" });
  if (!STATE_RE.test(state))
    return void res.status(400).json({ error: "State must be a 2-letter code" });
  if (!ZIP_RE.test(zip))
    return void res.status(400).json({ error: "ZIP must be 5 digits (or ZIP+4)" });

  // Swag is a one-time lifetime perk: any prior claim (active or delivered)
  // disqualifies the user from claiming again.
  const [existing] = await db
    .select()
    .from(swagClaimsTable)
    .where(eq(swagClaimsTable.userClerkId, userId))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "You've already claimed your swag" });
    return;
  }

  const [claim] = await db
    .insert(swagClaimsTable)
    .values({
      userClerkId: userId,
      name,
      street,
      city,
      state: state.toUpperCase(),
      zip,
    })
    .returning();
  res.status(201).json(claim);
});

router.post("/users/me/brand-offers/:offerId/accept", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const offerId = Number(req.params.offerId);
  if (!Number.isFinite(offerId)) {
    res.status(400).json({ error: "Invalid offer id" });
    return;
  }
  const [offer] = await db
    .select()
    .from(brandDealOffersTable)
    .where(eq(brandDealOffersTable.id, offerId));
  if (!offer || offer.userClerkId !== userId) {
    res.status(404).json({ error: "Offer not found" });
    return;
  }
  if (offer.status !== "pending") {
    res.status(409).json({ error: "Offer is no longer pending" });
    return;
  }
  const [updated] = await db
    .update(brandDealOffersTable)
    .set({ status: "accepted", respondedAt: new Date() })
    .where(eq(brandDealOffersTable.id, offerId))
    .returning();

  // Stamp the brand on the public profile so it surfaces as a "Sponsored by" badge.
  await db
    .update(usersTable)
    .set({ sponsorBrandName: offer.brandName })
    .where(eq(usersTable.clerkId, userId));

  res.json(updated);
});

router.post(
  "/users/me/brand-offers/:offerId/decline",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const offerId = Number(req.params.offerId);
    if (!Number.isFinite(offerId)) {
      res.status(400).json({ error: "Invalid offer id" });
      return;
    }
    const [offer] = await db
      .select()
      .from(brandDealOffersTable)
      .where(eq(brandDealOffersTable.id, offerId));
    if (!offer || offer.userClerkId !== userId) {
      res.status(404).json({ error: "Offer not found" });
      return;
    }
    if (offer.status !== "pending") {
      res.status(409).json({ error: "Offer is no longer pending" });
      return;
    }
    const [updated] = await db
      .update(brandDealOffersTable)
      .set({ status: "declined", respondedAt: new Date() })
      .where(eq(brandDealOffersTable.id, offerId))
      .returning();
    res.json(updated);
  },
);

router.post("/deals/:dealId/boost", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const dealId = Number(req.params.dealId);
  if (!Number.isFinite(dealId)) {
    res.status(400).json({ error: "Invalid deal id" });
    return;
  }
  const points = await getPoints(userId);
  const tier = tierForPoints(points);
  const tierOrder = TIERS.findIndex((t) => t.key === tier.key);
  const goldIdx = TIERS.findIndex((t) => t.key === "gold");
  if (tierOrder < goldIdx) {
    res.status(403).json({ error: "Reach Gold tier to boost a deal" });
    return;
  }

  const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.id, dealId));
  if (!deal || deal.proClerkId !== userId) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }

  // Enforce one boosted deal per calendar month per pro.
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);

  const [existingBoost] = await db
    .select({ id: dealsTable.id })
    .from(dealsTable)
    .where(
      and(
        eq(dealsTable.proClerkId, userId),
        sql`${dealsTable.boostedUntil} is not null and ${dealsTable.boostedUntil} > ${new Date()}`,
        sql`${dealsTable.id} <> ${dealId}`,
      ),
    )
    .limit(1);
  if (existingBoost) {
    res.status(409).json({ error: "You already have a boosted deal this month" });
    return;
  }

  const [updated] = await db
    .update(dealsTable)
    .set({ boostedUntil: monthEnd })
    .where(eq(dealsTable.id, dealId))
    .returning();
  res.json(updated);
});

// ----- Generic event award endpoints --------------------------------
// Mobile clients ping these to record a points-earning event. Each is
// idempotent on its sourceRef so repeated calls don't double-award.

router.post(
  "/users/me/events/daily-login",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const body = (req.body ?? {}) as { localDate?: string; localHour?: number };
    const localDate = typeof body.localDate === "string" ? body.localDate : "";
    const hour = Number(body.localHour);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
      res.status(400).json({ error: "localDate must be YYYY-MM-DD" });
      return;
    }
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
      res.status(400).json({ error: "localHour must be 0-23" });
      return;
    }
    const result = await awardDailyLogin(userId, localDate, Math.floor(hour));
    res.json(result);
  },
);

router.post(
  "/users/me/events/roundhouse-share",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const body = (req.body ?? {}) as { sourceRef?: string };
    const sourceRef = typeof body.sourceRef === "string" && body.sourceRef.length > 0
      ? body.sourceRef
      : `share:${Date.now()}`;
    await recordPoints({ userClerkId: userId, eventType: "roundhouse_share", sourceRef });
    res.json({ ok: true });
  },
);

router.post(
  "/users/me/events/estimate-sent",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const body = (req.body ?? {}) as { sourceRef?: string };
    const sourceRef = typeof body.sourceRef === "string" && body.sourceRef.length > 0
      ? body.sourceRef
      : `estimate:${Date.now()}`;
    await recordPoints({ userClerkId: userId, eventType: "estimate_sent", sourceRef });
    res.json({ ok: true });
  },
);

router.post(
  "/users/me/events/invoice-sent",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const body = (req.body ?? {}) as { sourceRef?: string };
    const sourceRef = typeof body.sourceRef === "string" && body.sourceRef.length > 0
      ? body.sourceRef
      : `invoice:${Date.now()}`;
    await recordPoints({ userClerkId: userId, eventType: "invoice_sent", sourceRef });
    res.json({ ok: true });
  },
);

router.post(
  "/users/me/events/log-generic",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const body = (req.body ?? {}) as { sourceRef?: string };
    const sourceRef = typeof body.sourceRef === "string" && body.sourceRef.length > 0
      ? body.sourceRef
      : `log_generic:${Date.now()}`;
    await recordPoints({ userClerkId: userId, eventType: "log_generic", sourceRef });
    res.json({ ok: true });
  },
);

export default router;

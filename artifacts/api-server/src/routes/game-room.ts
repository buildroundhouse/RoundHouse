import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, desc, eq, sql, inArray } from "drizzle-orm";
import {
  db,
  pointsLedgerTable,
  prizeWinnersTable,
  usersTable,
} from "@workspace/db";
import { tryAttachAuth, type AuthRequest } from "../middlewares/requireAuth";
import { renderGameRoomDashboardHtml } from "./gameRoomDashboardHtml";
import {
  ALL_EVENT_TYPES,
  DEFAULT_POINT_VALUES,
  POINT_EVENT_LABELS,
  POINT_EVENT_DESCRIPTIONS,
  TIERS,
  getAllPointValues,
  setPointValues,
  invalidatePointValuesCache,
  getPoints,
  tierForPoints,
  isAdminUser,
  type RewardEventType,
} from "../lib/rewards";

const router: IRouter = Router();

// ----- Auth: admin Clerk id OR operator API key -----------------------
function extractOperatorCredential(req: Request): string | null {
  const headerVal = req.header("x-operator-api-key");
  if (typeof headerVal === "string" && headerVal.length > 0) return headerVal;
  const auth = req.header("authorization");
  if (typeof auth === "string" && auth.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(auth.slice(6).trim(), "base64").toString("utf8");
      const idx = decoded.indexOf(":");
      if (idx >= 0) return decoded.slice(idx + 1);
    } catch {
      return null;
    }
  }
  return null;
}

async function requireGameRoomAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Operator key short-circuits — used by the web admin dashboard.
  const expected = process.env["OPERATOR_API_KEY"];
  if (expected) {
    const provided = extractOperatorCredential(req);
    if (provided === expected) {
      next();
      return;
    }
  }
  // Otherwise, accept a verified Firebase user that's in the
  // ADMIN_CLERK_IDS allowlist (mobile path).
  await tryAttachAuth(req);
  const ar = req as AuthRequest;
  if (ar.userId && (await isAdminUser(ar.userId))) {
    next();
    return;
  }
  if (expected) res.setHeader("WWW-Authenticate", 'Basic realm="Operator", charset="UTF-8"');
  res.status(401).json({ error: "Game Room access requires admin auth" });
}

// ----- Dashboard HTML ------------------------------------------------
router.get(
  "/admin/game-room/dashboard",
  requireGameRoomAdmin,
  (_req, res): void => {
    res.type("html").send(renderGameRoomDashboardHtml());
  },
);

// ----- Score controls -------------------------------------------------
router.get(
  "/admin/game-room/score-controls",
  requireGameRoomAdmin,
  async (_req, res): Promise<void> => {
    const values = await getAllPointValues();
    const events = ALL_EVENT_TYPES.map((eventType) => ({
      eventType,
      label: POINT_EVENT_LABELS[eventType],
      description: POINT_EVENT_DESCRIPTIONS[eventType],
      defaultPoints: DEFAULT_POINT_VALUES[eventType],
      points: values[eventType] ?? DEFAULT_POINT_VALUES[eventType],
    }));
    res.setHeader("Cache-Control", "no-store");
    res.json({ events });
  },
);

router.put(
  "/admin/game-room/score-controls",
  requireGameRoomAdmin,
  async (req, res): Promise<void> => {
    const body = (req.body ?? {}) as { events?: Array<{ eventType: string; points: number }> };
    if (!Array.isArray(body.events)) {
      res.status(400).json({ error: "events must be an array" });
      return;
    }
    await setPointValues(body.events);
    invalidatePointValuesCache();
    const values = await getAllPointValues();
    const events = ALL_EVENT_TYPES.map((eventType) => ({
      eventType,
      label: POINT_EVENT_LABELS[eventType],
      description: POINT_EVENT_DESCRIPTIONS[eventType],
      defaultPoints: DEFAULT_POINT_VALUES[eventType],
      points: values[eventType] ?? DEFAULT_POINT_VALUES[eventType],
    }));
    res.json({ events });
  },
);

// ----- Live scoreboard ------------------------------------------------
router.get(
  "/admin/game-room/scoreboard",
  requireGameRoomAdmin,
  async (req, res): Promise<void> => {
    const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 100;
    const limit = Math.max(1, Math.min(500, Number.isFinite(rawLimit) ? rawLimit : 100));

    const rows = await db
      .select({
        userClerkId: pointsLedgerTable.userClerkId,
        total: sql<number>`coalesce(sum(${pointsLedgerTable.points}), 0)`.as("total"),
        events: sql<number>`count(*)`.as("events"),
      })
      .from(pointsLedgerTable)
      .groupBy(pointsLedgerTable.userClerkId)
      .orderBy(sql`coalesce(sum(${pointsLedgerTable.points}), 0) desc`)
      .limit(limit);

    const clerkIds = rows.map((r) => r.userClerkId);
    const users = clerkIds.length
      ? await db
          .select({
            clerkId: usersTable.clerkId,
            name: usersTable.name,
            username: usersTable.username,
            email: usersTable.email,
            avatarUrl: usersTable.avatarUrl,
          })
          .from(usersTable)
          .where(inArray(usersTable.clerkId, clerkIds))
      : [];
    const userByClerk = new Map(users.map((u) => [u.clerkId, u]));

    const entries = rows.map((r, i) => {
      const total = Number(r.total) || 0;
      const u = userByClerk.get(r.userClerkId);
      return {
        rank: i + 1,
        userClerkId: r.userClerkId,
        name: u?.name ?? "Unknown",
        username: u?.username ?? null,
        email: u?.email ?? null,
        avatarUrl: u?.avatarUrl ?? null,
        points: total,
        events: Number(r.events) || 0,
        tier: tierForPoints(total),
      };
    });
    res.setHeader("Cache-Control", "no-store");
    res.json({ entries });
  },
);

// ----- Per-user drill-down -------------------------------------------
router.get(
  "/admin/game-room/users/:clerkId",
  requireGameRoomAdmin,
  async (req, res): Promise<void> => {
    const clerkId = String(req.params.clerkId);
    const [user] = await db
      .select({
        clerkId: usersTable.clerkId,
        name: usersTable.name,
        username: usersTable.username,
        email: usersTable.email,
        avatarUrl: usersTable.avatarUrl,
        phone: usersTable.phone,
        addressStreet: usersTable.addressStreet,
        addressCity: usersTable.addressCity,
        addressState: usersTable.addressState,
        addressZip: usersTable.addressZip,
      })
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkId));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const points = await getPoints(clerkId);

    const history = await db
      .select()
      .from(pointsLedgerTable)
      .where(eq(pointsLedgerTable.userClerkId, clerkId))
      .orderBy(desc(pointsLedgerTable.createdAt))
      .limit(500);

    const enriched = history.map((h) => ({
      id: h.id,
      eventType: h.eventType as RewardEventType,
      label: POINT_EVENT_LABELS[h.eventType as RewardEventType] ?? h.eventType,
      points: h.points,
      sourceRef: h.sourceRef,
      createdAt: h.createdAt,
    }));

    const [latestPrize] = await db
      .select()
      .from(prizeWinnersTable)
      .where(eq(prizeWinnersTable.userClerkId, clerkId))
      .orderBy(desc(prizeWinnersTable.createdAt))
      .limit(1);

    res.setHeader("Cache-Control", "no-store");
    res.json({
      user,
      points,
      tier: tierForPoints(points),
      history: enriched,
      latestPrize: latestPrize ?? null,
    });
  },
);

// ----- Game stats -----------------------------------------------------
router.get(
  "/admin/game-room/stats",
  requireGameRoomAdmin,
  async (_req, res): Promise<void> => {
    const [totalRow] = await db
      .select({
        total: sql<number>`coalesce(sum(${pointsLedgerTable.points}), 0)`,
        events: sql<number>`count(*)`,
        users: sql<number>`count(distinct ${pointsLedgerTable.userClerkId})`,
      })
      .from(pointsLedgerTable);

    const eventBreakdown = await db
      .select({
        eventType: pointsLedgerTable.eventType,
        count: sql<number>`count(*)`,
        points: sql<number>`coalesce(sum(${pointsLedgerTable.points}), 0)`,
      })
      .from(pointsLedgerTable)
      .groupBy(pointsLedgerTable.eventType)
      .orderBy(sql`count(*) desc`);

    const breakdown = eventBreakdown.map((b) => ({
      eventType: b.eventType as RewardEventType,
      label:
        POINT_EVENT_LABELS[b.eventType as RewardEventType] ?? b.eventType,
      count: Number(b.count) || 0,
      points: Number(b.points) || 0,
    }));

    // Quick lookup helpers for the headline metrics.
    const sumOf = (...types: RewardEventType[]): { count: number; points: number } => {
      let count = 0;
      let points = 0;
      for (const b of breakdown) {
        if (types.includes(b.eventType)) {
          count += b.count;
          points += b.points;
        }
      }
      return { count, points };
    };

    res.setHeader("Cache-Control", "no-store");
    res.json({
      totals: {
        totalPoints: Number(totalRow?.total ?? 0),
        totalEvents: Number(totalRow?.events ?? 0),
        totalUsers: Number(totalRow?.users ?? 0),
      },
      headline: {
        totalLogins: sumOf("daily_login_t1", "daily_login_t2", "daily_login_t3", "daily_login_t4"),
        totalEstimates: sumOf("estimate_sent"),
        totalInvoices: sumOf("invoice_sent"),
        totalQuestionsAnswered: sumOf("question_answered"),
        totalAnswersAccepted: sumOf("question_confirmed_helpful"),
        totalShares: sumOf("roundhouse_share"),
        totalLogs: sumOf("log_completed", "log_generic"),
      },
      breakdown,
    });
  },
);

// ----- Prize management ----------------------------------------------
const VALID_PRIZE_STATUS = ["eligible", "selected", "shipped"] as const;
type PrizeStatus = (typeof VALID_PRIZE_STATUS)[number];

router.get(
  "/admin/game-room/prizes",
  requireGameRoomAdmin,
  async (req, res): Promise<void> => {
    const minPoints = Number(req.query.minPoints ?? 100) || 100;

    const eligibleRows = await db
      .select({
        userClerkId: pointsLedgerTable.userClerkId,
        total: sql<number>`coalesce(sum(${pointsLedgerTable.points}), 0)`.as("total"),
      })
      .from(pointsLedgerTable)
      .groupBy(pointsLedgerTable.userClerkId)
      .having(sql`coalesce(sum(${pointsLedgerTable.points}), 0) >= ${minPoints}`)
      .orderBy(sql`coalesce(sum(${pointsLedgerTable.points}), 0) desc`)
      .limit(500);

    const clerkIds = eligibleRows.map((r) => r.userClerkId);

    const users = clerkIds.length
      ? await db
          .select({
            clerkId: usersTable.clerkId,
            name: usersTable.name,
            username: usersTable.username,
            email: usersTable.email,
            phone: usersTable.phone,
            addressStreet: usersTable.addressStreet,
            addressCity: usersTable.addressCity,
            addressState: usersTable.addressState,
            addressZip: usersTable.addressZip,
            address: usersTable.address,
          })
          .from(usersTable)
          .where(inArray(usersTable.clerkId, clerkIds))
      : [];
    const userByClerk = new Map(users.map((u) => [u.clerkId, u]));

    const winners = clerkIds.length
      ? await db
          .select()
          .from(prizeWinnersTable)
          .where(inArray(prizeWinnersTable.userClerkId, clerkIds))
      : [];
    const winnerByClerk = new Map<string, typeof winners[number]>();
    for (const w of winners) {
      const prev = winnerByClerk.get(w.userClerkId);
      if (!prev || w.createdAt > prev.createdAt) {
        winnerByClerk.set(w.userClerkId, w);
      }
    }

    const entries = eligibleRows.map((r) => {
      const u = userByClerk.get(r.userClerkId);
      const w = winnerByClerk.get(r.userClerkId);
      return {
        userClerkId: r.userClerkId,
        name: u?.name ?? "Unknown",
        username: u?.username ?? null,
        email: u?.email ?? null,
        phone: u?.phone ?? null,
        address: {
          street: u?.addressStreet ?? null,
          city: u?.addressCity ?? null,
          state: u?.addressState ?? null,
          zip: u?.addressZip ?? null,
          legacy: u?.address ?? null,
        },
        points: Number(r.total) || 0,
        prize: w
          ? {
              id: w.id,
              status: w.status,
              prizeKey: w.prizeKey,
              notes: w.notes,
              selectedAt: w.selectedAt,
              shippedAt: w.shippedAt,
            }
          : { status: "eligible" as PrizeStatus },
      };
    });

    res.setHeader("Cache-Control", "no-store");
    res.json({ entries, minPoints });
  },
);

router.patch(
  "/admin/game-room/prizes/:userClerkId",
  requireGameRoomAdmin,
  async (req, res): Promise<void> => {
    const userClerkId = String(req.params.userClerkId);
    const body = (req.body ?? {}) as {
      status?: string;
      notes?: string | null;
      prizeKey?: string;
    };
    const status = (body.status ?? "selected") as PrizeStatus;
    if (!VALID_PRIZE_STATUS.includes(status)) {
      res.status(400).json({ error: `status must be one of ${VALID_PRIZE_STATUS.join(", ")}` });
      return;
    }

    const [user] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.clerkId, userClerkId));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const prizeKey = body.prizeKey ?? "monthly";
    const notes = body.notes ?? null;

    // Find existing prize row for this (user, prizeKey) to update in
    // place; otherwise insert a fresh one.
    const [existing] = await db
      .select()
      .from(prizeWinnersTable)
      .where(
        and(
          eq(prizeWinnersTable.userClerkId, userClerkId),
          eq(prizeWinnersTable.prizeKey, prizeKey),
        ),
      )
      .orderBy(desc(prizeWinnersTable.createdAt))
      .limit(1);

    if (status === "eligible") {
      // Reset to eligible — drop any existing prize record so the row
      // reverts to the implicit "not yet selected" state.
      if (existing) {
        await db.delete(prizeWinnersTable).where(eq(prizeWinnersTable.id, existing.id));
      }
      res.json({ ok: true, status });
      return;
    }

    const now = new Date();
    if (existing) {
      const [updated] = await db
        .update(prizeWinnersTable)
        .set({
          status,
          notes,
          shippedAt: status === "shipped" ? (existing.shippedAt ?? now) : existing.shippedAt,
          selectedAt: status === "selected" ? now : existing.selectedAt,
        })
        .where(eq(prizeWinnersTable.id, existing.id))
        .returning();
      res.json(updated);
      return;
    }
    const [inserted] = await db
      .insert(prizeWinnersTable)
      .values({
        userClerkId,
        prizeKey,
        status,
        notes,
        shippedAt: status === "shipped" ? now : null,
      })
      .returning();
    res.status(201).json(inserted);
  },
);

// ----- Tier reference (used by mobile UI) ----------------------------
router.get(
  "/admin/game-room/tiers",
  requireGameRoomAdmin,
  async (_req, res): Promise<void> => {
    res.json({ tiers: TIERS });
  },
);

export default router;

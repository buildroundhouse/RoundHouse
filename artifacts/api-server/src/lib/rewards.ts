import { and, eq, sql } from "drizzle-orm";
import {
  db,
  pointsLedgerTable,
  swagClaimsTable,
  brandDealOffersTable,
  usersTable,
  workLogsTable,
  jobRatingsTable,
  dealsTable,
  pointSettingsTable,
  dailyLoginAwardsTable,
} from "@workspace/db";

// ----- Server-side configuration (no client release needed to tune) -----
export type TierKey = "bronze" | "silver" | "gold" | "platinum";

export interface TierDef {
  key: TierKey;
  label: string;
  threshold: number;
}

export const TIERS: TierDef[] = [
  { key: "bronze", label: "Bronze", threshold: 0 },
  { key: "silver", label: "Silver", threshold: 100 },
  { key: "gold", label: "Gold", threshold: 500 },
  { key: "platinum", label: "Platinum", threshold: 1500 },
];

/**
 * All event types known to the rewards engine. New events should be
 * added here and seeded with a default value in DEFAULT_POINT_VALUES;
 * the runtime value is read from the `point_settings` table on each
 * award so admins can tune values without a redeploy.
 */
export type RewardEventType =
  | "log_completed"
  | "log_generic"
  | "job_delivered"
  | "rating_received"
  | "success_story_shared"
  | "profile_completed"
  | "app_invite_signup"
  | "question_answered"
  | "question_confirmed_helpful"
  | "estimate_sent"
  | "invoice_sent"
  | "roundhouse_share"
  | "daily_login_t1"
  | "daily_login_t2"
  | "daily_login_t3"
  | "daily_login_t4";

export const DEFAULT_POINT_VALUES: Record<RewardEventType, number> = {
  log_completed: 5,
  log_generic: 2,
  job_delivered: 25,
  rating_received: 15,
  success_story_shared: 50,
  profile_completed: 75,
  app_invite_signup: 10,
  question_answered: 5,
  question_confirmed_helpful: 20,
  estimate_sent: 20,
  invoice_sent: 50,
  roundhouse_share: 10,
  daily_login_t1: 10, // before 6 AM
  daily_login_t2: 5,  // before 7 AM
  daily_login_t3: 3,  // before 9 AM
  daily_login_t4: 2,  // 9 AM and after
};

export const POINT_EVENT_LABELS: Record<RewardEventType, string> = {
  log_completed: "Log completed",
  log_generic: "Generic work log",
  job_delivered: "Job delivered",
  rating_received: "Rating received",
  success_story_shared: "Success story shared",
  profile_completed: "Profile completed",
  app_invite_signup: "App invite signup",
  question_answered: "Question answered",
  question_confirmed_helpful: "Answer confirmed helpful",
  estimate_sent: "Estimate sent",
  invoice_sent: "Invoice sent",
  roundhouse_share: "Shared Roundhouse",
  daily_login_t1: "Daily login (before 6 AM)",
  daily_login_t2: "Daily login (before 7 AM)",
  daily_login_t3: "Daily login (before 9 AM)",
  daily_login_t4: "Daily login (after 9 AM)",
};

export const POINT_EVENT_DESCRIPTIONS: Record<RewardEventType, string> = {
  log_completed: "Awarded the first time a work log is created.",
  log_generic: "Awarded for any additional valid log entry (incl. post-dated).",
  job_delivered: "Awarded to the assignee when a log is created in 'done' state.",
  rating_received: "Awarded when a homeowner rates the pro on a job.",
  success_story_shared: "Awarded when a delivered job is shared as a success story.",
  profile_completed: "Awarded once the bio, avatar, contact and services are filled in.",
  app_invite_signup: "Awarded when an invited person signs up.",
  question_answered: "Awarded to providers for answering a client's question.",
  question_confirmed_helpful: "Awarded when the client marks an answer as helpful.",
  estimate_sent: "Awarded each time an estimate is sent to a client.",
  invoice_sent: "Awarded each time an invoice is sent to a client.",
  roundhouse_share: "Awarded when a user shares Roundhouse with someone new.",
  daily_login_t1: "First login of the day before 6:00 AM (local).",
  daily_login_t2: "First login of the day before 7:00 AM (local).",
  daily_login_t3: "First login of the day before 9:00 AM (local).",
  daily_login_t4: "First login of the day at 9:00 AM (local) or later.",
};

export const ALL_EVENT_TYPES: RewardEventType[] = Object.keys(
  DEFAULT_POINT_VALUES,
) as RewardEventType[];

export type PerkKey = "swag" | "free_advertising" | "search_boost" | "brand_deals";

export interface PerkDef {
  key: PerkKey;
  tier: TierKey;
  name: string;
  description: string;
}

export const PERKS: PerkDef[] = [
  { key: "swag", tier: "silver", name: "Roundhouse swag", description: "Claim a one-time merch shipment shipped to your door." },
  { key: "free_advertising", tier: "gold", name: "Free monthly Deal boost", description: "Boost one of your Deals & Offers in the homeowner carousel each month." },
  { key: "search_boost", tier: "platinum", name: "Top-of-search placement", description: "Surface above default results in Find a Pro, rotated fairly with other Platinum pros." },
  { key: "brand_deals", tier: "platinum", name: "Curated brand deals", description: "Roundhouse staff curates sponsored offers from suppliers and manufacturers for you." },
];

export interface BadgeDef {
  key: string;
  label: string;
  description: string;
  howTo: string;
  tier: TierKey;
}

export const BADGES: BadgeDef[] = [
  { key: "first_log", label: "First Log", tier: "bronze", description: "Logged your first piece of work.", howTo: "Complete your first log entry." },
  { key: "ten_logs", label: "Ten Logs", tier: "bronze", description: "Logged ten work entries.", howTo: "Complete 10 log entries." },
  { key: "first_job", label: "First Job", tier: "silver", description: "Delivered your first assigned job.", howTo: "Complete a job assigned to you." },
  { key: "five_star", label: "Five-Star", tier: "silver", description: "Earned a perfect rating.", howTo: "Receive a 5-star rating from a homeowner." },
  { key: "ten_jobs", label: "Ten Jobs", tier: "gold", description: "Delivered ten jobs.", howTo: "Complete 10 assigned jobs." },
  { key: "storyteller", label: "Storyteller", tier: "gold", description: "Shared a success story.", howTo: "Share a completed job as a success story." },
  { key: "profile_pro", label: "Profile Pro", tier: "gold", description: "Filled in your full profile.", howTo: "Complete your bio, services, and contact info." },
  { key: "fifty_jobs", label: "Fifty Jobs", tier: "platinum", description: "Delivered fifty jobs.", howTo: "Complete 50 assigned jobs." },
];

// ----- Cached point-value lookup -----
// 30-second cache keeps the hot path cheap while still picking up
// admin edits within seconds without a server restart.
let _cache: Record<string, number> | null = null;
let _cacheAt = 0;
const CACHE_TTL_MS = 30_000;

export function invalidatePointValuesCache(): void {
  _cache = null;
  _cacheAt = 0;
}

async function loadPointValuesFromDb(): Promise<Record<string, number>> {
  const rows = await db.select().from(pointSettingsTable);
  const map: Record<string, number> = { ...DEFAULT_POINT_VALUES };
  for (const r of rows) map[r.eventType] = r.points;
  return map;
}

export async function getAllPointValues(): Promise<Record<string, number>> {
  const now = Date.now();
  if (_cache && now - _cacheAt < CACHE_TTL_MS) return _cache;
  _cache = await loadPointValuesFromDb();
  _cacheAt = now;
  return _cache;
}

export async function getPointValue(eventType: RewardEventType): Promise<number> {
  const all = await getAllPointValues();
  const v = all[eventType];
  if (typeof v === "number") return v;
  return DEFAULT_POINT_VALUES[eventType] ?? 0;
}

/**
 * Backwards-compatible synchronous lookup used by older callers that
 * still want the default values directly. New code should prefer
 * `getPointValue()` so admin overrides are honoured.
 */
export const POINT_VALUES: Record<RewardEventType, number> = DEFAULT_POINT_VALUES;

/**
 * Persist the full set of admin-supplied point values. Unknown event
 * types are rejected (we only allow the curated `RewardEventType`
 * union); known events are upserted.
 */
export async function setPointValues(
  values: Array<{ eventType: string; points: number }>,
): Promise<void> {
  for (const v of values) {
    if (!ALL_EVENT_TYPES.includes(v.eventType as RewardEventType)) continue;
    const points = Math.max(0, Math.floor(Number(v.points) || 0));
    await db
      .insert(pointSettingsTable)
      .values({
        eventType: v.eventType,
        points,
        label: POINT_EVENT_LABELS[v.eventType as RewardEventType] ?? "",
        description: POINT_EVENT_DESCRIPTIONS[v.eventType as RewardEventType] ?? "",
      })
      .onConflictDoUpdate({
        target: pointSettingsTable.eventType,
        set: { points, updatedAt: new Date() },
      });
  }
  invalidatePointValuesCache();
}

// ----- Helpers -----
export function tierForPoints(points: number): TierDef {
  let current = TIERS[0];
  for (const t of TIERS) if (points >= t.threshold) current = t;
  return current;
}

export function nextTierForPoints(points: number): TierDef | null {
  for (const t of TIERS) if (t.threshold > points) return t;
  return null;
}

/**
 * Insert a points ledger entry. Idempotent on (userClerkId, eventType, sourceRef)
 * when sourceRef is provided — duplicate inserts are no-ops.
 *
 * Reads the runtime point value from `point_settings` so admin tuning
 * via the Game Room takes effect on the next award without restart.
 */
export async function recordPoints(args: {
  userClerkId: string;
  eventType: RewardEventType;
  sourceRef?: string | null;
  pointsOverride?: number;
}): Promise<void> {
  const points =
    args.pointsOverride ?? (await getPointValue(args.eventType));
  if (!points || points <= 0) return;

  if (args.sourceRef) {
    const [existing] = await db
      .select({ id: pointsLedgerTable.id })
      .from(pointsLedgerTable)
      .where(
        and(
          eq(pointsLedgerTable.userClerkId, args.userClerkId),
          eq(pointsLedgerTable.eventType, args.eventType),
          eq(pointsLedgerTable.sourceRef, args.sourceRef),
        ),
      )
      .limit(1);
    if (existing) return;
  }

  await db.insert(pointsLedgerTable).values({
    userClerkId: args.userClerkId,
    eventType: args.eventType,
    points,
    sourceRef: args.sourceRef ?? null,
  });
}

export function dailyLoginTierForHour(hour: number): {
  eventType: RewardEventType;
  label: string;
} {
  if (hour < 6) return { eventType: "daily_login_t1", label: "Before 6 AM" };
  if (hour < 7) return { eventType: "daily_login_t2", label: "Before 7 AM" };
  if (hour < 9) return { eventType: "daily_login_t3", label: "Before 9 AM" };
  return { eventType: "daily_login_t4", label: "After 9 AM" };
}

/**
 * Award the time-tiered first-of-day login bonus. Idempotent per
 * (userClerkId, localDate): the first call inserts the daily marker
 * and writes a points-ledger entry; subsequent calls on the same
 * local date are no-ops.
 */
export async function awardDailyLogin(
  userClerkId: string,
  localDate: string,
  localHour: number,
): Promise<{ awarded: boolean; eventType: RewardEventType; points: number }> {
  const tier = dailyLoginTierForHour(localHour);
  const points = await getPointValue(tier.eventType);
  // Use the unique index on (user_clerk_id, local_date) to enforce one
  // per local day. ON CONFLICT DO NOTHING tells us if we just inserted.
  const inserted = await db
    .insert(dailyLoginAwardsTable)
    .values({
      userClerkId,
      localDate,
      localHour: String(localHour),
      points: String(points),
    })
    .onConflictDoNothing({
      target: [
        dailyLoginAwardsTable.userClerkId,
        dailyLoginAwardsTable.localDate,
      ],
    })
    .returning();
  if (inserted.length === 0) {
    return { awarded: false, eventType: tier.eventType, points: 0 };
  }
  await recordPoints({
    userClerkId,
    eventType: tier.eventType,
    sourceRef: `daily_login:${localDate}`,
  });
  return { awarded: true, eventType: tier.eventType, points };
}

export async function getPoints(userClerkId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${pointsLedgerTable.points}), 0)` })
    .from(pointsLedgerTable)
    .where(eq(pointsLedgerTable.userClerkId, userClerkId));
  return Number(row?.total ?? 0);
}

export interface EarnedBadge {
  key: string;
  label: string;
  description: string;
  howTo: string;
  tier: TierKey;
  earned: boolean;
}

export async function computeBadges(userClerkId: string): Promise<EarnedBadge[]> {
  const [logCountRow] = await db
    .select({ c: sql<number>`count(*)` })
    .from(workLogsTable)
    .where(eq(workLogsTable.authorClerkId, userClerkId));
  const logCount = Number(logCountRow?.c ?? 0);

  const [jobCountRow] = await db
    .select({ c: sql<number>`count(*)` })
    .from(workLogsTable)
    .where(
      and(
        eq(workLogsTable.assigneeClerkId, userClerkId),
        eq(workLogsTable.status, "done"),
      ),
    );
  const jobCount = Number(jobCountRow?.c ?? 0);

  const [storyRow] = await db
    .select({ c: sql<number>`count(*)` })
    .from(workLogsTable)
    .where(
      and(
        eq(workLogsTable.assigneeClerkId, userClerkId),
        eq(workLogsTable.isSuccessStory, true),
      ),
    );
  const storyCount = Number(storyRow?.c ?? 0);

  const [fiveStarRow] = await db
    .select({ c: sql<number>`count(*)` })
    .from(jobRatingsTable)
    .where(
      and(
        eq(jobRatingsTable.memberClerkId, userClerkId),
        eq(jobRatingsTable.stars, 5),
      ),
    );
  const fiveStarCount = Number(fiveStarRow?.c ?? 0);

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkId, userClerkId));
  const profileComplete = isProfileComplete(user);

  const earned: Record<string, boolean> = {
    first_log: logCount >= 1,
    ten_logs: logCount >= 10,
    first_job: jobCount >= 1,
    ten_jobs: jobCount >= 10,
    fifty_jobs: jobCount >= 50,
    five_star: fiveStarCount >= 1,
    storyteller: storyCount >= 1,
    profile_pro: profileComplete,
  };

  return BADGES.map((b) => ({
    key: b.key,
    label: b.label,
    tier: b.tier,
    description: b.description,
    howTo: b.howTo,
    earned: earned[b.key] === true,
  }));
}

export function isProfileComplete(user: typeof usersTable.$inferSelect | undefined): boolean {
  if (!user) return false;
  const hasBio = !!user.bio && user.bio.trim().length > 0;
  const hasAvatar = !!user.avatarUrl && user.avatarUrl.trim().length > 0;
  const hasContact =
    !!(user.phone || user.cellPhone || user.officePhone) ||
    !!user.address ||
    !!user.website;
  const hasServices = Array.isArray(user.services) && user.services.length > 0;
  return hasBio && hasAvatar && hasContact && hasServices;
}

export async function maybeAwardProfileCompleted(userClerkId: string): Promise<void> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, userClerkId));
  if (isProfileComplete(user)) {
    await recordPoints({
      userClerkId,
      eventType: "profile_completed",
      sourceRef: "self",
    });
  }
}

// ----- Admin allowlist (Tony's account etc.) -----
/**
 * Resolve the list of Firebase/Clerk user ids that are treated as
 * Game Room admins on the mobile side. Sourced from the
 * ADMIN_CLERK_IDS env (comma-separated). Empty / unset means no
 * mobile admin sees the Game Room — the web dashboard is still
 * reachable via the existing OPERATOR_API_KEY gate.
 */
export function getAdminClerkIds(): string[] {
  const raw = process.env["ADMIN_CLERK_IDS"] ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function isAdminClerkId(clerkId: string | null | undefined): boolean {
  if (!clerkId) return false;
  return getAdminClerkIds().includes(clerkId);
}

/**
 * Resolves admin status by combining the env-allowlist (legacy / ops
 * accounts) with the per-user `users.is_admin` flag (real admin
 * accounts created in-app, e.g. "Savage"). Use this anywhere admin
 * gating decides between admin-only and member behavior. Returns
 * false on missing input or DB lookup failure.
 */
export async function isAdminUser(clerkId: string | null | undefined): Promise<boolean> {
  if (!clerkId) return false;
  if (getAdminClerkIds().includes(clerkId)) return true;
  try {
    const row = await db
      .select({ isAdmin: usersTable.isAdmin })
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkId))
      .limit(1);
    return row[0]?.isAdmin === true;
  } catch {
    return false;
  }
}

export interface RewardsState {
  points: number;
  tier: TierDef;
  nextTier: TierDef | null;
  pointsToNext: number;
  badges: EarnedBadge[];
  perks: Array<{
    key: PerkKey;
    tier: TierKey;
    name: string;
    description: string;
    unlocked: boolean;
    requirement: string;
  }>;
  swagClaim: typeof swagClaimsTable.$inferSelect | null;
  brandOffers: Array<typeof brandDealOffersTable.$inferSelect>;
  boostedDealId: number | null;
}

export async function buildRewardsState(userClerkId: string): Promise<RewardsState> {
  const points = await getPoints(userClerkId);
  const tier = tierForPoints(points);
  const next = nextTierForPoints(points);
  const badges = await computeBadges(userClerkId);
  const tierIdx = TIERS.findIndex((t) => t.key === tier.key);
  const perks = PERKS.map((p) => {
    const perkIdx = TIERS.findIndex((t) => t.key === p.tier);
    const unlocked = tierIdx >= perkIdx;
    return {
      key: p.key,
      tier: p.tier,
      name: p.name,
      description: p.description,
      unlocked,
      requirement: unlocked
        ? "Unlocked"
        : `Reach ${TIERS[perkIdx].label} (${TIERS[perkIdx].threshold} points)`,
    };
  });

  const [swagClaim] = await db
    .select()
    .from(swagClaimsTable)
    .where(eq(swagClaimsTable.userClerkId, userClerkId))
    .orderBy(sql`${swagClaimsTable.createdAt} desc`)
    .limit(1);

  const brandOffers = await db
    .select()
    .from(brandDealOffersTable)
    .where(eq(brandDealOffersTable.userClerkId, userClerkId))
    .orderBy(sql`${brandDealOffersTable.createdAt} desc`);

  const now = new Date();
  const [boosted] = await db
    .select({ id: dealsTable.id })
    .from(dealsTable)
    .where(
      and(
        eq(dealsTable.proClerkId, userClerkId),
        sql`${dealsTable.boostedUntil} is not null and ${dealsTable.boostedUntil} > ${now}`,
      ),
    )
    .limit(1);

  return {
    points,
    tier,
    nextTier: next,
    pointsToNext: next ? Math.max(0, next.threshold - points) : 0,
    badges,
    perks,
    swagClaim: swagClaim ?? null,
    brandOffers,
    boostedDealId: boosted?.id ?? null,
  };
}

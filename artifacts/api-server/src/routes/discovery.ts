import { Router, type IRouter } from "express";
import { and, desc, eq, gt, gte, ilike, inArray, lte, ne, or, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  userModesTable,
  workLogsTable,
  propertiesTable,
  jobRatingsTable,
  dealsTable,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { publicUserColumns } from "../lib/userPublic";
import { recordPoints, tierForPoints } from "../lib/rewards";
import { excludeDemoUsersWhere, notDemoUserPredicate } from "../lib/adminDemo";
import { getMembershipForProperty } from "../lib/propertyAccess";

const router: IRouter = Router();

const MAX_LIMIT = 50;

function clampLimit(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Synonyms keep the search forgiving (sheetrock → drywall, etc).
const SYNONYMS: Record<string, string[]> = {
  sheetrock: ["drywall", "wallboard"],
  drywall: ["sheetrock", "wallboard"],
  ac: ["hvac", "air conditioning"],
  hvac: ["ac", "air conditioning", "heating"],
  plumber: ["plumbing", "pipe"],
  plumbing: ["plumber", "pipe"],
  electric: ["electrician", "electrical"],
  electrician: ["electric", "electrical"],
  paint: ["painter", "painting"],
  lawn: ["landscaper", "landscaping", "yard"],
};

function expandQuery(q: string): string[] {
  const terms = new Set<string>();
  const norm = q.toLowerCase().trim();
  if (!norm) return [];
  terms.add(norm);
  for (const word of norm.split(/\s+/)) {
    terms.add(word);
    for (const syn of SYNONYMS[word] ?? []) terms.add(syn);
  }
  return Array.from(terms).filter((t) => t.length >= 2);
}

// -------------- Pros search --------------

router.get("/pros/search", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const zip = typeof req.query.zip === "string" ? req.query.zip.trim() : "";
  const trade = typeof req.query.trade === "string" ? req.query.trade.trim().toLowerCase() : "";
  const limit = clampLimit(req.query.limit, 30);

  const conditions = [
    ne(usersTable.clerkId, userId),
    eq(userModesTable.kind, "trade_pro"),
    // #672 / #677 — keep admin Wardrobe demo personas out of the
    // consumer pros directory. Since this query already joins on
    // `usersTable`, use the column predicate (`users.is_demo = false`)
    // instead of a per-row subquery. The flag is mirrored from
    // `admin_demo_profiles` by the shared write helpers in
    // `lib/adminDemo.ts`.
    notDemoUserPredicate(),
  ];

  if (q) {
    const terms = expandQuery(q);
    const orClauses = terms.flatMap((t) => {
      const pat = `%${escapeLike(t)}%`;
      return [
        ilike(usersTable.name, pat),
        ilike(usersTable.username, pat),
        ilike(usersTable.companyName, pat),
        sql`${userModesTable.intakeData}::text ilike ${pat}`,
      ];
    });
    if (orClauses.length > 0) conditions.push(or(...orClauses)!);
  }

  if (zip) {
    conditions.push(sql`${zip} = ANY(${usersTable.serviceZips})`);
  }

  if (trade) {
    conditions.push(sql`lower(${userModesTable.intakeData}->>'trade') = ${trade}`);
  }

  const rows = await db
    .select({
      id: usersTable.id,
      clerkId: usersTable.clerkId,
      name: usersTable.name,
      username: usersTable.username,
      avatarUrl: usersTable.avatarUrl,
      companyName: usersTable.companyName,
      slogan: usersTable.slogan,
      serviceZips: usersTable.serviceZips,
      trade: sql<string | null>`${userModesTable.intakeData}->>'trade'`,
    })
    .from(usersTable)
    .innerJoin(userModesTable, eq(userModesTable.id, usersTable.lastActiveModeId))
    .where(and(...conditions))
    .limit(limit);

  if (rows.length === 0) {
    res.json({ pros: [] });
    return;
  }

  const clerkIds = rows.map((r) => r.clerkId);

  const ratingRows = await db
    .select({
      memberClerkId: jobRatingsTable.memberClerkId,
      avgRating: sql<number>`avg(${jobRatingsTable.stars})`,
      ratingCount: sql<number>`count(*)`,
    })
    .from(jobRatingsTable)
    .where(inArray(jobRatingsTable.memberClerkId, clerkIds))
    .groupBy(jobRatingsTable.memberClerkId);

  const ratingMap = new Map(ratingRows.map((r) => [r.memberClerkId, r]));

  const jobRows = await db
    .select({
      assigneeClerkId: workLogsTable.assigneeClerkId,
      jobCount: sql<number>`count(*)`,
    })
    .from(workLogsTable)
    .where(inArray(workLogsTable.assigneeClerkId, clerkIds))
    .groupBy(workLogsTable.assigneeClerkId);

  const jobMap = new Map(
    jobRows.filter((r) => r.assigneeClerkId).map((r) => [r.assigneeClerkId as string, r.jobCount]),
  );

  // Pull point totals for the candidate pros so we can surface Platinum tier
  // pros above the default top-rated results, rotated fairly within the pool.
  const { pointsLedgerTable } = await import("@workspace/db");
  const pointRows = await db
    .select({
      userClerkId: pointsLedgerTable.userClerkId,
      total: sql<number>`coalesce(sum(${pointsLedgerTable.points}), 0)`,
    })
    .from(pointsLedgerTable)
    .where(inArray(pointsLedgerTable.userClerkId, clerkIds))
    .groupBy(pointsLedgerTable.userClerkId);
  const pointMap = new Map(pointRows.map((r) => [r.userClerkId, Number(r.total)]));

  // Also pull sponsor brand from user rows so we can render a "Sponsored by"
  // badge on each pro card.
  const sponsorRows = await db
    .select({ clerkId: usersTable.clerkId, sponsor: usersTable.sponsorBrandName })
    .from(usersTable)
    .where(inArray(usersTable.clerkId, clerkIds));
  const sponsorMap = new Map(sponsorRows.map((r) => [r.clerkId, r.sponsor]));

  const enriched = rows.map((r) => {
    const rating = ratingMap.get(r.clerkId);
    const points = pointMap.get(r.clerkId) ?? 0;
    const tier = tierForPoints(points);
    return {
      ...r,
      avgRating: rating ? Number(rating.avgRating) : null,
      ratingCount: rating ? Number(rating.ratingCount) : 0,
      jobCount: Number(jobMap.get(r.clerkId) ?? 0),
      tier: tier.key,
      tierLabel: tier.label,
      topPro: tier.key === "platinum",
      sponsorBrandName: sponsorMap.get(r.clerkId) ?? null,
    };
  });

  // Default sort: avg rating desc, then job count desc.
  enriched.sort((a, b) => {
    const ra = a.avgRating ?? 0;
    const rb = b.avgRating ?? 0;
    if (rb !== ra) return rb - ra;
    return b.jobCount - a.jobCount;
  });

  // Surface Platinum pros at the top, rotated by a daily seed so each Platinum
  // pro gets a fair turn at the marquee position.
  const platinums = enriched.filter((p) => p.topPro);
  const others = enriched.filter((p) => !p.topPro);
  const dayKey = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  if (platinums.length > 1) {
    const offset = dayKey % platinums.length;
    const rotated = [...platinums.slice(offset), ...platinums.slice(0, offset)];
    platinums.length = 0;
    platinums.push(...rotated);
  }

  res.json({ pros: [...platinums, ...others] });
});

// -------------- Area feed --------------

router.get("/area-feed", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const queryZip = typeof req.query.zip === "string" ? req.query.zip.trim() : "";
  const limit = clampLimit(req.query.limit, 20);

  let zip = queryZip;
  if (!zip) {
    const [me] = await db
      .select({ addressZip: usersTable.addressZip })
      .from(usersTable)
      .where(eq(usersTable.clerkId, userId));
    zip = me?.addressZip ?? "";
  }

  // Find properties whose zip matches the area (best-effort: parse from address text).
  const propConditions = [];
  if (zip) propConditions.push(sql`${propertiesTable.address} ilike ${`%${zip}%`}`);
  const properties = zip
    ? await db
        .select({ id: propertiesTable.id, name: propertiesTable.name, address: propertiesTable.address })
        .from(propertiesTable)
        .where(and(...propConditions))
        .limit(200)
    : [];

  const propIds = properties.map((p) => p.id);
  const propMap = new Map(properties.map((p) => [p.id, p]));

  // Pull recent logs that are completed or shared as success stories.
  const baseWhere = [eq(workLogsTable.status, "done")];
  if (propIds.length > 0) {
    baseWhere.push(inArray(workLogsTable.propertyId, propIds));
  }

  // #672 / #677 — never surface a job whose assignee is a demo
  // persona, even if the underlying property happens to be in the
  // area / the log happens to be a success story. The anti-join is
  // keyed on the assignee's clerk id; logs without an assignee
  // (DIY-by-owner) pass through untouched. The `excludeDemoUsersWhere`
  // helper is a `NOT EXISTS` against `users.is_demo` covered by the
  // `users_is_demo_partial_idx` partial index, so the lookup stays
  // cheap as the user table grows.
  const notDemoAssignee = or(
    sql`${workLogsTable.assigneeClerkId} IS NULL`,
    excludeDemoUsersWhere(workLogsTable.assigneeClerkId),
  )!;

  const logs = await db
    .select()
    .from(workLogsTable)
    .where(
      and(
        notDemoAssignee,
        or(
          eq(workLogsTable.isSuccessStory, true),
          and(...baseWhere),
        )!,
      ),
    )
    .orderBy(desc(workLogsTable.completedAt), desc(workLogsTable.createdAt))
    .limit(limit * 2);

  const proIds = Array.from(
    new Set(logs.map((l) => l.assigneeClerkId).filter(Boolean) as string[]),
  );
  const pros = proIds.length > 0
    ? await db.select(publicUserColumns).from(usersTable).where(inArray(usersTable.clerkId, proIds))
    : [];
  const proMap = new Map(pros.map((p) => [p.clerkId, p]));

  const items = logs
    .filter((l) => l.isSuccessStory || propMap.has(l.propertyId))
    .slice(0, limit)
    .map((l) => {
      const property = propMap.get(l.propertyId);
      const pro = l.assigneeClerkId ? proMap.get(l.assigneeClerkId) ?? null : null;
      const hidden = l.successStoryHidden;
      return {
        id: l.id,
        kind: l.isSuccessStory ? ("success_story" as const) : ("completed_job" as const),
        headline:
          (l.isSuccessStory && l.successStoryBlurb) ||
          (l.note ? l.note.split("\n")[0].slice(0, 120) : "Job completed"),
        blurb: l.isSuccessStory ? l.successStoryBlurb ?? null : null,
        photoUrl: l.photoUrl ?? null,
        serviceTag: l.successStoryServiceTag ?? null,
        zip: zip || null,
        propertyName: hidden ? null : property?.name ?? null,
        createdAt: (l.completedAt ?? l.createdAt).toISOString(),
        pro,
      };
    });

  res.json({ items });
});

// -------------- Success stories search --------------

// Fixed 14-category taxonomy used by the Find page. Each category maps to a
// list of substring matches against either the structured service tag or the
// log's free-text fields (note, blurb).
const STORY_CATEGORY_TERMS: Record<string, string[]> = {
  "Designer / Architect": ["designer", "architect", "interior design", "design"],
  "Housekeeper": ["housekeeper", "housekeeping", "house cleaner", "cleaner", "cleaning", "maid"],
  "Contractor": ["contractor", "gc ", "general contractor", "general"],
  "Handyman": ["handyman", "handyperson"],
  "Electrician": ["electrician", "electric", "electrical", "wiring"],
  "Plumber": ["plumber", "plumbing", "pipe"],
  "Landscaper": ["landscaper", "landscaping", "landscape", "lawn", "yard", "garden"],
  "Tree Trimmer": ["tree trimmer", "tree trimming", "arborist", "tree"],
  "Roofer": ["roofer", "roofing", "roof"],
  "Pest Control": ["pest", "exterminator", "pest control"],
  "Security / IT": ["security", "alarm", "cctv", "camera", "it ", "network", "wifi"],
  "Pool": ["pool"],
  "HVAC": ["hvac", "ac ", "air conditioning", "heating", "furnace", "heat pump"],
  "Home Staging": ["home staging", "staging", "stager"],
};

router.get("/success-stories/search", requireAuth, async (_req, res): Promise<void> => {
  const q = typeof _req.query.q === "string" ? _req.query.q.trim() : "";
  const categoryRaw =
    typeof _req.query.category === "string" ? _req.query.category.trim() : "";
  const limit = clampLimit(_req.query.limit, 30);

  const conditions = [
    eq(workLogsTable.isSuccessStory, true),
    eq(workLogsTable.successStoryHidden, false),
    // #672 — exclude stories whose assigned pro is a demo persona,
    // matching the rule used by every other public discovery surface.
    // Author-only stories (no assignee) still pass through.
    or(
      sql`${workLogsTable.assigneeClerkId} IS NULL`,
      excludeDemoUsersWhere(workLogsTable.assigneeClerkId),
    )!,
  ];
  if (q) {
    const terms = expandQuery(q);
    const orClauses = terms.flatMap((t) => {
      const pat = `%${escapeLike(t)}%`;
      return [
        ilike(workLogsTable.successStoryBlurb, pat),
        ilike(workLogsTable.note, pat),
        ilike(workLogsTable.successStoryServiceTag, pat),
      ];
    });
    if (orClauses.length > 0) conditions.push(or(...orClauses)!);
  }
  if (categoryRaw) {
    const terms = STORY_CATEGORY_TERMS[categoryRaw];
    if (!terms || terms.length === 0) {
      // Unknown category — return nothing rather than ignoring it silently.
      res.json({ stories: [] });
      return;
    }
    const orClauses = terms.flatMap((t) => {
      const pat = `%${escapeLike(t)}%`;
      return [
        ilike(workLogsTable.successStoryServiceTag, pat),
        ilike(workLogsTable.successStoryBlurb, pat),
        ilike(workLogsTable.note, pat),
      ];
    });
    conditions.push(or(...orClauses)!);
  }

  const logs = await db
    .select()
    .from(workLogsTable)
    .where(and(...conditions))
    .orderBy(desc(workLogsTable.successStoryAt), desc(workLogsTable.createdAt))
    .limit(limit);

  const proIds = Array.from(
    new Set(logs.map((l) => l.assigneeClerkId).filter(Boolean) as string[]),
  );
  const propIds = Array.from(new Set(logs.map((l) => l.propertyId)));
  const [pros, properties] = await Promise.all([
    proIds.length > 0
      ? db.select(publicUserColumns).from(usersTable).where(inArray(usersTable.clerkId, proIds))
      : Promise.resolve([]),
    propIds.length > 0
      ? db
          .select({ id: propertiesTable.id, name: propertiesTable.name, address: propertiesTable.address })
          .from(propertiesTable)
          .where(inArray(propertiesTable.id, propIds))
      : Promise.resolve([]),
  ]);
  const proMap = new Map(pros.map((p) => [p.clerkId, p]));
  const propMap = new Map(properties.map((p) => [p.id, p]));

  const stories = logs.map((l) => {
    const prop = propMap.get(l.propertyId);
    return {
      id: l.id,
      headline: l.successStoryBlurb || (l.note ? l.note.split("\n")[0].slice(0, 120) : "Success story"),
      blurb: l.successStoryBlurb ?? null,
      serviceTag: l.successStoryServiceTag ?? null,
      photoUrl: l.photoUrl ?? null,
      propertyId: l.propertyId ?? null,
      propertyName: prop?.name ?? null,
      zip: null,
      createdAt: (l.successStoryAt ?? l.completedAt ?? l.createdAt).toISOString(),
      pro: l.assigneeClerkId ? proMap.get(l.assigneeClerkId) ?? null : null,
    };
  });

  res.json({ stories });
});

// -------------- Share / hide success story --------------

router.post("/logs/:logId/share-success", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const logId = Number(req.params.logId);
  if (!Number.isFinite(logId)) {
    res.status(400).json({ error: "Invalid log id" });
    return;
  }
  const [log] = await db.select().from(workLogsTable).where(eq(workLogsTable.id, logId));
  if (!log) {
    res.status(404).json({ error: "Log not found" });
    return;
  }
  // The assigned pro is the only one who can flip a job into a story.
  if (log.assigneeClerkId !== userId && log.authorClerkId !== userId) {
    res.status(403).json({ error: "Only the pro on the job can share it" });
    return;
  }
  const blurb = typeof req.body?.blurb === "string" ? req.body.blurb.trim().slice(0, 280) : null;
  const serviceTag = typeof req.body?.serviceTag === "string" ? req.body.serviceTag.trim().slice(0, 60) : null;

  const [updated] = await db
    .update(workLogsTable)
    .set({
      isSuccessStory: true,
      successStoryAt: new Date(),
      successStoryBlurb: blurb && blurb.length > 0 ? blurb : null,
      successStoryServiceTag: serviceTag && serviceTag.length > 0 ? serviceTag : null,
    })
    .where(eq(workLogsTable.id, logId))
    .returning();

  // Reward the pro for sharing a success story (idempotent on logId).
  if (log.assigneeClerkId) {
    await recordPoints({
      userClerkId: log.assigneeClerkId,
      eventType: "success_story_shared",
      sourceRef: `log:${logId}`,
    });
  }

  res.json(updated);
});

router.post("/logs/:logId/hide-from-stories", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const logId = Number(req.params.logId);
  if (!Number.isFinite(logId)) {
    res.status(400).json({ error: "Invalid log id" });
    return;
  }
  const [log] = await db.select().from(workLogsTable).where(eq(workLogsTable.id, logId));
  if (!log) {
    res.status(404).json({ error: "Log not found" });
    return;
  }
  // Only the property owner (or members with `owner`/`admin` role) can hide their property.
  const [prop] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, log.propertyId));
  if (!prop) {
    res.status(404).json({ error: "Property not found" });
    return;
  }
  const isOwner = prop.ownerClerkId === userId;
  let isAdmin = false;
  if (!isOwner) {
    const member = await getMembershipForProperty(prop.id, userId);
    isAdmin = member?.role === "owner" || member?.role === "admin";
  }
  if (!isOwner && !isAdmin) {
    res.status(403).json({ error: "Only the property owner can hide the property" });
    return;
  }

  const [updated] = await db
    .update(workLogsTable)
    .set({ successStoryHidden: true })
    .where(eq(workLogsTable.id, logId))
    .returning();

  res.json(updated);
});

// -------------- Deals --------------

async function attachPros<T extends { proClerkId: string }>(deals: T[]) {
  if (deals.length === 0) return [] as (T & { pro: unknown | null })[];
  const ids = Array.from(new Set(deals.map((d) => d.proClerkId)));
  const pros = await db.select(publicUserColumns).from(usersTable).where(inArray(usersTable.clerkId, ids));
  const map = new Map(pros.map((p) => [p.clerkId, p]));
  return deals.map((d) => ({ ...d, pro: map.get(d.proClerkId) ?? null }));
}

router.get("/deals/active", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const queryZip = typeof req.query.zip === "string" ? req.query.zip.trim() : "";
  const limit = clampLimit(req.query.limit, 20);

  let zip = queryZip;
  if (!zip) {
    const [me] = await db
      .select({ addressZip: usersTable.addressZip })
      .from(usersTable)
      .where(eq(usersTable.clerkId, userId));
    zip = me?.addressZip ?? "";
  }

  const now = new Date();
  const baseConds = [
    lte(dealsTable.startDate, now),
    gt(dealsTable.endDate, now),
    // #672 — never surface deals posted by an admin Wardrobe demo
    // persona; they're admin practice data, not real consumer offers.
    excludeDemoUsersWhere(dealsTable.proClerkId),
  ];

  // Boosted deals (Gold+ perk) sort first, then by recency. We sort in SQL by
  // a derived "is currently boosted" flag desc, then createdAt desc.
  const boostOrder = sql`(${dealsTable.boostedUntil} is not null and ${dealsTable.boostedUntil} > ${now}) desc`;

  let local: typeof dealsTable.$inferSelect[] = [];
  if (zip) {
    local = await db
      .select()
      .from(dealsTable)
      .where(and(...baseConds, sql`${zip} = ANY(${dealsTable.zips})`))
      .orderBy(boostOrder, desc(dealsTable.createdAt))
      .limit(limit);
  }

  let combined = local;
  if (local.length < limit) {
    const fallback = await db
      .select()
      .from(dealsTable)
      .where(and(...baseConds, eq(dealsTable.nationwide, true)))
      .orderBy(boostOrder, desc(dealsTable.createdAt))
      .limit(limit - local.length);
    const seen = new Set(local.map((d) => d.id));
    combined = [...local, ...fallback.filter((d) => !seen.has(d.id))];
  }

  const enriched = await attachPros(combined);
  res.json({ deals: enriched });
});

router.get("/deals/me", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const rows = await db
    .select()
    .from(dealsTable)
    .where(eq(dealsTable.proClerkId, userId))
    .orderBy(desc(dealsTable.createdAt));
  const enriched = await attachPros(rows);
  res.json({ deals: enriched });
});

function parseDealBody(body: unknown): { ok: true; data: typeof dealsTable.$inferInsert } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid body" };
  const b = body as Record<string, unknown>;
  const headline = typeof b.headline === "string" ? b.headline.trim() : "";
  if (!headline) return { ok: false, error: "headline is required" };
  const serviceTag = typeof b.serviceTag === "string" ? b.serviceTag.trim() : "";
  if (!serviceTag) return { ok: false, error: "serviceTag is required" };
  const startStr = typeof b.startDate === "string" ? b.startDate : "";
  const endStr = typeof b.endDate === "string" ? b.endDate : "";
  const startDate = new Date(startStr);
  const endDate = new Date(endStr);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return { ok: false, error: "startDate and endDate must be valid ISO dates" };
  }
  if (endDate <= startDate) return { ok: false, error: "endDate must be after startDate" };

  const description = typeof b.description === "string" ? b.description : "";
  const terms = typeof b.terms === "string" ? b.terms : "";
  const photoUrl = typeof b.photoUrl === "string" && b.photoUrl ? b.photoUrl : null;
  const nationwide = b.nationwide === true;
  const zips = Array.isArray(b.zips)
    ? Array.from(new Set(
        b.zips
          .map((z) => (typeof z === "string" ? z.trim() : ""))
          .filter((z) => /^\d{5}(-\d{4})?$/.test(z)),
      )).slice(0, 50)
    : [];
  if (!nationwide && zips.length === 0) {
    return { ok: false, error: "Provide at least one ZIP or mark the deal nationwide" };
  }

  return {
    ok: true,
    data: {
      proClerkId: "", // filled in by caller
      headline,
      description,
      photoUrl,
      serviceTag,
      terms,
      zips,
      nationwide,
      startDate,
      endDate,
    },
  };
}

router.post("/deals", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const parsed = parseDealBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const [deal] = await db
    .insert(dealsTable)
    .values({ ...parsed.data, proClerkId: userId })
    .returning();
  const [enriched] = await attachPros([deal]);
  res.status(201).json(enriched);
});

router.put("/deals/:dealId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const dealId = Number(req.params.dealId);
  if (!Number.isFinite(dealId)) {
    res.status(400).json({ error: "Invalid deal id" });
    return;
  }
  const [existing] = await db.select().from(dealsTable).where(eq(dealsTable.id, dealId));
  if (!existing) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }
  if (existing.proClerkId !== userId) {
    res.status(403).json({ error: "Not your deal" });
    return;
  }
  const parsed = parseDealBody({ ...existing, ...req.body });
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const [updated] = await db
    .update(dealsTable)
    .set({ ...parsed.data, proClerkId: userId })
    .where(eq(dealsTable.id, dealId))
    .returning();
  const [enriched] = await attachPros([updated]);
  res.json(enriched);
});

router.delete("/deals/:dealId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const dealId = Number(req.params.dealId);
  if (!Number.isFinite(dealId)) {
    res.status(400).json({ error: "Invalid deal id" });
    return;
  }
  const [existing] = await db.select().from(dealsTable).where(eq(dealsTable.id, dealId));
  if (!existing) {
    res.status(404).json({ error: "Deal not found" });
    return;
  }
  if (existing.proClerkId !== userId) {
    res.status(403).json({ error: "Not your deal" });
    return;
  }
  await db.delete(dealsTable).where(eq(dealsTable.id, dealId));
  res.json({ ok: true });
});

export default router;

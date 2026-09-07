import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  db,
  appInvitesTable,
  entitiesTable,
  entityMembersTable,
  notificationsTable,
  outwardAccountsTable,
  pointsLedgerTable,
  propertiesTable,
  usersTable,
  userModesTable,
  type AppInviteStatus,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import {
  listOutwardAccountIdsForUser,
  resolveActiveOutwardAccountId,
} from "../lib/outwardAccounts";
import { insertNotifications } from "../lib/insertNotifications";
import { recordPoints, POINT_VALUES, tierForPoints, type TierKey } from "../lib/rewards";
import { shouldNotify } from "../lib/notificationPrefs";
import { sendPushToUser } from "../lib/push";

const router: IRouter = Router();

const MODE_KINDS = new Set([
  "trade_pro",
  "home",
  "facilities",
  "trade_pro_teammate",
  "facilities_teammate",
  "home_teammate",
  "trade_pro_collab",
  "facilities_collab",
  "collab",
]);

const MODE_LABEL: Record<string, string> = {
  trade_pro: "Trade Pro",
  home: "Home",
  facilities: "Facility Management",
  trade_pro_teammate: "Trade Teammate",
  facilities_teammate: "Facility Teammate",
  home_teammate: "Home Teammate",
  trade_pro_collab: "Collaborator",
  facilities_collab: "Collaborator",
  collab: "Collaborator",
};

// Roles line for the SMS/share copy.
const ROLES_LINE =
  "Roles: Home, Home Teammate, Trade Pro, Trade Teammate, Facility Management, Facility Teammate, Collaborator";

const DEFAULT_DAILY_LIMIT = 20;

function dailyInviteLimit(): number {
  const raw = process.env.APP_INVITE_DAILY_LIMIT;
  if (!raw) return DEFAULT_DAILY_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAILY_LIMIT;
  return n;
}

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// Statuses that count against the rolling 24h cap. Cancelled/expired
// invites release their slot so the share modal CTA re-enables as soon as
// the user (or the lazy expiry sweep) frees one up — without forcing a
// manual reopen of the share sheet.
const CAPPED_STATUSES: AppInviteStatus[] = ["sent", "signed_up"];

async function countInvitesInLastDay(
  clerkId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const since = new Date(Date.now() - 1000 * 60 * 60 * 24);
  // Cap counts cover invites the user sent across every skin they own.
  const accountIds = await listOutwardAccountIdsForUser(clerkId);
  if (accountIds.length === 0) return 0;
  const [row] = await executor
    .select({ n: sql<number>`count(*)` })
    .from(appInvitesTable)
    .where(
      and(
        inArray(appInvitesTable.senderOutwardAccountId, accountIds),
        gte(appInvitesTable.createdAt, since),
        inArray(appInvitesTable.status, CAPPED_STATUSES),
      ),
    );
  return Number(row?.n ?? 0);
}

function inviteBaseUrl(): string {
  return (process.env.INVITE_LINK_BASE_URL || "https://roundhouse.app").replace(
    /\/+$/,
    "",
  );
}

function buildSignupUrl(token: string): string {
  return `${inviteBaseUrl()}/invite/app/${token}`;
}

function digitsOnly(s: string): string {
  return s.replace(/\D+/g, "");
}

function maskPhone(phone: string): string {
  const d = digitsOnly(phone);
  if (d.length <= 4) return `••• ${d}`;
  return `••• ${d.slice(-4)}`;
}

function buildSmsUri(phoneDigits: string, body: string): string {
  const encoded = encodeURIComponent(body);
  return `sms:${phoneDigits}?body=${encoded}`;
}

function firstName(fullName: string | null | undefined): string | null {
  if (!fullName) return null;
  const trimmed = fullName.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}

type SenderContext = {
  activeKind: string | null;
  firstName: string | null;
  companyName: string | null;
  propertyName: string | null;
  missingFields: ("firstName" | "companyName" | "propertyName")[];
};

async function loadSenderContext(clerkId: string): Promise<SenderContext> {
  const [me] = await db
    .select({
      name: usersTable.name,
      companyName: usersTable.companyName,
      activeKind: userModesTable.kind,
    })
    .from(usersTable)
    .leftJoin(userModesTable, eq(userModesTable.id, usersTable.lastActiveModeId))
    .where(eq(usersTable.clerkId, clerkId));

  const fname = firstName(me?.name ?? null);
  const activeKind = me?.activeKind ?? null;

  // Company name lives per-skin on the active outward account (the new
  // model). The legacy `users.company_name` is only a fallback for users
  // who haven't migrated. Read the active outward account's value first
  // so a user who has filled in their company on their active skin
  // doesn't see a "missing company name" hint on Share Round House.
  const activeAcctId = await resolveActiveOutwardAccountId(clerkId);
  let activeAcctCompany: string | null = null;
  if (activeAcctId != null) {
    const [acct] = await db
      .select({ companyName: outwardAccountsTable.companyName })
      .from(outwardAccountsTable)
      .where(eq(outwardAccountsTable.id, activeAcctId))
      .limit(1);
    activeAcctCompany = (acct?.companyName ?? "").trim() || null;
  }
  const company = activeAcctCompany ?? ((me?.companyName ?? "").trim() || null);

  // Property name: pick the user's primary property (lowest id).
  let propertyName: string | null = null;
  if (activeKind === "home") {
    const [prop] = await db
      .select({ name: propertiesTable.name })
      .from(propertiesTable)
      .where(eq(propertiesTable.ownerClerkId, clerkId))
      .orderBy(propertiesTable.id)
      .limit(1);
    propertyName = (prop?.name ?? "").trim() || null;
  }

  const missing: SenderContext["missingFields"] = [];
  if (!fname) missing.push("firstName");
  if (
    activeKind === "trade_pro" ||
    activeKind === "facilities" ||
    activeKind === "trade_pro_teammate" ||
    activeKind === "facilities_teammate"
  ) {
    if (!company) missing.push("companyName");
  }
  if (activeKind === "home" || activeKind === "home_teammate") {
    if (!propertyName) missing.push("propertyName");
  }

  return { activeKind, firstName: fname, companyName: company, propertyName, missingFields: missing };
}

/**
 * Build the SMS body from the sender's active mode + context. Required
 * placeholders that are missing are dropped gracefully (never emit literal
 * `[Brackets]`); the caller surfaces an inline hint via the share-context
 * endpoint so the user can fill them in.
 */
function buildSmsBody(ctx: SenderContext, signupUrl: string): string {
  const fname = ctx.firstName ?? "";
  const company = ctx.companyName ?? "";
  const property = ctx.propertyName ?? "";
  const kind = ctx.activeKind ?? "home";

  let opener: string;
  switch (kind) {
    case "home":
    case "home_teammate": {
      const namePart = fname ? `Hi, this is ${fname}` : "Hi, there";
      const placePart = property ? ` at ${property}` : "";
      opener =
        `${namePart}${placePart}. ` +
        `I'm inviting you to connect with me on Roundhouse — ` +
        `my home upkeep and beautification platform. Please join me.`;
      break;
    }
    case "trade_pro":
    case "trade_pro_teammate": {
      const namePart = fname ? `Hi, this is ${fname}` : "Hi, there";
      const companyPart = company ? ` of ${company}` : "";
      opener =
        `${namePart}${companyPart}. ` +
        `I'm building on Roundhouse — come connect with me and ` +
        `see what we're working on.`;
      break;
    }
    case "facilities":
    case "facilities_teammate": {
      const namePart = fname ? `Hi, this is ${fname}` : "Hi, there";
      const companyPart = company ? ` of ${company}` : "";
      opener =
        `${namePart}${companyPart}. ` +
        `I'm inviting you to connect with me on Roundhouse — ` +
        `our commercial facility management platform.`;
      break;
    }
    case "trade_pro_collab":
    case "facilities_collab": {
      const namePart = fname ? `Hi, this is ${fname}.` : "Hi.";
      opener =
        `${namePart} I'm inviting you to connect with me on Roundhouse ` +
        `— an app for building property profiles and managing improvement ` +
        `projects. Please join me as a collaborator.`;
      break;
    }
    default: {
      opener = fname
        ? `Hi, this is ${fname}. Come check out Roundhouse.`
        : `Hi. Come check out Roundhouse.`;
    }
  }

  return `${opener}\n${ROLES_LINE}\n${signupUrl}`;
}

/**
 * Load an app invite by id together with the clerk id that owns its sender
 * outward account. Returns null if the invite does not exist. Used by
 * routes that need to authorize the caller against the invite's sender.
 */
async function loadAppInviteWithSenderClerk(
  id: number,
): Promise<{ invite: typeof appInvitesTable.$inferSelect; senderClerkId: string } | null> {
  const [row] = await db
    .select({
      invite: appInvitesTable,
      senderClerkId: outwardAccountsTable.ownerClerkId,
    })
    .from(appInvitesTable)
    .innerJoin(
      outwardAccountsTable,
      eq(outwardAccountsTable.id, appInvitesTable.senderOutwardAccountId),
    )
    .where(eq(appInvitesTable.id, id));
  return row ? { invite: row.invite, senderClerkId: row.senderClerkId } : null;
}

/**
 * Mark this user's `sent` invites past their expiry as `expired`. Cheap
 * lazy sweep — runs at list-time so the analytics view stays accurate.
 */
async function expirePastDueForUser(clerkId: string): Promise<void> {
  const now = new Date();
  const accountIds = await listOutwardAccountIdsForUser(clerkId);
  if (accountIds.length === 0) return;
  await db
    .update(appInvitesTable)
    .set({ status: "expired" as AppInviteStatus })
    .where(
      and(
        inArray(appInvitesTable.senderOutwardAccountId, accountIds),
        eq(appInvitesTable.status, "sent" as AppInviteStatus),
        lt(appInvitesTable.expiresAt, now),
      ),
    );
}

router.get(
  "/app-invites/share-context",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    // Sweep past-due `sent` invites to `expired` first so they drop out of
    // the rolling 24h count and dailyRemaining bounces back immediately.
    await expirePastDueForUser(userId);
    const [ctx, used] = await Promise.all([
      loadSenderContext(userId),
      countInvitesInLastDay(userId),
    ]);
    const dailyLimit = dailyInviteLimit();
    res.json({
      ...ctx,
      dailyLimit,
      dailyUsed: used,
      dailyRemaining: Math.max(0, dailyLimit - used),
    });
  },
);

router.post("/app-invites", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const recipientName =
    typeof req.body?.recipientName === "string" ? req.body.recipientName.trim() : "";
  const recipientPhoneRaw =
    typeof req.body?.recipientPhone === "string" ? req.body.recipientPhone.trim() : "";
  const invitedKind =
    typeof req.body?.invitedKind === "string" ? req.body.invitedKind : "";

  if (!recipientName || recipientName.length > 80) {
    res.status(400).json({ error: "Recipient name is required." });
    return;
  }
  const phoneDigits = digitsOnly(recipientPhoneRaw);
  if (phoneDigits.length < 7 || phoneDigits.length > 15) {
    res.status(400).json({ error: "A valid cell phone number is required." });
    return;
  }
  if (!MODE_KINDS.has(invitedKind)) {
    res.status(400).json({ error: "Pick a valid mode to invite them as." });
    return;
  }

  // Resolve sender's active outward account + the full set of accounts
  // they own once outside the transaction so we don't hold the
  // per-inviter advisory lock while doing it.
  const senderOutwardAccountId =
    (req as AuthRequest).activeOutwardAccountId ??
    (await resolveActiveOutwardAccountId(userId));
  if (senderOutwardAccountId == null) {
    res.status(409).json({ error: "Account not ready" });
    return;
  }
  const myAccountIds = await listOutwardAccountIdsForUser(userId);

  // Atomically reuse-or-create within a per-inviter advisory lock so two
  // concurrent POSTs from the same user can't both pass the rate-limit
  // check and over-issue invites.
  const limit = dailyInviteLimit();
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`app_invite:${userId}`}, 0))`,
    );

    // Reuse an existing not-yet-signed-up invite for this same recipient
    // phone so retries don't spam new tokens (and don't consume the cap).
    // The reuse window is "any of my skins" so a person who flips skins
    // doesn't double-invite the same phone.
    const [existing] = await tx
      .select()
      .from(appInvitesTable)
      .where(
        and(
          inArray(appInvitesTable.senderOutwardAccountId, myAccountIds),
          eq(appInvitesTable.recipientPhone, phoneDigits),
          eq(appInvitesTable.status, "sent" as AppInviteStatus),
        ),
      )
      .orderBy(desc(appInvitesTable.createdAt))
      .limit(1);

    if (existing) {
      const [updated] = await tx
        .update(appInvitesTable)
        .set({
          recipientName,
          invitedKind,
          sentAt: new Date(),
        })
        .where(eq(appInvitesTable.id, existing.id))
        .returning();
      return { kind: "ok" as const, invite: updated };
    }

    const used = await countInvitesInLastDay(userId, tx);
    if (used >= limit) {
      return { kind: "limited" as const, used };
    }

    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 60); // 60 days
    const [created] = await tx
      .insert(appInvitesTable)
      .values({
        senderOutwardAccountId,
        recipientName,
        recipientPhone: phoneDigits,
        invitedKind,
        token,
        status: "sent" as AppInviteStatus,
        sentAt: new Date(),
        expiresAt,
      })
      .returning();
    return { kind: "ok" as const, invite: created };
  });

  if (result.kind === "limited") {
    res.status(429).json({
      error:
        `You've sent ${limit} invites in the last 24 hours. ` +
        `Try again tomorrow so we can keep invites feeling personal.`,
      dailyLimit: limit,
      dailyUsed: result.used,
      dailyRemaining: 0,
    });
    return;
  }
  const invite = result.invite;

  const senderCtx = await loadSenderContext(userId);
  const signupUrl = buildSignupUrl(invite.token);
  const smsBody = buildSmsBody(senderCtx, signupUrl);
  const smsUri = buildSmsUri(phoneDigits, smsBody);

  res.json({
    invite: serializeInvite(invite, null),
    signupUrl,
    smsUri,
    smsBody,
  });
});

router.post(
  "/app-invites/:id/resend",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invite id is required." });
      return;
    }

    const loaded = await loadAppInviteWithSenderClerk(id);
    if (!loaded || loaded.senderClerkId !== userId) {
      res.status(404).json({ error: "Invite not found." });
      return;
    }
    const { invite } = loaded;
    if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
      // Bring its status in line lazily.
      await db
        .update(appInvitesTable)
        .set({ status: "expired" as AppInviteStatus })
        .where(eq(appInvitesTable.id, invite.id));
      res.status(409).json({ error: "This invite has expired." });
      return;
    }
    if (invite.status !== "sent") {
      res.status(409).json({ error: "This invite can no longer be resent." });
      return;
    }

    const [updated] = await db
      .update(appInvitesTable)
      .set({ sentAt: new Date() })
      .where(eq(appInvitesTable.id, invite.id))
      .returning();

    const senderCtx = await loadSenderContext(userId);
    const signupUrl = buildSignupUrl(updated.token);
    const smsBody = buildSmsBody(senderCtx, signupUrl);
    const smsUri = buildSmsUri(updated.recipientPhone, smsBody);

    res.json({
      invite: serializeInvite(updated, null),
      signupUrl,
      smsUri,
      smsBody,
    });
  },
);

router.post(
  "/app-invites/:id/cancel",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invite id is required." });
      return;
    }

    const loaded = await loadAppInviteWithSenderClerk(id);
    if (!loaded || loaded.senderClerkId !== userId) {
      res.status(404).json({ error: "Invite not found." });
      return;
    }
    const { invite } = loaded;
    // Lazy-expire past-due rows so the client gets the accurate status.
    if (
      invite.status === "sent" &&
      invite.expiresAt &&
      invite.expiresAt.getTime() < Date.now()
    ) {
      await db
        .update(appInvitesTable)
        .set({ status: "expired" as AppInviteStatus })
        .where(eq(appInvitesTable.id, invite.id));
      res.status(409).json({ error: "This invite has expired." });
      return;
    }
    if (invite.status !== "sent") {
      res
        .status(409)
        .json({ error: "This invite can no longer be cancelled." });
      return;
    }

    // Conditional update guards against a concurrent accept claiming the
    // invite between the read above and the write here.
    const [updated] = await db
      .update(appInvitesTable)
      .set({ status: "cancelled" as AppInviteStatus })
      .where(
        and(
          eq(appInvitesTable.id, invite.id),
          eq(appInvitesTable.status, "sent" as AppInviteStatus),
        ),
      )
      .returning();
    if (!updated) {
      res
        .status(409)
        .json({ error: "This invite can no longer be cancelled." });
      return;
    }

    res.json({ invite: serializeInvite(updated, null) });
  },
);

router.get("/app-invites", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  await expirePastDueForUser(userId);

  // "Invites I sent" spans every skin the caller owns.
  const myAccountIds = await listOutwardAccountIdsForUser(userId);
  const rows = myAccountIds.length === 0 ? [] : await db
    .select({
      invite: appInvitesTable,
      acceptedByName: usersTable.name,
      acceptedByUsername: usersTable.username,
      acceptedByAvatarUrl: usersTable.avatarUrl,
    })
    .from(appInvitesTable)
    .leftJoin(usersTable, eq(usersTable.clerkId, appInvitesTable.acceptedByClerkId))
    .where(inArray(appInvitesTable.senderOutwardAccountId, myAccountIds))
    .orderBy(desc(appInvitesTable.createdAt), desc(appInvitesTable.id))
    .limit(200);

  // For signed-up invitees, surface a light "how they're doing" signal —
  // their current rewards tier — using points data the rewards system
  // already exposes. We do this in one grouped query against the points
  // ledger keyed by the accepted clerk ids on this page so a long invite
  // list still costs a single round-trip.
  const acceptedClerkIds = Array.from(
    new Set(
      rows
        .map((r) => r.invite.acceptedByClerkId)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  );
  const tierByClerkId = new Map<string, TierKey>();
  if (acceptedClerkIds.length > 0) {
    const pointsRows = await db
      .select({
        clerkId: pointsLedgerTable.userClerkId,
        total: sql<number>`coalesce(sum(${pointsLedgerTable.points}), 0)`,
      })
      .from(pointsLedgerTable)
      .where(inArray(pointsLedgerTable.userClerkId, acceptedClerkIds))
      .groupBy(pointsLedgerTable.userClerkId);
    for (const row of pointsRows) {
      // Spec: "If neither is available for a given invitee, omit the line
      // gracefully — no placeholders." A signed-up user with zero ledger
      // entries (or only zero-point rows) gives no real signal, so we
      // skip the map entry entirely and the client renders no line.
      const total = Number(row.total ?? 0);
      if (total > 0) {
        tierByClerkId.set(row.clerkId, tierForPoints(total).key);
      }
    }
  }

  const invites = rows.map((r) =>
    serializeInvite(
      r.invite,
      {
        name: r.acceptedByName,
        username: r.acceptedByUsername,
        avatarUrl: r.acceptedByAvatarUrl,
      },
      r.invite.acceptedByClerkId
        ? tierByClerkId.get(r.invite.acceptedByClerkId) ?? null
        : null,
    ),
  );

  const sent = invites.length;
  const signedUp = invites.filter((i) => i.status === "signed_up").length;
  const conversionPct = sent > 0 ? Math.round((signedUp / sent) * 100) : 0;

  const [pointsRow] = await db
    .select({
      total: sql<number>`coalesce(sum(${pointsLedgerTable.points}), 0)`,
    })
    .from(pointsLedgerTable)
    .where(
      and(
        eq(pointsLedgerTable.userClerkId, userId),
        eq(pointsLedgerTable.eventType, "app_invite_signup"),
      ),
    );
  const pointsEarned = Number(pointsRow?.total ?? 0);

  res.json({
    invites,
    summary: { sent, signedUp, conversionPct, pointsEarned },
  });
});

router.get("/app-invites/by-token/:token", async (req, res): Promise<void> => {
  const token = String(req.params.token ?? "");
  if (token.length === 0 || token.length > 200) {
    res.status(400).json({ error: "Invite token is required." });
    return;
  }

  const [row] = await db
    .select({
      invite: appInvitesTable,
      senderClerkId: outwardAccountsTable.ownerClerkId,
      inviterName: usersTable.name,
      inviterUsername: usersTable.username,
    })
    .from(appInvitesTable)
    .innerJoin(
      outwardAccountsTable,
      eq(outwardAccountsTable.id, appInvitesTable.senderOutwardAccountId),
    )
    .leftJoin(usersTable, eq(usersTable.clerkId, outwardAccountsTable.ownerClerkId))
    .where(eq(appInvitesTable.token, token));

  if (!row) {
    res.status(404).json({ error: "This invite link is no longer valid." });
    return;
  }

  // Lazy expire on read so a stale `sent` link surfaces correctly.
  let status = row.invite.status as AppInviteStatus;
  if (
    status === "sent" &&
    row.invite.expiresAt &&
    row.invite.expiresAt.getTime() < Date.now()
  ) {
    await db
      .update(appInvitesTable)
      .set({ status: "expired" as AppInviteStatus })
      .where(eq(appInvitesTable.id, row.invite.id));
    status = "expired";
  }

  res.json({
    id: row.invite.id,
    status,
    invitedKind: row.invite.invitedKind,
    recipientName: row.invite.recipientName,
    signedUpAt: row.invite.signedUpAt,
    inviter: row.inviterName
      ? {
          clerkId: row.senderClerkId,
          name: row.inviterName,
          username: row.inviterUsername ?? "",
        }
      : null,
  });
});

router.post("/app-invites/accept", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const rawToken = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (rawToken.length === 0 || rawToken.length > 200) {
    res.status(400).json({ error: "Invite token is required." });
    return;
  }

  const [tokenRow] = await db
    .select({
      invite: appInvitesTable,
      senderClerkId: outwardAccountsTable.ownerClerkId,
    })
    .from(appInvitesTable)
    .innerJoin(
      outwardAccountsTable,
      eq(outwardAccountsTable.id, appInvitesTable.senderOutwardAccountId),
    )
    .where(eq(appInvitesTable.token, rawToken));
  if (!tokenRow) {
    res.status(404).json({ error: "This invite link is no longer valid." });
    return;
  }
  const { invite, senderClerkId } = tokenRow;

  if (senderClerkId === userId) {
    res
      .status(400)
      .json({ error: "You can't accept your own invite." });
    return;
  }

  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
    if (invite.status === "sent") {
      await db
        .update(appInvitesTable)
        .set({ status: "expired" as AppInviteStatus })
        .where(eq(appInvitesTable.id, invite.id));
    }
    res.status(409).json({ error: "This invite link has expired." });
    return;
  }

  if (invite.status === "cancelled" || invite.status === "expired") {
    res.status(409).json({ error: "This invite is no longer active." });
    return;
  }

  // Idempotent re-accept by the same user.
  if (invite.status === "signed_up") {
    if (invite.acceptedByClerkId === userId) {
      res.json(await buildAcceptResponse(invite.id));
      return;
    }
    res.status(409).json({ error: "This invite has already been used by another account." });
    return;
  }

  const [me] = await db
    .select({
      name: usersTable.name,
      activeMode: userModesTable.kind,
    })
    .from(usersTable)
    .leftJoin(userModesTable, eq(userModesTable.id, usersTable.lastActiveModeId))
    .where(eq(usersTable.clerkId, userId));

  const acceptedKind = (me?.activeMode as string | null | undefined) ?? invite.invitedKind;

  // Pin the accepter's currently active outward account onto the invite
  // so the resulting connection's recipient skin is unambiguous.
  const recipientOutwardAccountId =
    (req as AuthRequest).activeOutwardAccountId ??
    (await resolveActiveOutwardAccountId(userId));

  const [claimed] = await db
    .update(appInvitesTable)
    .set({
      status: "signed_up" as AppInviteStatus,
      signedUpAt: new Date(),
      acceptedByClerkId: userId,
      acceptedKind,
      recipientOutwardAccountId,
    })
    .where(
      and(
        eq(appInvitesTable.id, invite.id),
        eq(appInvitesTable.status, "sent" as AppInviteStatus),
      ),
    )
    .returning();

  if (!claimed) {
    const [latest] = await db
      .select()
      .from(appInvitesTable)
      .where(eq(appInvitesTable.id, invite.id));
    if (latest && latest.acceptedByClerkId === userId) {
      res.json(await buildAcceptResponse(latest.id));
      return;
    }
    res.status(409).json({ error: "This invite has already been used by another account." });
    return;
  }

  // Task #663 — if the invite was bound to an entity, materialize an
  // approved entity_members row for the new user on signup. Entity
  // membership is the canonical relationship store, so the new user
  // should land already inside the inviter's entity instead of
  // sitting in a person-to-person limbo. Idempotent in case the
  // accept flow is replayed.
  if (claimed.entityId != null && recipientOutwardAccountId != null) {
    const [entity] = await db
      .select({ id: entitiesTable.id })
      .from(entitiesTable)
      .where(eq(entitiesTable.id, claimed.entityId));
    if (entity) {
      const [existing] = await db
        .select({ id: entityMembersTable.id })
        .from(entityMembersTable)
        .where(
          and(
            eq(entityMembersTable.entityId, claimed.entityId),
            eq(entityMembersTable.userClerkId, userId),
            eq(entityMembersTable.userOutwardAccountId, recipientOutwardAccountId),
          ),
        );
      if (!existing) {
        // Resolve the inviter's avatar so the audit trail points back
        // at who issued the invite.
        const [senderAcct] = await db
          .select({ id: outwardAccountsTable.id })
          .from(outwardAccountsTable)
          .where(eq(outwardAccountsTable.id, claimed.senderOutwardAccountId));
        await db.insert(entityMembersTable).values({
          entityId: claimed.entityId,
          userClerkId: userId,
          userOutwardAccountId: recipientOutwardAccountId,
          role: "worker",
          status: "approved",
          direction: "invite",
          requestedByOutwardAccountId: senderAcct?.id ?? recipientOutwardAccountId,
          decidedAt: new Date(),
        });
      }
    }
  }

  await recordPoints({
    userClerkId: senderClerkId,
    eventType: "app_invite_signup",
    sourceRef: `app_invite:${invite.id}`,
  });

  if (await shouldNotify(senderClerkId, "app_invite_signup")) {
    const newName = me?.name && me.name.trim().length > 0 ? me.name : invite.recipientName;
    const newFirst = firstName(newName) ?? newName;
    const roleLabel = MODE_LABEL[acceptedKind] ?? "Round House member";
    const title = `${newFirst} just joined Round House`;
    const body =
      `${newFirst} joined as ${roleLabel}. ` +
      `You earned ${POINT_VALUES.app_invite_signup} points for sharing.`;
    await insertNotifications({
      userClerkId: senderClerkId,
      type: "app_invite_signup",
      title,
      body,
      relatedId: String(claimed.id),
    });
    void sendPushToUser(senderClerkId, {
      title,
      body,
      data: { type: "app_invite_signup", appInviteId: claimed.id },
    });
  }

  res.json(await buildAcceptResponse(claimed.id));
});

async function buildAcceptResponse(inviteId: number) {
  const [row] = await db
    .select({
      invite: appInvitesTable,
      acceptedByName: usersTable.name,
      acceptedByUsername: usersTable.username,
      acceptedByAvatarUrl: usersTable.avatarUrl,
    })
    .from(appInvitesTable)
    .leftJoin(usersTable, eq(usersTable.clerkId, appInvitesTable.acceptedByClerkId))
    .where(eq(appInvitesTable.id, inviteId));
  if (!row) {
    return { invite: null, signupUrl: "", smsUri: "" };
  }
  const signupUrl = buildSignupUrl(row.invite.token);
  return {
    invite: serializeInvite(row.invite, {
      name: row.acceptedByName,
      username: row.acceptedByUsername,
      avatarUrl: row.acceptedByAvatarUrl,
    }),
    signupUrl,
    smsUri: buildSmsUri(row.invite.recipientPhone, ""),
  };
}

interface AcceptedByInfo {
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
}

function serializeInvite(
  invite: typeof appInvitesTable.$inferSelect,
  acceptedBy: AcceptedByInfo | null,
  acceptedByTier: TierKey | null = null,
) {
  // Only expose the tier signal for invitees who actually signed up — for
  // sent / expired / cancelled rows there is no invitee yet, so the
  // "how they're doing" line stays absent on the client.
  const tier = invite.status === "signed_up" ? acceptedByTier : null;
  return {
    id: invite.id,
    recipientName: invite.recipientName,
    recipientPhone: invite.recipientPhone,
    recipientPhoneMasked: maskPhone(invite.recipientPhone),
    invitedKind: invite.invitedKind,
    status: invite.status,
    createdAt: invite.createdAt,
    sentAt: invite.sentAt,
    expiresAt: invite.expiresAt,
    signedUpAt: invite.signedUpAt,
    acceptedKind: invite.acceptedKind ?? null,
    acceptedByClerkId: invite.acceptedByClerkId ?? null,
    acceptedByName: acceptedBy?.name ?? null,
    acceptedByUsername: acceptedBy?.username ?? null,
    acceptedByAvatarUrl: acceptedBy?.avatarUrl ?? null,
    acceptedByTier: tier,
    acceptedByTierLabel: tier ? tierLabel(tier) : null,
  };
}

function tierLabel(key: TierKey): string {
  switch (key) {
    case "bronze":
      return "Bronze";
    case "silver":
      return "Silver";
    case "gold":
      return "Gold";
    case "platinum":
      return "Platinum";
  }
}

export default router;

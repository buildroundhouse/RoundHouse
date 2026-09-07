import { Router, type IRouter } from "express";
import { eq, and, ne, or, ilike, sql, inArray, isNull } from "drizzle-orm";
import {
  db,
  usersTable,
  userModesTable,
  propertiesTable,
  outwardAccountsTable,
  userTeamMembersTable,
  workLogsTable,
  entitiesTable,
  entityMembersTable,
  type UserModeKind,
  type TeamRole,
} from "@workspace/db";
import {
  excludeDemoUsersWhere,
  isAdminDemoClerkId,
  notDemoUserPredicate,
} from "../lib/adminDemo";
import {
  getMembershipForProperty,
  listMembershipsForUser,
  upsertPropertyMembership,
} from "../lib/propertyAccess";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { publicUserColumns, selfUserColumns } from "../lib/userPublic";
import {
  ensureCollabBaselineMode,
  ensureCollabBaselineOutwardAccount,
  listOutwardAccountsForUser,
  resolveActiveOutwardAccountId,
} from "../lib/outwardAccounts";
import { createUserMode } from "../lib/userModes";
import { formatOwnerNameForSkin } from "../lib/ownerNameDisplay";
import { listAcceptedSeatsForMember } from "../lib/teamSeats";
import { assertCallerOwnsUploads } from "../lib/objectAccess";
import { maybeAwardProfileCompleted, isAdminUser } from "../lib/rewards";
import { getDefaultOutwardAccountForUser } from "../lib/activeOutwardScope";
import {
  NOTIFICATION_PREF_TYPES,
  isManagedPrefType,
  listMyPrefs,
  setMyPref,
  setMyPrefsBulk,
  shouldNotify,
  type NotificationPrefType,
} from "../lib/notificationPrefs";
import { insertNotifications } from "../lib/insertNotifications";
import { parseTeammateChipFields } from "../lib/connectionTags";

const router: IRouter = Router();

// VALID_MODE_KINDS, SINGLE_PROFILE_KINDS, TEAMMATE_PARENT_KIND, and
// PARENT_KIND_LABEL now live in src/lib/userModes.ts so the demo /
// admin-seeding routes share the same validation as POST /users/me/modes.

// Layer 1 required intake keys per mode. Keep in sync with client intake-schemas.ts.
const REQUIRED_INTAKE_KEYS: Record<UserModeKind, string[]> = {
  trade_pro: [
    "companyName",
    "ownerName",
    "businessEmail",
    "businessPhone",
    "businessAddress",
    "trade",
    "experience",
    "region",
    "primaryZip",
  ],
  home: ["placeName", "matters"],
  facilities: ["operationKind", "maintenanceGoals", "teamSize"],
  trade_pro_teammate: ["belongsTo", "roleTitle", "displayName"],
  facilities_teammate: ["belongsTo", "roleTitle", "displayName"],
  home_teammate: ["belongsTo", "roleTitle", "displayName"],
  trade_pro_collab: ["experience", "strengths", "growth"],
  facilities_collab: ["experience", "strengths", "learning"],
  collab: [],
};

const ZIP_RE = /^\d{5}$/;

function parseZipList(input: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const t = s.trim();
    if (ZIP_RE.test(t) && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  };
  if (typeof input === "string") {
    for (const part of input.split(/[\s,;]+/)) push(part);
  } else if (Array.isArray(input)) {
    for (const v of input) if (typeof v === "string") push(v);
  }
  return out;
}

function normalizeTradeProIntake(data: Record<string, unknown>): string | null {
  const rawZip = typeof data.primaryZip === "string" ? data.primaryZip.trim() : "";
  if (!ZIP_RE.test(rawZip)) {
    return "Primary ZIP must be a 5-digit ZIP code.";
  }
  data.primaryZip = rawZip;
  data.additionalZips = parseZipList(data.additionalZips).filter((z) => z !== rawZip);
  return null;
}

function validateIntakeData(kind: UserModeKind, data: Record<string, unknown>): string | null {
  const required = REQUIRED_INTAKE_KEYS[kind] ?? [];
  for (const key of required) {
    const value = data[key];
    if (value == null) return `Missing required field: ${key}`;
    if (typeof value === "string" && value.trim() === "") return `Field "${key}" cannot be empty`;
    if (Array.isArray(value) && value.length === 0) return `Field "${key}" needs at least one selection`;
  }
  if (kind === "trade_pro") {
    const err = normalizeTradeProIntake(data);
    if (err) return err;
  }
  return null;
}

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
const RESERVED_USERNAMES = new Set([
  "admin", "root", "support", "help", "me", "you", "system", "round", "roundhouse",
  "user", "users", "anonymous", "null", "undefined",
]);

function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

function makePlaceholderUsername(clerkId: string): string {
  // First-touch placeholder so DB NOT NULL is satisfied; identity step replaces this.
  const slug = clerkId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 12) || "newuser";
  const rand = Math.random().toString(36).slice(2, 6);
  return `_pending_${slug}_${rand}`.slice(0, 24);
}

function validateUsername(input: string): { ok: true; value: string } | { ok: false; reason: string } {
  const u = normalizeUsername(input);
  if (!USERNAME_RE.test(u)) {
    return { ok: false, reason: "Use 3–24 lowercase letters, numbers, or underscores." };
  }
  if (RESERVED_USERNAMES.has(u)) {
    return { ok: false, reason: "That username is reserved." };
  }
  return { ok: true, value: u };
}

// Per-account profile fields. These live on user_modes.intake_data and are
// hydrated onto the user response so each account's display surfaces show
// only that account's data — no bleed across accounts. Only first/last name
// + avatar (and auth-identity email/username) are shared at the user level.
const PER_ACCOUNT_FIELDS = [
  "bio",
  "companyName",
  "slogan",
  "companyLogoUrl",
  "headerImageUrl",
  "address",
  "phone",
  "website",
  "instagram",
  "licenseState",
  "licenseType",
  "licenseNumber",
  "insuranceCarrier",
  "insurancePolicyNumber",
  "services",
  "visibility",
] as const;

async function loadActiveModeIntake(
  clerkId: string,
  activeModeId: number | null,
): Promise<Record<string, unknown>> {
  if (!activeModeId) return {};
  const [mode] = await db
    .select({ intakeData: userModesTable.intakeData })
    .from(userModesTable)
    .where(and(eq(userModesTable.id, activeModeId), eq(userModesTable.userClerkId, clerkId)));
  return (mode?.intakeData ?? {}) as Record<string, unknown>;
}

function hydrateUserWithMode<T extends Record<string, unknown>>(
  user: T,
  intake: Record<string, unknown>,
): T {
  const out: Record<string, unknown> = { ...user };
  for (const k of PER_ACCOUNT_FIELDS) {
    if (intake[k] !== undefined && intake[k] !== null) {
      out[k] = intake[k];
    } else {
      // Account hasn't set this yet — show empty (NOT user-level fallback)
      // so other accounts' values cannot bleed in.
      const cur = out[k];
      if (Array.isArray(cur)) out[k] = [];
      else if (cur && typeof cur === "object") out[k] = {};
      else out[k] = null;
    }
  }
  // contactEmail (per-account) overrides the auth-identity email for display.
  if (typeof intake.contactEmail === "string" && intake.contactEmail.trim()) {
    out.email = intake.contactEmail;
  }
  // Legacy phone subfields — drop them so per-account "phone" is the source of truth.
  out.cellPhone = null;
  out.officePhone = null;
  return out as T;
}

router.get("/users/me", requireAuth, async (req, res): Promise<void> => {
  const { userId, userEmail, userName } = req as AuthRequest;

  let [user] = await db.select(selfUserColumns).from(usersTable).where(eq(usersTable.clerkId, userId));

  if (!user) {
    const email = userEmail || "";
    const name = userName || (email ? email.split("@")[0] : "User");

    // Concurrent /users/me calls on first sign-in (the client kicks off
    // several queries in parallel) used to race here: every one passed
    // the !user check, and the second-onward insert blew up on the
    // unique clerk_id (or unique placeholder username) constraint,
    // returning a 500 from drizzle's prepared insert. Make the insert
    // idempotent on clerk_id so the loser of the race silently no-ops
    // and falls through to the re-select below.
    await db
      .insert(usersTable)
      .values({ clerkId: userId, email, name, username: makePlaceholderUsername(userId) })
      .onConflictDoNothing({ target: usersTable.clerkId });
    [user] = await db.select(selfUserColumns).from(usersTable).where(eq(usersTable.clerkId, userId));
  }

  // #572: every signed-in user must own a permanent
  // Collaborator / Friend outward account. Backfill it on /users/me
  // (idempotent) so legacy users self-heal on next login and brand-new
  // users get one before the client renders the switcher.
  await ensureCollabBaselineOutwardAccount(userId);

  const intake = await loadActiveModeIntake(userId, user.lastActiveModeId ?? null);
  const [outwardAccounts, activeOutwardAccountId, teamSeats] = await Promise.all([
    listOutwardAccountsForUser(userId),
    resolveActiveOutwardAccountId(userId),
    listAcceptedSeatsForMember(userId),
  ]);
  // #310: surface company skins this user holds an active seat on so
  // their switcher can act-as those skins. Mark them so the client can
  // distinguish "owned" vs "team-seat" skins.
  const teamSeatSkins = teamSeats.map(({ seat, skin }) => ({
    ...skin,
    teamSeat: {
      seatId: seat.id,
      role: seat.role,
      isAdmin: seat.isAdmin,
      permissions: {
        seeContacts: !!seat.permissions?.seeContacts,
        seeBilling: !!seat.permissions?.seeBilling,
        createOnProperties: !!seat.permissions?.createOnProperties,
        manageTeam: !!seat.permissions?.manageTeam,
      },
    },
  }));
  res.json({
    ...hydrateUserWithMode(user, intake),
    outwardAccounts,
    teamSeatSkins,
    activeOutwardAccountId,
    isAdmin: await isAdminUser(userId),
  });
});

router.get("/users/search", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const raw = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const serviceRaw = typeof req.query.service === "string" ? req.query.service.trim() : "";
  if (raw.length < 1 && serviceRaw.length < 1) {
    res.json({ users: [] });
    return;
  }

  // #636 — Search returns one row per outward account ("skin") via
  // LEFT JOIN. The same human under multiple skins shows up as
  // multiple distinct search results so callers can address each
  // skin independently — that is the unit of conversation/contact
  // post-#307. This is the path that makes admin/operator skins
  // (a Game Room Admin, a Facility Admin, …) discoverable through
  // People search even when the admin also owns a personal/collab
  // baseline skin: each non-archived OA gets its own row, with its
  // own public-facing fields and its own `kind` for the role label.
  // Users without any outward account (legacy / pre-migration) still
  // appear once with a NULL outwardAccountId so existing
  // person-based callers keep working.
  const conditions = [ne(usersTable.clerkId, userId)];
  if (raw.length > 0) {
    const escaped = raw.replace(/[\\%_]/g, (c) => `\\${c}`);
    const pattern = `%${escaped}%`;
    // #617 — never match against `usersTable.name`. That field is the
    // private personal name of the underlying owner; matching on it
    // would surface a skin whose public-facing display name did not
    // contain the search term, leaking the owner's real identity by
    // proxy. Search only against the username and the per-skin
    // public-facing fields.
    conditions.push(
      or(
        ilike(usersTable.username, pattern),
        ilike(outwardAccountsTable.displayName, pattern),
        ilike(outwardAccountsTable.companyName, pattern),
        ilike(outwardAccountsTable.title, pattern),
      )!,
    );
  }
  if (serviceRaw.length > 0) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${usersTable.services}) AS e WHERE lower(e->>'name') = lower(${serviceRaw}))`,
    );
  }

  // #636 / #672 / #677 — Demo personas (the practice avatars an admin
  // spins up from the Wardrobe) live as ordinary `users` rows whose
  // `is_demo = true` flag is mirrored from `admin_demo_profiles` by
  // the shared write helpers in `lib/adminDemo.ts`. They must stay
  // hidden from every public discovery surface so testers don't
  // pollute results for real users. Since this query already joins
  // on `usersTable`, use the column predicate directly — no subquery.
  conditions.push(notDemoUserPredicate());

  // Fetch up to 200 join rows so we can collapse before applying
  // the public limit. #640 — People search is now skin-only: the
  // personal `kind = 'collab'` baseline and bare users (no outward
  // skin at all) are excluded via the INNER JOIN below, so every
  // surviving row IS an outward skin. #636 — owners with multiple
  // business/operator skins still surface once PER SKIN, so admin
  // operator avatars stay independently discoverable alongside the
  // owner's other business skins (the unit of conversation is the
  // skin, not the human).
  const rows = await db
    .select({
      outwardAccountId: outwardAccountsTable.id,
      kind: outwardAccountsTable.kind,
      title: outwardAccountsTable.title,
      displayName: outwardAccountsTable.displayName,
      companyName: outwardAccountsTable.companyName,
      accountAvatarUrl: outwardAccountsTable.avatarUrl,
      archivedAt: outwardAccountsTable.archivedAt,
      lastInitialOnly: outwardAccountsTable.lastInitialOnly,
      ownerId: usersTable.id,
      ownerClerkId: usersTable.clerkId,
      ownerName: usersTable.name,
      ownerUsername: usersTable.username,
      ownerAvatarUrl: usersTable.avatarUrl,
      ownerActiveMode: userModesTable.kind,
    })
    .from(usersTable)
    .innerJoin(
      outwardAccountsTable,
      and(
        eq(outwardAccountsTable.ownerClerkId, usersTable.clerkId),
        isNull(outwardAccountsTable.archivedAt),
        ne(outwardAccountsTable.kind, "collab"),
      ),
    )
    .leftJoin(userModesTable, eq(userModesTable.id, usersTable.lastActiveModeId))
    .where(and(...conditions))
    .limit(200);

  // Dedup duplicate join rows for the SAME (owner, outward account)
  // pair — these can occur when a `q` matches multiple columns on
  // the same OA via the OR clause and the planner emits a row per
  // matching predicate. #636 — we do NOT dedup across skins of the
  // same owner: each non-archived OA gets its own search row so an
  // admin's operator skins surface as their own entries alongside
  // the owner's other business skins. #640 — personal `collab` and
  // bare-user rows are excluded by the INNER JOIN, so every
  // surviving row has a non-null `outwardAccountId` and the dedup
  // key always pairs an owner with a real skin.
  type Row = (typeof rows)[number];
  const seen = new Set<string>();
  const ranked: Row[] = [];
  for (const r of rows) {
    const key = `${r.ownerId}:${r.outwardAccountId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ranked.push(r);
  }
  ranked.sort((a, b) => a.ownerUsername.length - b.ownerUsername.length);
  const sliced = ranked.slice(0, 40);

  // #617 — only the personal/collab skin may surface the owner's
  // real name; that skin is excluded above (#640), so every row here
  // MUST fall back to the skin's own public fields, then the
  // @username, never to `usersTable.name`.
  // #640 — when the skin's `lastInitialOnly` flag is on, shorten the
  // owner-name surfaced on the row to "First L.". For typical rows
  // the public name comes from displayName / companyName / title, so
  // the helper is a no-op on those — but we apply it defensively so
  // any skin whose displayName mirrors the owner's actual name still
  // gets shortened.
  const users = sliced.map((r) => {
    const fallback = `@${r.ownerUsername}`;
    const rawPublicName = r.displayName ?? r.companyName ?? r.title ?? fallback;
    const publicName =
      rawPublicName === fallback
        ? fallback
        : (formatOwnerNameForSkin(rawPublicName, r.lastInitialOnly) ?? fallback);
    return {
      id: r.ownerId,
      clerkId: r.ownerClerkId,
      outwardAccountId: r.outwardAccountId,
      name: publicName,
      username: r.ownerUsername,
      avatarUrl: r.accountAvatarUrl ?? r.ownerAvatarUrl,
      activeModeKind: r.kind ?? r.ownerActiveMode,
    };
  });

  res.json({ users });
});

const TRADE_LABELS: Record<string, string> = {
  general: "General contractor",
  electrician: "Electrician",
  plumber: "Plumber",
  hvac: "HVAC",
  carpenter: "Carpenter",
  painter: "Painter",
  landscaper: "Landscaper",
  cleaner: "Cleaner",
  handyman: "Handyman",
  other: "Trade pro",
};

const MODE_LABELS_SERVER: Record<UserModeKind, string> = {
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

function tradeLabel(t: string | null | undefined): string | null {
  if (!t) return null;
  const key = t.toLowerCase();
  return TRADE_LABELS[key] ?? t.charAt(0).toUpperCase() + t.slice(1);
}

// Task #663: avatar-to-avatar `connectionKind` is no longer a real type
// in @workspace/db (the column was retired). Keep the union locally so
// the `Person` shape that lingers in /users/search compiles; it may be
// removed entirely in a follow-up once no caller references it.
type ConnectionKind = "client" | "core" | "collaborator";

type Person = {
  id: number;
  clerkId: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  activeModeKind: UserModeKind | null;
  roleContext: string;
  counterpartOutwardAccountId: number | null;
  counterpartArchivedAt: string | null;
  // #502 — universal label + chip pattern. `connectionId` is the
  // user_connections row id for this directed edge so the UI can
  // PATCH it without re-deriving from the pair. The remaining
  // fields drive the `Name → Label · Chip` rendering.
  connectionId: number | null;
  connectionKind: ConnectionKind | null;
  classification: string | null;
  cadence: string | null;
  serviceTitle: string | null;
  onSiteIdentity: string | null;
  onSiteIdentityOther: string | null;
  chip: string | null;
  chipOther: string | null;
  // #503 — true when this person has at least one active (non-archived)
  // property assignment with the caller. Used by the UI to render the
  // "Connected — no active work" chip on accepted connections that have
  // not yet been put on a property.
  hasActiveAssignment: boolean;
};

function roleContextFor(
  intakeData: Record<string, unknown> | null | undefined,
  activeModeKind: UserModeKind | null,
): string {
  const intake = (intakeData ?? {}) as Record<string, unknown>;
  const trade = typeof intake.trade === "string" ? tradeLabel(intake.trade) : null;
  const company = typeof intake.companyName === "string" ? (intake.companyName as string).trim() : "";
  const modeLabel = activeModeKind ? MODE_LABELS_SERVER[activeModeKind] : null;
  if (trade && company) return `${trade} · ${company}`;
  if (trade) return trade;
  if (modeLabel) return modeLabel;
  return "Member";
}

router.get("/businesses/search", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const tradeRaw = typeof req.query.tradeType === "string" ? req.query.tradeType.trim() : "";
  const zipRaw = typeof req.query.zip === "string" ? req.query.zip.trim() : "";
  const nameRaw = typeof req.query.name === "string" ? req.query.name.trim() : "";

  if (!tradeRaw && !zipRaw && !nameRaw) {
    res.status(400).json({ error: "Provide at least one of tradeType, zip, or name" });
    return;
  }

  const conditions = [
    eq(userModesTable.kind, "trade_pro"),
    ne(usersTable.clerkId, userId),
    // #672 — keep admin Wardrobe demo personas out of consumer-facing
    // business discovery (same rule that already gates `/users/search`).
    notDemoUserPredicate(),
  ];

  if (tradeRaw) {
    conditions.push(sql`${userModesTable.intakeData} ->> 'trade' = ${tradeRaw.toLowerCase()}`);
  }
  if (zipRaw) {
    // Strip common ZIP punctuation only (spaces, hyphens for ZIP+4 form).
    // After stripping we require exactly 5 leading digits — we don't truncate
    // arbitrary digit strings like "123456" into a misleading "12345" match.
    const cleaned = zipRaw.replace(/[\s\-]/g, "");
    const zip = /^\d{5}$/.test(cleaned)
      ? cleaned
      : /^(\d{5})\d{4}$/.test(cleaned)
        ? cleaned.slice(0, 5)
        : "";
    if (zip.length !== 5) {
      // Invalid ZIP — return no matches rather than ranging over freeform text.
      res.json({ businesses: [] });
      return;
    }
    // Match the structured primaryZip exactly, or membership in the additionalZips array.
    conditions.push(
      sql`(${userModesTable.intakeData} ->> 'primaryZip' = ${zip} OR ${userModesTable.intakeData} -> 'additionalZips' ? ${zip})`,
    );
  }
  if (nameRaw) {
    const escapedName = nameRaw.replace(/[\\%_]/g, (c) => `\\${c}`);
    const namePattern = `%${escapedName}%`;
    conditions.push(
      sql`(
        ${userModesTable.intakeData} ->> 'companyName' ILIKE ${namePattern}
        OR ${userModesTable.intakeData} ->> 'ownerName' ILIKE ${namePattern}
        OR ${userModesTable.intakeData} ->> 'ownerFirstName' ILIKE ${namePattern}
        OR ${userModesTable.intakeData} ->> 'ownerLastName' ILIKE ${namePattern}
        OR ${userModesTable.intakeData} ->> 'ownerDisplayName' ILIKE ${namePattern}
        OR ${usersTable.name} ILIKE ${namePattern}
      )`,
    );
  }

  const rows = await db
    .select({
      id: usersTable.id,
      clerkId: usersTable.clerkId,
      name: usersTable.name,
      username: usersTable.username,
      avatarUrl: usersTable.avatarUrl,
      intakeData: userModesTable.intakeData,
    })
    .from(userModesTable)
    .innerJoin(usersTable, eq(usersTable.clerkId, userModesTable.userClerkId))
    .where(and(...conditions))
    .limit(40);

  const businesses = rows.map((r) => {
    const intake = (r.intakeData ?? {}) as Record<string, unknown>;
    const trade = typeof intake.trade === "string" ? intake.trade : null;
    const companyName = typeof intake.companyName === "string" ? intake.companyName : null;
    const region = typeof intake.region === "string" ? intake.region : null;
    const primaryZip = typeof intake.primaryZip === "string" ? intake.primaryZip : null;
    const additionalZips = Array.isArray(intake.additionalZips)
      ? (intake.additionalZips as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
    const lat =
      typeof intake.lat === "number" && Number.isFinite(intake.lat) ? intake.lat : null;
    const lng =
      typeof intake.lng === "number" && Number.isFinite(intake.lng) ? intake.lng : null;
    return {
      id: r.id,
      clerkId: r.clerkId,
      name: r.name,
      username: r.username,
      avatarUrl: r.avatarUrl,
      companyName,
      trade,
      tradeLabel: tradeLabel(trade),
      region,
      primaryZip,
      additionalZips,
      lat,
      lng,
    };
  });

  // Alphabetical by company name (falling back to owner name).
  businesses.sort((a, b) => (a.companyName ?? a.name).localeCompare(b.companyName ?? b.name));

  res.json({ businesses });
});

// =====================================================================
  // LEGACY user_connections-based endpoints (Task #663) — REMOVED.
  //
  // The avatar-to-avatar relationship paradigm has been retired. People
  // are now added to ENTITIES (residential_property, commercial_property,
  // business) via /entities/:id/members. The endpoints below are kept
  // as 410 Gone stubs so any lingering client caller fails loudly with
  // a clear migration message instead of silently doing nothing.
  // =====================================================================

  const GONE_BODY = {
    error: "This endpoint has been removed. Use /entities/:id/members instead.",
    code: "endpoint_gone_use_entities",
  } as const;

  router.get("/users/me/relationships", requireAuth, async (_req, res): Promise<void> => {
    // Avatar-to-avatar "core / clients / collaborators" lists no longer
    // exist. Surfaces that need a person list should derive it from
    // /entities/mine + /entities/:id/members.
    res.json({ core: [], clients: [], collaborators: [] });
  });

  router.post("/users/:userId/connect", requireAuth, async (_req, res): Promise<void> => {
    res.status(410).json(GONE_BODY);
  });

  router.post("/users/:userId/team-up/respond", requireAuth, async (_req, res): Promise<void> => {
    res.status(410).json(GONE_BODY);
  });

  router.patch("/users/me/connections/:id", requireAuth, async (_req, res): Promise<void> => {
    res.status(410).json(GONE_BODY);
  });

  router.get("/users/me/team-up-requests", requireAuth, async (_req, res): Promise<void> => {
    // Migrated to GET /entities/me/invites.
    res.json({ incoming: [], outgoing: [] });
  });

  router.get("/users/me/connection-status", requireAuth, async (_req, res): Promise<void> => {
    // Connection status no longer exists at the avatar pair level. The
    // equivalent question is "do we share an entity?" — surfaces that
    // need that answer should use entity_members.
    res.json({ entries: [] });
  });

  router.delete("/users/:userId/connect", requireAuth, async (_req, res): Promise<void> => {
    // Removal happens on the entity now (DELETE /entities/:id/members/:memberId).
    res.status(410).json(GONE_BODY);
  });
  

router.put("/users/me", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const {
    name,
    bio,
    email,
    avatarUrl,
    expoPushToken,
    website,
    officePhone,
    cellPhone,
    phone,
    address,
    instagram,
    companyName,
    slogan,
    companyLogoUrl,
    headerImageUrl,
    licenseState,
    licenseType,
    licenseNumber,
    insuranceCarrier,
    insurancePolicyNumber,
    services,
    visibility,
    notifyJobStarted,
    notifyJobCompleted,
    addressZip,
    addressStreet,
    addressCity,
    addressState,
    serviceZips,
  } = req.body;

  const cleanOptional = (v: unknown): string | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    return t.length === 0 ? null : t;
  };

  const updates: Partial<typeof usersTable.$inferSelect> = {};
  if (name != null) updates.name = name;
  if (bio != null) updates.bio = bio;
  if (typeof email === "string" && email.trim()) {
    const trimmedEmail = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      res.status(400).json({ error: "Invalid email address" });
      return;
    }
    updates.email = trimmedEmail;
  }
  if (avatarUrl != null) {
    await assertCallerOwnsUploads(userId, [String(avatarUrl)]);
    updates.avatarUrl = avatarUrl;
  }
  if (expoPushToken !== undefined) {
    updates.expoPushToken = expoPushToken || null;
    updates.pushTokenUpdatedAt = expoPushToken ? new Date() : null;
  }
  if (typeof notifyJobStarted === "boolean") updates.notifyJobStarted = notifyJobStarted;
  if (typeof notifyJobCompleted === "boolean") updates.notifyJobCompleted = notifyJobCompleted;
  const w = cleanOptional(website); if (w !== undefined) updates.website = w;
  const op = cleanOptional(officePhone); if (op !== undefined) updates.officePhone = op;
  const cp = cleanOptional(cellPhone); if (cp !== undefined) updates.cellPhone = cp;
  const ph = cleanOptional(phone); if (ph !== undefined) updates.phone = ph;
  const ad = cleanOptional(address); if (ad !== undefined) updates.address = ad;
  const ig = cleanOptional(instagram); if (ig !== undefined) updates.instagram = ig;
  const cn = cleanOptional(companyName); if (cn !== undefined) updates.companyName = cn;
  const sl = cleanOptional(slogan); if (sl !== undefined) updates.slogan = sl;
  const ls = cleanOptional(licenseState); if (ls !== undefined) updates.licenseState = ls;
  const lt = cleanOptional(licenseType); if (lt !== undefined) updates.licenseType = lt;
  const ln = cleanOptional(licenseNumber); if (ln !== undefined) updates.licenseNumber = ln;
  const ic = cleanOptional(insuranceCarrier); if (ic !== undefined) updates.insuranceCarrier = ic;
  const ipn = cleanOptional(insurancePolicyNumber); if (ipn !== undefined) updates.insurancePolicyNumber = ipn;
  if (Array.isArray(services)) {
    const cleanedServices = services
      .filter((s): s is { name: unknown; isCustom?: unknown } => s != null && typeof s === "object")
      .map((s) => ({
        name: typeof s.name === "string" ? s.name.trim() : "",
        isCustom: s.isCustom === true,
      }))
      .filter((s) => s.name.length > 0)
      .slice(0, 50);
    updates.services = cleanedServices;
  }
  if (visibility != null && typeof visibility === "object" && !Array.isArray(visibility)) {
    const visKeys: Array<keyof typeof visibility> = [
      "address", "phone", "email", "instagram", "website",
      "license", "insurance", "services", "team", "analytics",
    ] as const as Array<keyof typeof visibility>;
    const v: Record<string, boolean> = {};
    for (const k of visKeys) {
      const raw = (visibility as Record<string, unknown>)[k as string];
      if (typeof raw === "boolean") v[k as string] = raw;
    }
    updates.visibility = v;
  }
  const cl = cleanOptional(companyLogoUrl);
  if (cl !== undefined) {
    if (cl) await assertCallerOwnsUploads(userId, [cl]);
    updates.companyLogoUrl = cl;
  }
  const hi = cleanOptional(headerImageUrl);
  if (hi !== undefined) {
    if (hi) await assertCallerOwnsUploads(userId, [hi]);
    updates.headerImageUrl = hi;
  }
  const az = cleanOptional(addressZip);
  if (az !== undefined) updates.addressZip = az;
  const ast = cleanOptional(addressStreet);
  if (ast !== undefined) updates.addressStreet = ast;
  const ac = cleanOptional(addressCity);
  if (ac !== undefined) updates.addressCity = ac;
  const asState = cleanOptional(addressState);
  if (asState !== undefined) updates.addressState = asState;
  if (Array.isArray(serviceZips)) {
    const cleanedZips = serviceZips
      .map((z) => (typeof z === "string" ? z.trim() : ""))
      .filter((z) => /^\d{5}(-\d{4})?$/.test(z));
    updates.serviceZips = Array.from(new Set(cleanedZips)).slice(0, 50);
  }

  const [user] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.clerkId, userId))
    .returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Award the profile-completed milestone the first time the user reaches the bar.
  await maybeAwardProfileCompleted(userId);

  res.json(user);
});

// ---------------------------------------------------------------------------
// Personal profile (raw, never hydrated by the active outward account).
//
// /users/me overlays per-account fields (bio, phone, companyName, address,
// services, …) on top of the underlying users row so the rest of the app
// sees the active skin's view of the user. The Personal Profile screen
// must NOT see that overlay — otherwise editing a per-account phone would
// appear to overwrite the user's master phone, and switching accounts
// would silently change what the personal screen shows.
//
// These endpoints expose the raw users-table fields that belong to the
// person (not to any outward account). The PUT only accepts personal
// fields; per-account fields belong on /outward-accounts/:id.
// ---------------------------------------------------------------------------
const PERSONAL_FIELDS = [
  "name",
  "email",
  "avatarUrl",
  "phone",
  "notifyJobStarted",
  "notifyJobCompleted",
] as const;

router.get(
  "/users/me/personal",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const [user] = await db
      .select(selfUserColumns)
      .from(usersTable)
      .where(eq(usersTable.clerkId, userId));
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    // Return only the personal subset so the client can't accidentally
    // start treating per-account fields as "personal".
    const personal: Record<string, unknown> = { id: user.id, clerkId: user.clerkId };
    for (const k of PERSONAL_FIELDS) {
      personal[k] = (user as Record<string, unknown>)[k] ?? null;
    }
    res.json(personal);
  },
);

router.put(
  "/users/me/personal",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const cleanOptional = (v: unknown): string | null | undefined => {
      if (v === undefined) return undefined;
      if (v === null) return null;
      if (typeof v !== "string") return undefined;
      const t = v.trim();
      return t.length === 0 ? null : t;
    };

    const updates: Partial<typeof usersTable.$inferSelect> = {};
    if (typeof body.name === "string" && body.name.trim()) {
      updates.name = body.name.trim();
    }
    if (typeof body.email === "string" && body.email.trim()) {
      const trimmed = (body.email as string).trim();
      if (!/^\S+@\S+\.\S+$/.test(trimmed)) {
        res.status(400).json({ error: "Invalid email address" });
        return;
      }
      updates.email = trimmed;
    }
    if (body.avatarUrl !== undefined) {
      const av = cleanOptional(body.avatarUrl);
      if (av !== undefined) {
        if (av) await assertCallerOwnsUploads(userId, [av]);
        // avatarUrl is notNull (defaults to ""); empty string clears it.
        updates.avatarUrl = av ?? "";
      }
    }
    const ph = cleanOptional(body.phone);
    if (ph !== undefined) updates.phone = ph;
    if (typeof body.notifyJobStarted === "boolean") {
      updates.notifyJobStarted = body.notifyJobStarted;
    }
    if (typeof body.notifyJobCompleted === "boolean") {
      updates.notifyJobCompleted = body.notifyJobCompleted;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No personal fields provided." });
      return;
    }

    const [user] = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.clerkId, userId))
      .returning(selfUserColumns);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const personal: Record<string, unknown> = { id: user.id, clerkId: user.clerkId };
    for (const k of PERSONAL_FIELDS) {
      personal[k] = (user as Record<string, unknown>)[k] ?? null;
    }
    res.json(personal);
  },
);

router.get("/users/me/notification-prefs", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const prefs = await listMyPrefs(userId);
  res.json({
    prefs: NOTIFICATION_PREF_TYPES.map((type) => ({ type, enabled: prefs[type] })),
  });
});

router.put("/users/me/notification-prefs", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const { type, enabled } = req.body ?? {};
  if (typeof type !== "string" || !isManagedPrefType(type)) {
    res.status(400).json({ error: "Unknown notification type" });
    return;
  }
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be a boolean" });
    return;
  }
  await setMyPref(userId, type, enabled);
  res.json({ type, enabled });
});

router.put("/users/me/notification-prefs/bulk", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const { types, enabled } = req.body ?? {};
  if (!Array.isArray(types) || types.length === 0) {
    res.status(400).json({ error: "types must be a non-empty array" });
    return;
  }
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be a boolean" });
    return;
  }
  const valid: NotificationPrefType[] = [];
  for (const t of types) {
    if (typeof t !== "string" || !isManagedPrefType(t)) {
      res.status(400).json({ error: `Unknown notification type: ${String(t)}` });
      return;
    }
    valid.push(t);
  }
  await setMyPrefsBulk(userId, valid, enabled);
  const prefs = await listMyPrefs(userId);
  res.json({
    prefs: NOTIFICATION_PREF_TYPES.map((type) => ({ type, enabled: prefs[type] })),
  });
});

router.get("/users/me/property-notification-overrides", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const memberships = await listMembershipsForUser(userId);
  const overridesRaw = memberships.filter(
    (m) => m.notifyJobStarted != null || m.notifyJobCompleted != null,
  );
  if (overridesRaw.length === 0) {
    res.json({ overrides: [] });
    return;
  }
  const propIds = overridesRaw.map((m) => m.propertyId);
  const propRows = await db
    .select({ id: propertiesTable.id, name: propertiesTable.name })
    .from(propertiesTable)
    .where(inArray(propertiesTable.id, propIds));
  const nameById = new Map(propRows.map((p) => [p.id, p.name]));
  const overrides = overridesRaw
    .map((m) => ({
      propertyId: m.propertyId,
      propertyName: nameById.get(m.propertyId) ?? "",
      notifyJobStarted: m.notifyJobStarted,
      notifyJobCompleted: m.notifyJobCompleted,
    }))
    .sort((a, b) => a.propertyName.localeCompare(b.propertyName));
  res.json({ overrides });
});

router.put(
  "/users/me/property-notification-overrides/bulk",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const body = req.body ?? {};
    const rawIds = body.propertyIds;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      res.status(400).json({ error: "propertyIds must be a non-empty array" });
      return;
    }
    const propertyIds: number[] = [];
    for (const v of rawIds) {
      let n: number;
      if (typeof v === "number") {
        n = v;
      } else if (typeof v === "string" && /^\d+$/.test(v)) {
        n = Number(v);
      } else {
        res.status(400).json({ error: `Invalid property id: ${String(v)}` });
        return;
      }
      if (!Number.isInteger(n) || n <= 0) {
        res.status(400).json({ error: `Invalid property id: ${String(v)}` });
        return;
      }
      propertyIds.push(n);
    }

    const validateField = (
      key: "notifyJobStarted" | "notifyJobCompleted",
    ): { present: false } | { present: true; value: boolean | null } | { error: string } => {
      if (!(key in body)) return { present: false };
      const v = body[key];
      if (v === null) return { present: true, value: null };
      if (typeof v === "boolean") return { present: true, value: v };
      return { error: `${key} must be a boolean or null` };
    };

    const startedField = validateField("notifyJobStarted");
    if ("error" in startedField) {
      res.status(400).json({ error: startedField.error });
      return;
    }
    const completedField = validateField("notifyJobCompleted");
    if ("error" in completedField) {
      res.status(400).json({ error: completedField.error });
      return;
    }
    if (!startedField.present && !completedField.present) {
      res.status(400).json({
        error: "At least one of notifyJobStarted or notifyJobCompleted must be provided",
      });
      return;
    }

    const updatedPropertyIds: number[] = [];
    for (const propertyId of propertyIds) {
      const existing = await getMembershipForProperty(propertyId, userId);
      if (!existing || existing.userOutwardAccountId == null) continue;
      await upsertPropertyMembership({
        propertyId,
        userClerkId: userId,
        userOutwardAccountId: existing.userOutwardAccountId,
        ...(startedField.present ? { notifyJobStarted: startedField.value } : {}),
        ...(completedField.present ? { notifyJobCompleted: completedField.value } : {}),
      });
      updatedPropertyIds.push(propertyId);
    }

    const memberships = await listMembershipsForUser(userId);
    const overridesRaw = memberships.filter(
      (m) => m.notifyJobStarted != null || m.notifyJobCompleted != null,
    );
    const propIds = overridesRaw.map((m) => m.propertyId);
    const propRows = propIds.length
      ? await db
          .select({ id: propertiesTable.id, name: propertiesTable.name })
          .from(propertiesTable)
          .where(inArray(propertiesTable.id, propIds))
      : [];
    const nameById = new Map(propRows.map((p) => [p.id, p.name]));
    const overrides = overridesRaw
      .map((m) => ({
        propertyId: m.propertyId,
        propertyName: nameById.get(m.propertyId) ?? "",
        notifyJobStarted: m.notifyJobStarted,
        notifyJobCompleted: m.notifyJobCompleted,
      }))
      .sort((a, b) => a.propertyName.localeCompare(b.propertyName));

    res.json({ updatedCount: updatedPropertyIds.length, overrides });
  },
);

router.delete(
  "/users/me/property-notification-overrides/:propertyId",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const rawId = Array.isArray(req.params.propertyId)
      ? req.params.propertyId[0]
      : req.params.propertyId;
    const propertyId = parseInt(rawId, 10);
    if (Number.isNaN(propertyId)) {
      res.status(400).json({ error: "Invalid property id" });
      return;
    }
    const existing = await getMembershipForProperty(propertyId, userId);
    if (!existing || existing.userOutwardAccountId == null) {
      res.status(404).json({ error: "Membership not found" });
      return;
    }
    await upsertPropertyMembership({
      propertyId,
      userClerkId: userId,
      userOutwardAccountId: existing.userOutwardAccountId,
      notifyJobStarted: null,
      notifyJobCompleted: null,
    });
    res.json({ ok: true });
  },
);

router.put("/users/me/push-token", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const { token } = req.body;

  const value = typeof token === "string" && token.length > 0 ? token : null;

  const [user] = await db
    .update(usersTable)
    .set({ expoPushToken: value, pushTokenUpdatedAt: value ? new Date() : null })
    .where(eq(usersTable.clerkId, userId))
    .returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({ ok: true });
});

router.get("/users/username-available", requireAuth, async (req, res): Promise<void> => {
  const raw = typeof req.query.u === "string" ? req.query.u : "";
  const validation = validateUsername(raw);
  if (!validation.ok) {
    res.json({ available: false, reason: validation.reason });
    return;
  }
  const { userId } = req as AuthRequest;
  const [existing] = await db
    .select({ id: usersTable.id, clerkId: usersTable.clerkId })
    .from(usersTable)
    .where(eq(usersTable.username, validation.value));
  if (existing && existing.clerkId !== userId) {
    res.json({ available: false, reason: "That username is taken." });
    return;
  }
  res.json({ available: true, reason: null });
});

router.put("/users/me/identity", requireAuth, async (req, res): Promise<void> => {
  const { userId, userEmail } = req as AuthRequest;
  const rawUsername = typeof req.body?.username === "string" ? req.body.username : "";
  const avatarUrl = typeof req.body?.avatarUrl === "string" ? req.body.avatarUrl.trim() : "";

  const validation = validateUsername(rawUsername);
  if (!validation.ok) {
    res.status(400).json({ error: validation.reason });
    return;
  }
  if (!avatarUrl) {
    res.status(400).json({ error: "Profile photo is required." });
    return;
  }

  // Make sure the user row exists.
  let [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, userId));
  if (!user) {
    const email = userEmail || "";
    const name = email ? email.split("@")[0] : "User";
    [user] = await db
      .insert(usersTable)
      .values({ clerkId: userId, email, name, username: makePlaceholderUsername(userId) })
      .returning();
  }

  // Uniqueness check (excluding self).
  const [taken] = await db
    .select({ clerkId: usersTable.clerkId })
    .from(usersTable)
    .where(and(eq(usersTable.username, validation.value), ne(usersTable.clerkId, userId)));
  if (taken) {
    res.status(409).json({ error: "That username is taken." });
    return;
  }

  await assertCallerOwnsUploads(userId, [avatarUrl]);
  const [updated] = await db
    .update(usersTable)
    .set({ username: validation.value, avatarUrl, identityCompletedAt: new Date() })
    .where(eq(usersTable.clerkId, userId))
    .returning();

  res.json(updated);
});

router.get("/users/me/modes", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  // #572: every user must always have the permanent Collaborator /
  // Friend mode. Backfill before reading so the client never observes
  // an empty modes list (which would route the user back through the
  // mode picker on every fresh device).
  await ensureCollabBaselineMode(userId);
  const modes = await db
    .select()
    .from(userModesTable)
    .where(eq(userModesTable.userClerkId, userId));
  const [user] = await db
    .select({ lastActiveModeId: usersTable.lastActiveModeId })
    .from(usersTable)
    .where(eq(usersTable.clerkId, userId));
  // If lastActiveModeId points to a mode that no longer exists, fall back to first.
  const requestedActive = user?.lastActiveModeId ?? null;
  const activeIsValid = requestedActive != null && modes.some((m) => m.id === requestedActive);
  let activeModeId: number | null = activeIsValid ? requestedActive : modes[0]?.id ?? null;
  if (!activeIsValid && activeModeId != null && activeModeId !== requestedActive) {
    await db.update(usersTable).set({ lastActiveModeId: activeModeId }).where(eq(usersTable.clerkId, userId));
  } else if (modes.length === 0 && requestedActive != null) {
    await db.update(usersTable).set({ lastActiveModeId: null }).where(eq(usersTable.clerkId, userId));
    activeModeId = null;
  }
  res.json({ modes, activeModeId });
});

router.post("/users/me/modes", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const kind = req.body?.kind as UserModeKind | undefined;
  if (!kind) {
    res.status(400).json({ error: "Invalid mode kind" });
    return;
  }
  // Validation + seeding live in src/lib/userModes.ts so the admin
  // demo-profile route can route through the exact same path. Keeping
  // the logic shared means a teammate parent rule (#614) added in one
  // place is automatically enforced in the other, and intake-data
  // seeds (displayName / avatarUrl / trade_pro ownerName) can never
  // drift between live and demo accounts.
  const result = await createUserMode({ clerkId: userId, kind });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(201).json(result.mode);
});

router.put("/users/me/modes/:modeId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const modeId = Number(req.params.modeId);
  if (!Number.isFinite(modeId)) {
    res.status(400).json({ error: "Invalid mode id" });
    return;
  }
  const incoming =
    req.body?.intakeData && typeof req.body.intakeData === "object" && !Array.isArray(req.body.intakeData)
      ? (req.body.intakeData as Record<string, unknown>)
      : null;
  if (!incoming) {
    res.status(400).json({ error: "intakeData must be an object" });
    return;
  }
  const [existing] = await db
    .select()
    .from(userModesTable)
    .where(and(eq(userModesTable.id, modeId), eq(userModesTable.userClerkId, userId)));
  if (!existing) {
    res.status(404).json({ error: "Mode not found" });
    return;
  }
  // Merge incoming on top of existing so partial updates (e.g. just changing the
  // banner image) don't drop other required intake fields. If the caller wants
  // to clear a value, sending the key with null/"" still lets validation catch
  // a required field being emptied.
  const existingData = (existing.intakeData ?? {}) as Record<string, unknown>;
  const intakeData: Record<string, unknown> = { ...existingData, ...incoming };
  // Only enforce "all required fields present" on the FIRST completion. After
  // that, allow partial edits (e.g. updating just the banner image) without
  // forcing the user to refill the entire intake. Field-format normalization
  // (e.g. ZIP) still runs.
  const isFirstCompletion = existing.intakeCompletedAt == null;
  const validationError = isFirstCompletion
    ? validateIntakeData(existing.kind, intakeData)
    : existing.kind === "trade_pro" && typeof intakeData.primaryZip === "string" && intakeData.primaryZip.trim() !== ""
      ? normalizeTradeProIntake(intakeData)
      : null;
  if (validationError) {
    req.log.warn(
      { modeId, kind: existing.kind, validationError, incomingKeys: Object.keys(incoming) },
      "mode intake update rejected",
    );
    res.status(400).json({ error: validationError });
    return;
  }
  const [updated] = await db
    .update(userModesTable)
    .set({
      intakeData,
      intakeCompletedAt: existing.intakeCompletedAt ?? new Date(),
    })
    .where(eq(userModesTable.id, modeId))
    .returning();
  res.json(updated);
});

// #625: Let a signed-in user discard one of their own modes only while
// it is still pre-intake (i.e. `intakeCompletedAt` is null). Used by
// the onboarding "Start over — pick a different hat" flow so the user
// can back out of an avatar skin they activated by mistake before
// completing intake. Completed avatars are managed from Profile and
// must not be abandoned via this endpoint.
router.delete("/users/me/modes/:modeId", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const modeId = Number(req.params.modeId);
  if (!Number.isFinite(modeId)) {
    res.status(400).json({ error: "Invalid mode id" });
    return;
  }
  const [existing] = await db
    .select()
    .from(userModesTable)
    .where(and(eq(userModesTable.id, modeId), eq(userModesTable.userClerkId, userId)));
  if (!existing) {
    res.status(404).json({ error: "Mode not found" });
    return;
  }
  if (existing.intakeCompletedAt != null) {
    res.status(409).json({ error: "Cannot discard a mode whose intake is already complete." });
    return;
  }
  // Drop any outward account that was provisioned off this in-progress
  // mode so the user's switcher doesn't keep dangling skins around. We
  // only touch outward accounts whose source is exactly this mode —
  // the baseline collab account is keyed off `collabBaselineUq` and
  // not by `sourceUserModeId`, so it is unaffected for non-collab modes.
  await db
    .delete(outwardAccountsTable)
    .where(
      and(
        eq(outwardAccountsTable.ownerClerkId, userId),
        eq(outwardAccountsTable.sourceUserModeId, modeId),
      ),
    );
  await db.delete(userModesTable).where(eq(userModesTable.id, modeId));
  // If the discarded mode was the user's last active one, clear the
  // pointer so the next request lands cleanly on the picker (or on
  // whichever remaining mode the resolver chooses).
  const [me] = await db
    .select({ lastActiveModeId: usersTable.lastActiveModeId })
    .from(usersTable)
    .where(eq(usersTable.clerkId, userId));
  if (me?.lastActiveModeId === modeId) {
    await db
      .update(usersTable)
      .set({ lastActiveModeId: null })
      .where(eq(usersTable.clerkId, userId));
  }
  res.status(204).end();
});

router.put("/users/me/active-mode", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const modeId = Number(req.body?.modeId);
  if (!Number.isFinite(modeId)) {
    res.status(400).json({ error: "Invalid mode id" });
    return;
  }
  const [mode] = await db
    .select()
    .from(userModesTable)
    .where(and(eq(userModesTable.id, modeId), eq(userModesTable.userClerkId, userId)));
  if (!mode) {
    res.status(404).json({ error: "Mode not found" });
    return;
  }
  // CRITICAL: switching the active mode must ALSO flip the active outward
  // account so the server-side per-skin firewall (notes, properties, feed,
  // contacts, messages, notifications) re-partitions onto the new skin.
  // Without this, the user's UI shows the new mode's branding but every
  // data list still returns the previous skin's rows.
  const [matchingAccount] = await db
    .select({ id: outwardAccountsTable.id })
    .from(outwardAccountsTable)
    .where(
      and(
        eq(outwardAccountsTable.ownerClerkId, userId),
        eq(outwardAccountsTable.sourceUserModeId, modeId),
        isNull(outwardAccountsTable.archivedAt),
      ),
    )
    .limit(1);

  const [user] = await db
    .update(usersTable)
    .set({
      lastActiveModeId: modeId,
      ...(matchingAccount ? { activeOutwardAccountId: matchingAccount.id } : {}),
    })
    .where(eq(usersTable.clerkId, userId))
    .returning();
  res.json(user);
});

router.get("/users/:userId", requireAuth, async (req, res): Promise<void> => {
  const { userId: viewerClerkId } = req as AuthRequest;
  const raw = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;

  let [user] = await db.select(publicUserColumns).from(usersTable).where(eq(usersTable.clerkId, raw));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // #676 — Demo personas spawned from the admin Wardrobe own ordinary
  // user rows but must stay invisible to consumers. The profile route
  // is the canonical "look this @username up" surface, so we 404 it
  // for non-admin viewers exactly like a missing user. Self (i.e. an
  // admin acting-as the demo) and any admin still see the profile so
  // the Wardrobe can inspect / drive the demo. Other non-discovery
  // surfaces that key off this profile inherit the same gate below.
  if (raw !== viewerClerkId && (await isAdminDemoClerkId(raw))) {
    if (!(await isAdminUser(viewerClerkId))) {
      res.status(404).json({ error: "User not found" });
      return;
    }
  }

  // #640 — Apply per-skin "last initial only" shortening to the owner
  // name surfaced on the public profile header. The skin we resolve
  // against is the target's currently-active outward account (the same
  // skin the connection / messaging code uses for every other read on
  // this user). Self always sees their full name (they know their own
  // identity and use this view to confirm what's public).
  const isSelfView = viewerClerkId === raw;
  if (!isSelfView && user.name) {
    const targetActiveOaId = await resolveActiveOutwardAccountId(raw);
    if (targetActiveOaId != null) {
      const [activeOa] = await db
        .select({ lastInitialOnly: outwardAccountsTable.lastInitialOnly })
        .from(outwardAccountsTable)
        .where(eq(outwardAccountsTable.id, targetActiveOaId));
      if (activeOa?.lastInitialOnly) {
        user = {
          ...user,
          name: formatOwnerNameForSkin(user.name, true) ?? user.name,
        };
      }
    }
  }

  // #671 — When the caller opened this profile from a row tied to a
  // specific outward-account skin (e.g. a Game Room Admin row in
  // Finder), surface that skin's public face so the modal can render a
  // header chip identifying the exact company/role the visitor is
  // connecting to — instead of silently falling back to whatever
  // happens to sit on `lastActiveModeId` (often the owner's collab
  // baseline). We only return the OA when it's owned by this user and
  // not archived — anything else is silently treated as "no skin
  // selected" so visitors can't probe foreign OA ids through this
  // endpoint.
  let counterpartOutwardAccount:
    | {
        id: number;
        kind: UserModeKind;
        title: string | null;
        displayName: string | null;
        companyName: string | null;
        avatarUrl: string | null;
        bannerUrl: string | null;
        bio: string | null;
      }
    | null = null;
  // #679 — When the caller passed a specific skin, the Work snapshot
  // (trade / region / ZIPs / experience / companyName under the
  // avatar) must reflect THAT skin's intake — not whatever the owner
  // happens to have actively selected on their device. Otherwise a
  // Game Room Admin row in Finder can show "Connecting to Gameop Game
  // Room · Facility Management" at the top while the snapshot below
  // still says "Trade Pro · Plumber" because that's the owner's
  // current `lastActiveModeId`. We pick the snapshot mode from the
  // OA's `sourceUserModeId` when one is set, falling back to the
  // owner's last-active mode (legacy behavior) only when no OA was
  // passed or the OA has no source mode.
  let snapshotModeId: number | null = user.lastActiveModeId ?? null;
  const oaRaw = Array.isArray(req.query.outwardAccountId)
    ? req.query.outwardAccountId[0]
    : req.query.outwardAccountId;
  const oaId =
    typeof oaRaw === "string" && /^\d+$/.test(oaRaw) ? Number.parseInt(oaRaw, 10) : null;
  if (oaId != null && Number.isFinite(oaId)) {
    const [oa] = await db
      .select({
        id: outwardAccountsTable.id,
        kind: outwardAccountsTable.kind,
        title: outwardAccountsTable.title,
        displayName: outwardAccountsTable.displayName,
        companyName: outwardAccountsTable.companyName,
        avatarUrl: outwardAccountsTable.avatarUrl,
        bannerUrl: outwardAccountsTable.bannerUrl,
        bio: outwardAccountsTable.bio,
        sourceUserModeId: outwardAccountsTable.sourceUserModeId,
      })
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.id, oaId),
          eq(outwardAccountsTable.ownerClerkId, user.clerkId),
          isNull(outwardAccountsTable.archivedAt),
        ),
      );
    if (oa) {
      const { sourceUserModeId, ...publicOa } = oa;
      counterpartOutwardAccount = publicOa;
      if (sourceUserModeId != null) {
        snapshotModeId = sourceUserModeId;
      }
    }
  }

  // Active mode + intake snapshot for the public profile (work snapshot section).
  // We try the OA-derived `snapshotModeId` first, then fall back to the
  // owner's `lastActiveModeId` if that mode row is missing or no longer
  // owned by this user (stale `sourceUserModeId` data drift) — so a
  // visitor never sees an empty Work snapshot just because the picked
  // skin's source mode was deleted.
  let activeModeKind: UserModeKind | null = null;
  let intakeSnapshot: Record<string, unknown> = {};
  const modeIdsToTry: number[] = [];
  if (snapshotModeId != null) modeIdsToTry.push(snapshotModeId);
  if (
    user.lastActiveModeId != null &&
    user.lastActiveModeId !== snapshotModeId
  ) {
    modeIdsToTry.push(user.lastActiveModeId);
  }
  for (const modeId of modeIdsToTry) {
    const [mode] = await db
      .select({ kind: userModesTable.kind, intakeData: userModesTable.intakeData })
      .from(userModesTable)
      .where(
        and(
          eq(userModesTable.id, modeId),
          eq(userModesTable.userClerkId, user.clerkId),
        ),
      );
    if (mode) {
      activeModeKind = mode.kind;
      intakeSnapshot = (mode.intakeData ?? {}) as Record<string, unknown>;
      break;
    }
  }
  // Overlay per-account fields onto the user response so the public profile
  // shows ONLY the active account's data — no cross-account bleed.
  user = hydrateUserWithMode(user, intakeSnapshot);

  // Task #690 — When a specific skin (outward account) was picked, surface
  // THAT skin's branding (avatar, banner, bio, companyName) on the public
  // profile instead of the underlying owner's. Falls back per-field to the
  // owner's values when the OA hasn't set its own, so a partially-branded
  // skin doesn't end up with blank avatar/banner/etc.
  if (counterpartOutwardAccount) {
    const oa = counterpartOutwardAccount;
    if (oa.avatarUrl) user = { ...user, avatarUrl: oa.avatarUrl };
    if (oa.bannerUrl) user = { ...user, headerImageUrl: oa.bannerUrl };
    if (oa.bio) user = { ...user, bio: oa.bio };
    if (oa.companyName) user = { ...user, companyName: oa.companyName };
  }

  // Task #663: avatar-to-avatar connections were retired. Public profile
  // no longer surfaces a viewer↔target connection row. The replacement
  // is "do we share an entity?" surfaced via /entities/* endpoints.
  const connection: null = null;
  const myReverseConnection: null = null;

  // Visibility map controls which credential/contact fields are shown publicly.
  // Self always sees everything. Connected viewers see all (back-compat). Strangers see
  // only fields explicitly toggled visible.
  const isSelf = viewerClerkId === user.clerkId;
  const v = (user.visibility ?? {}) as Record<string, boolean>;
  // #310: when the viewer is a team member acting as a company skin
  // and their seat doesn't carry `seeContacts`, redact contact details
  // even on profiles that would otherwise be visible. The skin's owner
  // (and admin-level seats) keep full access.
  const acting = (req as AuthRequest).actingAsTeamSeat;
  const teamSeatRedactsContacts = !!acting && !acting.isAdmin && !acting.permissions.seeContacts;
  const sanitized = (() => {
    if (isSelf) return user;
    // Visibility flags are enforced for ALL non-self viewers (including
    // connected users). Public profile data is opt-in per field.
    const blank = { ...user };
    if (!v.email || teamSeatRedactsContacts) blank.email = "";
    if (!v.phone || teamSeatRedactsContacts) {
      blank.phone = null;
      blank.cellPhone = null;
      blank.officePhone = null;
    }
    if (!v.address || teamSeatRedactsContacts) blank.address = null;
    if (!v.website) blank.website = null;
    if (!v.instagram) blank.instagram = null;
    if (!v.license) {
      blank.licenseState = null;
      blank.licenseType = null;
      blank.licenseNumber = null;
    }
    if (!v.insurance) {
      blank.insuranceCarrier = null;
      blank.insurancePolicyNumber = null;
    }
    if (!v.services) blank.services = [];
    return blank;
  })();

  // Per-service success-story counts. Self always sees them; non-self viewers
  // only see counts when this pro has opted into public analytics. When the
  // viewer can't see counts at all we return null (vs an empty {}) so the
  // client can distinguish "private" from "no stories yet".
  let serviceStoryCounts: Record<string, number> | null = null;
  const canSeeCounts = isSelf || v.analytics === true;
  const serviceNames = Array.isArray(sanitized.services)
    ? (sanitized.services as { name: string }[])
        .map((s) => (typeof s?.name === "string" ? s.name : ""))
        .filter((n) => n.length > 0)
    : [];
  if (canSeeCounts && serviceNames.length > 0) {
    const rows = await db
      .select({
        tag: workLogsTable.successStoryServiceTag,
        count: sql<number>`count(*)`,
      })
      .from(workLogsTable)
      .where(
        and(
          eq(workLogsTable.assigneeClerkId, user.clerkId),
          eq(workLogsTable.isSuccessStory, true),
          eq(workLogsTable.successStoryHidden, false),
        ),
      )
      .groupBy(workLogsTable.successStoryServiceTag);

    const tagCount = new Map<string, number>();
    for (const r of rows) {
      const t = (r.tag ?? "").toLowerCase().trim();
      if (!t) continue;
      tagCount.set(t, Number(r.count));
    }
    serviceStoryCounts = {};
    for (const name of serviceNames) {
      serviceStoryCounts[name] = tagCount.get(name.toLowerCase().trim()) ?? 0;
    }
  }

  res.json({
    user: sanitized,
    activeModeKind,
    intakeSnapshot,
    connection,
    myReverseConnection,
    counterpartOutwardAccount,
    isSelf,
    serviceStoryCounts,
  });
});

/**
 * GET /users/:userId/shared-entities — entities both the viewer and
 * the target user are approved members of. Powers the "Shared: …"
 * line in PublicProfileModal so the viewer immediately sees which
 * workspaces tie them to the person they're looking at, without
 * having to hunt through every property's Team tab.
 *
 * Returns an empty list when:
 *  - viewer is looking at their own profile, OR
 *  - the two users share no approved entity_members rows.
 *
 * Both sides are filtered to status='approved' AND archivedAt IS NULL,
 * matching the same predicate used by canParticipateInEntity and the
 * entity-thread broadcast logic so the surface stays consistent with
 * the rest of the entity-only paradigm.
 */
router.get(
  "/users/:userId/shared-entities",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId: viewerClerkId } = req as AuthRequest;
    const targetClerkId = String(req.params.userId ?? "");
    if (!targetClerkId || targetClerkId === viewerClerkId) {
      res.json({ entities: [] });
      return;
    }

    const viewerEntityIds = await db
      .select({ id: entityMembersTable.entityId })
      .from(entityMembersTable)
      .where(
        and(
          eq(entityMembersTable.userClerkId, viewerClerkId),
          eq(entityMembersTable.status, "approved"),
          isNull(entityMembersTable.archivedAt),
        ),
      );
    const viewerIds = viewerEntityIds.map((r) => r.id);
    if (viewerIds.length === 0) {
      res.json({ entities: [] });
      return;
    }

    const shared = await db
      .select({
        id: entitiesTable.id,
        name: entitiesTable.name,
        kind: entitiesTable.kind,
      })
      .from(entityMembersTable)
      .innerJoin(entitiesTable, eq(entitiesTable.id, entityMembersTable.entityId))
      .where(
        and(
          eq(entityMembersTable.userClerkId, targetClerkId),
          eq(entityMembersTable.status, "approved"),
          isNull(entityMembersTable.archivedAt),
          // Also drop archived entities themselves so the SHARED line never
          // names a property/business that's been retired — matches the
          // archive-aware predicates used elsewhere in the entity surface.
          isNull(entitiesTable.archivedAt),
          inArray(entityMembersTable.entityId, viewerIds),
        ),
      );

    res.json({ entities: shared });
  },
);

// Focused success stories for a single pro, optionally narrowed by the
// service tag the viewer tapped. Newest first. Hidden stories are excluded.
// Visibility: mirrors the count-gating on GET /users/:userId — self always
// sees their stories; non-self viewers see them only when this pro has opted
// into visibility.analytics. Otherwise the response is an empty list (we
// don't 403 because the chip simply won't surface to a viewer who can't see
// the count).
router.get("/users/:userId/success-stories", requireAuth, async (req, res): Promise<void> => {
  const { userId: viewerClerkId } = req as AuthRequest;
  const targetClerkId = String(req.params.userId);
  // #676 — mirror the gate on `GET /users/:userId`: a demo persona's
  // public-profile sub-resources stay 404 for non-admin viewers so we
  // don't leak demo identity through profile-deeplinked surfaces.
  if (
    targetClerkId !== viewerClerkId &&
    (await isAdminDemoClerkId(targetClerkId)) &&
    !(await isAdminUser(viewerClerkId))
  ) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const serviceRaw =
    typeof req.query.service === "string" ? req.query.service.trim() : "";
  const limit = (() => {
    const n = Number(req.query.limit);
    if (!Number.isFinite(n) || n <= 0) return 50;
    return Math.min(Math.floor(n), 100);
  })();

  const isSelf = viewerClerkId === targetClerkId;
  if (!isSelf) {
    const [target] = await db
      .select({ visibility: usersTable.visibility })
      .from(usersTable)
      .where(eq(usersTable.clerkId, targetClerkId));
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const v = (target.visibility ?? {}) as Record<string, boolean>;
    if (v.analytics !== true) {
      res.json({ stories: [] });
      return;
    }
  }

  // Scope the public work history to the target's currently-active outward
  // account ("skin"). A Trade Pro's homeowner skin should never display the
  // jobs they did as a Trade Pro and vice versa. We use the property
  // membership row's outwardAccountId — that's the skin under which they
  // were invited and assigned the work. Legacy memberships without a
  // stamped outward account stay visible (NULL is treated as "any skin").
  const targetDefaultOutwardAccountId = await getDefaultOutwardAccountForUser(targetClerkId);
  const targetMemberships = await listMembershipsForUser(targetClerkId);
  const visiblePropertyIds = targetMemberships
    .filter((m) =>
      targetDefaultOutwardAccountId == null
        ? true
        : m.userOutwardAccountId == null ||
          m.userOutwardAccountId === targetDefaultOutwardAccountId,
    )
    .map((m) => m.propertyId);
  if (visiblePropertyIds.length === 0) {
    res.json({ stories: [] });
    return;
  }

  const conditions = [
    eq(workLogsTable.assigneeClerkId, targetClerkId),
    eq(workLogsTable.isSuccessStory, true),
    eq(workLogsTable.successStoryHidden, false),
    inArray(workLogsTable.propertyId, visiblePropertyIds),
  ];
  if (serviceRaw.length > 0) {
    conditions.push(
      sql`lower(${workLogsTable.successStoryServiceTag}) = lower(${serviceRaw})`,
    );
  }

  const logs = await db
    .select({
      id: workLogsTable.id,
      propertyId: workLogsTable.propertyId,
      photoUrl: workLogsTable.photoUrl,
      note: workLogsTable.note,
      blurb: workLogsTable.successStoryBlurb,
      serviceTag: workLogsTable.successStoryServiceTag,
      successStoryAt: workLogsTable.successStoryAt,
      completedAt: workLogsTable.completedAt,
      createdAt: workLogsTable.createdAt,
    })
    .from(workLogsTable)
    .where(and(...conditions))
    .orderBy(
      sql`coalesce(${workLogsTable.successStoryAt}, ${workLogsTable.completedAt}, ${workLogsTable.createdAt}) desc`,
    )
    .limit(limit);

  const propIds = Array.from(new Set(logs.map((l) => l.propertyId).filter((n): n is number => typeof n === "number")));
  const properties = propIds.length > 0
    ? await db
        .select({ id: propertiesTable.id, name: propertiesTable.name })
        .from(propertiesTable)
        .where(inArray(propertiesTable.id, propIds))
    : [];
  const propMap = new Map(properties.map((p) => [p.id, p]));

  const stories = logs.map((l) => {
    const prop = propMap.get(l.propertyId);
    const created = l.successStoryAt ?? l.completedAt ?? l.createdAt;
    return {
      id: l.id,
      logId: l.id,
      propertyId: l.propertyId ?? null,
      propertyName: prop?.name ?? null,
      photoUrl: l.photoUrl ?? null,
      blurb: l.blurb ?? null,
      headline: l.blurb || (l.note ? l.note.split("\n")[0].slice(0, 120) : "Success story"),
      serviceTag: l.serviceTag ?? null,
      createdAt: (created ?? new Date()).toISOString(),
    };
  });

  res.json({ stories });
});

// ---------------------------------------------------------------------------
// Team management
// ---------------------------------------------------------------------------

const VALID_TEAM_ROLES: TeamRole[] = ["employee", "manager", "partner"];

router.get("/users/me/team", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const rows = await db
    .select({
      memberClerkId: userTeamMembersTable.memberClerkId,
      role: userTeamMembersTable.role,
      status: userTeamMembersTable.status,
      invitedAt: userTeamMembersTable.invitedAt,
      acceptedAt: userTeamMembersTable.acceptedAt,
      // #548 — admin-seeded teammate chip.
      chip: userTeamMembersTable.chip,
      chipOther: userTeamMembersTable.chipOther,
      name: usersTable.name,
      username: usersTable.username,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(userTeamMembersTable)
    .innerJoin(usersTable, eq(usersTable.clerkId, userTeamMembersTable.memberClerkId))
    .where(
      and(
        eq(userTeamMembersTable.leadClerkId, userId),
        // #676 — defensive: the POST /users/me/team gate now refuses
        // to add a demo persona, but historical rows could already
        // pair a real lead with a demo member. Drop those from the
        // listing so demos never surface inside a real user's team
        // panel.
        excludeDemoUsersWhere(userTeamMembersTable.memberClerkId),
      ),
    );
  res.json({ members: rows });
});

router.post("/users/me/team", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const { role, clerkId, username, email, companyKind } = req.body ?? {};
  if (typeof role !== "string" || !VALID_TEAM_ROLES.includes(role as TeamRole)) {
    res.status(400).json({ error: "Invalid role" });
    return;
  }
  // #548 — admin may pre-set the teammate chip. Validate against the
  // curated list for the active skin's company kind (passed by the
  // client; server-side dictionary lives in connectionTags).
  const chipParse = parseTeammateChipFields(
    req.body ?? {},
    typeof companyKind === "string" ? companyKind : null,
  );
  if (!chipParse.ok) {
    res.status(400).json({ error: chipParse.error });
    return;
  }
  // Resolve target user.
  let target:
    | { clerkId: string; name: string; username: string; avatarUrl: string }
    | undefined;
  if (typeof clerkId === "string" && clerkId.trim()) {
    const [u] = await db
      .select({
        clerkId: usersTable.clerkId,
        name: usersTable.name,
        username: usersTable.username,
        avatarUrl: usersTable.avatarUrl,
      })
      .from(usersTable)
      .where(eq(usersTable.clerkId, clerkId.trim()));
    target = u;
  } else if (typeof username === "string" && username.trim()) {
    const [u] = await db
      .select({
        clerkId: usersTable.clerkId,
        name: usersTable.name,
        username: usersTable.username,
        avatarUrl: usersTable.avatarUrl,
      })
      .from(usersTable)
      .where(eq(usersTable.username, username.trim().toLowerCase()));
    target = u;
  } else if (typeof email === "string" && email.trim()) {
    const [u] = await db
      .select({
        clerkId: usersTable.clerkId,
        name: usersTable.name,
        username: usersTable.username,
        avatarUrl: usersTable.avatarUrl,
      })
      .from(usersTable)
      .where(eq(usersTable.email, email.trim()));
    target = u;
  }
  if (!target) {
    res
      .status(404)
      .json({ error: "We couldn't find a Roundhouse user with those details." });
    return;
  }
  // #676 — Refuse to invite an admin Wardrobe demo persona by handle.
  // Return the same generic "not found" so the path can't be used to
  // probe whether a username belongs to a demo (which is the same
  // signal the discovery endpoints already hide). Self can't trigger
  // this branch (that's the explicit check below).
  if (await isAdminDemoClerkId(target.clerkId)) {
    res
      .status(404)
      .json({ error: "We couldn't find a Roundhouse user with those details." });
    return;
  }
  if (target.clerkId === userId) {
    res.status(400).json({ error: "You can't invite yourself." });
    return;
  }

  // Upsert: if a row already exists, update its role; otherwise create pending.
  const [existing] = await db
    .select()
    .from(userTeamMembersTable)
    .where(
      and(
        eq(userTeamMembersTable.leadClerkId, userId),
        eq(userTeamMembersTable.memberClerkId, target.clerkId),
      ),
    );
  let row;
  // #548 — only persist chip fields when the admin actually picked one.
  const chipUpdates: Record<string, unknown> = {};
  if (chipParse.chip !== undefined) chipUpdates.chip = chipParse.chip;
  if (chipParse.chipOther !== undefined) chipUpdates.chipOther = chipParse.chipOther;

  if (existing) {
    [row] = await db
      .update(userTeamMembersTable)
      .set({ role: role as TeamRole, ...chipUpdates })
      .where(eq(userTeamMembersTable.id, existing.id))
      .returning();
  } else {
    [row] = await db
      .insert(userTeamMembersTable)
      .values({
        leadClerkId: userId,
        memberClerkId: target.clerkId,
        role: role as TeamRole,
        status: "pending",
        ...chipUpdates,
      })
      .returning();
  }
  res.json({
    memberClerkId: target.clerkId,
    name: target.name,
    username: target.username,
    avatarUrl: target.avatarUrl,
    role: row.role,
    status: row.status,
    invitedAt: row.invitedAt,
    acceptedAt: row.acceptedAt,
    chip: row.chip,
    chipOther: row.chipOther,
  });
});

/**
 * #548 — Admin sets a teammate's chip after invite. Modeled after the
 * team-seats chip endpoint but scoped to the admin's personal team
 * (`userTeamMembersTable`). Only the lead may PATCH; chip is validated
 * against the curated list when `companyKind` is supplied.
 */
router.patch(
  "/users/me/team/:memberClerkId/chip",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const memberClerkId = Array.isArray(req.params.memberClerkId)
      ? req.params.memberClerkId[0]
      : req.params.memberClerkId;
    const [existing] = await db
      .select()
      .from(userTeamMembersTable)
      .where(
        and(
          eq(userTeamMembersTable.leadClerkId, userId),
          eq(userTeamMembersTable.memberClerkId, memberClerkId),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Team member not found" });
      return;
    }
    const companyKind = req.body?.companyKind;
    const chipParse = parseTeammateChipFields(
      req.body ?? {},
      typeof companyKind === "string" ? companyKind : null,
    );
    if (!chipParse.ok) {
      res.status(400).json({ error: chipParse.error });
      return;
    }
    const setFields: Record<string, unknown> = {};
    if (chipParse.chip !== undefined) setFields.chip = chipParse.chip;
    if (chipParse.chipOther !== undefined) setFields.chipOther = chipParse.chipOther;
    if (Object.keys(setFields).length === 0) {
      res.json({ ok: true, chip: existing.chip, chipOther: existing.chipOther });
      return;
    }
    const [row] = await db
      .update(userTeamMembersTable)
      .set(setFields)
      .where(eq(userTeamMembersTable.id, existing.id))
      .returning();
    res.json({ ok: true, chip: row.chip, chipOther: row.chipOther });
  },
);

router.delete(
  "/users/me/team/:memberClerkId",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const memberClerkId = Array.isArray(req.params.memberClerkId)
      ? req.params.memberClerkId[0]
      : req.params.memberClerkId;
    await db
      .delete(userTeamMembersTable)
      .where(
        and(
          eq(userTeamMembersTable.leadClerkId, userId),
          eq(userTeamMembersTable.memberClerkId, memberClerkId),
        ),
      );
    res.json({ ok: true });
  },
);

router.get("/users/me/team-invites", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const rows = await db
    .select({
      leadClerkId: userTeamMembersTable.leadClerkId,
      role: userTeamMembersTable.role,
      invitedAt: userTeamMembersTable.invitedAt,
      name: usersTable.name,
      username: usersTable.username,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(userTeamMembersTable)
    .innerJoin(usersTable, eq(usersTable.clerkId, userTeamMembersTable.leadClerkId))
    .where(
      and(
        eq(userTeamMembersTable.memberClerkId, userId),
        eq(userTeamMembersTable.status, "pending"),
        // #676 — defensive: an invite from a demo persona should never
        // surface in a real user's invite tray. Real users can't end
        // up here under normal flow (demos don't act), but historical
        // rows or admin-side seeding could leak otherwise.
        excludeDemoUsersWhere(userTeamMembersTable.leadClerkId),
      ),
    );
  res.json({ invites: rows });
});

router.post(
  "/users/me/team-invites/:leadClerkId/accept",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const leadClerkId = Array.isArray(req.params.leadClerkId)
      ? req.params.leadClerkId[0]
      : req.params.leadClerkId;
    await db
      .update(userTeamMembersTable)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(
        and(
          eq(userTeamMembersTable.leadClerkId, leadClerkId),
          eq(userTeamMembersTable.memberClerkId, userId),
          eq(userTeamMembersTable.status, "pending"),
        ),
      );
    res.json({ ok: true });
  },
);

router.post(
  "/users/me/team-invites/:leadClerkId/decline",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const leadClerkId = Array.isArray(req.params.leadClerkId)
      ? req.params.leadClerkId[0]
      : req.params.leadClerkId;
    await db
      .delete(userTeamMembersTable)
      .where(
        and(
          eq(userTeamMembersTable.leadClerkId, leadClerkId),
          eq(userTeamMembersTable.memberClerkId, userId),
          eq(userTeamMembersTable.status, "pending"),
        ),
      );
    res.json({ ok: true });
  },
);

router.get("/users/:userId/team", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  // Honor the lead's `team` visibility unless the viewer is the lead.
  const { userId: viewerClerkId } = req as AuthRequest;
  const [lead] = await db
    .select({ visibility: usersTable.visibility })
    .from(usersTable)
    .where(eq(usersTable.clerkId, raw));
  if (!lead) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  // #676 — same gate as `GET /users/:userId`: a demo persona's
  // sub-resources stay 404 for non-admin viewers so the demo's team
  // composition can't be enumerated through this back-door.
  if (
    raw !== viewerClerkId &&
    (await isAdminDemoClerkId(raw)) &&
    !(await isAdminUser(viewerClerkId))
  ) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const v = (lead.visibility ?? {}) as Record<string, boolean>;
  if (viewerClerkId !== raw && !v.team) {
    res.json({ members: [] });
    return;
  }
  const rows = await db
    .select({
      memberClerkId: userTeamMembersTable.memberClerkId,
      role: userTeamMembersTable.role,
      name: usersTable.name,
      username: usersTable.username,
      avatarUrl: usersTable.avatarUrl,
      // #557 — surface admin-seeded teammate chips on public profiles
      // so visitors see the same `Name · Role · Chip` line that the
      // admin sees inside ManageTeamModal / TeamSection.
      chip: userTeamMembersTable.chip,
      chipOther: userTeamMembersTable.chipOther,
    })
    .from(userTeamMembersTable)
    .innerJoin(usersTable, eq(usersTable.clerkId, userTeamMembersTable.memberClerkId))
    .where(
      and(
        eq(userTeamMembersTable.leadClerkId, raw),
        eq(userTeamMembersTable.status, "accepted"),
      ),
    );
  res.json({
    members: rows.map((r) => ({
      ...r,
      chip: r.chip ?? null,
      chipOther: r.chipOther ?? null,
    })),
  });
});

export default router;

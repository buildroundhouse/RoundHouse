import { Router, type IRouter } from "express";
import { and, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  db,
  outwardAccountsTable,
  usersTable,
  type UserModeKind,
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import {
  RECENTLY_DELETED_WINDOW_DAYS,
  listArchivedOutwardAccountsForUser,
  listOutwardAccountsForUser,
  listRecentlyDeletedOutwardAccountsForUser,
  resolveActiveOutwardAccountId,
} from "../lib/outwardAccounts";
import { applyOutwardAccountKindDefaults } from "../lib/ownerNameDisplay";

const router: IRouter = Router();

// Outward accounts model the public-facing skin and only support the
// owner-facing kinds. Teammate/collab kinds live on user_modes.
const VALID_KINDS: UserModeKind[] = ["trade_pro", "home", "facilities"];

// Per-kind creation caps. Trade Pro and Facilities Management are
// the two business kinds that we cap at 5 per personal profile —
// running more than five distinct businesses through one human is
// an abuse vector and a UX foot-gun. Other kinds (homeowner,
// collaborator, commercial owner if/when added) keep their existing
// uncapped behavior on purpose: a person can legitimately own many
// homes or hold many collaborator roles.
export const PER_KIND_CREATE_CAPS: Partial<Record<UserModeKind, number>> = {
  trade_pro: 5,
  facilities: 5,
};

// Business-kind set used by the "last business account" recommendation
// path. When a user tries to delete their last remaining account of one
// of these kinds, the client surfaces a sheet that nudges them toward
// keeping a non-business outward account around (Homeowner / Collab) so
// they don't leave themselves stranded with only public-facing
// business identities. Mirrors the framing in the task spec.
export const BUSINESS_KINDS: UserModeKind[] = ["trade_pro", "facilities"];

function cleanString(v: unknown, max = 200): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.slice(0, max);
}

router.get("/outward-accounts", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const [accounts, activeOutwardAccountId] = await Promise.all([
    listOutwardAccountsForUser(userId),
    resolveActiveOutwardAccountId(userId),
  ]);
  // The active id can flip independently of the accounts list. Disable
  // weak-ETag-based 304s so a switch round-trips fresh data to clients
  // (Express's default weak ETag matches when content-length is equal —
  // common when account ids have the same digit count). Also, read the
  // active id from the persisted users.active_outward_account_id row
  // rather than from the request header — the client may still be
  // sending the previous active id right after a switch, and echoing
  // that back would prevent the UI from learning about the new active.
  res.setHeader("Cache-Control", "no-store");
  res.json({ accounts, activeOutwardAccountId });
});

// Archived outward accounts live behind their own endpoint so the main
// list stays purely the "live" set used by the switcher and other
// scoped queries. The settings UI reads this to populate the
// "Archived" section where users can unarchive a skin.
router.get(
  "/outward-accounts/archived",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const accounts = await listArchivedOutwardAccountsForUser(userId);
    res.json({ accounts });
  },
);

router.post("/outward-accounts", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthRequest;
  const kind = req.body?.kind;
  if (typeof kind !== "string" || !VALID_KINDS.includes(kind as UserModeKind)) {
    res.status(400).json({ error: "Invalid outward account kind" });
    return;
  }

  const title = cleanString(req.body?.title);
  // displayName falls back to title when omitted so callers that only
  // care about a single label (e.g. legacy tests, simple UI flows) still
  // succeed without forcing two redundant fields.
  const displayName = cleanString(req.body?.displayName) ?? title;
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  if (!displayName) {
    res.status(400).json({ error: "displayName is required" });
    return;
  }

  const insertKind: UserModeKind = kind as UserModeKind;

  // Cap business-kind creation per personal profile. Counted against
  // live (non-archived) accounts only — soft-deleted ones don't count
  // against the cap so an honest mistake-then-retry doesn't lock the
  // user out. We surface a structured error envelope so the client can
  // render the friendly "limit reached (5/5)" message inline.
  const cap = PER_KIND_CREATE_CAPS[insertKind];
  if (cap !== undefined) {
    const existing = await db
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.ownerClerkId, userId),
          eq(outwardAccountsTable.kind, insertKind),
          isNull(outwardAccountsTable.archivedAt),
        ),
      );
    if (existing.length >= cap) {
      res.status(409).json({
        error: `You've reached the limit of ${cap} ${insertKind === "trade_pro" ? "Trade Pro" : "Facilities Management"} accounts.`,
        code: "kind_cap_reached",
        kind: insertKind,
        limit: cap,
        currentCount: existing.length,
      });
      return;
    }
  }

  // #640 / #674 — Per-skin "show owner's last initial only" defaults
  // are computed centrally by `applyOutwardAccountKindDefaults` so every
  // OA-insert path uses the same per-kind rule. Owner-business kinds
  // (trade_pro / home / facilities) accepted here default to OFF; the
  // caller may override via an explicit boolean `lastInitialOnly` on the
  // create body. Out-of-range / non-boolean payloads silently fall back
  // to the kind default so a typo can't accidentally publish a
  // half-initial name.
  const overrideLIO = req.body?.lastInitialOnly;
  const [created] = await db
    .insert(outwardAccountsTable)
    .values(
      applyOutwardAccountKindDefaults({
        ownerClerkId: userId,
        kind: insertKind,
        title,
        displayName,
        avatarUrl: cleanString(req.body?.avatarUrl, 1000) ?? null,
        bannerUrl: cleanString(req.body?.bannerUrl, 1000) ?? null,
        companyName: cleanString(req.body?.companyName) ?? null,
        bio: cleanString(req.body?.bio, 2000) ?? null,
        lastInitialOnly:
          typeof overrideLIO === "boolean" ? overrideLIO : undefined,
        sourceUserModeId: null,
      }),
    )
    .returning();
  // First account a user creates becomes their active one. The caller may
  // also pass `makeActive: true` to immediately switch onto the new skin.
  const [me] = await db
    .select({ activeOutwardAccountId: usersTable.activeOutwardAccountId })
    .from(usersTable)
    .where(eq(usersTable.clerkId, userId));
  const wantsActivate = req.body?.makeActive === true;
  if (!me?.activeOutwardAccountId || wantsActivate) {
    await db
      .update(usersTable)
      .set({ activeOutwardAccountId: created.id })
      .where(eq(usersTable.clerkId, userId));
  }
  res.status(201).json(created);
});

router.patch(
  "/outward-accounts/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid outward account id" });
      return;
    }
    const [existing] = await db
      .select()
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.id, id),
          eq(outwardAccountsTable.ownerClerkId, userId),
          isNull(outwardAccountsTable.archivedAt),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Outward account not found" });
      return;
    }

    const updates: Partial<typeof outwardAccountsTable.$inferInsert> = {};
    const t = cleanString(req.body?.title); if (t !== undefined) updates.title = t;
    const dn = cleanString(req.body?.displayName); if (dn !== undefined) updates.displayName = dn;
    const av = cleanString(req.body?.avatarUrl, 1000); if (av !== undefined) updates.avatarUrl = av;
    const bn = cleanString(req.body?.bannerUrl, 1000); if (bn !== undefined) updates.bannerUrl = bn;
    const cn = cleanString(req.body?.companyName); if (cn !== undefined) updates.companyName = cn;
    const bi = cleanString(req.body?.bio, 2000); if (bi !== undefined) updates.bio = bi;
    // #640 — Per-skin "show owner's last initial only" toggle. Only
    // accept strict booleans; anything else (undefined, null, string,
    // number) is ignored so a malformed PATCH can't silently flip the
    // privacy posture on a skin.
    if (typeof req.body?.lastInitialOnly === "boolean") {
      updates.lastInitialOnly = req.body.lastInitialOnly;
    }

    if (Object.keys(updates).length === 0) {
      res.json(existing);
      return;
    }

    const [updated] = await db
      .update(outwardAccountsTable)
      .set(updates)
      .where(eq(outwardAccountsTable.id, id))
      .returning();
    res.json(updated);
  },
);

router.post(
  "/outward-accounts/:id/switch",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid outward account id" });
      return;
    }
    const [target] = await db
      .select({
        id: outwardAccountsTable.id,
        sourceUserModeId: outwardAccountsTable.sourceUserModeId,
      })
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.id, id),
          eq(outwardAccountsTable.ownerClerkId, userId),
          isNull(outwardAccountsTable.archivedAt),
        ),
      );
    if (!target) {
      res.status(404).json({ error: "Outward account not found" });
      return;
    }
    // SECURITY-CRITICAL: keep `last_active_mode_id` in lockstep with the
    // outward account being switched to. The active-skin firewall derives
    // the active outward account from `last_active_mode_id` (see
    // resolveActiveOutwardAccountId) and self-heals the cached column,
    // so writing only `active_outward_account_id` here would silently
    // snap back to the previously-active skin on the next request.
    const updates: Partial<typeof usersTable.$inferInsert> = {
      activeOutwardAccountId: id,
    };
    if (target.sourceUserModeId != null) {
      updates.lastActiveModeId = target.sourceUserModeId;
    }
    await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.clerkId, userId));
    res.json({ activeOutwardAccountId: id });
  },
);

router.post(
  "/outward-accounts/:id/archive",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid outward account id" });
      return;
    }
    const [existing] = await db
      .select()
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.id, id),
          eq(outwardAccountsTable.ownerClerkId, userId),
          isNull(outwardAccountsTable.archivedAt),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Outward account not found" });
      return;
    }
    // #572: the Collaborator / Friend baseline is permanent — every
    // user must always have it. Refuse archive/delete on it so the
    // switcher can hide the destructive controls without trusting
    // the client to enforce it.
    if (existing.kind === "collab") {
      res.status(409).json({
        error: "Your Collaborator / Friend account can't be archived.",
        code: "protected_baseline",
      });
      return;
    }

    // Archive is the lighter-touch retire flow: hide the skin from the
    // owner's switcher and outward-facing feeds, but leave existing
    // user_connections rows live so the *other* party still sees their
    // prior threads/jobs from this profile. Callers who want to also
    // sever those connections should hit /delete instead, which
    // soft-archives the connections and the account together.
    // Disallow archiving the user's only remaining account, or the
    // currently-active one (they should switch first).
    const remaining = await db
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.ownerClerkId, userId),
          isNull(outwardAccountsTable.archivedAt),
        ),
      );
    if (remaining.length <= 1) {
      res.status(409).json({
        error: "You need at least one outward account.",
        code: "last_account",
      });
      return;
    }
    const [me] = await db
      .select({ activeOutwardAccountId: usersTable.activeOutwardAccountId })
      .from(usersTable)
      .where(eq(usersTable.clerkId, userId));
    if (me?.activeOutwardAccountId === id) {
      res.status(409).json({
        error: "Switch to another account before archiving this one.",
        code: "active_account",
      });
      return;
    }

    const [archived] = await db
      .update(outwardAccountsTable)
      .set({ archivedAt: new Date() })
      .where(eq(outwardAccountsTable.id, id))
      .returning();
    res.json(archived);
  },
);

router.post(
  "/outward-accounts/:id/unarchive",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid outward account id" });
      return;
    }
    // Only restore an account that the caller owns AND that is
    // currently archived — unarchiving a live row is a no-op we
    // surface as 404 so callers can't accidentally clear archivedAt
    // on something they didn't intend to touch.
    const [existing] = await db
      .select()
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.id, id),
          eq(outwardAccountsTable.ownerClerkId, userId),
          isNotNull(outwardAccountsTable.archivedAt),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Outward account not found" });
      return;
    }

    const [restored] = await db
      .update(outwardAccountsTable)
      .set({ archivedAt: null })
      .where(eq(outwardAccountsTable.id, id))
      .returning();
    res.json(restored);
  },
);

// Helper: load the caller's owned, non-archived outward account by id, or
// null. Used by the delete-impact + delete endpoints below.
async function loadOwnedAccount(
  userId: string,
  id: number,
): Promise<typeof outwardAccountsTable.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(outwardAccountsTable)
    .where(
      and(
        eq(outwardAccountsTable.id, id),
        eq(outwardAccountsTable.ownerClerkId, userId),
        isNull(outwardAccountsTable.archivedAt),
      ),
    );
  return row ?? null;
}

// Task #663: avatar-to-avatar `user_connections` no longer exist, so
// the "live connections that touch this avatar" preview is always 0
// for the new model. The endpoint is preserved so the mobile delete
// sheet still gets a stable shape (`{ connectionCount }`) without
// branching on whether the new entity model is in effect; the entity
// equivalent ("entities this avatar still belongs to") is surfaced via
// /entities/me in T007.
async function countLiveConnectionsForAccount(_id: number): Promise<number> {
  return 0;
}

router.get(
  "/outward-accounts/:id/delete-impact",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid outward account id" });
      return;
    }
    const existing = await loadOwnedAccount(userId, id);
    if (!existing) {
      res.status(404).json({ error: "Outward account not found" });
      return;
    }
    // #572: surface the protected baseline so the client UI can
    // hide destructive controls instead of probing /delete itself.
    if (existing.kind === "collab") {
      res.status(409).json({
        error: "Your Collaborator / Friend account can't be deleted.",
        code: "protected_baseline",
      });
      return;
    }
    const connectionCount = await countLiveConnectionsForAccount(id);
    res.json({ connectionCount });
  },
);

router.post(
  "/outward-accounts/:id/delete",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid outward account id" });
      return;
    }
    const existing = await loadOwnedAccount(userId, id);
    if (!existing) {
      res.status(404).json({ error: "Outward account not found" });
      return;
    }
    // #572: Collaborator / Friend baseline can never be deleted.
    if (existing.kind === "collab") {
      res.status(409).json({
        error: "Your Collaborator / Friend account can't be deleted.",
        code: "protected_baseline",
      });
      return;
    }

    // Mirror archive's safety rails: never strand a user with zero
    // accounts, and don't let them nuke the one they're currently using.
    const remaining = await db
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.ownerClerkId, userId),
          isNull(outwardAccountsTable.archivedAt),
        ),
      );
    if (remaining.length <= 1) {
      res.status(409).json({
        error: "You need at least one outward account.",
        code: "last_account",
      });
      return;
    }
    const [me] = await db
      .select({ activeOutwardAccountId: usersTable.activeOutwardAccountId })
      .from(usersTable)
      .where(eq(usersTable.clerkId, userId));
    if (me?.activeOutwardAccountId === id) {
      res.status(409).json({
        error: "Switch to another account before deleting this one.",
        code: "active_account",
      });
      return;
    }

    // Soft-delete the account itself. Task #663: the legacy step that
    // also archived every `user_connections` row touching this avatar
    // is no longer needed — those rows don't exist in the entity
    // model. The avatar's `entity_members` rows stay live so the user
    // can restore the account inside the recovery window without
    // losing their workspaces; if they decide to purge instead, the
    // entity layer's own membership cleanup runs there.
    const now = new Date();
    const [deleted] = await db
      .update(outwardAccountsTable)
      .set({ archivedAt: now })
      .where(eq(outwardAccountsTable.id, id))
      .returning();

    res.json({
      account: deleted,
      archivedConnectionCount: 0,
    });
  },
);

// Helper: figure out which live connections involving `sourceId` would
// actually move onto `targetId` and which would have to be archived
// instead. A connection (from, to) gets a new pair (from', to') where
// every occurrence of sourceId is rewritten to targetId. We have to
// archive instead of move when:
//   - the rewrite would point an outward account at itself (the source
//     and target were already connected to each other), or
//   - some row already exists at the new (from, to) pair — the unique
//     index on user_connections won't let us land a duplicate.
// This is shared between the impact preview and the actual reassign.
async function planReassign(
  _sourceId: number,
  _targetId: number,
): Promise<{
  toMove: { id: number; newFrom: number; newTo: number; otherAccountId: number }[];
  toArchive: { id: number; otherAccountId: number }[];
  totalCount: number;
}> {
  // Task #663: hand-off planning previously rewrote every
  // `user_connections` row touching the source avatar onto the target
  // avatar (and archived collisions). With avatar-to-avatar
  // connections retired, there's nothing to move or archive at this
  // layer; the corresponding entity-membership hand-off lives
  // alongside the entity APIs and is not part of the avatar delete
  // flow today. Returning empty plans keeps the impact endpoint and
  // the reassign-and-delete handler shape-stable for any client still
  // calling them while T007 finishes the entity-side equivalents.
  return { toMove: [], toArchive: [], totalCount: 0 };
}

// Look up the public-facing party fields for the "other side" of every
// connection in a reassign plan. Returned in a Map keyed by outward
// account id so the impact endpoint can decorate its two lists cheaply.
async function loadPartySummaries(
  ids: number[],
): Promise<
  Map<
    number,
    {
      id: number;
      kind: string;
      displayName: string | null;
      title: string | null;
      avatarUrl: string | null;
    }
  >
> {
  const map = new Map<
    number,
    {
      id: number;
      kind: string;
      displayName: string | null;
      title: string | null;
      avatarUrl: string | null;
    }
  >();
  if (ids.length === 0) return map;
  const rows = await db
    .select({
      id: outwardAccountsTable.id,
      kind: outwardAccountsTable.kind,
      displayName: outwardAccountsTable.displayName,
      title: outwardAccountsTable.title,
      avatarUrl: outwardAccountsTable.avatarUrl,
    })
    .from(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.id, ids));
  for (const r of rows) map.set(r.id, r);
  return map;
}

router.get(
  "/outward-accounts/:id/reassign-impact",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const id = Number(req.params.id);
    const targetId = Number(req.query.targetId);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid outward account id" });
      return;
    }
    if (!Number.isFinite(targetId) || targetId <= 0 || targetId === id) {
      res.status(400).json({ error: "Pick a different account to receive the connections." });
      return;
    }
    const existing = await loadOwnedAccount(userId, id);
    if (!existing) {
      res.status(404).json({ error: "Outward account not found" });
      return;
    }
    const target = await loadOwnedAccount(userId, targetId);
    if (!target) {
      res.status(404).json({ error: "Target outward account not found" });
      return;
    }
    const { toMove, toArchive, totalCount } = await planReassign(id, targetId);
    // Pull party summaries for the "other side" of every connection in
    // one go so we can render names/avatars in the hand-off sheet.
    const otherIds = Array.from(
      new Set([
        ...toMove.map((r) => r.otherAccountId),
        ...toArchive.map((r) => r.otherAccountId),
      ]),
    );
    const parties = await loadPartySummaries(otherIds);
    const decorate = (
      rows: { id: number; otherAccountId: number }[],
    ) =>
      rows.map((r) => {
        const p = parties.get(r.otherAccountId);
        return {
          connectionId: r.id,
          otherAccount: {
            id: r.otherAccountId,
            kind: p?.kind ?? "home",
            displayName: p?.displayName ?? null,
            title: p?.title ?? null,
            avatarUrl: p?.avatarUrl ?? null,
          },
        };
      });
    res.json({
      totalCount,
      moveCount: toMove.length,
      collisionCount: toArchive.length,
      toMove: decorate(toMove),
      toArchive: decorate(toArchive),
    });
  },
);

router.post(
  "/outward-accounts/:id/reassign-and-delete",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const id = Number(req.params.id);
    const targetId = Number(req.body?.targetId);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid outward account id" });
      return;
    }
    if (!Number.isFinite(targetId) || targetId <= 0 || targetId === id) {
      res.status(400).json({ error: "Pick a different account to receive the connections." });
      return;
    }
    const existing = await loadOwnedAccount(userId, id);
    if (!existing) {
      res.status(404).json({ error: "Outward account not found" });
      return;
    }
    const target = await loadOwnedAccount(userId, targetId);
    if (!target) {
      res.status(404).json({ error: "Target outward account not found" });
      return;
    }
    // #572: Collaborator / Friend baseline can never be deleted —
    // even via reassign-and-delete.
    if (existing.kind === "collab") {
      res.status(409).json({
        error: "Your Collaborator / Friend account can't be deleted.",
        code: "protected_baseline",
      });
      return;
    }

    // Mirror delete's safety rails.
    const remaining = await db
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.ownerClerkId, userId),
          isNull(outwardAccountsTable.archivedAt),
        ),
      );
    if (remaining.length <= 1) {
      res.status(409).json({
        error: "You need at least one outward account.",
        code: "last_account",
      });
      return;
    }
    const [me] = await db
      .select({ activeOutwardAccountId: usersTable.activeOutwardAccountId })
      .from(usersTable)
      .where(eq(usersTable.clerkId, userId));
    if (me?.activeOutwardAccountId === id) {
      res.status(409).json({
        error: "Switch to another account before deleting this one.",
        code: "active_account",
      });
      return;
    }

    const result = await db.transaction(async (tx) => {
      // Task #663: the legacy step that rewrote/archived every
      // `user_connections` row touching this avatar is no longer
      // needed — those rows don't exist in the entity model. We just
      // archive the source avatar and leave any entity_members rows
      // alone so a Restore inside the recovery window puts the
      // workspaces back exactly as they were.
      void targetId;
      const now = new Date();
      const [deleted] = await tx
        .update(outwardAccountsTable)
        .set({ archivedAt: now })
        .where(eq(outwardAccountsTable.id, id))
        .returning();
      return { deleted, movedCount: 0, archivedCount: 0 };
    });

    res.json({
      account: result.deleted,
      movedConnectionCount: result.movedCount,
      archivedConnectionCount: result.archivedCount,
    });
  },
);

// "Recently deleted" — accounts the user soft-deleted in the last
// RECENTLY_DELETED_WINDOW_DAYS. The UI uses this to surface a Restore
// affordance so an accidental delete is recoverable.
router.get(
  "/outward-accounts/recently-deleted",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const accounts = await listRecentlyDeletedOutwardAccountsForUser(userId);
    res.json({ accounts, windowDays: RECENTLY_DELETED_WINDOW_DAYS });
  },
);

// Restore a previously soft-deleted outward account, plus the
// connections that were archived alongside it. We identify the
// "archived together" set by matching connections whose archivedAt
// equals the account's archivedAt — the delete handler stamps both
// with the same `now` value, so this gives an exact undo.
router.post(
  "/outward-accounts/:id/restore",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid outward account id" });
      return;
    }
    const [existing] = await db
      .select()
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.id, id),
          eq(outwardAccountsTable.ownerClerkId, userId),
          isNotNull(outwardAccountsTable.archivedAt),
        ),
      );
    if (!existing || existing.archivedAt == null) {
      res.status(404).json({ error: "Outward account not found" });
      return;
    }
    const cutoff = new Date(
      Date.now() - RECENTLY_DELETED_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    if (existing.archivedAt < cutoff) {
      res.status(409).json({
        error:
          "This account was deleted too long ago to be restored. Contact support if you need it back.",
      });
      return;
    }

    // Task #663: there are no archived `user_connections` rows to
    // unstamp anymore. Restoring an avatar simply unarchives the
    // outward_accounts row; the avatar's entity memberships were
    // never archived in the new delete path so they're still live.
    const [restored] = await db
      .update(outwardAccountsTable)
      .set({ archivedAt: null })
      .where(eq(outwardAccountsTable.id, id))
      .returning();

    res.json({
      account: restored,
      restoredConnectionCount: 0,
    });
  },
);

// Hard-delete an archived outward account. Mirrors the safety pattern of
// /delete (archive any remaining live connections that still touch this
// skin so they stop appearing on the other side) but then physically
// removes the outward_accounts row so it disappears from the Archived
// view entirely. Refuses if the account isn't already archived — the
// regular /delete endpoint covers that case and has its own safety
// rails (active account, only-account guards) we don't want to skip.
router.post(
  "/outward-accounts/:id/purge",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid outward account id" });
      return;
    }
    const [existing] = await db
      .select()
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.id, id),
          eq(outwardAccountsTable.ownerClerkId, userId),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Outward account not found" });
      return;
    }
    if (existing.archivedAt == null) {
      res.status(409).json({
        error: "Archive this account before deleting it forever.",
      });
      return;
    }

    // Task #663: no `user_connections` rows to archive — purge just
    // physically removes the outward_accounts row. Entity-side
    // membership cleanup runs in the entity layer's own delete path.
    await db
      .delete(outwardAccountsTable)
      .where(eq(outwardAccountsTable.id, id));

    res.json({ archivedConnectionCount: 0 });
  },
);

// Move the avatar from one of the caller's outward accounts to another
// of their outward accounts. Both source and target must be owned by
// the caller, both must be live, and both must be business kinds —
// homeowner/collab outward profiles intentionally do not participate
// in the avatar handoff flow because their avatar is the personal
// avatar by default. The source account is left avatar-less (caller
// can assign a fresh one afterwards).
router.post(
  "/outward-accounts/:id/transfer-avatar",
  requireAuth,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const id = Number(req.params.id);
    const targetId = Number(req.body?.targetId);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: "Invalid outward account id" });
      return;
    }
    if (!Number.isFinite(targetId) || targetId <= 0 || targetId === id) {
      res
        .status(400)
        .json({ error: "Pick a different account to receive the avatar." });
      return;
    }
    const source = await loadOwnedAccount(userId, id);
    if (!source) {
      res.status(404).json({ error: "Outward account not found" });
      return;
    }
    const target = await loadOwnedAccount(userId, targetId);
    if (!target) {
      res.status(404).json({ error: "Target outward account not found" });
      return;
    }
    if (
      !BUSINESS_KINDS.includes(source.kind as UserModeKind) ||
      !BUSINESS_KINDS.includes(target.kind as UserModeKind)
    ) {
      res.status(409).json({
        error: "Avatar transfer is only available between business accounts.",
        code: "non_business_kind",
      });
      return;
    }
    if (!source.avatarUrl) {
      res
        .status(409)
        .json({ error: "Source account has no avatar to transfer." });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [updatedTarget] = await tx
        .update(outwardAccountsTable)
        .set({ avatarUrl: source.avatarUrl })
        .where(eq(outwardAccountsTable.id, target.id))
        .returning();
      const [updatedSource] = await tx
        .update(outwardAccountsTable)
        .set({ avatarUrl: null })
        .where(eq(outwardAccountsTable.id, source.id))
        .returning();
      return { source: updatedSource, target: updatedTarget };
    });

    res.json(result);
  },
);

export default router;

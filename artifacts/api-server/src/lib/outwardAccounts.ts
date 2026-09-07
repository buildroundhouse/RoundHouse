import { eq, and, isNull, isNotNull, asc, desc, gte, lt, inArray, or } from "drizzle-orm";
import { compareUserModeKind } from "@workspace/api-zod";
import { isAdminDemoClerkId } from "./adminDemo";
import { applyOutwardAccountKindDefaults } from "./ownerNameDisplay";
import {
  db,
  outwardAccountsTable,
  outwardAccountPurgeRunsTable,
  usersTable,
  userModesTable,
  type OutwardAccount,
  type OutwardAccountPurgeRun,
  type OutwardAccountPurgeRunSource,
  type UserModeKind,
} from "@workspace/db";

/**
 * How long after a soft-delete a user can still recover an outward
 * account from the "Recently deleted" list. After this window the row
 * remains in the database (for audit) but is no longer surfaced for
 * restore.
 */
export const RECENTLY_DELETED_WINDOW_DAYS = 30;

/**
 * How long to keep rows in `outward_account_purge_runs` before the
 * sweep trims them. Every sweep — including no-ops — writes an audit
 * row, so on a tight cadence (e.g. hourly during testing) this table
 * grows fast. 90 days gives operators a useful window to confirm the
 * sweep is firing without letting the table balloon. Override with
 * the OUTWARD_ACCOUNT_PURGE_RETENTION_DAYS env var.
 */
export const PURGE_RUN_RETENTION_DAYS_DEFAULT = 90;

function resolvePurgeRunRetentionDays(override?: number): number {
  if (
    override != null &&
    Number.isFinite(override) &&
    override > 0
  ) {
    return Math.floor(override);
  }
  const raw = process.env["OUTWARD_ACCOUNT_PURGE_RETENTION_DAYS"];
  if (raw !== undefined && raw !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return PURGE_RUN_RETENTION_DAYS_DEFAULT;
}

/**
 * Resolve the active outward account id for a user, falling back to a
 * sensible default if none is set. Used by the auth middleware so every
 * request that has an authenticated user also has an active outward
 * account context.
 */
export async function resolveActiveOutwardAccountId(
  clerkId: string,
): Promise<number | null> {
  const [user] = await db
    .select({
      activeOutwardAccountId: usersTable.activeOutwardAccountId,
      lastActiveModeId: usersTable.lastActiveModeId,
    })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId));

  // SECURITY-CRITICAL: derive the active outward account from the user's
  // last_active_mode_id rather than trusting the cached
  // active_outward_account_id column. If a write path forgets to update
  // both columns together, the cached value can drift and start serving
  // another skin's data into the active session — a privacy breach.
  // Deriving from last_active_mode_id makes the firewall self-healing.
  if (user?.lastActiveModeId != null) {
    const [acctFromMode] = await db
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.ownerClerkId, clerkId),
          eq(outwardAccountsTable.sourceUserModeId, user.lastActiveModeId),
          isNull(outwardAccountsTable.archivedAt),
        ),
      )
      .limit(1);
    if (acctFromMode) {
      // Heal the cached column when it disagrees so any code still
      // reading users.active_outward_account_id directly sees the
      // correct value next time.
      if (user.activeOutwardAccountId !== acctFromMode.id) {
        await db
          .update(usersTable)
          .set({ activeOutwardAccountId: acctFromMode.id })
          .where(eq(usersTable.clerkId, clerkId));
      }
      return acctFromMode.id;
    }
  }

  // Mode-based derivation didn't find a match (e.g. a mode without a
  // matching outward account). Fall back to the cached column, but only
  // after validating it still belongs to the user and isn't archived.
  if (user?.activeOutwardAccountId != null) {
    const [acct] = await db
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.id, user.activeOutwardAccountId),
          eq(outwardAccountsTable.ownerClerkId, clerkId),
          isNull(outwardAccountsTable.archivedAt),
        ),
      );
    if (acct) return acct.id;
  }
  // Final fallback: the user's earliest outward account.
  const [first] = await db
    .select({ id: outwardAccountsTable.id })
    .from(outwardAccountsTable)
    .where(
      and(
        eq(outwardAccountsTable.ownerClerkId, clerkId),
        isNull(outwardAccountsTable.archivedAt),
      ),
    )
    .orderBy(asc(outwardAccountsTable.id))
    .limit(1);
  if (first) {
    // Heal users.active_outward_account_id so the next call short-circuits.
    await db
      .update(usersTable)
      .set({ activeOutwardAccountId: first.id })
      .where(eq(usersTable.clerkId, clerkId));
    return first.id;
  }
  // User has no outward accounts at all — lazily seed one so newly
  // created users (post-migration) and tests don't have to do this
  // manually. Mirrors the behavior of migrateOutwardAccounts.ts.
  return ensureDefaultOutwardAccount(clerkId);
}

async function ensureDefaultOutwardAccount(clerkId: string): Promise<number | null> {
  // The Collaborator / Friend baseline is the universal default skin.
  // Every signed-in user always has one — auto-created here on demand
  // so newly-created users (and any pre-#572 user without one) get
  // self-healed on next request.
  return ensureCollabBaselineOutwardAccount(clerkId);
}

/**
 * #572 — Ensure the user has a permanent Collaborator / Friend
 * `user_modes` row. Idempotent: a no-op if one already exists.
 * The baseline mode has an empty intake (no questions) and is marked
 * complete on creation so the onboarding flow can route the user
 * straight into the app without forcing them through the mode picker.
 *
 * Does NOT touch `users.last_active_mode_id`. Adopting collab as the
 * active mode here would override a real (mode-less) outward account
 * the user just switched to, since `resolveActiveOutwardAccountId`
 * derives from `last_active_mode_id` first. The `/users/me/modes`
 * endpoint already self-heals `last_active_mode_id` to the first
 * available mode when it's null/stale, so fresh users still land on
 * collab as their active mode without us forcing it here.
 */
export async function ensureCollabBaselineMode(
  clerkId: string,
): Promise<number | null> {
  const [user] = await db
    .select({ clerkId: usersTable.clerkId })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId));
  if (!user) return null;

  const [existing] = await db
    .select({ id: userModesTable.id })
    .from(userModesTable)
    .where(
      and(
        eq(userModesTable.userClerkId, clerkId),
        eq(userModesTable.kind, "collab"),
      ),
    )
    .limit(1);

  let modeId: number;
  if (existing) {
    modeId = existing.id;
  } else {
    // The schema's partial unique index on (user_clerk_id, kind) where
    // kind = 'collab' protects against a race here, but onConflict is
    // belt-and-braces so concurrent /users/me calls on first sign-in
    // can't blow up. The loser of the race re-fetches.
    const [created] = await db
      .insert(userModesTable)
      .values({
        userClerkId: clerkId,
        kind: "collab" satisfies UserModeKind,
        intakeData: {},
        intakeCompletedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: userModesTable.id });
    if (created) {
      modeId = created.id;
    } else {
      const [again] = await db
        .select({ id: userModesTable.id })
        .from(userModesTable)
        .where(
          and(
            eq(userModesTable.userClerkId, clerkId),
            eq(userModesTable.kind, "collab"),
          ),
        )
        .limit(1);
      if (!again) return null;
      modeId = again.id;
    }
  }
  return modeId;
}

/**
 * #572 — Ensure the user has a permanent Collaborator / Friend
 * outward account. Idempotent: a no-op if one already exists. Used
 * both as the lazy seed for fresh users and as the on-login backfill
 * for legacy users that pre-date this baseline. Returns the id of the
 * baseline account (existing or newly-created), or null when the user
 * row itself doesn't exist yet.
 *
 * Internally also ensures the matching `collab` user_mode exists and
 * links the outward account to it via `sourceUserModeId` so mode-driven
 * active-skin resolution (see `resolveActiveOutwardAccountId`) treats
 * the baseline pair coherently.
 */
export async function ensureCollabBaselineOutwardAccount(
  clerkId: string,
): Promise<number | null> {
  const [user] = await db
    .select({
      name: usersTable.name,
      avatarUrl: usersTable.avatarUrl,
      activeOutwardAccountId: usersTable.activeOutwardAccountId,
    })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId));
  if (!user) return null;

  // Always ensure the matching mode first so we can stamp the OA's
  // sourceUserModeId at insert time (and self-heal it on the existing
  // baseline if it was created before #572).
  const modeId = await ensureCollabBaselineMode(clerkId);

  // Already has a baseline OA? Self-heal archived state and link.
  const [existing] = await db
    .select({
      id: outwardAccountsTable.id,
      sourceUserModeId: outwardAccountsTable.sourceUserModeId,
      displayName: outwardAccountsTable.displayName,
      avatarUrl: outwardAccountsTable.avatarUrl,
    })
    .from(outwardAccountsTable)
    .where(
      and(
        eq(outwardAccountsTable.ownerClerkId, clerkId),
        eq(outwardAccountsTable.kind, "collab"),
      ),
    )
    .limit(1);
  if (existing) {
    // Self-heal: restore archived baselines (legacy / pre-#572 data),
    // link the matching mode, and #572 — backfill displayName/avatarUrl
    // from the user's identity when the baseline was first created
    // before identity completion (e.g. concurrent /users/me on the very
    // first sign-in fired the seed before the user uploaded an avatar).
    // Only fills empty fields; never clobbers a value the user has
    // since edited via the regular OA PATCH path.
    const patch: {
      archivedAt: null;
      sourceUserModeId?: number;
      displayName?: string;
      avatarUrl?: string;
    } = { archivedAt: null };
    if (modeId != null && existing.sourceUserModeId !== modeId) {
      patch.sourceUserModeId = modeId;
    }
    if (!existing.displayName && user.name?.trim()) {
      patch.displayName = user.name;
    }
    if (!existing.avatarUrl && user.avatarUrl?.trim()) {
      patch.avatarUrl = user.avatarUrl;
    }
    await db
      .update(outwardAccountsTable)
      .set(patch)
      .where(eq(outwardAccountsTable.id, existing.id));
    return existing.id;
  }

  // Seed a new Collaborator / Friend skin from the user's identity
  // (name + avatar). Race-safe: the partial unique index
  // `outward_accounts_collab_baseline_uq` guarantees only one live
  // baseline per owner, and `onConflictDoNothing` lets concurrent
  // first-login traffic safely no-op without surfacing a duplicate-
  // key error. After the insert we re-fetch by (owner, kind) to
  // resolve the winning row's id whether we created it or lost the
  // race.
  const inserted = await db
    .insert(outwardAccountsTable)
    .values(
      // #674 — Pipe through the centralised per-kind defaults so the
      // baseline collab OA picks up its `last_initial_only` value from
      // `defaultLastInitialOnlyForKind` (currently OFF for the bare
      // `collab` baseline; ON for the `*_collab` variants if/when this
      // helper is reused to seed those).
      applyOutwardAccountKindDefaults({
        ownerClerkId: clerkId,
        kind: "collab" satisfies UserModeKind,
        title: null,
        displayName: user.name?.trim() ? user.name : null,
        avatarUrl: user.avatarUrl?.trim() ? user.avatarUrl : null,
        bannerUrl: null,
        companyName: null,
        bio: null,
        sourceUserModeId: modeId,
      }),
    )
    // The composite project emit drops drizzle's index records from the
    // declared table type, so we widen the target reference for typing
    // without affecting runtime behavior. The unique index name is
    // pinned by the schema (`outward_accounts_collab_baseline_uq`).
    .onConflictDoNothing({
      target: (outwardAccountsTable as unknown as { collabBaselineUq: unknown }).collabBaselineUq as never,
    })
    .returning({ id: outwardAccountsTable.id });

  let createdId = inserted[0]?.id;
  if (createdId == null) {
    const [winner] = await db
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.ownerClerkId, clerkId),
          eq(outwardAccountsTable.kind, "collab"),
          isNull(outwardAccountsTable.archivedAt),
        ),
      )
      .limit(1);
    if (!winner) {
      // Should be unreachable: either we inserted, or another
      // request did. Throw so callers see the inconsistency rather
      // than silently returning `undefined`.
      throw new Error(
        "ensureCollabBaselineOutwardAccount: row vanished after race",
      );
    }
    createdId = winner.id;
  }

  // Only adopt this as the active skin if the user currently has none.
  // We never override an already-active business skin on backfill —
  // that would silently flip the active context out from under them.
  if (user.activeOutwardAccountId == null) {
    await db
      .update(usersTable)
      .set({ activeOutwardAccountId: createdId })
      .where(eq(usersTable.clerkId, clerkId));
  }
  return createdId;
}

/**
 * Return the ids of every non-archived outward account owned by the user.
 * Used by routes that need to scope queries (invite lists, daily-cap
 * counts, etc.) to "everything I sent across all of my skins".
 */
export async function listOutwardAccountIdsForUser(
  clerkId: string,
): Promise<number[]> {
  const rows = await db
    .select({ id: outwardAccountsTable.id })
    .from(outwardAccountsTable)
    .where(
      and(
        eq(outwardAccountsTable.ownerClerkId, clerkId),
        isNull(outwardAccountsTable.archivedAt),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Resolve the default (earliest, non-archived) outward account id for a
 * user. Used by write paths that need to stamp an outward account on a
 * row owned by *another* user (e.g. inviting a member to a property —
 * the invitee's default skin owns their membership row). Lazily seeds an
 * outward account if none exist yet, mirroring `resolveActiveOutwardAccountId`.
 */
export async function resolveDefaultOutwardAccountIdForUser(
  clerkId: string,
): Promise<number | null> {
  const [first] = await db
    .select({ id: outwardAccountsTable.id })
    .from(outwardAccountsTable)
    .where(
      and(
        eq(outwardAccountsTable.ownerClerkId, clerkId),
        isNull(outwardAccountsTable.archivedAt),
      ),
    )
    .orderBy(asc(outwardAccountsTable.id))
    .limit(1);
  if (first) return first.id;
  return ensureDefaultOutwardAccount(clerkId);
}

export async function listOutwardAccountsForUser(
  clerkId: string,
): Promise<(OutwardAccount & { isDemo: boolean })[]> {
  const rows = await db
    .select()
    .from(outwardAccountsTable)
    .where(
      and(
        eq(outwardAccountsTable.ownerClerkId, clerkId),
        isNull(outwardAccountsTable.archivedAt),
      ),
    )
    .orderBy(asc(outwardAccountsTable.id));
  // Every outward account a user owns shares the same owner clerkId, so
  // a single isAdminDemoClerkId() lookup answers the question for the
  // whole list without N+1 queries. The demo flag rides along on every
  // OA returned to the client so the DEMO badge can render anywhere
  // this avatar appears.
  const isDemo = await isAdminDemoClerkId(clerkId);
  // #616: Switcher renders skins in a fixed lifecycle order so users
  // always find the same kind in the same slot regardless of when
  // each account was created. The order is shared with the client
  // via @workspace/api-zod so server sort and client pickers can't
  // drift. Within the same kind, fall back to insertion order
  // (id asc).
  return rows
    .sort((a, b) => {
      const cmp = compareUserModeKind(a.kind, b.kind);
      if (cmp !== 0) return cmp;
      return a.id - b.id;
    })
    .map((r) => ({ ...r, isDemo }));
}

/**
 * Outward accounts the user soft-deleted within the recovery window.
 * Surfaced as the "Recently deleted" section so they can Restore one
 * if they hit Delete by mistake. Newest deletions first.
 */
export async function listRecentlyDeletedOutwardAccountsForUser(
  clerkId: string,
  withinDays: number = RECENTLY_DELETED_WINDOW_DAYS,
): Promise<OutwardAccount[]> {
  const cutoff = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000);
  return db
    .select()
    .from(outwardAccountsTable)
    .where(
      and(
        eq(outwardAccountsTable.ownerClerkId, clerkId),
        isNotNull(outwardAccountsTable.archivedAt),
        gte(outwardAccountsTable.archivedAt, cutoff),
      ),
    )
    .orderBy(desc(outwardAccountsTable.archivedAt));
}

/**
 * Every archived outward account owned by the user, regardless of how
 * long ago. Used by the "Archived" section in the mobile account
 * settings (#339) so users can unarchive an old skin even after the
 * recently-deleted recovery window has passed.
 *
 * Overlap with {@link listRecentlyDeletedOutwardAccountsForUser} is
 * expected; the UI dedupes by id so each row only renders once.
 */
export async function listArchivedOutwardAccountsForUser(
  clerkId: string,
): Promise<OutwardAccount[]> {
  return db
    .select()
    .from(outwardAccountsTable)
    .where(
      and(
        eq(outwardAccountsTable.ownerClerkId, clerkId),
        isNotNull(outwardAccountsTable.archivedAt),
      ),
    )
    .orderBy(asc(outwardAccountsTable.id));
}

/**
 * Hard-delete every outward account whose soft-delete fell out of the
 * recovery window, plus the archived `user_connections` rows that point
 * at those accounts on either side. Closes the loop on the soft-delete
 * lifecycle from #325 — past the window the row is no longer surface-able
 * for restore, so keeping it (and its archived connection rows) around
 * just inflates storage and noise in audits.
 *
 * Returns counts so callers (the scheduled sweep, the on-demand script,
 * tests) can log/report exactly what was removed.
 *
 * `now` is injectable so tests can simulate the passage of time without
 * having to backdate rows by 30+ days.
 */
export interface PurgeExpiredOutwardAccountsOptions {
  now?: Date;
  withinDays?: number;
  /**
   * What kicked off this run. Persisted on the audit row so operators
   * can tell a startup sweep apart from the on-demand script. Defaults
   * to "scheduled" since that's the dominant caller.
   */
  source?: OutwardAccountPurgeRunSource;
  /**
   * Override the retention window (in days) for trimming old audit
   * rows. Falls back to OUTWARD_ACCOUNT_PURGE_RETENTION_DAYS env var,
   * then PURGE_RUN_RETENTION_DAYS_DEFAULT. Mainly here so tests can
   * exercise the trim without backdating rows by 90 days.
   */
  runRetentionDays?: number;
}

export interface PurgeExpiredOutwardAccountsResult {
  accounts: number;
  connections: number;
  /** Number of old audit rows trimmed by this run. */
  runsTrimmed: number;
  /** Id of the audit row written for this invocation. */
  runId: number;
}

export async function purgeExpiredOutwardAccounts(
  opts: PurgeExpiredOutwardAccountsOptions = {},
): Promise<PurgeExpiredOutwardAccountsResult> {
  const now = opts.now ?? new Date();
  const withinDays = opts.withinDays ?? RECENTLY_DELETED_WINDOW_DAYS;
  const source: OutwardAccountPurgeRunSource = opts.source ?? "scheduled";
  const cutoff = new Date(now.getTime() - withinDays * 24 * 60 * 60 * 1000);
  const retentionDays = resolvePurgeRunRetentionDays(opts.runRetentionDays);
  const runRetentionCutoff = new Date(
    now.getTime() - retentionDays * 24 * 60 * 60 * 1000,
  );
  const startedAt = Date.now();
  // Wrap the read + two deletes + audit insert in a single transaction
  // so a partial failure can't leave us with orphaned connection rows
  // pointing at a purged account (or vice versa), and so the audit row
  // either reflects the work that actually committed or is absent
  // entirely. Cheap because the maintenance sweep runs serially.
  return db.transaction(async (tx) => {
    const expired = await tx
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(
        and(
          isNotNull(outwardAccountsTable.archivedAt),
          lt(outwardAccountsTable.archivedAt, cutoff),
        ),
      );

    let removedAccountIds: number[] = [];
    let removedConnectionIds: number[] = [];

    if (expired.length > 0) {
      const ids = expired.map((r) => r.id);

      // Task #663: avatar-to-avatar `user_connections` rows no longer
      // exist, so the legacy "drop archived connections that touched
      // these avatars" step is a no-op. Entity-side membership cleanup
      // for purged avatars happens in the entity layer's own delete
      // path; the audit row keeps reporting `connectionsRemoved=0`
      // here so dashboards / alerts stay schema-stable.
      const removedAccounts = await tx
        .delete(outwardAccountsTable)
        .where(inArray(outwardAccountsTable.id, ids))
        .returning({ id: outwardAccountsTable.id });

      removedAccountIds = removedAccounts.map((r) => r.id);
      removedConnectionIds = [];
    }

    // Trim audit rows older than the retention window before inserting
    // the new one so the table self-bounds. Done inside the same
    // transaction as the audit insert so the trim and the new row
    // commit (or roll back) together.
    const trimmedRuns = await tx
      .delete(outwardAccountPurgeRunsTable)
      .where(lt(outwardAccountPurgeRunsTable.ranAt, runRetentionCutoff))
      .returning({ id: outwardAccountPurgeRunsTable.id });

    // Always record the run — including no-ops — so the operator
    // history shows the sweep is actually firing on its cadence, not
    // just that it occasionally found something to delete.
    const [run] = await tx
      .insert(outwardAccountPurgeRunsTable)
      .values({
        source,
        accountsRemoved: removedAccountIds.length,
        connectionsRemoved: removedConnectionIds.length,
        runsTrimmed: trimmedRuns.length,
        accountIds: removedAccountIds.length > 0 ? removedAccountIds : null,
        connectionIds:
          removedConnectionIds.length > 0 ? removedConnectionIds : null,
        durationMs: Date.now() - startedAt,
      })
      .returning({ id: outwardAccountPurgeRunsTable.id });

    return {
      accounts: removedAccountIds.length,
      connections: removedConnectionIds.length,
      runsTrimmed: trimmedRuns.length,
      runId: run.id,
    };
  });
}

/**
 * Most recent outward-account purge runs for the operator history view.
 * Newest first. Capped to keep the response bounded.
 */
export async function listRecentOutwardAccountPurgeRuns(
  limit = 50,
): Promise<OutwardAccountPurgeRun[]> {
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 500);
  return db
    .select()
    .from(outwardAccountPurgeRunsTable)
    .orderBy(desc(outwardAccountPurgeRunsTable.ranAt))
    .limit(safeLimit);
}

/**
 * Default sweep cadence (matches the scheduler in src/index.ts) and the
 * upper bound Node's setInterval can accept. Exported so the alert
 * monitor and admin health endpoint can resolve the same configured
 * cadence the sweep itself uses.
 */
export const DEFAULT_OUTWARD_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const MAX_OUTWARD_PURGE_INTERVAL_MS = 2_147_483_647;

/**
 * Resolve the configured purge sweep interval from the environment,
 * falling back to {@link DEFAULT_OUTWARD_PURGE_INTERVAL_MS} when the
 * value is missing or invalid. Mirrors the parsing the scheduler does
 * in src/index.ts so the overdue check is anchored to the same number
 * the sweep is actually firing on.
 */
export function getConfiguredOutwardPurgeIntervalMs(): number {
  const raw = process.env["OUTWARD_ACCOUNT_PURGE_INTERVAL_MS"];
  if (raw === undefined || raw === "") return DEFAULT_OUTWARD_PURGE_INTERVAL_MS;
  const parsed = Number(raw);
  if (
    Number.isFinite(parsed) &&
    parsed > 0 &&
    parsed <= MAX_OUTWARD_PURGE_INTERVAL_MS
  ) {
    return parsed;
  }
  return DEFAULT_OUTWARD_PURGE_INTERVAL_MS;
}

/**
 * How many sweep intervals are allowed to elapse before the most-recent
 * run is considered overdue. Default 2 — one missed cycle is noise
 * (clock skew, restart-in-flight), two missed cycles means the sweep is
 * actually stuck. Override with OUTWARD_ACCOUNT_PURGE_OVERDUE_MULTIPLIER.
 */
export const DEFAULT_OUTWARD_PURGE_OVERDUE_MULTIPLIER = 2;

export function getConfiguredOutwardPurgeOverdueMultiplier(): number {
  const raw = process.env["OUTWARD_ACCOUNT_PURGE_OVERDUE_MULTIPLIER"];
  if (raw === undefined || raw === "") {
    return DEFAULT_OUTWARD_PURGE_OVERDUE_MULTIPLIER;
  }
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 1) return parsed;
  return DEFAULT_OUTWARD_PURGE_OVERDUE_MULTIPLIER;
}

export interface OutwardAccountPurgeHealthOptions {
  /** Sweep cadence to compare against. Defaults to the configured one. */
  intervalMs?: number;
  /** Multiplier of the cadence that defines "overdue". Default 2. */
  overdueMultiplier?: number;
  /** Injectable clock for tests. */
  now?: Date;
}

export interface OutwardAccountPurgeHealth {
  /** True when no run has been recorded for `intervalMs * overdueMultiplier`. */
  overdue: boolean;
  /** Most recent `ran_at`, or null if the sweep has *never* recorded a run. */
  lastRanAt: Date | null;
  /** Age of the most recent run vs `now`, in ms. Null when no run exists. */
  ageMs: number | null;
  /** Configured sweep cadence in ms. */
  intervalMs: number;
  /** Multiplier applied to the cadence to derive the overdue threshold. */
  overdueMultiplier: number;
  /** `intervalMs * overdueMultiplier` — the deadline a fresh run must beat. */
  thresholdMs: number;
}

/**
 * Compare the most-recent purge run against the configured cadence and
 * report whether the sweep has gone silent for too long. Used by the
 * scheduled monitor (logs an alert) and the `/admin/outward-account-purge-health`
 * endpoint (lets operators or external uptime checks read the same
 * signal on demand).
 *
 * "Never ran" (no rows in the audit table at all) counts as overdue —
 * a freshly-deployed instance will record a startup run within seconds,
 * so a missing row past the threshold means the sweep failed to fire on
 * boot, which is exactly what we want to be paged about.
 */
export async function getOutwardAccountPurgeHealth(
  opts: OutwardAccountPurgeHealthOptions = {},
): Promise<OutwardAccountPurgeHealth> {
  const intervalMs = opts.intervalMs ?? getConfiguredOutwardPurgeIntervalMs();
  const overdueMultiplier =
    opts.overdueMultiplier ?? getConfiguredOutwardPurgeOverdueMultiplier();
  const thresholdMs = intervalMs * overdueMultiplier;
  const now = opts.now ?? new Date();
  const [latest] = await db
    .select({ ranAt: outwardAccountPurgeRunsTable.ranAt })
    .from(outwardAccountPurgeRunsTable)
    .orderBy(desc(outwardAccountPurgeRunsTable.ranAt))
    .limit(1);
  if (!latest) {
    return {
      overdue: true,
      lastRanAt: null,
      ageMs: null,
      intervalMs,
      overdueMultiplier,
      thresholdMs,
    };
  }
  const ageMs = now.getTime() - latest.ranAt.getTime();
  return {
    overdue: ageMs > thresholdMs,
    lastRanAt: latest.ranAt,
    ageMs,
    intervalMs,
    overdueMultiplier,
    thresholdMs,
  };
}

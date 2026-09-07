/**
 * Idempotent forward migration that introduces outward-facing accounts.
 *
 * For every personal-profile `users` row this:
 *   1. Ensures one default `outward_accounts` row exists, seeded from the
 *      user's current `last_active_mode_id` (or a sensible fallback if
 *      none).
 *   2. Sets `users.active_outward_account_id` to that default if NULL.
 *   3. Backfills the per-row outward account on owned-data tables that
 *      moved to the skins model in task #312:
 *        - `properties.owner_outward_account_id`
 *        - `work_orders.created_by_outward_account_id`
 *        - `work_orders.assignee_outward_account_id`
 *
 *      The legacy `property_members` backfill that lived here was
 *      retired in task #681 along with the table itself. Property
 *      membership now lives entirely in `entity_members` and is
 *      mirrored on boot by `migratePropertyEntities`.
 *
 * Note: prior backfills for `user_connections`, `app_invites`, and
 * `business_invites` ran in earlier migrations; those tables now key on
 * outward_account ids exclusively (the legacy clerk-id columns were
 * dropped from the schema), so no backfill is needed here.
 *
 * Safe to re-run in dev: every step skips rows it has already touched.
 */
import { eq, and, isNull, isNotNull } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  userModesTable,
  outwardAccountsTable,
  propertiesTable,
  workOrdersTable,
  type UserModeKind,
  type InsertOutwardAccount,
} from "../src";

function pickDefaultKind(modes: { id: number; kind: UserModeKind }[]): UserModeKind {
  // Prefer "home" if present, else first mode, else fall back to "home"
  // for users with no modes at all.
  const home = modes.find((m) => m.kind === "home");
  if (home) return home.kind;
  return modes[0]?.kind ?? "home";
}

function brandingFromIntake(intake: Record<string, unknown> | null | undefined) {
  const i = (intake ?? {}) as Record<string, unknown>;
  const str = (k: string): string | null => {
    const v = i[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  return {
    title: str("title") ?? str("displayName") ?? str("companyName"),
    displayName: str("displayName") ?? str("ownerDisplayName") ?? str("ownerName"),
    avatarUrl: str("avatarUrl") ?? str("logoUrl"),
    bannerUrl: str("bannerUrl") ?? str("headerImageUrl"),
    companyName: str("companyName"),
    bio: str("bio"),
  };
}

async function ensureDefaultAccountForUser(
  user: { clerkId: string; name: string; avatarUrl: string; lastActiveModeId: number | null },
): Promise<{ id: number; created: boolean }> {
  // Already has an outward account? Nothing to do.
  const [existing] = await db
    .select({ id: outwardAccountsTable.id })
    .from(outwardAccountsTable)
    .where(eq(outwardAccountsTable.ownerClerkId, user.clerkId))
    .orderBy(outwardAccountsTable.id)
    .limit(1);
  if (existing) return { id: existing.id, created: false };

  const modes = await db
    .select({
      id: userModesTable.id,
      kind: userModesTable.kind,
      intakeData: userModesTable.intakeData,
    })
    .from(userModesTable)
    .where(eq(userModesTable.userClerkId, user.clerkId));

  const seedMode =
    (user.lastActiveModeId != null
      ? modes.find((m) => m.id === user.lastActiveModeId)
      : null) ?? modes[0] ?? null;

  const kind = seedMode?.kind ?? pickDefaultKind(modes);
  const branding = brandingFromIntake(seedMode?.intakeData ?? null);

  const insert: InsertOutwardAccount = {
    ownerClerkId: user.clerkId,
    kind,
    title: branding.title,
    displayName: branding.displayName ?? user.name ?? null,
    avatarUrl: branding.avatarUrl ?? (user.avatarUrl?.trim() ? user.avatarUrl : null),
    bannerUrl: branding.bannerUrl,
    companyName: branding.companyName,
    bio: branding.bio,
    sourceUserModeId: seedMode?.id ?? null,
  };

  const [created] = await db.insert(outwardAccountsTable).values(insert).returning({
    id: outwardAccountsTable.id,
  });
  return { id: created.id, created: true };
}

export async function migrateOutwardAccounts(): Promise<{
  usersSeen: number;
  accountsCreated: number;
  activeSet: number;
  propertiesUpdated: number;
  workOrdersCreatorUpdated: number;
  workOrdersAssigneeUpdated: number;
}> {
  const users = await db
    .select({
      clerkId: usersTable.clerkId,
      name: usersTable.name,
      avatarUrl: usersTable.avatarUrl,
      lastActiveModeId: usersTable.lastActiveModeId,
      activeOutwardAccountId: usersTable.activeOutwardAccountId,
    })
    .from(usersTable);

  let accountsCreated = 0;
  let activeSet = 0;
  // Map from clerkId → that user's default outward account id.
  const defaultByClerk = new Map<string, number>();
  for (const u of users) {
    const { id, created } = await ensureDefaultAccountForUser(u);
    defaultByClerk.set(u.clerkId, id);
    if (created) accountsCreated++;
    if (u.activeOutwardAccountId == null) {
      await db
        .update(usersTable)
        .set({ activeOutwardAccountId: id })
        .where(eq(usersTable.clerkId, u.clerkId));
      activeSet++;
    }
  }

  // Owned-data tables (task #312/#316). Each table gets the actor's default
  // outward account stamped on rows that don't already have one.
  const props = await db
    .select({
      id: propertiesTable.id,
      ownerClerkId: propertiesTable.ownerClerkId,
      ownerOutwardAccountId: propertiesTable.ownerOutwardAccountId,
    })
    .from(propertiesTable)
    .where(isNull(propertiesTable.ownerOutwardAccountId));
  let propertiesUpdated = 0;
  for (const p of props) {
    const ownerId = defaultByClerk.get(p.ownerClerkId);
    if (ownerId == null) continue;
    await db
      .update(propertiesTable)
      .set({ ownerOutwardAccountId: ownerId })
      .where(
        and(eq(propertiesTable.id, p.id), isNull(propertiesTable.ownerOutwardAccountId)),
      );
    propertiesUpdated++;
  }

  // The `property_members` backfill that ran here in earlier
  // migrations was retired in task #681 — the table is now dropped
  // and property membership lives entirely in `entity_members`.

  const creators = await db
    .select({
      id: workOrdersTable.id,
      createdByClerkId: workOrdersTable.createdByClerkId,
    })
    .from(workOrdersTable)
    .where(isNull(workOrdersTable.createdByOutwardAccountId));
  let workOrdersCreatorUpdated = 0;
  for (const w of creators) {
    const id = defaultByClerk.get(w.createdByClerkId);
    if (id == null) continue;
    await db
      .update(workOrdersTable)
      .set({ createdByOutwardAccountId: id })
      .where(
        and(
          eq(workOrdersTable.id, w.id),
          isNull(workOrdersTable.createdByOutwardAccountId),
        ),
      );
    workOrdersCreatorUpdated++;
  }

  const assignees = await db
    .select({
      id: workOrdersTable.id,
      assigneeClerkId: workOrdersTable.assigneeClerkId,
    })
    .from(workOrdersTable)
    .where(
      and(
        isNotNull(workOrdersTable.assigneeClerkId),
        isNull(workOrdersTable.assigneeOutwardAccountId),
      ),
    );
  let workOrdersAssigneeUpdated = 0;
  for (const w of assignees) {
    if (!w.assigneeClerkId) continue;
    const id = defaultByClerk.get(w.assigneeClerkId);
    if (id == null) continue;
    await db
      .update(workOrdersTable)
      .set({ assigneeOutwardAccountId: id })
      .where(
        and(
          eq(workOrdersTable.id, w.id),
          isNull(workOrdersTable.assigneeOutwardAccountId),
        ),
      );
    workOrdersAssigneeUpdated++;
  }

  return {
    usersSeen: users.length,
    accountsCreated,
    activeSet,
    propertiesUpdated,
    workOrdersCreatorUpdated,
    workOrdersAssigneeUpdated,
  };
}

// Allow the script to be invoked via `tsx lib/db/scripts/migrateOutwardAccounts.ts`.
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("migrateOutwardAccounts.ts");

if (isDirectRun) {
  migrateOutwardAccounts()
    .then((stats) => {
      // eslint-disable-next-line no-console
      console.log("[migrateOutwardAccounts]", stats);
      return pool.end();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[migrateOutwardAccounts] failed", err);
      process.exit(1);
    });
}

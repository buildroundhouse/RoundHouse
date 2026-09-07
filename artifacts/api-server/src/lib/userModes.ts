import { and, eq } from "drizzle-orm";
import {
  db,
  userModesTable,
  usersTable,
  SINGLE_PROFILE_KINDS,
  type UserMode,
  type UserModeKind,
} from "@workspace/db";

/**
 * Single source of truth for which `user_modes.kind` strings are valid
 * to create. Both the regular `POST /users/me/modes` route and the
 * admin demo-profile route validate against this list so the demo flow
 * can never accept a kind the production flow rejects (or vice versa).
 */
export const VALID_MODE_KINDS: UserModeKind[] = [
  "trade_pro",
  "home",
  "facilities",
  "trade_pro_teammate",
  "facilities_teammate",
  "home_teammate",
  "trade_pro_collab",
  "facilities_collab",
  "collab",
];

/**
 * #614 — Teammate kinds are scoped strictly to their parent account
 * family. A `home_teammate` belongs to a Home, `trade_pro_teammate` to
 * a Trade Pro, `facilities_teammate` to a Facility. This map is what
 * {@link createUserMode} consults to enforce that. Collaborator and
 * the owner-facing kinds are absent (no parent requirement).
 */
export const TEAMMATE_PARENT_KIND: Partial<
  Record<UserModeKind, UserModeKind>
> = {
  home_teammate: "home",
  trade_pro_teammate: "trade_pro",
  facilities_teammate: "facilities",
};

export const PARENT_KIND_LABEL: Record<UserModeKind, string> = {
  home: "Home",
  trade_pro: "Trade Pro",
  facilities: "Facility Management",
  home_teammate: "Home Teammate",
  trade_pro_teammate: "Trade Teammate",
  facilities_teammate: "Facility Teammate",
  trade_pro_collab: "Collaborator",
  facilities_collab: "Collaborator",
  collab: "Collaborator",
};

export interface CreateUserModeOptions {
  clerkId: string;
  kind: UserModeKind;
  /**
   * When true (default), updates `users.last_active_mode_id` to the
   * resulting mode so the new mode is the user's active context. The
   * regular onboarding flow always wants this; bulk seeding paths can
   * pass false to leave the active pointer alone.
   */
  setActive?: boolean;
}

export type CreateUserModeResult =
  | { ok: true; mode: UserMode; reusedExisting: boolean }
  | { ok: false; status: 400; error: string };

/**
 * Create (or reuse) a `user_modes` row for the given user, applying the
 * same validation and intake-data seeding the production
 * `POST /users/me/modes` route enforces:
 *   - `kind` must be in {@link VALID_MODE_KINDS}.
 *   - Teammate kinds require an existing parent kind on the same user
 *     (see {@link TEAMMATE_PARENT_KIND}).
 *   - Single-profile kinds (collab) reuse the existing row if any.
 *   - Multi-profile kinds always insert a fresh row, seeded with the
 *     user's name + avatar (and `ownerName` for trade_pro).
 *
 * Routes that need to short-circuit demo or admin flows through the
 * same path call this helper so the production and demo behaviors stay
 * in lockstep — fixing a validation gap or seed-shape change in one
 * place is automatically picked up by the other.
 */
export async function createUserMode(
  opts: CreateUserModeOptions,
): Promise<CreateUserModeResult> {
  const { clerkId, kind, setActive = true } = opts;
  if (!VALID_MODE_KINDS.includes(kind)) {
    return { ok: false, status: 400, error: "Invalid mode kind" };
  }
  const requiredParent = TEAMMATE_PARENT_KIND[kind];
  if (requiredParent) {
    const existingParent = await db
      .select({ id: userModesTable.id })
      .from(userModesTable)
      .where(
        and(
          eq(userModesTable.userClerkId, clerkId),
          eq(userModesTable.kind, requiredParent),
        ),
      )
      .limit(1);
    if (existingParent.length === 0) {
      return {
        ok: false,
        status: 400,
        error: `${PARENT_KIND_LABEL[kind]} requires an existing ${PARENT_KIND_LABEL[requiredParent]} account.`,
      };
    }
  }
  if (SINGLE_PROFILE_KINDS.includes(kind)) {
    const [existing] = await db
      .select()
      .from(userModesTable)
      .where(
        and(
          eq(userModesTable.userClerkId, clerkId),
          eq(userModesTable.kind, kind),
        ),
      );
    if (existing) {
      if (setActive) {
        await db
          .update(usersTable)
          .set({ lastActiveModeId: existing.id })
          .where(eq(usersTable.clerkId, clerkId));
      }
      return { ok: true, mode: existing, reusedExisting: true };
    }
  }
  const [me] = await db
    .select({ name: usersTable.name, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId));
  const seed: Record<string, unknown> = {};
  if (me?.name) seed.displayName = me.name;
  if (me?.avatarUrl) seed.avatarUrl = me.avatarUrl;
  if (kind === "trade_pro" && me?.name) seed.ownerName = me.name;
  const [created] = await db
    .insert(userModesTable)
    .values({ userClerkId: clerkId, kind, intakeData: seed })
    .returning();
  if (setActive) {
    await db
      .update(usersTable)
      .set({ lastActiveModeId: created.id })
      .where(eq(usersTable.clerkId, clerkId));
  }
  return { ok: true, mode: created, reusedExisting: false };
}

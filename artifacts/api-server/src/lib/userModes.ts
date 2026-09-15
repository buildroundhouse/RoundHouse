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
 * Valid mode-storage keys for NEW creation.
 *
 * `collab` is retained only as the historical storage key backing the neutral
 * Viewer profile. The older `trade_pro_collab` and `facilities_collab` kinds
 * remain readable on legacy accounts but may no longer be created. Work-capable
 * people now use Trade Professional / Trade Team Member / Commercial roles;
 * view-only people use Viewer through a Property or Facility invitation.
 */
export const VALID_MODE_KINDS: UserModeKind[] = [
  "trade_pro",
  "home",
  "facilities",
  "trade_pro_teammate",
  "facilities_teammate",
  "home_teammate",
  "collab",
];

/** Teammate kinds require an existing parent operating context. */
export const TEAMMATE_PARENT_KIND: Partial<
  Record<UserModeKind, UserModeKind>
> = {
  home_teammate: "home",
  trade_pro_teammate: "trade_pro",
  facilities_teammate: "facilities",
};

/** Product-facing names. Historical neutral keys all render as Viewer. */
export const PARENT_KIND_LABEL: Record<UserModeKind, string> = {
  home: "Home",
  trade_pro: "Trade Pro",
  facilities: "Facility Management",
  home_teammate: "Home Teammate",
  trade_pro_teammate: "Trade Teammate",
  facilities_teammate: "Facility Teammate",
  trade_pro_collab: "Viewer",
  facilities_collab: "Viewer",
  collab: "Viewer",
};

export interface CreateUserModeOptions {
  clerkId: string;
  kind: UserModeKind;
  /** When true, adopt the resulting mode as the active context. */
  setActive?: boolean;
}

export type CreateUserModeResult =
  | { ok: true; mode: UserMode; reusedExisting: boolean }
  | { ok: false; status: 400; error: string };

/**
 * Create or reuse a mode-storage row.
 *
 * The neutral Viewer baseline is represented by the historical `collab` key
 * until the underlying data migration is complete. It has no independent
 * Entity permission: private Viewer access still requires a Residential
 * Property or Commercial Facility membership/invitation.
 */
export async function createUserMode(
  opts: CreateUserModeOptions,
): Promise<CreateUserModeResult> {
  const { clerkId, kind, setActive = true } = opts;
  if (!VALID_MODE_KINDS.includes(kind)) {
    return {
      ok: false,
      status: 400,
      error:
        kind === "trade_pro_collab" || kind === "facilities_collab"
          ? "That legacy profile type is no longer available. Use Viewer for view-only Property/Facility access or a Trade/Commercial Role for operational participation."
          : "Invalid mode kind",
    };
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

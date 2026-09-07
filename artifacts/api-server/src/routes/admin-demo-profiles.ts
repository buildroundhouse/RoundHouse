import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  adminDemoProfilesTable,
  usersTable,
  userModesTable,
  outwardAccountsTable,
  type UserModeKind,
} from "@workspace/db";
import { tryAttachAuth, type AuthRequest } from "../middlewares/requireAuth";
import { isAdminUser } from "../lib/rewards";
import { ensureCollabBaselineOutwardAccount } from "../lib/outwardAccounts";
import { applyOutwardAccountKindDefaults } from "../lib/ownerNameDisplay";
import { createUserMode, TEAMMATE_PARENT_KIND } from "../lib/userModes";
import {
  insertAdminDemoProfile,
  deleteAdminDemoProfileById,
} from "../lib/adminDemo";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const ALL_ROLE_KINDS: UserModeKind[] = [
  "trade_pro",
  "home",
  "facilities",
  "trade_pro_teammate",
  "facilities_teammate",
  "trade_pro_collab",
  "facilities_collab",
  // "collab" is the bare-baseline option — the wardrobe's
  // "Stitch a new avatar" button creates demos with this kind so the
  // admin lands at /(onboarding)/identity exactly like a real signup
  // (no role chip pre-selected, no display name pre-filled). The
  // user_modes seeding block below short-circuits on `collab` because
  // ensureCollabBaselineOutwardAccount() already provisions the
  // matching mode + outward account.
  "collab",
];

const DEFAULT_DEMO_DISPLAY_NAME = "New Avatar";
const DEFAULT_DEMO_ROLE_KIND: UserModeKind = "collab";

// Mirrors VALID_KINDS in routes/outward-accounts.ts — only owner-facing
// business kinds get an outward_accounts row in the production flow.
// Teammate / collab kinds live on user_modes only and ride the
// universal Collaborator/Friend baseline OA for their outward identity.
const OUTWARD_ROLE_KINDS = new Set<UserModeKind>([
  "trade_pro",
  "home",
  "facilities",
]);

// Admin gating: tryAttachAuth resolves the bearer token, then we
// confirm the caller is on the admin allowlist (env or users.is_admin).
async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await tryAttachAuth(req);
  const ar = req as AuthRequest;
  if (ar.userId && (await isAdminUser(ar.userId))) {
    next();
    return;
  }
  res.status(401).json({ error: "Admin auth required" });
}

interface SerializedProfile {
  id: number;
  roleKind: string;
  displayName: string;
  demoClerkId: string;
  demoUsername: string;
  demoEmail: string;
  /** Plaintext password for the demo Firebase user. Only ever returned
   * to the admin who owns the demo profile so they can `signIn` as the
   * demo to test/walk the persona end-to-end. */
  demoPassword: string;
  outwardAccountId: number | null;
  outwardAccountKind: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

async function serializeProfile(
  row: typeof adminDemoProfilesTable.$inferSelect,
): Promise<SerializedProfile> {
  const [user] = await db
    .select({
      username: usersTable.username,
      avatarUrl: usersTable.avatarUrl,
      email: usersTable.email,
      activeOutwardAccountId: usersTable.activeOutwardAccountId,
    })
    .from(usersTable)
    .where(eq(usersTable.clerkId, row.demoClerkId));
  // Demo users now own multiple outward_accounts (collab baseline +
  // optionally the requested business kind), so resolve the surfaced
  // account from `users.active_outward_account_id` rather than relying
  // on insertion order. Falls back to the first OA we find for legacy
  // demo profiles created before this seeded the active id.
  let account:
    | { id: number; kind: string }
    | undefined;
  if (user?.activeOutwardAccountId != null) {
    // Defensive: scope the lookup to the demo user's own clerk id in
    // addition to the OA id so a stale `activeOutwardAccountId`
    // pointer (e.g. one that drifted across users via a bug) can never
    // surface another user's outward account in this admin payload.
    [account] = await db
      .select({ id: outwardAccountsTable.id, kind: outwardAccountsTable.kind })
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.id, user.activeOutwardAccountId),
          eq(outwardAccountsTable.ownerClerkId, row.demoClerkId),
        ),
      )
      .limit(1);
  }
  if (!account) {
    [account] = await db
      .select({ id: outwardAccountsTable.id, kind: outwardAccountsTable.kind })
      .from(outwardAccountsTable)
      .where(eq(outwardAccountsTable.ownerClerkId, row.demoClerkId))
      .limit(1);
  }
  return {
    id: row.id,
    roleKind: row.roleKind,
    displayName: row.displayName,
    demoClerkId: row.demoClerkId,
    demoUsername: user?.username ?? "",
    demoEmail: user?.email ?? "",
    demoPassword: row.demoPassword ?? "",
    outwardAccountId: account?.id ?? null,
    outwardAccountKind: account?.kind ?? null,
    avatarUrl: user?.avatarUrl?.trim() ? user.avatarUrl : null,
    createdAt: row.createdAt.toISOString(),
  };
}

// --- Firebase REST helpers (Identity Toolkit) -----------------------
// Mirrors what .local/seed-admin.mjs did earlier in this project: we
// don't have the Admin SDK on the server, so we hit the public REST
// endpoints with the same EXPO_PUBLIC_FIREBASE_API_KEY the mobile app
// uses. The helpers are exported (via __test) so tests can stub them.
interface ProvisionedFirebaseUser {
  localId: string;
  reused: boolean;
}

async function firebaseSignUp(
  apiKey: string,
  email: string,
  password: string,
): Promise<{ localId: string } | { error: string }> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: false }),
    },
  );
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errMsg =
      (json?.error as { message?: string } | undefined)?.message ??
      `signUp failed (${res.status})`;
    return { error: errMsg };
  }
  return { localId: String(json.localId ?? "") };
}

async function firebaseSignIn(
  apiKey: string,
  email: string,
  password: string,
): Promise<{ localId: string } | { error: string }> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: false }),
    },
  );
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const errMsg =
      (json?.error as { message?: string } | undefined)?.message ??
      `signInWithPassword failed (${res.status})`;
    return { error: errMsg };
  }
  return { localId: String(json.localId ?? "") };
}

/**
 * Provision (or recover) a Firebase user for the demo email. Returns the
 * resolved uid and a flag indicating whether we re-used an existing
 * Firebase row (EMAIL_EXISTS path). Throws on any unrecoverable failure.
 */
async function provisionFirebaseUser(args: {
  email: string;
  password: string;
  priorPassword: string | null;
}): Promise<ProvisionedFirebaseUser> {
  const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    throw new Error("EXPO_PUBLIC_FIREBASE_API_KEY is not configured.");
  }
  const signUp = await firebaseSignUp(apiKey, args.email, args.password);
  if ("localId" in signUp) {
    return { localId: signUp.localId, reused: false };
  }
  if (signUp.error !== "EMAIL_EXISTS") {
    throw new Error(`Firebase signUp failed: ${signUp.error}`);
  }
  // Try recovery via prior stored password. Without one we can't
  // recover and surface 500 to the caller.
  if (!args.priorPassword) {
    throw new Error(
      "Firebase has an orphaned demo account but no stored password is available to recover it.",
    );
  }
  const signIn = await firebaseSignIn(apiKey, args.email, args.priorPassword);
  if ("localId" in signIn) {
    return { localId: signIn.localId, reused: true };
  }
  throw new Error(`Firebase recovery signIn failed: ${signIn.error}`);
}

function shortId(): string {
  return crypto.randomBytes(4).toString("hex");
}

function makeDemoUsername(roleKind: string): string {
  return `demo-${roleKind.replace(/_/g, "-")}-${shortId()}`.slice(0, 24);
}

// --- Routes ---------------------------------------------------------

router.get(
  "/admin/demo-profiles",
  requireAdmin,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const rows = await db
      .select()
      .from(adminDemoProfilesTable)
      .where(eq(adminDemoProfilesTable.adminClerkId, userId));
    const profiles = await Promise.all(rows.map((r) => serializeProfile(r)));
    // Multiple demos per role kind are allowed (the unique index that
    // used to enforce one-per-kind was dropped) so every kind is always
    // available — the wardrobe should never grey out a chip again.
    const availableRoleKinds = [...ALL_ROLE_KINDS];
    res.json({ profiles, availableRoleKinds });
  },
);

router.post(
  "/admin/demo-profiles",
  requireAdmin,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const body = (req.body ?? {}) as {
      roleKind?: string;
      displayName?: string;
    };
    // Both `roleKind` and `displayName` are optional now (#690 follow-
    // up). The wardrobe's "Stitch a new avatar" button POSTs an empty
    // body and lets the admin walk through the regular onboarding
    // (identity → mode picker → intake) AS the demo, exactly the way a
    // real first-time user would. Explicit values are still honored
    // for any internal/legacy caller that wants a pre-shaped demo.
    const rawRoleKind = String(body.roleKind ?? "").trim();
    const roleKind = (rawRoleKind || DEFAULT_DEMO_ROLE_KIND) as UserModeKind;
    const displayName =
      String(body.displayName ?? "").trim() || DEFAULT_DEMO_DISPLAY_NAME;
    if (!ALL_ROLE_KINDS.includes(roleKind)) {
      res.status(400).json({ error: "Invalid roleKind" });
      return;
    }
    // Multiple demos per role kind are now allowed (#690 — admin
    // wardrobe was greying out every chip after six creates and bricked
    // step-in). The email therefore needs a per-create suffix so we
    // don't collide with a previously-provisioned Firebase identity for
    // the same admin+kind pair.
    const email = `demo-${userId}-${roleKind}-${shortId()}@roundhouse.app`;
    const password = crypto.randomBytes(18).toString("base64url");

    let provisioned: ProvisionedFirebaseUser;
    try {
      provisioned = await provisionFirebaseUser({
        email,
        password,
        priorPassword: null,
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), email },
        "Failed to provision Firebase demo user",
      );
      res
        .status(500)
        .json({ error: "Failed to provision Firebase demo account" });
      return;
    }

    const demoClerkId = provisioned.localId;
    const username = makeDemoUsername(roleKind);

    // Insert the users row for the demo user. Use ON CONFLICT
    // DO NOTHING on clerkId so a previously-orphaned Firebase user
    // (recovered via signInWithPassword) doesn't blow up here.
    //
    // #638 — Do NOT pre-stamp `identityCompletedAt`. A demo profile
    // should walk through the same identity onboarding screen a real
    // first-time user sees (set username + avatar via the `/users/me/identity`
    // endpoint) when the admin first "wears" it. Pre-stamping bypassed
    // that screen and made demos a second-class shape (no avatar, no
    // user-driven username confirmation). The `displayName` the admin
    // typed is still seeded onto `users.name` and the per-mode
    // intake — that's fine, it's a useful prefill the admin can keep
    // or change on the identity / intake screens.
    await db
      .insert(usersTable)
      .values({
        clerkId: demoClerkId,
        email,
        name: displayName,
        username,
        isAdmin: false,
      })
      .onConflictDoNothing({ target: usersTable.clerkId });

    // Mirror the production sign-up path so demo skins end up with the
    // exact same row shape as a real account would after onboarding —
    // not the truncated shape this route used to write.
    //
    // 1) Every signed-in user owns a permanent Collaborator/Friend
    //    baseline (matching `user_modes` row + `outward_accounts` row),
    //    seeded lazily by `/users/me` in production. Without it the
    //    demo user has no collab skin to fall back on for social
    //    features and `lastActiveModeId` defaults are off.
    await ensureCollabBaselineOutwardAccount(demoClerkId);

    // 2) Create a `user_modes` row for the requested role kind by
    //    routing through the SAME `createUserMode` helper that
    //    `POST /users/me/modes` uses. This guarantees the demo user
    //    lands with the exact same validation (#614 teammate-parent
    //    rule) and intake-data seed (displayName / avatarUrl /
    //    trade_pro `ownerName`) that a real user's first mode would
    //    have. The collab baseline mode was already created in step 1,
    //    so we only seed for non-collab kinds.
    //
    //    Teammate kinds in production require an existing parent kind
    //    on the same user (e.g. a `trade_pro_teammate` requires a
    //    `trade_pro` mode). To keep the demo user representative of a
    //    real account that owns BOTH the parent business and a
    //    teammate seat on it, we seed the parent kind first via the
    //    same helper before creating the teammate kind.
    if (roleKind !== "collab") {
      const requiredParent = TEAMMATE_PARENT_KIND[roleKind];
      if (requiredParent) {
        const parentResult = await createUserMode({
          clerkId: demoClerkId,
          kind: requiredParent,
        });
        if (!parentResult.ok) {
          logger.error(
            { roleKind, parentKind: requiredParent, error: parentResult.error },
            "Failed to seed parent mode for demo teammate kind",
          );
          res.status(500).json({
            error: `Failed to seed parent ${requiredParent} mode: ${parentResult.error}`,
          });
          return;
        }
      }
      const result = await createUserMode({
        clerkId: demoClerkId,
        kind: roleKind,
      });
      if (!result.ok) {
        // Validation failure here means the production rules rejected
        // this kind — surface the same error code/message the live
        // route would. Bubbles up to the wardrobe as a structured 400
        // so the admin sees exactly why the demo couldn't be created.
        res.status(result.status).json({ error: result.error });
        return;
      }
    }

    // 4) For owner-facing business kinds, seed the matching
    //    `outward_accounts` row with the same field shape that
    //    `POST /outward-accounts` produces (title + displayName +
    //    nullable avatar/banner/companyName/bio, sourceUserModeId
    //    null — production stamps null here too) and adopt it as the
    //    active outward account.
    if (OUTWARD_ROLE_KINDS.has(roleKind)) {
      const [haveAccount] = await db
        .select({ id: outwardAccountsTable.id })
        .from(outwardAccountsTable)
        .where(
          and(
            eq(outwardAccountsTable.ownerClerkId, demoClerkId),
            eq(outwardAccountsTable.kind, roleKind),
          ),
        )
        .limit(1);
      let oaId = haveAccount?.id ?? null;
      if (oaId == null) {
        const [createdOa] = await db
          .insert(outwardAccountsTable)
          .values(
            // #674 — Use the centralised per-kind defaults so demo
            // profiles inherit the same `last_initial_only` rule as
            // production-created skins. Today this set is owner-facing
            // kinds only (default OFF), but routing through the helper
            // keeps the demo-seed honest if the set ever expands to
            // teammate / collab kinds.
            applyOutwardAccountKindDefaults({
              ownerClerkId: demoClerkId,
              kind: roleKind,
              title: displayName,
              displayName,
              avatarUrl: null,
              bannerUrl: null,
              companyName: null,
              bio: null,
              sourceUserModeId: null,
            }),
          )
          .returning({ id: outwardAccountsTable.id });
        oaId = createdOa.id;
      }
      await db
        .update(usersTable)
        .set({ activeOutwardAccountId: oaId })
        .where(eq(usersTable.clerkId, demoClerkId));
    }

    // Single source of truth (#677): wrap the admin_demo_profiles
    // insert AND the matching `users.is_demo = true` flip in one
    // transaction so the discovery filter (which now reads
    // `users.is_demo` instead of subquerying admin_demo_profiles)
    // can never see a demo persona surface in public lists between
    // the two writes.
    const row = await insertAdminDemoProfile({
      adminClerkId: userId,
      demoClerkId,
      roleKind,
      displayName,
      demoPassword: password,
    });

    const serialized = await serializeProfile(row);
    res.status(201).json(serialized);
  },
);

router.delete(
  "/admin/demo-profiles/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const { userId } = req as AuthRequest;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [row] = await db
      .select()
      .from(adminDemoProfilesTable)
      .where(eq(adminDemoProfilesTable.id, id));
    if (!row || row.adminClerkId !== userId) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Cascade — best-effort per the contract. Each step logs its own
    // failure but doesn't abort the deletion of the demo profile row,
    // so a partial cascade still lets the admin "Create" the slot
    // again later.
    try {
      await db
        .delete(outwardAccountsTable)
        .where(eq(outwardAccountsTable.ownerClerkId, row.demoClerkId));
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), id },
        "Failed to delete demo user's outward accounts",
      );
    }
    // Demo users now own user_modes rows too (collab baseline + the
    // requested kind), seeded by the production-aligned POST. Clear
    // them before nuking the user row so we don't leave orphans
    // pointing at a deleted clerk id.
    try {
      await db
        .delete(userModesTable)
        .where(eq(userModesTable.userClerkId, row.demoClerkId));
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), id },
        "Failed to delete demo user's user_modes rows",
      );
    }
    try {
      await db
        .delete(usersTable)
        .where(eq(usersTable.clerkId, row.demoClerkId));
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), id },
        "Failed to delete demo user's users row",
      );
    }
    // Single source of truth (#677): wrap the admin_demo_profiles
    // delete AND the matching `users.is_demo = false` clear in one
    // transaction. The user row is also deleted by the cascade above
    // in production, in which case the clear is a harmless no-op
    // matching zero rows; the helper is still the right write path
    // for any future flow that un-marks a demo without nuking the
    // user.
    await deleteAdminDemoProfileById(id);

    res.status(204).end();
  },
);

export default router;

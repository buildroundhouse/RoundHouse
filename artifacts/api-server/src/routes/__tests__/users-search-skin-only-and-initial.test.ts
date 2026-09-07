/**
 * #640 — `GET /api/users/search` is now skin-only:
 *   - Personal/friend baseline rows (`outward_accounts.kind = 'collab'`)
 *     must NEVER appear in results.
 *   - Bare users with NO outward account must NEVER appear (legacy /
 *     pre-migration humans surface only via the dedicated invite/friend
 *     flows, not the public People search).
 *   - Archived skins (`archived_at IS NOT NULL`) must NEVER appear.
 *
 * #640 — `outward_accounts.last_initial_only` is the per-skin privacy
 * toggle. When ON, every surfaced owner-name on that skin is shortened
 * to `"First L."` — so a Trade Pro who set the toggle on shows up as
 * `"Alex M."` in People search, on their public profile, and in chat
 * thread headers; when OFF the full `displayName` is unchanged.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const uid = req.headers["x-test-user"];
    if (!uid) {
      res.status(401).json({ error: "missing x-test-user" });
      return;
    }
    req.userId = String(uid);
    next();
  },
}));

const { db, usersTable, outwardAccountsTable, userModesTable } = await import(
  "@workspace/db"
);
const usersRouter = (await import("../users")).default;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", usersRouter);
  return app;
}

const tag = `t640-${Date.now()}`;
const callerClerk = `${tag}-caller`;
// Each owner gets a distinct username so we can target them with the
// `q` filter without colliding with other rows in the test database.
const ownerFullClerk = `${tag}-full`;
const ownerInitialClerk = `${tag}-initial`;
const ownerCollabOnlyClerk = `${tag}-collab`;
const ownerArchivedClerk = `${tag}-archived`;
const ownerBareClerk = `${tag}-bare`;
// Legacy / pre-migration owners (#640 regression). These mimic the
// real production shape of accounts created BEFORE the outward-accounts
// migration: they have a populated `user_modes` row + `lastActiveModeId`
// pointing at it (so they look fully active in the system) but they
// either never received an outward account, or they only got the
// auto-backfilled `kind = 'collab'` baseline. Both shapes must be
// invisible in People search regardless of how active the user looks.
const ownerLegacyBareClerk = `${tag}-legacybare`;
const ownerLegacyCollabClerk = `${tag}-legacycollab`;

let app: Express;
let fullSkinId: number;
let initialSkinId: number;
let collabOnlyId: number;
let archivedSkinId: number;
let legacyCollabSkinId: number;
let legacyBareModeId: number;
let legacyCollabModeId: number;

beforeAll(async () => {
  app = makeApp();

  await db.insert(usersTable).values([
    {
      clerkId: callerClerk,
      email: `${tag}-caller@example.test`,
      name: "Carol Caller",
      username: `caller_${tag}`,
    },
    {
      clerkId: ownerFullClerk,
      email: `${tag}-full@example.test`,
      name: "Alex Mendoza",
      username: `full_${tag}`,
    },
    {
      clerkId: ownerInitialClerk,
      email: `${tag}-initial@example.test`,
      name: "Priya Singh",
      username: `initial_${tag}`,
    },
    {
      clerkId: ownerCollabOnlyClerk,
      email: `${tag}-collab@example.test`,
      name: "Collab Only",
      username: `collab_${tag}`,
    },
    {
      clerkId: ownerArchivedClerk,
      email: `${tag}-archived@example.test`,
      name: "Archived Owner",
      username: `archived_${tag}`,
    },
    {
      clerkId: ownerBareClerk,
      email: `${tag}-bare@example.test`,
      name: "Bare Owner",
      username: `bare_${tag}`,
    },
    {
      clerkId: ownerLegacyBareClerk,
      email: `${tag}-legacybare@example.test`,
      name: "Legacy Bare Owner",
      username: `legacybare_${tag}`,
    },
    {
      clerkId: ownerLegacyCollabClerk,
      email: `${tag}-legacycollab@example.test`,
      name: "Legacy Collab Owner",
      username: `legacycollab_${tag}`,
    },
  ]);

  // #640 regression — seed `user_modes` rows for the legacy owners so
  // they look like long-time active users (pre-migration accounts that
  // were active in a real mode kind before outward_accounts existed).
  // Wire up `lastActiveModeId` so they pass any "is this user real?"
  // sanity check the search route might grow in the future.
  const legacyModes = await db
    .insert(userModesTable)
    .values([
      {
        userClerkId: ownerLegacyBareClerk,
        kind: "trade_pro",
        intakeData: {},
        intakeCompletedAt: new Date(),
      },
      {
        userClerkId: ownerLegacyCollabClerk,
        kind: "trade_pro",
        intakeData: {},
        intakeCompletedAt: new Date(),
      },
    ])
    .returning();
  legacyBareModeId = legacyModes[0].id;
  legacyCollabModeId = legacyModes[1].id;
  await db
    .update(usersTable)
    .set({ lastActiveModeId: legacyBareModeId })
    .where(eq(usersTable.clerkId, ownerLegacyBareClerk));
  await db
    .update(usersTable)
    .set({ lastActiveModeId: legacyCollabModeId })
    .where(eq(usersTable.clerkId, ownerLegacyCollabClerk));

  // Skin matrix:
  //   ownerFull        → trade_pro skin, displayName="Alex Mendoza", flag OFF
  //   ownerInitial     → trade_pro skin, displayName="Priya Singh",  flag ON
  //   ownerCollabOnly  → ONLY a collab baseline (must be excluded)
  //   ownerArchived    → ONE trade_pro skin that IS archived
  //   ownerBare        → has no outward account at all (must be excluded)
  const accounts = await db
    .insert(outwardAccountsTable)
    .values([
      {
        ownerClerkId: ownerFullClerk,
        kind: "trade_pro",
        displayName: "Alex Mendoza",
        lastInitialOnly: false,
      },
      {
        ownerClerkId: ownerInitialClerk,
        kind: "trade_pro",
        displayName: "Priya Singh",
        lastInitialOnly: true,
      },
      {
        ownerClerkId: ownerCollabOnlyClerk,
        kind: "collab",
        displayName: "Collab Only",
        lastInitialOnly: false,
      },
      {
        ownerClerkId: ownerArchivedClerk,
        kind: "trade_pro",
        displayName: "Archived Owner",
        lastInitialOnly: false,
        archivedAt: new Date(),
      },
      // Legacy regression: this owner was active pre-migration, then
      // got the auto-backfilled collab baseline and nothing else. Their
      // displayName intentionally mirrors their username so the `q`
      // pattern matches via `outward_accounts.display_name` too — the
      // INNER JOIN's `kind != 'collab'` predicate must still drop the
      // row even with a strong text match.
      {
        ownerClerkId: ownerLegacyCollabClerk,
        kind: "collab",
        displayName: `legacycollab_${tag}`,
        lastInitialOnly: false,
      },
      // Note: ownerLegacyBare gets NO outward account row at all — it
      // simulates a user whose pre-migration account never received
      // even the auto-backfill (e.g. they haven't signed in since the
      // migration shipped, so /users/me hasn't healed them yet).
    ])
    .returning();
  fullSkinId = accounts[0].id;
  initialSkinId = accounts[1].id;
  collabOnlyId = accounts[2].id;
  archivedSkinId = accounts[3].id;
  legacyCollabSkinId = accounts[4].id;
});

afterAll(async () => {
  const clerkIds = [
    callerClerk,
    ownerFullClerk,
    ownerInitialClerk,
    ownerCollabOnlyClerk,
    ownerArchivedClerk,
    ownerBareClerk,
    ownerLegacyBareClerk,
    ownerLegacyCollabClerk,
  ];
  await db
    .delete(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.ownerClerkId, clerkIds));
  // Clear lastActiveModeId before deleting modes so the FK-style
  // pointer doesn't get left dangling if the test runner aborts here.
  await db
    .update(usersTable)
    .set({ lastActiveModeId: null })
    .where(inArray(usersTable.clerkId, clerkIds));
  await db
    .delete(userModesTable)
    .where(inArray(userModesTable.userClerkId, clerkIds));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, clerkIds));
});

describe("/api/users/search — skin-only filter (#640)", () => {
  it("excludes collab/personal baseline rows even when the query matches their displayName", async () => {
    const res = await request(app)
      .get(`/api/users/search?q=${encodeURIComponent(`collab_${tag}`)}`)
      .set("x-test-user", callerClerk);
    expect(res.status).toBe(200);
    const ids = (res.body.users ?? []).map((u: any) => u.outwardAccountId);
    expect(ids).not.toContain(collabOnlyId);
    // Owner who only has a collab baseline must not surface at all.
    const ownerIds = (res.body.users ?? []).map((u: any) => u.id);
    const [collabUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.clerkId, ownerCollabOnlyClerk));
    expect(ownerIds).not.toContain(collabUser?.id);
  });

  it("excludes bare users with no outward account at all", async () => {
    const res = await request(app)
      .get(`/api/users/search?q=${encodeURIComponent(`bare_${tag}`)}`)
      .set("x-test-user", callerClerk);
    expect(res.status).toBe(200);
    const usernames: string[] = (res.body.users ?? []).map(
      (u: any) => u.username,
    );
    expect(usernames).not.toContain(`bare_${tag}`);
  });

  it("excludes archived skins", async () => {
    const res = await request(app)
      .get(`/api/users/search?q=${encodeURIComponent(`archived_${tag}`)}`)
      .set("x-test-user", callerClerk);
    expect(res.status).toBe(200);
    const ids = (res.body.users ?? []).map((u: any) => u.outwardAccountId);
    expect(ids).not.toContain(archivedSkinId);
  });

  // #640 regression — pre-migration legacy users in production may
  // present as either (a) a fully active account whose only outward
  // row is the auto-backfilled `kind = 'collab'` baseline, or (b) an
  // account that hasn't been touched since the migration shipped and
  // therefore has no outward row at all. Both shapes look like real,
  // long-time users (populated `user_modes` row, `lastActiveModeId`
  // set) but they MUST NOT surface in People search; legacy humans
  // are reachable only via the dedicated invite/friend flows.
  it("excludes a legacy pre-migration user with only an auto-backfilled collab baseline", async () => {
    const res = await request(app)
      .get(`/api/users/search?q=${encodeURIComponent(`legacycollab_${tag}`)}`)
      .set("x-test-user", callerClerk);
    expect(res.status).toBe(200);
    const usernames: string[] = (res.body.users ?? []).map(
      (u: any) => u.username,
    );
    expect(usernames).not.toContain(`legacycollab_${tag}`);
    const skinIds = (res.body.users ?? []).map(
      (u: any) => u.outwardAccountId,
    );
    expect(skinIds).not.toContain(legacyCollabSkinId);
    // Belt-and-suspenders: even with the owner's row id in hand the
    // search must not surface them, since the INNER JOIN's
    // `kind != 'collab'` predicate is the firewall here.
    const [legacyCollabUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.clerkId, ownerLegacyCollabClerk));
    const ownerIds = (res.body.users ?? []).map((u: any) => u.id);
    expect(ownerIds).not.toContain(legacyCollabUser?.id);
  });

  it("excludes a legacy pre-migration user with no outward account at all", async () => {
    const res = await request(app)
      .get(`/api/users/search?q=${encodeURIComponent(`legacybare_${tag}`)}`)
      .set("x-test-user", callerClerk);
    expect(res.status).toBe(200);
    const usernames: string[] = (res.body.users ?? []).map(
      (u: any) => u.username,
    );
    expect(usernames).not.toContain(`legacybare_${tag}`);
    const [legacyBareUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.clerkId, ownerLegacyBareClerk));
    const ownerIds = (res.body.users ?? []).map((u: any) => u.id);
    expect(ownerIds).not.toContain(legacyBareUser?.id);
  });
});

describe("/api/users/search — per-skin lastInitialOnly (#640)", () => {
  it("returns the full displayName when the skin's lastInitialOnly flag is OFF", async () => {
    const res = await request(app)
      .get(`/api/users/search?q=${encodeURIComponent(`full_${tag}`)}`)
      .set("x-test-user", callerClerk);
    expect(res.status).toBe(200);
    const row = (res.body.users ?? []).find(
      (u: any) => u.outwardAccountId === fullSkinId,
    );
    expect(row).toBeTruthy();
    expect(row.name).toBe("Alex Mendoza");
  });

  it("shortens the name to 'First L.' when the skin's lastInitialOnly flag is ON", async () => {
    const res = await request(app)
      .get(`/api/users/search?q=${encodeURIComponent(`initial_${tag}`)}`)
      .set("x-test-user", callerClerk);
    expect(res.status).toBe(200);
    const row = (res.body.users ?? []).find(
      (u: any) => u.outwardAccountId === initialSkinId,
    );
    expect(row).toBeTruthy();
    expect(row.name).toBe("Priya S.");
  });

  it("flips back to the full name immediately after the toggle is turned off", async () => {
    // Flip the flag off and re-search; the row must un-shorten on the
    // very next read so toggling is a true real-time control.
    await db
      .update(outwardAccountsTable)
      .set({ lastInitialOnly: false })
      .where(eq(outwardAccountsTable.id, initialSkinId));
    const res = await request(app)
      .get(`/api/users/search?q=${encodeURIComponent(`initial_${tag}`)}`)
      .set("x-test-user", callerClerk);
    expect(res.status).toBe(200);
    const row = (res.body.users ?? []).find(
      (u: any) => u.outwardAccountId === initialSkinId,
    );
    expect(row).toBeTruthy();
    expect(row.name).toBe("Priya Singh");
  });
});

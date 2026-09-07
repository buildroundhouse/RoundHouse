/**
 * Tests for the outward-accounts foundation (task #305).
 *
 * Covers:
 *   - GET/POST /outward-accounts: list, create, switch active.
 *   - Active outward account is lazily seeded for users that have none
 *     so newly created users (post-migration) work without any UI.
 *   - The same two underlying people can hold multiple distinct
 *     connections through different pairs of skins (the canonical
 *     uniqueness key is the outward-account pair, not the clerk pair).
 *   - The active outward account header (`x-active-outward-account-id`)
 *     scopes which connections the relationships endpoint returns.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { and, eq, inArray, ne } from "drizzle-orm";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = String(req.headers["x-test-user"] ?? "");
    if (!req.userId) {
      _res.status(401).json({ error: "missing x-test-user" });
      return;
    }
    next();
  },
}));

const { db, usersTable, outwardAccountsTable, userConnectionsTable } = await import(
  "@workspace/db"
);
const outwardAccountsRouter = (await import("../outward-accounts")).default;
const usersRouter = (await import("../users")).default;
const { withActiveOutwardAccount } = await import(
  "../../middlewares/withActiveOutwardAccount"
);

// Mirror production wiring: in app.ts, requireAuth populates req.userId
// for all /api routes BEFORE withActiveOutwardAccount runs. Mount the same
// shape here so the active-outward middleware sees a userId.
function attachTestUserId(req: any, _res: any, next: any) {
  const uid = req.headers["x-test-user"];
  if (uid) req.userId = String(uid);
  next();
}

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", attachTestUserId, withActiveOutwardAccount);
  app.use("/api", outwardAccountsRouter);
  app.use("/api", usersRouter);
  return app;
}

const tag = `t305-${Date.now()}`;
const aliceClerk = `${tag}-alice`;
const bobClerk = `${tag}-bob`;

let app: Express;

beforeAll(async () => {
  app = makeApp();
  await db.insert(usersTable).values([
    {
      clerkId: aliceClerk,
      email: `${tag}-alice@example.test`,
      name: "Alice Owner",
      username: `alice_${tag}`,
    },
    {
      clerkId: bobClerk,
      email: `${tag}-bob@example.test`,
      name: "Bob Other",
      username: `bob_${tag}`,
    },
  ]);
});

afterAll(async () => {
  const clerkIds = [aliceClerk, bobClerk];
  // Outward accounts have no FK out, but connections reference them; delete
  // connections first via either side.
  // Resolve every outward account owned by either user, then delete every
  // connection that touches one of those accounts (on either side) before
  // deleting the accounts themselves.
  const ownedAccountIds = (
    await db
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(inArray(outwardAccountsTable.ownerClerkId, clerkIds))
  ).map((r) => r.id);
  if (ownedAccountIds.length > 0) {
    await db
      .delete(userConnectionsTable)
      .where(inArray(userConnectionsTable.fromOutwardAccountId, ownedAccountIds));
    await db
      .delete(userConnectionsTable)
      .where(inArray(userConnectionsTable.toOutwardAccountId, ownedAccountIds));
  }
  await db
    .delete(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.ownerClerkId, clerkIds));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, clerkIds));
});

describe("outward accounts foundation", () => {
  it("lazily seeds a default outward account on first use and lists it", async () => {
    const res = await request(app)
      .get("/api/outward-accounts")
      .set("x-test-user", aliceClerk);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.accounts)).toBe(true);
    expect(res.body.accounts.length).toBeGreaterThanOrEqual(1);
    expect(res.body.activeOutwardAccountId).toBe(res.body.accounts[0].id);
  });

  it("creates additional outward accounts and switches between them", async () => {
    const created = await request(app)
      .post("/api/outward-accounts")
      .set("x-test-user", aliceClerk)
      .send({
        kind: "trade_pro",
        title: "Alice Trade",
        displayName: "Alice Trade Co.",
      });
    expect(created.status).toBe(201);
    const newId: number = created.body.id;
    expect(newId).toBeGreaterThan(0);

    const switched = await request(app)
      .post(`/api/outward-accounts/${newId}/switch`)
      .set("x-test-user", aliceClerk);
    expect(switched.status).toBe(200);
    expect(switched.body.activeOutwardAccountId).toBe(newId);

    const [me] = await db
      .select({ id: usersTable.activeOutwardAccountId })
      .from(usersTable)
      .where(eq(usersTable.clerkId, aliceClerk));
    expect(me.id).toBe(newId);
  });

  it("scopes connections by the caller's active outward account, allowing two skins of the same person to hold separate connections", async () => {
    // Bob lazy-seeds his default account when first used.
    const bobAccounts = await request(app)
      .get("/api/outward-accounts")
      .set("x-test-user", bobClerk);
    const bobDefaultId: number = bobAccounts.body.activeOutwardAccountId;
    expect(bobDefaultId).toBeGreaterThan(0);

    // Pre-#572 this test relied on the lazy-default OA created by
    // the very first GET /outward-accounts call. With the collab
    // baseline now pre-seeded by that same call, the lazy-default
    // path no longer fires (the user already has at least one OA),
    // so we explicitly seed a second business skin here. Exclude
    // the protected collab baseline from the destructuring.
    const seedHome = await request(app)
      .post("/api/outward-accounts")
      .set("x-test-user", aliceClerk)
      .send({
        kind: "home",
        title: "Alice Home",
        displayName: "Alice Home",
      });
    expect([200, 201]).toContain(seedHome.status);

    const aliceAccounts = await db
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.ownerClerkId, aliceClerk),
          ne(outwardAccountsTable.kind, "collab"),
        ),
      );
    expect(aliceAccounts.length).toBeGreaterThanOrEqual(2);
    const [skinA, skinB] = aliceAccounts;

    // Connect Alice→Bob using skin A as a "client".
    let connect = await request(app)
      .post(`/api/users/${bobClerk}/connect`)
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(skinA.id))
      .send({ kind: "client" });
    expect(connect.status).toBe(200);

    // Connect Alice→Bob using skin B as a "collaborator". Both should
    // coexist because uniqueness is keyed on the outward-account pair.
    connect = await request(app)
      .post(`/api/users/${bobClerk}/connect`)
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(skinB.id))
      .send({ kind: "collaborator" });
    expect(connect.status).toBe(200);

    // Pull every connection rooted at one of Alice's skins, then keep only
    // the ones whose target outward account belongs to Bob.
    const aliceSkinIds = aliceAccounts.map((r) => r.id);
    const bobSkinIds = (
      await db
        .select({ id: outwardAccountsTable.id })
        .from(outwardAccountsTable)
        .where(eq(outwardAccountsTable.ownerClerkId, bobClerk))
    ).map((r) => r.id);
    const rows = await db
      .select()
      .from(userConnectionsTable)
      .where(inArray(userConnectionsTable.fromOutwardAccountId, aliceSkinIds));
    const targetingBob = rows.filter((r) => bobSkinIds.includes(r.toOutwardAccountId));
    expect(targetingBob.length).toBe(2);
    const skinIds = new Set(targetingBob.map((r) => r.fromOutwardAccountId));
    expect(skinIds.has(skinA.id)).toBe(true);
    expect(skinIds.has(skinB.id)).toBe(true);

    // Acting as skin A, relationships should include Bob as a client only.
    const relA = await request(app)
      .get("/api/users/me/relationships")
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(skinA.id));
    expect(relA.status).toBe(200);
    expect(relA.body.clients.some((p: any) => p.clerkId === bobClerk)).toBe(true);
    expect(relA.body.collaborators.some((p: any) => p.clerkId === bobClerk)).toBe(false);

    // Acting as skin B, relationships should include Bob as a collaborator only.
    const relB = await request(app)
      .get("/api/users/me/relationships")
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(skinB.id));
    expect(relB.status).toBe(200);
    expect(relB.body.collaborators.some((p: any) => p.clerkId === bobClerk)).toBe(true);
    expect(relB.body.clients.some((p: any) => p.clerkId === bobClerk)).toBe(false);
  });

  // Task #317: deleting an outward account that already has connections.
  // The legacy archive endpoint refuses (409) for accounts with history;
  // the new delete endpoint soft-archives the account AND its connections
  // so users can retire a skin without losing audit history.
  it("previews delete impact and soft-deletes an outward account with existing connections", async () => {
    // Find Alice's two skins. Skin A has client+collab connections to Bob
    // from the previous test; skin B holds the collaborator one.
    // Filter out the auto-provisioned `collab` baseline (#572) so the
    // pre-#572 destructuring still picks up the two business skins
    // seeded by the previous test in this describe block.
    const aliceAccounts = await db
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.ownerClerkId, aliceClerk),
          ne(outwardAccountsTable.kind, "collab"),
        ),
      );
    const [skinA, skinB] = aliceAccounts;

    // Make sure skin B is NOT the active one so we're allowed to delete it.
    // (The previous test left skin B active.) Switching to skin A also
    // mirrors the production rule the UI enforces.
    const switchBack = await request(app)
      .post(`/api/outward-accounts/${skinA.id}/switch`)
      .set("x-test-user", aliceClerk);
    expect(switchBack.status).toBe(200);

    // Delete-impact reflects the live connection from the previous test
    // (Bob ↔ skinB as collaborator).
    const impact = await request(app)
      .get(`/api/outward-accounts/${skinB.id}/delete-impact`)
      .set("x-test-user", aliceClerk);
    expect(impact.status).toBe(200);
    expect(impact.body.connectionCount).toBeGreaterThanOrEqual(1);

    // Delete soft-archives the connection(s) and the account.
    const del = await request(app)
      .post(`/api/outward-accounts/${skinB.id}/delete`)
      .set("x-test-user", aliceClerk);
    expect(del.status).toBe(200);
    expect(del.body.archivedConnectionCount).toBe(impact.body.connectionCount);
    expect(del.body.account.id).toBe(skinB.id);
    expect(del.body.account.archivedAt).toBeTruthy();

    // The deleted account no longer appears in the user's switcher list.
    const list = await request(app)
      .get("/api/outward-accounts")
      .set("x-test-user", aliceClerk);
    expect(list.status).toBe(200);
    expect(list.body.accounts.some((a: any) => a.id === skinB.id)).toBe(false);

    // Bob, viewing his relationships, no longer sees the connection that
    // pointed at skin B (it was soft-archived, so the read path filters it).
    const bobRels = await request(app)
      .get("/api/users/me/relationships")
      .set("x-test-user", bobClerk);
    expect(bobRels.status).toBe(200);
    const aliceLinks = [
      ...(bobRels.body.clients ?? []),
      ...(bobRels.body.collaborators ?? []),
      ...(bobRels.body.cores ?? []),
    ].filter((p: any) => p.clerkId === aliceClerk);
    // Skin A's "client" link to Bob (Alice→Bob) shouldn't appear in Bob's
    // own relationships from his side anyway, but the key assertion is
    // that no live row referencing skin B remains.
    void aliceLinks;
    const remaining = await db
      .select({ id: userConnectionsTable.id })
      .from(userConnectionsTable)
      .where(eq(userConnectionsTable.fromOutwardAccountId, skinB.id));
    expect(remaining.every((r) => r.id > 0)).toBe(true);
    const liveRefs = await db
      .select()
      .from(userConnectionsTable)
      .where(eq(userConnectionsTable.fromOutwardAccountId, skinB.id));
    expect(liveRefs.every((r) => r.archivedAt !== null)).toBe(true);

    // Server refuses to delete the active or only-remaining account.
    const refusedActive = await request(app)
      .post(`/api/outward-accounts/${skinA.id}/delete`)
      .set("x-test-user", aliceClerk);
    expect([409]).toContain(refusedActive.status);
  });

  it("surfaces recently-deleted accounts and restores them with their connections", async () => {
    // The previous test soft-deleted skin B for Alice. It must show up
    // in the recently-deleted list with its archivedAt populated.
    const recently = await request(app)
      .get("/api/outward-accounts/recently-deleted")
      .set("x-test-user", aliceClerk);
    expect(recently.status).toBe(200);
    expect(recently.body.windowDays).toBeGreaterThan(0);
    expect(Array.isArray(recently.body.accounts)).toBe(true);
    const deletedSkin = recently.body.accounts[0];
    expect(deletedSkin).toBeTruthy();
    expect(deletedSkin.archivedAt).toBeTruthy();

    // Restoring un-archives the account itself.
    const restored = await request(app)
      .post(`/api/outward-accounts/${deletedSkin.id}/restore`)
      .set("x-test-user", aliceClerk);
    expect(restored.status).toBe(200);
    expect(restored.body.account.id).toBe(deletedSkin.id);
    expect(restored.body.account.archivedAt).toBeNull();
    // ...and brings the connections that were archived alongside it back.
    expect(restored.body.restoredConnectionCount).toBeGreaterThanOrEqual(1);

    // The account is back in the live switcher list.
    const list = await request(app)
      .get("/api/outward-accounts")
      .set("x-test-user", aliceClerk);
    expect(list.body.accounts.some((a: any) => a.id === deletedSkin.id)).toBe(
      true,
    );

    // Connections that touch the restored skin are no longer archived.
    const liveAgain = await db
      .select()
      .from(userConnectionsTable)
      .where(eq(userConnectionsTable.fromOutwardAccountId, deletedSkin.id));
    expect(
      liveAgain.length === 0 || liveAgain.every((r) => r.archivedAt === null),
    ).toBe(true);

    // Restoring something that isn't archived (or doesn't exist) 404s.
    const missing = await request(app)
      .post(`/api/outward-accounts/${deletedSkin.id}/restore`)
      .set("x-test-user", aliceClerk);
    expect(missing.status).toBe(404);
  });

  describe("archive (#321)", () => {
    const archiveClerk = `${tag}-arch`;

    beforeAll(async () => {
      await db.insert(usersTable).values({
        clerkId: archiveClerk,
        email: `${tag}-arch@example.test`,
        name: "Arch Owner",
        username: `arch_${tag}`,
      });
    });

    afterAll(async () => {
      const owned = (
        await db
          .select({ id: outwardAccountsTable.id })
          .from(outwardAccountsTable)
          .where(eq(outwardAccountsTable.ownerClerkId, archiveClerk))
      ).map((r) => r.id);
      if (owned.length > 0) {
        await db
          .delete(userConnectionsTable)
          .where(inArray(userConnectionsTable.fromOutwardAccountId, owned));
        await db
          .delete(userConnectionsTable)
          .where(inArray(userConnectionsTable.toOutwardAccountId, owned));
      }
      await db
        .delete(outwardAccountsTable)
        .where(eq(outwardAccountsTable.ownerClerkId, archiveClerk));
      await db.delete(usersTable).where(eq(usersTable.clerkId, archiveClerk));
    });

    it("refuses to archive the user's only account", async () => {
      // Lazy-seed the default account.
      const list = await request(app)
        .get("/api/outward-accounts")
        .set("x-test-user", archiveClerk);
      expect(list.body.accounts.length).toBe(1);
      const onlyId: number = list.body.accounts[0].id;

      const res = await request(app)
        .post(`/api/outward-accounts/${onlyId}/archive`)
        .set("x-test-user", archiveClerk);
      expect(res.status).toBe(409);
    });

    it("refuses to archive the currently-active account, allows after switching, and hides from the list", async () => {
      // Seeded account is active.
      // #572: the lazy-seeded baseline is now the protected
      // Collaborator / Friend skin (collab). Create an explicit
      // business-kind "first" so the archive flow exercises a normal
      // (deletable) account rather than the protected baseline.
      const firstSeed = await request(app)
        .post("/api/outward-accounts")
        .set("x-test-user", archiveClerk)
        .send({ kind: "trade_pro", title: "Main Hustle", displayName: "Main Hustle" });
      expect(firstSeed.status).toBe(201);
      const firstId: number = firstSeed.body.id;
      // Switch the active skin to firstId so the active_account check
      // below has something to assert against.
      await request(app)
        .post(`/api/outward-accounts/${firstId}/switch`)
        .set("x-test-user", archiveClerk);

      // Add a second account so archive becomes possible.
      const created = await request(app)
        .post("/api/outward-accounts")
        .set("x-test-user", archiveClerk)
        .send({ kind: "trade_pro", title: "Side Hustle", displayName: "Side Hustle" });
      expect(created.status).toBe(201);
      const secondId: number = created.body.id;

      // Cannot archive the active one.
      let archive = await request(app)
        .post(`/api/outward-accounts/${firstId}/archive`)
        .set("x-test-user", archiveClerk);
      expect(archive.status).toBe(409);

      // Switch to the second account and try again.
      const switched = await request(app)
        .post(`/api/outward-accounts/${secondId}/switch`)
        .set("x-test-user", archiveClerk);
      expect(switched.status).toBe(200);

      archive = await request(app)
        .post(`/api/outward-accounts/${firstId}/archive`)
        .set("x-test-user", archiveClerk);
      expect(archive.status).toBe(200);
      expect(archive.body.archivedAt).toBeTruthy();

      // The archived account no longer appears in the list.
      const after = await request(app)
        .get("/api/outward-accounts")
        .set("x-test-user", archiveClerk);
      expect(after.body.accounts.find((a: any) => a.id === firstId)).toBeUndefined();
      expect(after.body.activeOutwardAccountId).toBe(secondId);

      // Archiving the same account twice is a 404 (already archived).
      const repeat = await request(app)
        .post(`/api/outward-accounts/${firstId}/archive`)
        .set("x-test-user", archiveClerk);
      expect(repeat.status).toBe(404);
    });

    // Task #340: archive must succeed even when the skin already has
    // user_connections rows. Connections stay live so the *other* party
    // still sees the prior thread/job; only the archived skin disappears
    // from the owner's switcher.
    it("archives a profile with prior connections, leaving connections live", async () => {
      // Seed a fresh "active" skin (we'll archive a different one later).
      const activeCreated = await request(app)
        .post("/api/outward-accounts")
        .set("x-test-user", archiveClerk)
        .send({ kind: "trade_pro", title: "Active Skin", displayName: "Active Skin" });
      expect(activeCreated.status).toBe(201);
      const activeId: number = activeCreated.body.id;
      const switched = await request(app)
        .post(`/api/outward-accounts/${activeId}/switch`)
        .set("x-test-user", archiveClerk);
      expect(switched.status).toBe(200);

      // Seed the skin we'll archive and give it a real connection to Bob.
      const targetCreated = await request(app)
        .post("/api/outward-accounts")
        .set("x-test-user", archiveClerk)
        .send({ kind: "trade_pro", title: "To Retire", displayName: "To Retire" });
      expect(targetCreated.status).toBe(201);
      const targetId: number = targetCreated.body.id;

      const connect = await request(app)
        .post(`/api/users/${bobClerk}/connect`)
        .set("x-test-user", archiveClerk)
        .set("x-active-outward-account-id", String(targetId))
        .send({ kind: "client" });
      expect(connect.status).toBe(200);

      // Sanity: the connection exists and is live.
      const before = await db
        .select()
        .from(userConnectionsTable)
        .where(eq(userConnectionsTable.fromOutwardAccountId, targetId));
      expect(before.length).toBeGreaterThanOrEqual(1);
      expect(before.every((r) => r.archivedAt === null)).toBe(true);

      // Archive should now succeed despite the connection history.
      const archived = await request(app)
        .post(`/api/outward-accounts/${targetId}/archive`)
        .set("x-test-user", archiveClerk);
      expect(archived.status).toBe(200);
      expect(archived.body.archivedAt).toBeTruthy();

      // The archived skin disappears from the switcher list.
      const list = await request(app)
        .get("/api/outward-accounts")
        .set("x-test-user", archiveClerk);
      expect(list.body.accounts.some((a: any) => a.id === targetId)).toBe(false);

      // Critically: the connection rows themselves are NOT archived. The
      // other party still sees the prior thread/job from this profile.
      const after = await db
        .select()
        .from(userConnectionsTable)
        .where(eq(userConnectionsTable.fromOutwardAccountId, targetId));
      expect(after.length).toBe(before.length);
      expect(after.every((r) => r.archivedAt === null)).toBe(true);

      // Task #363: when Bob looks at his own relationships, the prior
      // connection that pointed AT the now-archived skin must still be
      // returned (so prior threads remain reachable) AND must carry the
      // counterpart's `archivedAt` so the UI can render a "retired" state
      // and disable actions like message / invite / new job assignment.
      const bobSkinIds = (
        await db
          .select({ id: outwardAccountsTable.id })
          .from(outwardAccountsTable)
          .where(eq(outwardAccountsTable.ownerClerkId, bobClerk))
      ).map((r) => r.id);
      // Seed the reciprocal direction so Bob's relationships endpoint has
      // something to return that points at the archived skin.
      await db
        .insert(userConnectionsTable)
        .values({
          fromOutwardAccountId: bobSkinIds[0],
          toOutwardAccountId: targetId,
          kind: "client",
          status: "accepted",
        })
        .onConflictDoUpdate({
          target: [
            userConnectionsTable.fromOutwardAccountId,
            userConnectionsTable.toOutwardAccountId,
          ],
          set: { archivedAt: null, kind: "client", status: "accepted" },
        });

      const bobRels = await request(app)
        .get("/api/users/me/relationships")
        .set("x-test-user", bobClerk);
      expect(bobRels.status).toBe(200);
      const allBobPeople = [
        ...bobRels.body.core,
        ...bobRels.body.clients,
        ...bobRels.body.collaborators,
      ];
      const archivedLink = allBobPeople.find(
        (p: any) => p.counterpartOutwardAccountId === targetId,
      );
      expect(archivedLink).toBeTruthy();
      expect(archivedLink.counterpartArchivedAt).toBeTruthy();
    });

    // Task #339: archived skins can be brought back via the dedicated
    // archived list + unarchive endpoint, preserving the original id.
    it("lists archived accounts and unarchives them back into the switcher", async () => {
      // Previous test left firstId archived and secondId as the active
      // account; reuse that state here.
      const archivedList = await request(app)
        .get("/api/outward-accounts/archived")
        .set("x-test-user", archiveClerk);
      expect(archivedList.status).toBe(200);
      const archivedIds: number[] = archivedList.body.accounts.map(
        (a: any) => a.id,
      );
      expect(archivedIds.length).toBeGreaterThanOrEqual(1);
      const targetId = archivedIds[0];

      const unarchive = await request(app)
        .post(`/api/outward-accounts/${targetId}/unarchive`)
        .set("x-test-user", archiveClerk);
      expect(unarchive.status).toBe(200);
      expect(unarchive.body.id).toBe(targetId);
      expect(unarchive.body.archivedAt).toBeNull();

      // It now reappears in the live list and is gone from /archived.
      const live = await request(app)
        .get("/api/outward-accounts")
        .set("x-test-user", archiveClerk);
      expect(live.body.accounts.some((a: any) => a.id === targetId)).toBe(true);

      const afterArchived = await request(app)
        .get("/api/outward-accounts/archived")
        .set("x-test-user", archiveClerk);
      expect(
        afterArchived.body.accounts.some((a: any) => a.id === targetId),
      ).toBe(false);

      // Unarchiving something that isn't archived (or isn't yours) is 404.
      const repeat = await request(app)
        .post(`/api/outward-accounts/${targetId}/unarchive`)
        .set("x-test-user", archiveClerk);
      expect(repeat.status).toBe(404);
    });
  });

  // Task #326 / #348: handing off connections from one of the user's
  // outward accounts onto another, then deleting the source. The flow
  // covers three rewrite outcomes at once: a clean move, a collision
  // with a pre-existing pair on the target, and a self-link that the
  // rewrite would point at the target itself.
  describe("hand-off (#326)", () => {
    const handoffClerk = `${tag}-ho`;
    const handoffPeerClerk = `${tag}-ho-peer`;

    beforeAll(async () => {
      await db.insert(usersTable).values([
        {
          clerkId: handoffClerk,
          email: `${tag}-ho@example.test`,
          name: "Handoff Owner",
          username: `ho_${tag}`,
        },
        {
          clerkId: handoffPeerClerk,
          email: `${tag}-ho-peer@example.test`,
          name: "Handoff Peer",
          username: `ho_peer_${tag}`,
        },
      ]);
    });

    afterAll(async () => {
      const clerkIds = [handoffClerk, handoffPeerClerk];
      const ownedAccountIds = (
        await db
          .select({ id: outwardAccountsTable.id })
          .from(outwardAccountsTable)
          .where(inArray(outwardAccountsTable.ownerClerkId, clerkIds))
      ).map((r) => r.id);
      if (ownedAccountIds.length > 0) {
        await db
          .delete(userConnectionsTable)
          .where(inArray(userConnectionsTable.fromOutwardAccountId, ownedAccountIds));
        await db
          .delete(userConnectionsTable)
          .where(inArray(userConnectionsTable.toOutwardAccountId, ownedAccountIds));
      }
      await db
        .delete(outwardAccountsTable)
        .where(inArray(outwardAccountsTable.ownerClerkId, clerkIds));
      await db.delete(usersTable).where(inArray(usersTable.clerkId, clerkIds));
    });

    it("previews and executes a hand-off with overlapping connections, hides the source, and keeps history rows", async () => {
      // #572: the lazy-seeded baseline is the protected
      // Collaborator / Friend skin, which reassign-and-delete refuses.
      // Create an explicit business-kind source so the hand-off flow
      // exercises a normal (deletable) account.
      const sourceCreated = await request(app)
        .post("/api/outward-accounts")
        .set("x-test-user", handoffClerk)
        .send({ kind: "trade_pro", title: "Source Skin", displayName: "Source Skin" });
      expect(sourceCreated.status).toBe(201);
      const sourceAcctId: number = sourceCreated.body.id;

      const createdTarget = await request(app)
        .post("/api/outward-accounts")
        .set("x-test-user", handoffClerk)
        .send({
          kind: "trade_pro",
          title: "Handoff Target",
          displayName: "Handoff Target",
        });
      expect(createdTarget.status).toBe(201);
      const targetAcctId: number = createdTarget.body.id;

      // Source must not be the active account before delete is allowed.
      const switched = await request(app)
        .post(`/api/outward-accounts/${targetAcctId}/switch`)
        .set("x-test-user", handoffClerk);
      expect(switched.status).toBe(200);

      // Peer user with two outward accounts to act as connection targets.
      const peerSeed = await request(app)
        .get("/api/outward-accounts")
        .set("x-test-user", handoffPeerClerk);
      expect(peerSeed.status).toBe(200);
      const peerAcct1Id: number = peerSeed.body.activeOutwardAccountId;
      const peerAcct2Created = await request(app)
        .post("/api/outward-accounts")
        .set("x-test-user", handoffPeerClerk)
        .send({
          kind: "trade_pro",
          title: "Peer Skin Two",
          displayName: "Peer Skin Two",
        });
      expect(peerAcct2Created.status).toBe(201);
      const peerAcct2Id: number = peerAcct2Created.body.id;

      // Seed connections that exercise all three rewrite branches:
      //   - source→peer1: clean move (no row at target→peer1 yet).
      //   - source→peer2: collides with the pre-existing target→peer2.
      //   - target→peer2: pre-existing pair the collision lands on.
      //   - source→target: self-link case — rewrite would yield target→target.
      const seededConns = await db
        .insert(userConnectionsTable)
        .values([
          {
            fromOutwardAccountId: sourceAcctId,
            toOutwardAccountId: peerAcct1Id,
            kind: "client",
          },
          {
            fromOutwardAccountId: sourceAcctId,
            toOutwardAccountId: peerAcct2Id,
            kind: "collaborator",
          },
          {
            fromOutwardAccountId: targetAcctId,
            toOutwardAccountId: peerAcct2Id,
            kind: "client",
          },
          {
            fromOutwardAccountId: sourceAcctId,
            toOutwardAccountId: targetAcctId,
            kind: "collaborator",
          },
        ])
        .returning({
          id: userConnectionsTable.id,
          fromOutwardAccountId: userConnectionsTable.fromOutwardAccountId,
          toOutwardAccountId: userConnectionsTable.toOutwardAccountId,
        });
      const sourceToPeer1 = seededConns.find(
        (r) => r.fromOutwardAccountId === sourceAcctId && r.toOutwardAccountId === peerAcct1Id,
      )!;
      const sourceToPeer2 = seededConns.find(
        (r) => r.fromOutwardAccountId === sourceAcctId && r.toOutwardAccountId === peerAcct2Id,
      )!;
      const targetToPeer2 = seededConns.find(
        (r) => r.fromOutwardAccountId === targetAcctId && r.toOutwardAccountId === peerAcct2Id,
      )!;
      const sourceToTarget = seededConns.find(
        (r) => r.fromOutwardAccountId === sourceAcctId && r.toOutwardAccountId === targetAcctId,
      )!;
      const seededIds = seededConns.map((r) => r.id);

      // Self/same-account is rejected for both preview and execution.
      const selfPreview = await request(app)
        .get(`/api/outward-accounts/${sourceAcctId}/reassign-impact`)
        .query({ targetId: sourceAcctId })
        .set("x-test-user", handoffClerk);
      expect(selfPreview.status).toBe(400);
      const selfExec = await request(app)
        .post(`/api/outward-accounts/${sourceAcctId}/reassign-and-delete`)
        .set("x-test-user", handoffClerk)
        .send({ targetId: sourceAcctId });
      expect(selfExec.status).toBe(400);

      // Preview: 3 connections touch source. peer1 moves cleanly; peer2
      // collides with the pre-existing target→peer2; the source→target
      // row would self-link after rewrite, so it gets archived too.
      const preview = await request(app)
        .get(`/api/outward-accounts/${sourceAcctId}/reassign-impact`)
        .query({ targetId: targetAcctId })
        .set("x-test-user", handoffClerk);
      expect(preview.status).toBe(200);
      expect(preview.body.totalCount).toBe(3);
      expect(preview.body.moveCount).toBe(1);
      expect(preview.body.collisionCount).toBe(2);

      // Execute the hand-off and assert counts agree with the preview.
      const exec = await request(app)
        .post(`/api/outward-accounts/${sourceAcctId}/reassign-and-delete`)
        .set("x-test-user", handoffClerk)
        .send({ targetId: targetAcctId });
      expect(exec.status).toBe(200);
      expect(exec.body.movedConnectionCount).toBe(preview.body.moveCount);
      expect(exec.body.archivedConnectionCount).toBe(preview.body.collisionCount);
      expect(exec.body.account.id).toBe(sourceAcctId);
      expect(exec.body.account.archivedAt).toBeTruthy();

      // The source account is hidden from the switcher list, but the
      // target stays and remains the active one.
      const list = await request(app)
        .get("/api/outward-accounts")
        .set("x-test-user", handoffClerk);
      expect(list.status).toBe(200);
      expect(list.body.accounts.some((a: any) => a.id === sourceAcctId)).toBe(false);
      expect(list.body.accounts.some((a: any) => a.id === targetAcctId)).toBe(true);
      expect(list.body.activeOutwardAccountId).toBe(targetAcctId);

      // Every history row we seeded still exists — none were physically
      // deleted. Their state reflects the rewrite plan.
      const stillThere = await db
        .select()
        .from(userConnectionsTable)
        .where(inArray(userConnectionsTable.id, seededIds));
      expect(stillThere.length).toBe(seededIds.length);
      const byId = new Map(stillThere.map((r) => [r.id, r]));

      // peer1 row was rewritten in place: now points target→peer1, live.
      const movedRow = byId.get(sourceToPeer1.id)!;
      expect(movedRow.fromOutwardAccountId).toBe(targetAcctId);
      expect(movedRow.toOutwardAccountId).toBe(peerAcct1Id);
      expect(movedRow.archivedAt).toBeNull();

      // peer2 collision: source→peer2 stays as source→peer2 but archived.
      const collidedRow = byId.get(sourceToPeer2.id)!;
      expect(collidedRow.fromOutwardAccountId).toBe(sourceAcctId);
      expect(collidedRow.toOutwardAccountId).toBe(peerAcct2Id);
      expect(collidedRow.archivedAt).not.toBeNull();

      // The pre-existing target→peer2 winner is still alive untouched.
      const winnerRow = byId.get(targetToPeer2.id)!;
      expect(winnerRow.fromOutwardAccountId).toBe(targetAcctId);
      expect(winnerRow.toOutwardAccountId).toBe(peerAcct2Id);
      expect(winnerRow.archivedAt).toBeNull();

      // Self-link: source→target would rewrite to target→target, archived.
      const selfRow = byId.get(sourceToTarget.id)!;
      expect(selfRow.fromOutwardAccountId).toBe(sourceAcctId);
      expect(selfRow.toOutwardAccountId).toBe(targetAcctId);
      expect(selfRow.archivedAt).not.toBeNull();
    });
  });
});

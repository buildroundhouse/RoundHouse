/**
 * Tests for #344 — auto-purge outward accounts whose recovery window
 * has elapsed.
 *
 * The purge:
 *   - Hard-deletes outward_accounts rows whose archivedAt is older than
 *     RECENTLY_DELETED_WINDOW_DAYS.
 *   - Hard-deletes the archived user_connections rows that point at any
 *     of the purged accounts on either side.
 *   - Leaves alone (a) live accounts, (b) accounts archived inside the
 *     window, and (c) live connections.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";

const { db, usersTable, outwardAccountsTable, userConnectionsTable } = await import(
  "@workspace/db"
);
const { purgeExpiredOutwardAccounts, RECENTLY_DELETED_WINDOW_DAYS } = await import(
  "../../lib/outwardAccounts"
);

const tag = `t344-${Date.now()}`;
const ownerClerk = `${tag}-owner`;
const peerClerk = `${tag}-peer`;

let liveAccountId = 0;
let recentlyDeletedAccountId = 0;
let expiredAccountId = 0;
let peerAccountId = 0;

let liveConnectionId = 0;
let archivedRecentConnectionId = 0;
let expiredArchivedConnectionId = 0;

beforeAll(async () => {
  await db.insert(usersTable).values([
    {
      clerkId: ownerClerk,
      email: `${tag}-owner@example.test`,
      name: "Purge Owner",
      username: `owner_${tag}`,
    },
    {
      clerkId: peerClerk,
      email: `${tag}-peer@example.test`,
      name: "Purge Peer",
      username: `peer_${tag}`,
    },
  ]);

  // Seed four outward accounts with intentionally varied archive states:
  //   - liveAccountId: never archived; must survive.
  //   - recentlyDeletedAccountId: archived inside the recovery window.
  //   - expiredAccountId: archived past the recovery window — purge target.
  //   - peerAccountId: belongs to another user, used only as the "other
  //     side" of a connection so we can prove cross-side cleanup works.
  const insertedAccounts = await db
    .insert(outwardAccountsTable)
    .values([
      { ownerClerkId: ownerClerk, kind: "home", title: "Live" },
      { ownerClerkId: ownerClerk, kind: "home", title: "RecentlyDeleted" },
      { ownerClerkId: ownerClerk, kind: "home", title: "Expired" },
      { ownerClerkId: peerClerk, kind: "home", title: "Peer" },
    ])
    .returning({ id: outwardAccountsTable.id, title: outwardAccountsTable.title });
  liveAccountId = insertedAccounts.find((r) => r.title === "Live")!.id;
  recentlyDeletedAccountId = insertedAccounts.find((r) => r.title === "RecentlyDeleted")!.id;
  expiredAccountId = insertedAccounts.find((r) => r.title === "Expired")!.id;
  peerAccountId = insertedAccounts.find((r) => r.title === "Peer")!.id;

  const now = new Date();
  const insideWindow = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
  const outsideWindow = new Date(
    now.getTime() - (RECENTLY_DELETED_WINDOW_DAYS + 5) * 24 * 60 * 60 * 1000,
  );
  await db
    .update(outwardAccountsTable)
    .set({ archivedAt: insideWindow })
    .where(eq(outwardAccountsTable.id, recentlyDeletedAccountId));
  await db
    .update(outwardAccountsTable)
    .set({ archivedAt: outsideWindow })
    .where(eq(outwardAccountsTable.id, expiredAccountId));

  // Connections:
  //   - liveConnectionId: live, between live and peer. Untouched.
  //   - archivedRecentConnectionId: archived but tied to a still-recoverable
  //     account; must be left alone.
  //   - expiredArchivedConnectionId: archived alongside the expired account;
  //     must be hard-deleted with it.
  const conns = await db
    .insert(userConnectionsTable)
    .values([
      {
        fromOutwardAccountId: liveAccountId,
        toOutwardAccountId: peerAccountId,
        kind: "client",
      },
      {
        fromOutwardAccountId: recentlyDeletedAccountId,
        toOutwardAccountId: peerAccountId,
        kind: "client",
        archivedAt: insideWindow,
      },
      {
        fromOutwardAccountId: peerAccountId,
        toOutwardAccountId: expiredAccountId,
        kind: "collaborator",
        archivedAt: outsideWindow,
      },
    ])
    .returning({
      id: userConnectionsTable.id,
      from: userConnectionsTable.fromOutwardAccountId,
      to: userConnectionsTable.toOutwardAccountId,
    });
  liveConnectionId = conns.find(
    (r) => r.from === liveAccountId && r.to === peerAccountId,
  )!.id;
  archivedRecentConnectionId = conns.find(
    (r) => r.from === recentlyDeletedAccountId,
  )!.id;
  expiredArchivedConnectionId = conns.find(
    (r) => r.to === expiredAccountId,
  )!.id;
});

afterAll(async () => {
  const ownedAccountIds = (
    await db
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(inArray(outwardAccountsTable.ownerClerkId, [ownerClerk, peerClerk]))
  ).map((r) => r.id);
  if (ownedAccountIds.length > 0) {
    await db
      .delete(userConnectionsTable)
      .where(inArray(userConnectionsTable.fromOutwardAccountId, ownedAccountIds));
    await db
      .delete(userConnectionsTable)
      .where(inArray(userConnectionsTable.toOutwardAccountId, ownedAccountIds));
    await db
      .delete(outwardAccountsTable)
      .where(inArray(outwardAccountsTable.id, ownedAccountIds));
  }
  await db
    .delete(usersTable)
    .where(inArray(usersTable.clerkId, [ownerClerk, peerClerk]));
});

describe("purgeExpiredOutwardAccounts", () => {
  it("hard-deletes expired accounts and their archived connections, leaves the rest alone", async () => {
    const result = await purgeExpiredOutwardAccounts();
    // The seeded data may run alongside other purgeable rows from other
    // tests' fixtures, so assert lower bounds rather than equality.
    expect(result.accounts).toBeGreaterThanOrEqual(1);
    expect(result.connections).toBeGreaterThanOrEqual(1);

    const remainingAccounts = await db
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(
        inArray(outwardAccountsTable.id, [
          liveAccountId,
          recentlyDeletedAccountId,
          expiredAccountId,
          peerAccountId,
        ]),
      );
    const remainingIds = new Set(remainingAccounts.map((r) => r.id));
    expect(remainingIds.has(liveAccountId)).toBe(true);
    expect(remainingIds.has(recentlyDeletedAccountId)).toBe(true);
    expect(remainingIds.has(peerAccountId)).toBe(true);
    expect(remainingIds.has(expiredAccountId)).toBe(false);

    const remainingConnections = await db
      .select({ id: userConnectionsTable.id })
      .from(userConnectionsTable)
      .where(
        inArray(userConnectionsTable.id, [
          liveConnectionId,
          archivedRecentConnectionId,
          expiredArchivedConnectionId,
        ]),
      );
    const remainingConnIds = new Set(remainingConnections.map((r) => r.id));
    expect(remainingConnIds.has(liveConnectionId)).toBe(true);
    expect(remainingConnIds.has(archivedRecentConnectionId)).toBe(true);
    expect(remainingConnIds.has(expiredArchivedConnectionId)).toBe(false);
  });

  it("is a no-op when nothing has expired", async () => {
    // The previous test purged everything that was eligible. Re-running
    // should report zeros.
    const second = await purgeExpiredOutwardAccounts();
    expect(second.accounts).toBe(0);
    expect(second.connections).toBe(0);
    expect(typeof second.runId).toBe("number");
  });
});

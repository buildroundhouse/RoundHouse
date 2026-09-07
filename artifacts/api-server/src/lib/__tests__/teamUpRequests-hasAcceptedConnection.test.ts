/**
 * Task #654 — regression coverage for `hasAcceptedConnection`.
 *
 * The messages route gates sends with `hasAcceptedConnection`. Before
 * the fix, it only consulted `user_connections`, which meant that an
 * accepted teammate (related via `user_team_members.clerkId` rather
 * than `user_connections` outward-account ids) was treated as
 * "not connected" and the inbox composer rendered the blocked banner.
 * See `artifacts/round-house/e2e/my-team-tab-message.test-plan.md`
 * Cases 3 (trade-pro / facilities). These tests pin both branches:
 *   - the original `user_connections` source still works,
 *   - and the `user_team_members` fallback (in either lead/member
 *     direction, only when status="accepted") flips the gate.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { and, eq, inArray, or } from "drizzle-orm";

const {
  db,
  outwardAccountsTable,
  userConnectionsTable,
  userTeamMembersTable,
  usersTable,
} = await import("@workspace/db");
const { resolveActiveOutwardAccountId } = await import("../outwardAccounts");
const { hasAcceptedConnection } = await import("../teamUpRequests");

const tag = `t654-hac-${Date.now()}`;
const aClerk = `${tag}-a`;
const bClerk = `${tag}-b`;
const allClerks = [aClerk, bClerk];

let aAcct: number;
let bAcct: number;

beforeAll(async () => {
  await db.insert(usersTable).values([
    {
      clerkId: aClerk,
      email: `${tag}-a@example.test`,
      name: "Alice Admin",
      username: `a_${tag}`,
    },
    {
      clerkId: bClerk,
      email: `${tag}-b@example.test`,
      name: "Bob Buddy",
      username: `b_${tag}`,
    },
  ]);
  const a = await resolveActiveOutwardAccountId(aClerk);
  const b = await resolveActiveOutwardAccountId(bClerk);
  if (a == null || b == null) throw new Error("failed to seed outward accounts");
  aAcct = a;
  bAcct = b;
});

afterAll(async () => {
  await db
    .delete(userTeamMembersTable)
    .where(
      or(
        inArray(userTeamMembersTable.leadClerkId, allClerks),
        inArray(userTeamMembersTable.memberClerkId, allClerks),
      ),
    );
  const ownedAccountIds = (
    await db
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(inArray(outwardAccountsTable.ownerClerkId, allClerks))
  ).map((r) => r.id);
  if (ownedAccountIds.length > 0) {
    await db
      .delete(userConnectionsTable)
      .where(
        or(
          inArray(userConnectionsTable.fromOutwardAccountId, ownedAccountIds),
          inArray(userConnectionsTable.toOutwardAccountId, ownedAccountIds),
        ),
      );
  }
  await db
    .update(usersTable)
    .set({ activeOutwardAccountId: null })
    .where(inArray(usersTable.clerkId, allClerks));
  await db
    .delete(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.ownerClerkId, allClerks));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, allClerks));
});

beforeEach(async () => {
  // Wipe any rows left behind by the previous test so each case
  // starts from a known-clean slate.
  await db
    .delete(userTeamMembersTable)
    .where(
      or(
        inArray(userTeamMembersTable.leadClerkId, allClerks),
        inArray(userTeamMembersTable.memberClerkId, allClerks),
      ),
    );
  await db
    .delete(userConnectionsTable)
    .where(
      or(
        inArray(userConnectionsTable.fromOutwardAccountId, [aAcct, bAcct]),
        inArray(userConnectionsTable.toOutwardAccountId, [aAcct, bAcct]),
      ),
    );
});

describe("hasAcceptedConnection (#654)", () => {
  it("returns false when no rows exist in either table", async () => {
    expect(await hasAcceptedConnection(aAcct, bAcct)).toBe(false);
    expect(await hasAcceptedConnection(bAcct, aAcct)).toBe(false);
  });

  it("returns true when an accepted user_connections row exists (either direction)", async () => {
    await db.insert(userConnectionsTable).values({
      fromClerkId: aClerk,
      toClerkId: bClerk,
      fromOutwardAccountId: aAcct,
      toOutwardAccountId: bAcct,
      status: "accepted",
      kind: "client",
    });
    expect(await hasAcceptedConnection(aAcct, bAcct)).toBe(true);
    expect(await hasAcceptedConnection(bAcct, aAcct)).toBe(true);
  });

  it("returns false when only a pending user_connections row exists", async () => {
    await db.insert(userConnectionsTable).values({
      fromClerkId: aClerk,
      toClerkId: bClerk,
      fromOutwardAccountId: aAcct,
      toOutwardAccountId: bAcct,
      status: "pending",
      kind: "client",
    });
    expect(await hasAcceptedConnection(aAcct, bAcct)).toBe(false);
    expect(await hasAcceptedConnection(bAcct, aAcct)).toBe(false);
  });

  it("returns false when an accepted user_connections row is archived", async () => {
    await db.insert(userConnectionsTable).values({
      fromClerkId: aClerk,
      toClerkId: bClerk,
      fromOutwardAccountId: aAcct,
      toOutwardAccountId: bAcct,
      status: "accepted",
      kind: "client",
      archivedAt: new Date(),
    });
    expect(await hasAcceptedConnection(aAcct, bAcct)).toBe(false);
  });

  it("returns true when an accepted user_team_members row exists (lead → member)", async () => {
    await db.insert(userTeamMembersTable).values({
      leadClerkId: aClerk,
      memberClerkId: bClerk,
      status: "accepted",
      role: "employee",
      invitedAt: new Date(),
      acceptedAt: new Date(),
    });
    expect(await hasAcceptedConnection(aAcct, bAcct)).toBe(true);
  });

  it("returns true when an accepted user_team_members row exists in the reverse direction (symmetric)", async () => {
    // bClerk is the lead, aClerk is the member — caller still passes
    // (aAcct, bAcct) and expects the gate to open.
    await db.insert(userTeamMembersTable).values({
      leadClerkId: bClerk,
      memberClerkId: aClerk,
      status: "accepted",
      role: "employee",
      invitedAt: new Date(),
      acceptedAt: new Date(),
    });
    expect(await hasAcceptedConnection(aAcct, bAcct)).toBe(true);
    expect(await hasAcceptedConnection(bAcct, aAcct)).toBe(true);
  });

  it("returns false when only a pending user_team_members row exists", async () => {
    await db.insert(userTeamMembersTable).values({
      leadClerkId: aClerk,
      memberClerkId: bClerk,
      status: "pending",
      role: "employee",
      invitedAt: new Date(),
    });
    expect(await hasAcceptedConnection(aAcct, bAcct)).toBe(false);
    expect(await hasAcceptedConnection(bAcct, aAcct)).toBe(false);
  });

  it("returns false for a self-pair even when the owner is the same", async () => {
    // Two outward accounts owned by the same user — a self-thread is
    // handled upstream and must not be reported as an accepted
    // connection here, otherwise the messages route would treat any
    // owner who has a teammate row as messageable to themselves.
    const [secondaryRow] = await db
      .insert(outwardAccountsTable)
      .values({
        ownerClerkId: aClerk,
        kind: "facilities",
        title: `${tag}-a-secondary`,
      })
      .returning({ id: outwardAccountsTable.id });
    try {
      await db.insert(userTeamMembersTable).values({
        leadClerkId: aClerk,
        memberClerkId: bClerk,
        status: "accepted",
        role: "employee",
        invitedAt: new Date(),
        acceptedAt: new Date(),
      });
      expect(await hasAcceptedConnection(aAcct, secondaryRow.id)).toBe(false);
    } finally {
      await db
        .delete(outwardAccountsTable)
        .where(eq(outwardAccountsTable.id, secondaryRow.id));
    }
  });
});

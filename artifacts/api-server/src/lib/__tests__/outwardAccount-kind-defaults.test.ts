/**
 * Task #674 — pin the per-kind `last_initial_only` default that every
 * `outward_accounts` insert path must apply via
 * `applyOutwardAccountKindDefaults`.
 *
 * The taxonomy is owner-facing kinds (`trade_pro`, `home`, `facilities`)
 * default OFF, while teammate / collab variants default ON so a
 * teammate or collaborator skin never accidentally publishes the
 * helper's full last name. The catch is that the codebase doesn't yet
 * have a production handler that creates a teammate-kind OA — those
 * paths land later (team-seat acceptance, collab invite, etc.). To
 * keep the contract honest in the meantime, the centralised
 * insert-default helper is itself the production code path: every
 * existing insert site already routes through it (see
 * `routes/outward-accounts.ts`, `lib/outwardAccounts.ts`,
 * `routes/admin-demo-profiles.ts`), and any future insertion site is
 * expected to do the same. This test inserts a teammate-kind row using
 * exactly that helper and asserts the resulting row has
 * `last_initial_only = true`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";

const { db, outwardAccountsTable, usersTable } = await import("@workspace/db");
const {
  applyOutwardAccountKindDefaults,
  defaultLastInitialOnlyForKind,
} = await import("../ownerNameDisplay");

const tag = `t674-${Date.now()}`;
const ownerClerk = `${tag}-owner`;

beforeAll(async () => {
  await db.insert(usersTable).values({
    clerkId: ownerClerk,
    email: `${tag}@example.test`,
    name: "Owner Person",
    username: `owner_${tag}`,
  });
});

afterAll(async () => {
  await db
    .delete(outwardAccountsTable)
    .where(eq(outwardAccountsTable.ownerClerkId, ownerClerk));
  await db
    .delete(usersTable)
    .where(inArray(usersTable.clerkId, [ownerClerk]));
});

describe("defaultLastInitialOnlyForKind", () => {
  it("returns true for every teammate / collab variant kind", () => {
    expect(defaultLastInitialOnlyForKind("home_teammate")).toBe(true);
    expect(defaultLastInitialOnlyForKind("trade_pro_teammate")).toBe(true);
    expect(defaultLastInitialOnlyForKind("facilities_teammate")).toBe(true);
    expect(defaultLastInitialOnlyForKind("trade_pro_collab")).toBe(true);
    expect(defaultLastInitialOnlyForKind("facilities_collab")).toBe(true);
  });

  it("returns false for every owner-facing business kind and the bare collab baseline", () => {
    expect(defaultLastInitialOnlyForKind("trade_pro")).toBe(false);
    expect(defaultLastInitialOnlyForKind("home")).toBe(false);
    expect(defaultLastInitialOnlyForKind("facilities")).toBe(false);
    // The bare `collab` baseline is the universal-friend skin, not a
    // teammate variant — it should keep the default OFF so the
    // owner's full name still surfaces unless they opt in.
    expect(defaultLastInitialOnlyForKind("collab")).toBe(false);
  });
});

describe("applyOutwardAccountKindDefaults", () => {
  it("fills in the per-kind ON default when no lastInitialOnly is provided", () => {
    const out = applyOutwardAccountKindDefaults({
      ownerClerkId: ownerClerk,
      kind: "trade_pro_teammate",
      title: "T",
      displayName: "T",
    });
    expect(out.lastInitialOnly).toBe(true);
  });

  it("preserves an explicit caller override (true wins, false wins)", () => {
    const onTrue = applyOutwardAccountKindDefaults({
      ownerClerkId: ownerClerk,
      kind: "trade_pro",
      lastInitialOnly: true,
    });
    expect(onTrue.lastInitialOnly).toBe(true);
    const onFalse = applyOutwardAccountKindDefaults({
      ownerClerkId: ownerClerk,
      kind: "facilities_teammate",
      lastInitialOnly: false,
    });
    expect(onFalse.lastInitialOnly).toBe(false);
  });

  it("falls back to the per-kind default when an out-of-band non-boolean slips through", () => {
    // Mirror what a malformed PATCH/POST body could shape into the
    // helper if upstream validation ever drifts: undefined, null, and
    // any non-boolean must NOT be trusted as "off".
    const out = applyOutwardAccountKindDefaults({
      ownerClerkId: ownerClerk,
      kind: "trade_pro_collab",
      // @ts-expect-error — exercising the runtime fallback path
      lastInitialOnly: "true",
    });
    expect(out.lastInitialOnly).toBe(true);
  });
});

describe("teammate-kind insert via the production helper (#674)", () => {
  it("persists last_initial_only=true when a teammate-kind OA is created through applyOutwardAccountKindDefaults", async () => {
    // This mirrors how a future team-seat acceptance / collab invite
    // acceptance handler is expected to create the OA: build the
    // insert payload, route it through the centralised helper, then
    // hand it to `db.insert(outwardAccountsTable).values(...)`.
    const [created] = await db
      .insert(outwardAccountsTable)
      .values(
        applyOutwardAccountKindDefaults({
          ownerClerkId: ownerClerk,
          kind: "trade_pro_teammate",
          title: "Teammate Skin",
          displayName: "Teammate Skin",
          avatarUrl: null,
          bannerUrl: null,
          companyName: null,
          bio: null,
          sourceUserModeId: null,
        }),
      )
      .returning();
    expect(created).toBeDefined();
    expect(created.kind).toBe("trade_pro_teammate");
    expect(created.lastInitialOnly).toBe(true);

    // Re-read from the database to confirm the column landed as `true`
    // on the actual row (not just on the returning() projection).
    const [reread] = await db
      .select({ lastInitialOnly: outwardAccountsTable.lastInitialOnly })
      .from(outwardAccountsTable)
      .where(eq(outwardAccountsTable.id, created.id));
    expect(reread.lastInitialOnly).toBe(true);
  });
});

/**
 * Task #677 — sync correctness for the denormalized `users.is_demo`
 * mirror of `admin_demo_profiles`.
 *
 * Public discovery endpoints used to gate the demo filter via a
 * per-row `NOT EXISTS` subquery against `admin_demo_profiles`. As
 * Wardrobe demo usage scales that became expensive, so the filter
 * was switched to read the denormalized `users.is_demo` boolean
 * instead — but only if every write that toggles
 * admin_demo_profiles ALSO flips users.is_demo, transactionally.
 *
 * The shared write helpers (`insertAdminDemoProfile`,
 * `deleteAdminDemoProfileById`) are the single supported write path
 * for that flip. This test pins down their contract:
 *
 *   1. INSERT helper sets `users.is_demo = true` on the matching
 *      users row in the same transaction it inserts the
 *      admin_demo_profiles row.
 *   2. DELETE helper clears `users.is_demo = false` on the matching
 *      users row in the same transaction it deletes the
 *      admin_demo_profiles row.
 *   3. The read helpers (`isAdminDemoClerkId`,
 *      `getAdminDemoClerkIds`) read the denormalized column, so the
 *      sync is observable end-to-end.
 *   4. The discovery filter helpers (`notDemoUserPredicate`,
 *      `excludeDemoUsersWhere`) hide rows whose `users.is_demo` is
 *      true and surface them again once it is cleared.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

const { db, usersTable, adminDemoProfilesTable } = await import(
  "@workspace/db"
);
const {
  insertAdminDemoProfile,
  deleteAdminDemoProfileById,
  isAdminDemoClerkId,
  getAdminDemoClerkIds,
  notDemoUserPredicate,
  excludeDemoUsersWhere,
} = await import("../adminDemo");

const tag = `t677-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
const adminClerk = `${tag}-admin`;
const demoClerk = `${tag}-demo`;
const liveClerk = `${tag}-live`;

beforeAll(async () => {
  await db.insert(usersTable).values([
    {
      clerkId: adminClerk,
      email: `${tag}-admin@example.test`,
      name: "Admin",
      username: `admin_${tag}`,
      isAdmin: true,
    },
    {
      clerkId: demoClerk,
      email: `${tag}-demo@example.test`,
      name: "Demo Persona",
      username: `demo_${tag}`,
    },
    {
      clerkId: liveClerk,
      email: `${tag}-live@example.test`,
      name: "Live Person",
      username: `live_${tag}`,
    },
  ]);
});

afterAll(async () => {
  const clerks = [adminClerk, demoClerk, liveClerk];
  await db
    .delete(adminDemoProfilesTable)
    .where(inArray(adminDemoProfilesTable.demoClerkId, clerks));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, clerks));
});

async function readIsDemo(clerkId: string): Promise<boolean | null> {
  const [row] = await db
    .select({ isDemo: usersTable.isDemo })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId));
  return row?.isDemo ?? null;
}

describe("admin demo profile <-> users.is_demo sync (#677)", () => {
  it("starts with users.is_demo = false for every freshly-seeded user", async () => {
    expect(await readIsDemo(demoClerk)).toBe(false);
    expect(await readIsDemo(liveClerk)).toBe(false);
    expect(await isAdminDemoClerkId(demoClerk)).toBe(false);
    expect(await isAdminDemoClerkId(liveClerk)).toBe(false);
  });

  it("insertAdminDemoProfile sets users.is_demo = true on the matching users row", async () => {
    const row = await insertAdminDemoProfile({
      adminClerkId: adminClerk,
      demoClerkId: demoClerk,
      roleKind: "trade_pro",
      displayName: "Demo Persona",
    });
    expect(row.demoClerkId).toBe(demoClerk);
    expect(await readIsDemo(demoClerk)).toBe(true);
    expect(await readIsDemo(liveClerk)).toBe(false);

    // Read-side helpers see the same answer, so any caller that
    // routes through them stays consistent with the discovery
    // filter (which also reads users.is_demo).
    expect(await isAdminDemoClerkId(demoClerk)).toBe(true);
    expect(await isAdminDemoClerkId(liveClerk)).toBe(false);
    const set = await getAdminDemoClerkIds([demoClerk, liveClerk, adminClerk]);
    expect(set.has(demoClerk)).toBe(true);
    expect(set.has(liveClerk)).toBe(false);
    expect(set.has(adminClerk)).toBe(false);
  });

  it("notDemoUserPredicate hides demo users and surfaces non-demo users", async () => {
    const visible = await db
      .select({ clerkId: usersTable.clerkId })
      .from(usersTable)
      .where(
        and(
          inArray(usersTable.clerkId, [adminClerk, demoClerk, liveClerk]),
          notDemoUserPredicate(),
        ),
      );
    const ids = visible.map((r) => r.clerkId);
    expect(ids).toContain(adminClerk);
    expect(ids).toContain(liveClerk);
    expect(ids).not.toContain(demoClerk);
  });

  it("excludeDemoUsersWhere(foreignClerkIdColumn) hides rows whose foreign clerk id is a demo user", async () => {
    // Use `users.clerk_id` as the "foreign" column so we can prove
    // the helper is keyed on the column value, not on the column's
    // table. The helper emits a NOT EXISTS against users.is_demo.
    const visible = await db
      .select({ clerkId: usersTable.clerkId })
      .from(usersTable)
      .where(
        and(
          inArray(usersTable.clerkId, [adminClerk, demoClerk, liveClerk]),
          excludeDemoUsersWhere(usersTable.clerkId),
        ),
      );
    const ids = visible.map((r) => r.clerkId);
    expect(ids).toContain(adminClerk);
    expect(ids).toContain(liveClerk);
    expect(ids).not.toContain(demoClerk);
  });

  it("deleteAdminDemoProfileById clears users.is_demo back to false on the matching users row", async () => {
    const [row] = await db
      .select()
      .from(adminDemoProfilesTable)
      .where(eq(adminDemoProfilesTable.demoClerkId, demoClerk));
    expect(row).toBeTruthy();
    const deleted = await deleteAdminDemoProfileById(row.id);
    expect(deleted?.id).toBe(row.id);

    expect(await readIsDemo(demoClerk)).toBe(false);
    expect(await isAdminDemoClerkId(demoClerk)).toBe(false);

    // The user is no longer hidden by the discovery filter.
    const visible = await db
      .select({ clerkId: usersTable.clerkId })
      .from(usersTable)
      .where(
        and(
          inArray(usersTable.clerkId, [adminClerk, demoClerk, liveClerk]),
          notDemoUserPredicate(),
        ),
      );
    const ids = visible.map((r) => r.clerkId);
    expect(ids).toContain(demoClerk);
  });

  it("deleteAdminDemoProfileById on a non-existent id is a no-op that returns null", async () => {
    const result = await deleteAdminDemoProfileById(-987654321);
    expect(result).toBeNull();
    // No rows changed.
    expect(await readIsDemo(demoClerk)).toBe(false);
    expect(await readIsDemo(liveClerk)).toBe(false);
  });
});

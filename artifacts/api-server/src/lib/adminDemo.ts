/**
 * Admin-demo provenance helpers.
 *
 * Demo avatars created from the admin Wardrobe go through the exact
 * same setup flow as real users — they own ordinary `users` rows,
 * `outward_accounts`, properties, and entities. The only distinction
 * is provenance: their clerk id appears in `admin_demo_profiles` AND
 * the matching `users` row carries `is_demo = true`.
 *
 * Single source of truth (#677): `users.is_demo` is the denormalized
 * mirror of "this user has a row in admin_demo_profiles". Both are
 * written together inside the same transaction by the helpers below
 * (`insertAdminDemoProfile` / `deleteAdminDemoProfileById`) so a
 * Wardrobe demo create/delete can never leave the two stores in
 * disagreement. Every "is this user a demo?" question — public
 * discovery filters, list serializers, single-row creation stamps —
 * reads `users.is_demo`. The boolean is covered by a partial index
 * (`users_is_demo_partial_idx`) so the foreign-clerk-id discovery
 * filter (`/area-feed`, `/deals/active`, `/success-stories/search`)
 * stays a tiny index lookup as the users table grows.
 *
 * These helpers answer the questions every surface needs:
 *   1. "Is THIS clerkId a demo profile?" — used at create-time to
 *      auto-stamp `is_admin_demo = true` on the row.
 *   2. "Which of THESE clerkIds are demo profiles?" — batched form for
 *      list/serializer paths so we can attach an `isDemo` flag onto
 *      each user/avatar in the response without N+1 queries.
 *   3. "Exclude any demo persona from THIS list query" — the SQL
 *      fragment used by every public discovery endpoint
 *      (`/users/search`, `/businesses/search`, `/pros/search`,
 *      `/area-feed`, `/success-stories/search`, `/deals/active`, …)
 *      so demo personas live in exactly one place and a new endpoint
 *      can opt in by importing one helper rather than re-deriving the
 *      filter itself. Two flavors are exported:
 *        - `notDemoUserPredicate()` — a column predicate
 *          (`users.is_demo = false`) for queries already joined on
 *          `users`. No subquery at all.
 *        - `excludeDemoUsersWhere(column)` — a `NOT EXISTS` against
 *          `users.is_demo` for queries that key on a foreign clerk
 *          id (`work_logs.assignee_clerk_id`, `deals.pro_clerk_id`)
 *          and don't have `users` in the join already.
 *   4. "Mark / unmark this user as a Wardrobe demo" — the only
 *      supported write paths (`insertAdminDemoProfile`,
 *      `deleteAdminDemoProfileById`). They wrap the
 *      `admin_demo_profiles` insert/delete and the matching
 *      `users.is_demo` flip in a single transaction so the two
 *      stores can never drift.
 */
import { and, eq, inArray, sql, type SQL, type AnyColumn } from "drizzle-orm";
import {
  db,
  adminDemoProfilesTable,
  usersTable,
  type AdminDemoProfile,
  type InsertAdminDemoProfile,
} from "@workspace/db";

/**
 * Returns true iff this clerkId belongs to a demo profile spawned from
 * the admin Wardrobe. Single-row lookup for create-time auto-flagging.
 *
 * Reads from `users.is_demo` (the denormalized mirror, kept in sync
 * by the write helpers in this file) so the lookup is a single
 * point query against the `users.clerk_id` unique index instead of a
 * scan over `admin_demo_profiles`.
 */
export async function isAdminDemoClerkId(clerkId: string): Promise<boolean> {
  if (!clerkId) return false;
  const rows = await db
    .select({ isDemo: usersTable.isDemo })
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkId))
    .limit(1);
  return rows.length > 0 && rows[0].isDemo === true;
}

/**
 * Returns the subset of `clerkIds` that are demo profiles. Use this in
 * any serializer that returns a list of users/avatars to attach an
 * `isDemo` flag without paying per-row query cost.
 *
 * Reads from `users.is_demo` so the lookup is bounded by `users` (one
 * indexed `IN`) rather than scanning `admin_demo_profiles`.
 */
export async function getAdminDemoClerkIds(
  clerkIds: string[],
): Promise<Set<string>> {
  const unique = Array.from(new Set(clerkIds.filter(Boolean)));
  if (unique.length === 0) return new Set();
  const rows = await db
    .select({ clerkId: usersTable.clerkId })
    .from(usersTable)
    .where(
      and(inArray(usersTable.clerkId, unique), eq(usersTable.isDemo, true)),
    );
  return new Set(rows.map((r) => r.clerkId));
}

/**
 * Column predicate (`users.is_demo = false`) for any discovery query
 * that already has `users` in its FROM/JOIN. Prefer this over
 * `excludeDemoUsersWhere(usersTable.clerkId)` so the planner can
 * filter on a column instead of running a subquery.
 *
 * Used by `/users/search`, `/businesses/search`, `/pros/search`.
 */
export function notDemoUserPredicate(): SQL {
  return sql`${usersTable.isDemo} = false`;
}

/**
 * SQL `WHERE` fragment that excludes any row whose `clerkIdColumn`
 * matches a demo persona. Use as part of `and(...)` on every public
 * discovery endpoint so demo avatars stay out of consumer-facing
 * lists. The rule lives here so a new discovery surface only has to
 * import this one helper instead of re-deriving its own anti-join.
 *
 * Implemented as a correlated `NOT EXISTS` against
 * `users.is_demo`, which is covered by a partial index
 * (`users_is_demo_partial_idx`) — the index only contains the demo
 * rows, so the lookup stays cheap even as the users table grows.
 *
 * Pass the column whose value is the *user* clerk id you want to
 * filter — usually a *foreign* clerk id like
 * `workLogsTable.assigneeClerkId`, `dealsTable.proClerkId`,
 * `userTeamMembersTable.memberClerkId`, or
 * `outwardAccountsTable.ownerClerkId`. When the calling query
 * already joins on `usersTable`, prefer `notDemoUserPredicate()`
 * instead — it's a plain column predicate with no subquery at all.
 *
 * #676 — Audit notes for surfaces that intentionally do NOT use this
 * helper, so a future contributor doesn't add the filter and break
 * the existing rule:
 *
 *   - `GET /users/username-available` — demo personas occupy real
 *     `usersTable.username` rows. If we hid them from the availability
 *     check, a real user could "claim" the same handle, then collide
 *     at INSERT time when the demo is wired up to a non-demo flow.
 *   - `GET /notifications` and the rest of the notifications router —
 *     owner-scoped to the caller's own inbox. Other users' identities
 *     aren't surfaced as direct fields; the actor is reachable only
 *     via a `relatedId` deep-link to a log/work-order the caller is
 *     already a member of, and demo personas aren't members of real
 *     properties/entities, so this path doesn't generate cross-user
 *     leakage in practice.
 *   - `GET /outward-accounts/:id/team` (the admin-side seat list) —
 *     visible only to the skin's owner / admin-permission seat-holders.
 *     New invites that name a demo persona are blocked at the POST,
 *     so the GET reflects only seats the admin themselves created.
 *   - `GET /work-orders/:workOrderId/comments`,
 *     `GET /entities/:id/messages` — gated by membership in the
 *     work order / entity. Demo personas can't be added to real
 *     properties or entities, so they can't author comments or
 *     messages on these surfaces.
 */
export function excludeDemoUsersWhere(clerkIdColumn: AnyColumn): SQL {
  // The inner `users` is aliased to `demo_users_lookup` so that
  // callers whose outer query is itself rooted on `users` (e.g. the
  // `/users/search` join graph) do not self-correlate the subquery
  // to the outer row. Without the alias, `users.clerk_id =
  // users.clerk_id` would refer to the same row inside the subquery
  // and the predicate would degenerate to "any demo exists",
  // hiding everyone whenever any demo exists at all.
  return sql`NOT EXISTS (SELECT 1 FROM ${usersTable} AS demo_users_lookup WHERE demo_users_lookup.clerk_id = ${clerkIdColumn} AND demo_users_lookup.is_demo = true)`;
}

/**
 * Insert a row into `admin_demo_profiles` AND set `users.is_demo = true`
 * on the matching `users` row, atomically. This is the single
 * supported write path for marking a user as a Wardrobe demo persona;
 * every discovery filter reads `users.is_demo`, so the two stores
 * MUST stay in lock-step. Wrapping both writes in a transaction
 * guarantees a partial failure can never surface a demo in public
 * lists.
 *
 * Returns the inserted `admin_demo_profiles` row.
 */
export async function insertAdminDemoProfile(
  values: InsertAdminDemoProfile,
): Promise<AdminDemoProfile> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(adminDemoProfilesTable)
      .values(values)
      .returning();
    await tx
      .update(usersTable)
      .set({ isDemo: true })
      .where(eq(usersTable.clerkId, row.demoClerkId));
    return row;
  });
}

/**
 * Delete a row from `admin_demo_profiles` by id AND clear
 * `users.is_demo` on the matching `users` row, atomically. Returns
 * the deleted `admin_demo_profiles` row, or `null` if no row matched.
 *
 * The clear is unconditional on success: if the user row still
 * exists (e.g. for a soft-cascade flow that keeps the user around
 * after un-marking it as a demo), it WILL be flipped back to a
 * regular discoverable account. If the broader cascade also deletes
 * the `users` row, the no-op `UPDATE` simply matches zero rows.
 */
export async function deleteAdminDemoProfileById(
  id: number,
): Promise<AdminDemoProfile | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .delete(adminDemoProfilesTable)
      .where(eq(adminDemoProfilesTable.id, id))
      .returning();
    if (!row) return null;
    await tx
      .update(usersTable)
      .set({ isDemo: false })
      .where(eq(usersTable.clerkId, row.demoClerkId));
    return row;
  });
}

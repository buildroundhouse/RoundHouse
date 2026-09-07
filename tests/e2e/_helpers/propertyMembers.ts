/**
 * Helpers for e2e specs that need to seed the entity_members rows that
 * back property membership after task #681 retired the legacy
 * `property_members` table.
 *
 * These mirror what `upsertPropertyMembership` (in the api-server)
 * does at runtime, but call into Postgres via `pg` directly so the
 * specs stay framework-free.
 */
import type { Client } from "pg";

type PgLike = {
  query: Client["query"];
};

/**
 * Look up (or lazily create) the entity_id that backs `propertyId`.
 * Mirrors the boot migration's per-property bootstrap so a property
 * inserted directly via raw SQL still gets a backing entity row.
 */
export async function ensureEntityIdForProperty(
  pg: PgLike,
  propertyId: number,
): Promise<number> {
  const link = await pg.query<{ entity_id: number }>(
    `SELECT entity_id FROM property_entity_links WHERE property_id = $1 LIMIT 1`,
    [propertyId],
  );
  if (link.rows.length > 0) return link.rows[0].entity_id;

  const prop = await pg.query<{
    name: string | null;
    type: string | null;
    owner_clerk_id: string;
    owner_outward_account_id: number | null;
    cover_color: string | null;
    cover_photo_url: string | null;
    is_admin_demo: boolean | null;
  }>(
    `SELECT name, type, owner_clerk_id, owner_outward_account_id,
            cover_color, cover_photo_url, is_admin_demo
       FROM properties WHERE id = $1`,
    [propertyId],
  );
  if (prop.rows.length === 0) {
    throw new Error(`ensureEntityIdForProperty: no properties row for id=${propertyId}`);
  }
  const p = prop.rows[0];
  const kind =
    p.type === "commercial" ? "commercial_property" : "residential_property";
  const ent = await pg.query<{ id: number }>(
    `INSERT INTO entities
       (kind, name, cover_color, cover_photo_url,
        controller_outward_account_id, controller_user_clerk_id,
        created_by_user_clerk_id, is_admin_demo)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7)
     RETURNING id`,
    [
      kind,
      p.name,
      p.cover_color,
      p.cover_photo_url,
      p.owner_outward_account_id ?? 0,
      p.owner_clerk_id,
      p.is_admin_demo ?? false,
    ],
  );
  const entityId = ent.rows[0].id;
  await pg.query(
    `INSERT INTO property_entity_links (property_id, entity_id)
     VALUES ($1, $2)
     ON CONFLICT (property_id) DO NOTHING`,
    [propertyId, entityId],
  );
  return entityId;
}

/**
 * Look up (or lazily create) the personal outward_account row for
 * `clerkId`. Tests that create users directly via raw SQL skip the
 * usual lazy-seed path the API uses, so we replay the bare minimum
 * here.
 */
export async function ensureOutwardAccountId(
  pg: PgLike,
  clerkId: string,
): Promise<number> {
  const existing = await pg.query<{ id: number }>(
    `SELECT id FROM outward_accounts
      WHERE owner_clerk_id = $1
      ORDER BY id ASC LIMIT 1`,
    [clerkId],
  );
  if (existing.rows.length > 0) return existing.rows[0].id;
  const created = await pg.query<{ id: number }>(
    `INSERT INTO outward_accounts (owner_clerk_id, kind, title)
     VALUES ($1, 'home', $1)
     RETURNING id`,
    [clerkId],
  );
  return created.rows[0].id;
}

export interface InsertPropertyMemberArgs {
  propertyId: number;
  userClerkId: string;
  role: "owner" | "admin" | "member";
  notifyJobStarted?: boolean | null;
  notifyJobCompleted?: boolean | null;
}

/**
 * The replacement for the legacy
 *   `INSERT INTO property_members (property_id, user_clerk_id, role)`
 * one-liner used by every e2e spec before task #681. Looks up the
 * backing entity (creating it if needed), looks up the user's
 * outward account (creating a personal one if needed), then writes
 * the row into `entity_members`.
 *
 * Maps the legacy `member` role → `worker`, matching the api-server's
 * own translation in `upsertPropertyMembership`.
 */
export async function insertPropertyMember(
  pg: PgLike,
  args: InsertPropertyMemberArgs,
): Promise<void> {
  const entityId = await ensureEntityIdForProperty(pg, args.propertyId);
  const outwardAccountId = await ensureOutwardAccountId(pg, args.userClerkId);
  const role =
    args.role === "owner" ? "owner" : args.role === "admin" ? "admin" : "worker";
  const permissions: Record<string, unknown> = {};
  if (args.notifyJobStarted !== undefined) {
    permissions.notifyJobStarted = args.notifyJobStarted;
  }
  if (args.notifyJobCompleted !== undefined) {
    permissions.notifyJobCompleted = args.notifyJobCompleted;
  }
  await pg.query(
    `INSERT INTO entity_members
       (entity_id, user_clerk_id, user_outward_account_id, role,
        status, direction, requested_by_outward_account_id,
        decided_at, permissions)
     VALUES ($1, $2, $3, $4, 'approved', 'invite', $3, now(), $5::jsonb)`,
    [entityId, args.userClerkId, outwardAccountId, role, JSON.stringify(permissions)],
  );
}

/**
 * Cascade cleanup for properties seeded by an e2e spec: delete the
 * entity_members rows tied to the property's backing entity, then
 * the entity, then the property_entity_links row. Safe to call
 * multiple times.
 */
export async function purgeEntityForProperty(
  pg: PgLike,
  propertyId: number,
): Promise<void> {
  const link = await pg.query<{ entity_id: number }>(
    `SELECT entity_id FROM property_entity_links WHERE property_id = $1 LIMIT 1`,
    [propertyId],
  );
  if (link.rows.length === 0) return;
  const entityId = link.rows[0].entity_id;
  await pg.query(`DELETE FROM entity_members WHERE entity_id = $1`, [entityId]);
  await pg.query(`DELETE FROM property_entity_links WHERE property_id = $1`, [
    propertyId,
  ]);
  await pg.query(`DELETE FROM entities WHERE id = $1`, [entityId]);
}

export interface PropertyNotifyPrefs {
  notifyJobStarted: boolean | null;
  notifyJobCompleted: boolean | null;
}

/**
 * Read the per-property notify_job_* prefs back out of `entity_members`
 * for the given owner across the given properties. Returns a Map keyed
 * by propertyId so call sites can keep using the same lookup pattern
 * they had with the legacy `property_members` table.
 */
export async function readPropertyNotifyPrefs(
  pg: PgLike,
  ownerClerkId: string,
  propertyIds: number[],
): Promise<Map<number, PropertyNotifyPrefs>> {
  if (propertyIds.length === 0) return new Map();
  const r = await pg.query<{
    property_id: number;
    permissions: EntityMemberPermissionsLike | null;
  }>(
    `SELECT pel.property_id AS property_id, em.permissions AS permissions
       FROM entity_members em
       JOIN property_entity_links pel ON pel.entity_id = em.entity_id
      WHERE em.user_clerk_id = $1
        AND pel.property_id = ANY($2::int[])`,
    [ownerClerkId, propertyIds],
  );
  return new Map(
    r.rows.map((row) => {
      const perms = row.permissions ?? {};
      return [
        row.property_id,
        {
          notifyJobStarted: perms.notifyJobStarted ?? null,
          notifyJobCompleted: perms.notifyJobCompleted ?? null,
        },
      ];
    }),
  );
}

interface EntityMemberPermissionsLike {
  notifyJobStarted?: boolean | null;
  notifyJobCompleted?: boolean | null;
}

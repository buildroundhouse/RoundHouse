/**
 * Task #663 — initial cutover: every `properties` row gets a matching
 * `entities` row, and every legacy `property_members` row gets a
 * matching `entity_members` row.
 *
 * Task #681 — finishing the cutover: this module is now the *only*
 * source of truth for property membership. The legacy
 * `property_members` table is mirrored once on boot (if any rows are
 * still present), verified to be fully represented in `entity_members`,
 * and then dropped. The defensive read fallback to `property_members`
 * has been removed; helpers read exclusively from `entity_members`
 * via the `property_entity_links` side table.
 *
 * The migration is keyed off a side table `property_entity_links`
 * (created here, not in the schema package, because it's a migration
 * artifact rather than a primary modeling concept).
 */
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import {
  db,
  entitiesTable,
  entityMembersTable,
  propertiesTable,
  type EntityKind,
  type EntityMember,
  type EntityMemberPermissions,
  type EntityMemberRole,
} from "@workspace/db";

/** Property type → entity kind. Conservative: defaults to residential. */
function entityKindForPropertyType(type: string): EntityKind {
  if (type === "commercial") return "commercial_property";
  return "residential_property";
}

/** Property-member role/classification → entity-member role. */
function entityRoleForPropertyMember(
  role: string | null | undefined,
  classification: string | null | undefined,
): EntityMemberRole {
  if (role === "owner") return "owner";
  if (role === "admin") return "admin";
  if (classification === "worker") return "worker";
  if (classification === "outside_service_provider") return "worker";
  if (classification === "collaborator") return "collaborator";
  // Default for legacy "member" / "vendor" / etc.
  return "worker";
}

/**
 * The shape every property route expects to read membership in. Matches
 * the legacy `property_members` row 1:1 so the cutover is invisible to
 * callers — `entity_members` rows are reshaped into this on read.
 */
export interface PropertyMembershipShape {
  id: number;
  propertyId: number;
  userClerkId: string;
  userOutwardAccountId: number | null;
  role: string;
  classification: string | null;
  connectionId: number | null;
  assignedByClerkId: string | null;
  invitedBy: string | null;
  tradeType: string | null;
  companyName: string | null;
  phone: string | null;
  licenseNumber: string | null;
  notes: string | null;
  notifyJobStarted: boolean | null;
  notifyJobCompleted: boolean | null;
  archivedAt: Date | null;
  createdAt: Date;
  firstVisitedAt: Date | null;
  welcomeDismissedAt: Date | null;
  messagesLastReadAt: Date | null;
}

function isoToDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateToIso(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

function entityRoleToPropertyRole(role: EntityMemberRole): string {
  return role === "owner" || role === "admin" ? role : "member";
}

/**
 * Reshape an `entity_members` row into the legacy `property_members`
 * shape so existing callers keep working unchanged. Property fields
 * preserved on `permissions` are unpacked back into top-level columns.
 */
function entityMemberToPropertyShape(
  propertyId: number,
  m: EntityMember,
): PropertyMembershipShape {
  const perms = (m.permissions ?? {}) as EntityMemberPermissions;
  return {
    id: m.id,
    propertyId,
    userClerkId: m.userClerkId,
    userOutwardAccountId: m.userOutwardAccountId ?? null,
    role: entityRoleToPropertyRole(m.role),
    classification: perms.classification ?? null,
    connectionId: perms.legacyConnectionId ?? null,
    assignedByClerkId: perms.assignedByClerkId ?? null,
    invitedBy: perms.invitedBy ?? null,
    tradeType: perms.tradeType ?? null,
    companyName: perms.companyName ?? null,
    phone: perms.phone ?? null,
    licenseNumber: perms.licenseNumber ?? null,
    notes: perms.notes ?? null,
    notifyJobStarted: perms.notifyJobStarted ?? null,
    notifyJobCompleted: perms.notifyJobCompleted ?? null,
    archivedAt: m.archivedAt ?? null,
    createdAt: m.createdAt,
    firstVisitedAt: isoToDate(perms.firstVisitedAt),
    welcomeDismissedAt: isoToDate(perms.welcomeDismissedAt),
    messagesLastReadAt: isoToDate(perms.messagesLastReadAt),
  };
}

/**
 * Build a `permissions` JSON payload from a `property_members` row's
 * full shape. Used both by the boot backfill and the route-side
 * upsert helpers so the entity_members mirror always carries the
 * full property-membership shape.
 */
function permissionsFromPropertyShape(p: {
  classification?: string | null;
  connectionId?: number | null;
  assignedByClerkId?: string | null;
  invitedBy?: string | null;
  tradeType?: string | null;
  companyName?: string | null;
  phone?: string | null;
  licenseNumber?: string | null;
  notes?: string | null;
  notifyJobStarted?: boolean | null;
  notifyJobCompleted?: boolean | null;
  firstVisitedAt?: Date | string | null;
  welcomeDismissedAt?: Date | string | null;
  messagesLastReadAt?: Date | string | null;
}): EntityMemberPermissions {
  return {
    classification: p.classification ?? null,
    legacyConnectionId: p.connectionId ?? null,
    assignedByClerkId: p.assignedByClerkId ?? null,
    invitedBy: p.invitedBy ?? null,
    tradeType: p.tradeType ?? null,
    companyName: p.companyName ?? null,
    phone: p.phone ?? null,
    licenseNumber: p.licenseNumber ?? null,
    notes: p.notes ?? null,
    notifyJobStarted: p.notifyJobStarted ?? null,
    notifyJobCompleted: p.notifyJobCompleted ?? null,
    firstVisitedAt:
      p.firstVisitedAt instanceof Date
        ? p.firstVisitedAt.toISOString()
        : (p.firstVisitedAt as string | null | undefined) ?? null,
    welcomeDismissedAt:
      p.welcomeDismissedAt instanceof Date
        ? p.welcomeDismissedAt.toISOString()
        : (p.welcomeDismissedAt as string | null | undefined) ?? null,
    messagesLastReadAt:
      p.messagesLastReadAt instanceof Date
        ? p.messagesLastReadAt.toISOString()
        : (p.messagesLastReadAt as string | null | undefined) ?? null,
  };
}

/**
 * Ensure the side table that maps properties → entities exists. We
 * keep it here rather than in the schema package so the link is
 * obviously a migration artifact and so we don't have to expose a new
 * Drizzle table to the rest of the app.
 */
async function ensurePropertyEntityLinkTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS property_entity_links (
      property_id integer PRIMARY KEY,
      entity_id integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS property_entity_links_entity_idx
      ON property_entity_links (entity_id);
  `);
}

/**
 * Returns true if a relation with the given name exists in the
 * current database. Used to handle the (post-cutover) world where
 * `property_members` has been dropped.
 */
async function tableExists(name: string): Promise<boolean> {
  const r = await db.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = ${name}
    ) AS exists
  `);
  return Boolean(r.rows[0]?.exists);
}

/** Legacy-shape row read out of the soon-to-be-dropped `property_members` table. */
interface LegacyPropertyMemberRow {
  id: number;
  propertyId: number;
  userClerkId: string;
  userOutwardAccountId: number | null;
  role: string;
  classification: string | null;
  connectionId: number | null;
  assignedByClerkId: string | null;
  invitedBy: string | null;
  tradeType: string | null;
  companyName: string | null;
  phone: string | null;
  licenseNumber: string | null;
  notes: string | null;
  notifyJobStarted: boolean | null;
  notifyJobCompleted: boolean | null;
  archivedAt: Date | null;
  createdAt: Date;
  firstVisitedAt: Date | null;
  welcomeDismissedAt: Date | null;
  messagesLastReadAt: Date | null;
}

type LegacyPropertyMemberRawRow = {
  id: number;
  property_id: number;
  user_clerk_id: string;
  user_outward_account_id: number | null;
  role: string;
  classification: string | null;
  connection_id: number | null;
  assigned_by_clerk_id: string | null;
  invited_by: string | null;
  trade_type: string | null;
  company_name: string | null;
  phone: string | null;
  license_number: string | null;
  notes: string | null;
  notify_job_started: boolean | null;
  notify_job_completed: boolean | null;
  archived_at: Date | null;
  created_at: Date;
  first_visited_at: Date | null;
  welcome_dismissed_at: Date | null;
  messages_last_read_at: Date | null;
} & Record<string, unknown>;

function legacyRowFromRaw(r: LegacyPropertyMemberRawRow): LegacyPropertyMemberRow {
  return {
    id: r.id,
    propertyId: r.property_id,
    userClerkId: r.user_clerk_id,
    userOutwardAccountId: r.user_outward_account_id,
    role: r.role,
    classification: r.classification,
    connectionId: r.connection_id,
    assignedByClerkId: r.assigned_by_clerk_id,
    invitedBy: r.invited_by,
    tradeType: r.trade_type,
    companyName: r.company_name,
    phone: r.phone,
    licenseNumber: r.license_number,
    notes: r.notes,
    notifyJobStarted: r.notify_job_started,
    notifyJobCompleted: r.notify_job_completed,
    archivedAt: r.archived_at,
    createdAt: r.created_at,
    firstVisitedAt: r.first_visited_at,
    welcomeDismissedAt: r.welcome_dismissed_at,
    messagesLastReadAt: r.messages_last_read_at,
  };
}

interface MigrateResult {
  entitiesCreated: number;
  membersCreated: number;
  membersUpdated: number;
  total: number;
  /** Number of legacy property_members rows still not represented on entity_members after the run. */
  legacyOrphanRows: number;
  /** True if the legacy property_members table was dropped during this run. */
  legacyTableDropped: boolean;
}

/**
 * Idempotent backfill: ensures every property has a matching entity,
 * and every legacy `property_members` row (if the table still exists)
 * has a matching `entity_members` row. After mirroring, verifies that
 * zero legacy rows remain unrepresented and drops the legacy table.
 *
 * Safe to re-run on every server boot. Once the legacy table is gone,
 * subsequent runs are a no-op except for backfilling entity links for
 * any new properties created since the last run.
 */
export async function migratePropertyEntities(): Promise<MigrateResult> {
  await ensurePropertyEntityLinkTable();

  let entitiesCreated = 0;
  let membersCreated = 0;
  let membersUpdated = 0;

  const properties = await db.select().from(propertiesTable);
  const legacyTableStillExists = await tableExists("property_members");

  for (const p of properties) {
    const { entityId, created } = await ensureEntityRowForPropertyRow(p);
    if (created) entitiesCreated += 1;

    // Ensure the controller has an owner membership row.
    if (p.ownerOutwardAccountId != null) {
      const [ownerMembership] = await db
        .select()
        .from(entityMembersTable)
        .where(
          and(
            eq(entityMembersTable.entityId, entityId),
            eq(entityMembersTable.userClerkId, p.ownerClerkId),
            eq(entityMembersTable.userOutwardAccountId, p.ownerOutwardAccountId),
          ),
        )
        .limit(1);
      if (!ownerMembership) {
        await db.insert(entityMembersTable).values({
          entityId,
          userClerkId: p.ownerClerkId,
          userOutwardAccountId: p.ownerOutwardAccountId,
          role: "owner",
          status: "approved",
          direction: "invite",
          requestedByOutwardAccountId: p.ownerOutwardAccountId,
          decidedAt: new Date(),
        });
        membersCreated += 1;
      }
    }

    if (!legacyTableStillExists) continue;

    // Mirror legacy property_members → entity_members.
    const propMembersRaw = await db.execute<LegacyPropertyMemberRawRow>(sql`
      SELECT * FROM property_members WHERE property_id = ${p.id}
    `);
    const propMembers = propMembersRaw.rows.map(legacyRowFromRaw);

    for (const pm of propMembers) {
      if (pm.userOutwardAccountId == null) continue;
      const [existingMember] = await db
        .select()
        .from(entityMembersTable)
        .where(
          and(
            eq(entityMembersTable.entityId, entityId),
            eq(entityMembersTable.userClerkId, pm.userClerkId),
            eq(
              entityMembersTable.userOutwardAccountId,
              pm.userOutwardAccountId,
            ),
          ),
        )
        .limit(1);
      const role = entityRoleForPropertyMember(pm.role, pm.classification);
      const permissions = permissionsFromPropertyShape(pm);
      if (!existingMember) {
        await db.insert(entityMembersTable).values({
          entityId,
          userClerkId: pm.userClerkId,
          userOutwardAccountId: pm.userOutwardAccountId,
          role,
          status: pm.archivedAt ? "removed" : "approved",
          direction: "invite",
          permissions,
          requestedByOutwardAccountId: pm.userOutwardAccountId,
          decidedAt: pm.createdAt ?? new Date(),
          archivedAt: pm.archivedAt ?? null,
        });
        membersCreated += 1;
      } else if (
        // Resync archived state (and refresh the full permissions
        // payload while we're here) so a re-run after a property_members
        // archive correctly reflects on the entity_members mirror.
        Boolean(existingMember.archivedAt) !== Boolean(pm.archivedAt)
      ) {
        await db
          .update(entityMembersTable)
          .set({
            archivedAt: pm.archivedAt ?? null,
            status: pm.archivedAt ? "removed" : existingMember.status,
            permissions: { ...existingMember.permissions, ...permissions },
          })
          .where(eq(entityMembersTable.id, existingMember.id));
        membersUpdated += 1;
      }
    }
  }

  // ---------------------------------------------------------------
  // Task #681 — verify the cutover is complete and retire the legacy
  // table. We refuse to drop it if any (propertyId, userClerkId,
  // userOutwardAccountId) triple exists on property_members but not
  // on entity_members — the operator can re-run after backfilling.
  // ---------------------------------------------------------------
  let legacyOrphanRows = 0;
  let legacyTableDropped = false;
  if (legacyTableStillExists) {
    const orphanCount = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM property_members pm
      LEFT JOIN property_entity_links pel ON pel.property_id = pm.property_id
      LEFT JOIN entity_members em
        ON em.entity_id = pel.entity_id
       AND em.user_clerk_id = pm.user_clerk_id
       AND (
         em.user_outward_account_id = pm.user_outward_account_id
         OR pm.user_outward_account_id IS NULL
       )
      WHERE em.id IS NULL
    `);
    legacyOrphanRows = orphanCount.rows[0]?.count ?? 0;
    if (legacyOrphanRows === 0) {
      await db.execute(sql`DROP TABLE IF EXISTS property_members`);
      legacyTableDropped = true;
    }
  }

  return {
    entitiesCreated,
    membersCreated,
    membersUpdated,
    total: properties.length,
    legacyOrphanRows,
    legacyTableDropped,
  };
}

/**
 * Per-property version of the boot loop's entity creation. Returns
 * the entityId for the property and whether a fresh `entities` row
 * was created. Used by `upsertPropertyMembership` to handle the case
 * where a brand-new property was just inserted at runtime and hasn't
 * been picked up by the boot migration yet.
 */
async function ensureEntityRowForPropertyRow(
  p: typeof propertiesTable.$inferSelect,
): Promise<{ entityId: number; created: boolean }> {
  const existing = await db.execute<{ entity_id: number }>(sql`
    SELECT entity_id FROM property_entity_links WHERE property_id = ${p.id} LIMIT 1
  `);
  const existingId = existing.rows[0]?.entity_id ?? null;
  if (existingId != null) return { entityId: existingId, created: false };

  const [entity] = await db
    .insert(entitiesTable)
    .values({
      kind: entityKindForPropertyType(p.type),
      name: p.name,
      coverColor: p.coverColor,
      coverPhotoUrl: p.coverPhotoUrl,
      controllerOutwardAccountId: p.ownerOutwardAccountId ?? 0,
      controllerUserClerkId: p.ownerClerkId,
      createdByUserClerkId: p.ownerClerkId,
      isAdminDemo: p.isAdminDemo,
    })
    .returning();

  await db.execute(sql`
    INSERT INTO property_entity_links (property_id, entity_id)
    VALUES (${p.id}, ${entity.id})
    ON CONFLICT (property_id) DO NOTHING
  `);
  return { entityId: entity.id, created: true };
}

/**
 * Public per-property bootstrap: returns the entityId for the
 * property, creating the `entities` row + `property_entity_links`
 * row if they don't yet exist. Returns null if no `properties` row
 * matches `propertyId`.
 */
export async function ensureEntityForProperty(
  propertyId: number,
): Promise<number | null> {
  await ensurePropertyEntityLinkTable();
  const [p] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId))
    .limit(1);
  if (!p) return null;
  const { entityId } = await ensureEntityRowForPropertyRow(p);
  return entityId;
}

/**
 * Returns true when a thrown DB error is "the property_entity_links
 * table doesn't exist yet" — happens in test environments where the
 * boot migration has never run.
 */
function isMissingLinksTable(err: unknown): boolean {
  let cur: unknown = err;
  while (cur) {
    const e = cur as { code?: string; message?: string; cause?: unknown };
    if (e.code === "42P01") return true;
    if (typeof e.message === "string" && /property_entity_links/i.test(e.message)) {
      if (/does not exist|undefined table|relation .* does not exist/i.test(e.message)) {
        return true;
      }
    }
    if (e.cause === cur) break;
    cur = e.cause;
  }
  return false;
}

/**
 * Look up the entity id for a property. Used by message routes and
 * any other code that needs to translate a propertyId into the
 * canonical entityId.
 */
export async function entityIdForProperty(
  propertyId: number,
): Promise<number | null> {
  try {
    const r = await db.execute<{ entity_id: number }>(sql`
      SELECT entity_id FROM property_entity_links WHERE property_id = ${propertyId} LIMIT 1
    `);
    return r.rows[0]?.entity_id ?? null;
  } catch (err) {
    if (isMissingLinksTable(err)) return null;
    throw err;
  }
}

/**
 * Reverse lookup: property id for an entity id (or null when the
 * entity isn't a property).
 */
export async function propertyIdForEntity(
  entityId: number,
): Promise<number | null> {
  try {
    const r = await db.execute<{ property_id: number }>(sql`
      SELECT property_id FROM property_entity_links WHERE entity_id = ${entityId} LIMIT 1
    `);
    return r.rows[0]?.property_id ?? null;
  } catch (err) {
    if (isMissingLinksTable(err)) return null;
    throw err;
  }
}

/**
 * Bulk variant of {@link entityIdForProperty}. Returns a Map keyed
 * by propertyId → entityId.
 */
export async function entityIdsForProperties(
  propertyIds: number[],
): Promise<Map<number, number>> {
  if (propertyIds.length === 0) return new Map();
  try {
    const r = await db.execute<{ property_id: number; entity_id: number }>(sql`
      SELECT property_id, entity_id FROM property_entity_links
      WHERE property_id = ANY(${sql.raw(`ARRAY[${propertyIds.join(",")}]::integer[]`)})
    `);
    return new Map(r.rows.map((row) => [row.property_id, row.entity_id]));
  } catch (err) {
    if (isMissingLinksTable(err)) return new Map();
    throw err;
  }
}

// ---------------------------------------------------------------------
// Task #664 / #681 — entity_members-backed property membership helpers.
//
// `entity_members` is now the only source of truth for property
// membership. The boot migration creates the entity link for every
// property and `upsertPropertyMembership` self-bootstraps for any
// property created after the last boot, so reads and writes always
// hit the same place.
// ---------------------------------------------------------------------

interface UpsertPropertyMembershipInput {
  propertyId: number;
  userClerkId: string;
  userOutwardAccountId: number;
  role?: "owner" | "admin" | "member";
  classification?: "worker" | "outside_service_provider" | "collaborator" | null;
  connectionId?: number | null;
  assignedByClerkId?: string | null;
  invitedBy?: string | null;
  tradeType?: string | null;
  companyName?: string | null;
  phone?: string | null;
  licenseNumber?: string | null;
  notes?: string | null;
  notifyJobStarted?: boolean | null;
  notifyJobCompleted?: boolean | null;
  firstVisitedAt?: Date | null;
  welcomeDismissedAt?: Date | null;
  messagesLastReadAt?: Date | null;
  archivedAt?: Date | null;
}

/**
 * Upsert the property's entity_members row for `(propertyId,
 * userClerkId)`. Handles both inserts (new memberships) and updates
 * (role flips, profile edits, archival toggles). Returns the resulting
 * row reshaped into the legacy `property_members` shape so callers can
 * continue using the same response payload.
 *
 * Self-bootstraps the entity + property_entity_links row for the
 * property if they don't yet exist (e.g. when called immediately after
 * the property row was inserted via `POST /api/properties`).
 *
 * Only the fields you pass in are touched. Existing values for fields
 * not in the input are preserved (think PATCH, not PUT).
 */
export async function upsertPropertyMembership(
  input: UpsertPropertyMembershipInput,
): Promise<PropertyMembershipShape | null> {
  const entityId = await ensureEntityForProperty(input.propertyId);
  if (entityId == null) return null;

  const [existing] = await db
    .select()
    .from(entityMembersTable)
    .where(
      and(
        eq(entityMembersTable.entityId, entityId),
        eq(entityMembersTable.userClerkId, input.userClerkId),
        eq(entityMembersTable.userOutwardAccountId, input.userOutwardAccountId),
      ),
    )
    .limit(1);

  // Build the next permissions payload by merging the existing JSON
  // with only the fields the caller explicitly set, so untouched
  // fields stay as they were (PATCH semantics).
  const prev = (existing?.permissions ?? {}) as EntityMemberPermissions;
  const nextPerms: EntityMemberPermissions = { ...prev };
  if (input.classification !== undefined) nextPerms.classification = input.classification;
  if (input.connectionId !== undefined) nextPerms.legacyConnectionId = input.connectionId;
  if (input.assignedByClerkId !== undefined) nextPerms.assignedByClerkId = input.assignedByClerkId;
  if (input.invitedBy !== undefined) nextPerms.invitedBy = input.invitedBy;
  if (input.tradeType !== undefined) nextPerms.tradeType = input.tradeType;
  if (input.companyName !== undefined) nextPerms.companyName = input.companyName;
  if (input.phone !== undefined) nextPerms.phone = input.phone;
  if (input.licenseNumber !== undefined) nextPerms.licenseNumber = input.licenseNumber;
  if (input.notes !== undefined) nextPerms.notes = input.notes;
  if (input.notifyJobStarted !== undefined) nextPerms.notifyJobStarted = input.notifyJobStarted;
  if (input.notifyJobCompleted !== undefined) nextPerms.notifyJobCompleted = input.notifyJobCompleted;
  if (input.firstVisitedAt !== undefined) nextPerms.firstVisitedAt = dateToIso(input.firstVisitedAt);
  if (input.welcomeDismissedAt !== undefined) nextPerms.welcomeDismissedAt = dateToIso(input.welcomeDismissedAt);
  if (input.messagesLastReadAt !== undefined) nextPerms.messagesLastReadAt = dateToIso(input.messagesLastReadAt);

  if (existing) {
    const role = input.role
      ? entityRoleForPropertyMember(input.role, nextPerms.classification)
      : existing.role;
    const archivedAt =
      input.archivedAt !== undefined ? input.archivedAt : existing.archivedAt;
    const status =
      input.archivedAt === null
        ? "approved"
        : archivedAt
          ? "removed"
          : existing.status;
    const [updated] = await db
      .update(entityMembersTable)
      .set({
        role,
        status,
        permissions: nextPerms,
        archivedAt,
      })
      .where(eq(entityMembersTable.id, existing.id))
      .returning();
    return entityMemberToPropertyShape(input.propertyId, updated);
  }

  const role = entityRoleForPropertyMember(
    input.role ?? "member",
    nextPerms.classification,
  );
  const [inserted] = await db
    .insert(entityMembersTable)
    .values({
      entityId,
      userClerkId: input.userClerkId,
      userOutwardAccountId: input.userOutwardAccountId,
      role,
      status: input.archivedAt ? "removed" : "approved",
      direction: "invite",
      permissions: nextPerms,
      requestedByOutwardAccountId: input.userOutwardAccountId,
      decidedAt: new Date(),
      archivedAt: input.archivedAt ?? null,
    })
    .returning();
  return entityMemberToPropertyShape(input.propertyId, inserted);
}

/**
 * Soft-archive the entity_members mirror for a single removed
 * membership. Mirrors the legacy `DELETE FROM property_members WHERE …`
 * step.
 */
export async function archiveEntityMemberForProperty(
  propertyId: number,
  userClerkId: string,
): Promise<void> {
  const entityId = await entityIdForProperty(propertyId);
  if (entityId == null) return;
  await db
    .update(entityMembersTable)
    .set({ status: "removed", archivedAt: new Date() })
    .where(
      and(
        eq(entityMembersTable.entityId, entityId),
        eq(entityMembersTable.userClerkId, userClerkId),
        isNull(entityMembersTable.archivedAt),
      ),
    );
}

/**
 * Soft-archive every entity_members row for a property that's been
 * hard-deleted. Mirrors the full
 * `DELETE FROM property_members WHERE property_id = ?` step.
 */
export async function archiveAllEntityMembersForProperty(
  propertyId: number,
): Promise<void> {
  const entityId = await entityIdForProperty(propertyId);
  if (entityId == null) return;
  await db
    .update(entityMembersTable)
    .set({ status: "removed", archivedAt: new Date() })
    .where(
      and(
        eq(entityMembersTable.entityId, entityId),
        isNull(entityMembersTable.archivedAt),
      ),
    );
}

/**
 * Hard-delete every `entity_members` row + the entity link + the
 * `entities` row for a property. Used by test fixtures during
 * `afterAll` cleanup so the property's membership rows don't leak
 * between test suites. Production code should use
 * `archiveAllEntityMembersForProperty` instead.
 */
export async function purgeEntityForProperty(
  propertyId: number,
): Promise<void> {
  const entityId = await entityIdForProperty(propertyId);
  if (entityId == null) return;
  await db
    .delete(entityMembersTable)
    .where(eq(entityMembersTable.entityId, entityId));
  await db.execute(sql`
    DELETE FROM property_entity_links WHERE property_id = ${propertyId}
  `);
  await db.delete(entitiesTable).where(eq(entitiesTable.id, entityId));
}

/**
 * Bulk variant of {@link purgeEntityForProperty}. Test helpers that
 * delete a batch of properties in `afterAll` use this so the entity
 * mirror gets cleaned up alongside the property rows.
 */
export async function purgeEntitiesForProperties(
  propertyIds: number[],
): Promise<void> {
  for (const id of propertyIds) {
    await purgeEntityForProperty(id);
  }
}

/**
 * Read every membership for a single property in legacy shape. Reads
 * straight from `entity_members` via the entity link — there is no
 * fallback to `property_members` (Task #681).
 */
export async function listMembersForProperty(
  propertyId: number,
): Promise<PropertyMembershipShape[]> {
  const entityId = await entityIdForProperty(propertyId);
  if (entityId == null) return [];
  const rows = await db
    .select()
    .from(entityMembersTable)
    .where(eq(entityMembersTable.entityId, entityId));
  return rows.map((r) => entityMemberToPropertyShape(propertyId, r));
}

/**
 * Read every membership a single user has across all properties.
 * Joins `entity_members` to `property_entity_links` to attach a
 * propertyId. Reads only `entity_members` (Task #681).
 */
export async function listMembershipsForUser(
  userClerkId: string,
  opts: { activeOutwardAccountId?: number | null } = {},
): Promise<PropertyMembershipShape[]> {
  type EntityRow = {
    em_id: number;
    em_role: EntityMemberRole;
    em_status: string;
    em_archived_at: Date | null;
    em_permissions: EntityMemberPermissions | null;
    em_user_outward_account_id: number;
    em_created_at: Date;
    property_id: number;
  };
  const skinClause =
    opts.activeOutwardAccountId != null
      ? sql`AND em.user_outward_account_id = ${opts.activeOutwardAccountId}`
      : sql``;
  let entityRows: EntityRow[] = [];
  try {
    const rows = await db.execute<EntityRow>(sql`
      SELECT
        em.id                       AS em_id,
        em.role                     AS em_role,
        em.status                   AS em_status,
        em.archived_at              AS em_archived_at,
        em.permissions              AS em_permissions,
        em.user_outward_account_id  AS em_user_outward_account_id,
        em.created_at               AS em_created_at,
        pel.property_id             AS property_id
      FROM property_entity_links pel
      JOIN entity_members em ON em.entity_id = pel.entity_id
      WHERE em.user_clerk_id = ${userClerkId}
      ${skinClause}
    `);
    entityRows = rows.rows;
  } catch (err) {
    if (!isMissingLinksTable(err)) throw err;
  }
  return entityRows.map((r) =>
    entityMemberToPropertyShape(r.property_id, {
      id: r.em_id,
      entityId: 0,
      userClerkId,
      userOutwardAccountId: r.em_user_outward_account_id,
      role: r.em_role,
      status: r.em_status as EntityMember["status"],
      direction: "invite",
      permissions: (r.em_permissions ?? {}) as EntityMemberPermissions,
      requestedByOutwardAccountId: null,
      createdAt: r.em_created_at,
      decidedAt: null,
      archivedAt: r.em_archived_at,
    }),
  );
}

/**
 * Single-membership read for a (propertyId, userClerkId) pair.
 * Reads only `entity_members` (Task #681).
 */
export async function getMembershipForProperty(
  propertyId: number,
  userClerkId: string,
  opts: { activeOutwardAccountId?: number | null } = {},
): Promise<PropertyMembershipShape | null> {
  const entityId = await entityIdForProperty(propertyId);
  if (entityId == null) return null;
  const conds = [
    eq(entityMembersTable.entityId, entityId),
    eq(entityMembersTable.userClerkId, userClerkId),
  ];
  if (opts.activeOutwardAccountId != null) {
    conds.push(
      eq(entityMembersTable.userOutwardAccountId, opts.activeOutwardAccountId),
    );
  }
  const [r] = await db
    .select()
    .from(entityMembersTable)
    .where(and(...conds))
    .limit(1);
  return r ? entityMemberToPropertyShape(propertyId, r) : null;
}

/**
 * Bulk: list memberships across many users for a single property.
 * Used by the work-order completion / due-date-change notifier code
 * that already has a list of recipient clerk ids.
 */
export async function listMembershipsForUsersOnProperty(
  propertyId: number,
  userClerkIds: string[],
): Promise<PropertyMembershipShape[]> {
  if (userClerkIds.length === 0) return [];
  const all = await listMembersForProperty(propertyId);
  const set = new Set(userClerkIds);
  return all.filter((m) => set.has(m.userClerkId));
}

// Re-export the legacy name as an alias so callers that imported
// the old dual-write helper keep compiling. It now writes only to
// entity_members; the property_members table is gone.
export { archiveEntityMemberForProperty as syncArchiveEntityMemberForProperty };

// `ne` and `or` are imported to widen the re-usable filter set.
void ne;
void or;

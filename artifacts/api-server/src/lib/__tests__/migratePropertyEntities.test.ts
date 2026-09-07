/**
 * Task #682 — focused coverage for the entity-backed property
 * membership helpers introduced by Task #664 and finalised by
 * Task #681 (legacy `property_members` table dropped).
 *
 * Routes only ever go through these helpers when they read or write
 * property membership; today they're indirectly exercised by route
 * tests, which makes regressions hard to localise. This file pins:
 *
 *   - upsertPropertyMembership: insert vs update, the PATCH-style
 *     permissions merge (untouched fields preserved), role flips,
 *     and the archivedAt → status flip in both directions. Also
 *     covers the self-bootstrap that creates the entity + link
 *     for a property that had none.
 *   - getMembershipForProperty / listMembersForProperty: read from
 *     entity_members exclusively.
 *   - listMembershipsForUser: union across all linked properties for
 *     a user, with the optional active-skin filter.
 *   - listMembershipsForUsersOnProperty: filters to the requested
 *     clerk ids only.
 *   - archiveEntityMemberForProperty: flips status=removed and
 *     stamps archivedAt on the matching entity_members row.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";

const {
  db,
  entitiesTable,
  entityMembersTable,
  outwardAccountsTable,
  propertiesTable,
  usersTable,
} = await import("@workspace/db");
const {
  archiveEntityMemberForProperty,
  getMembershipForProperty,
  listMembersForProperty,
  listMembershipsForUser,
  listMembershipsForUsersOnProperty,
  upsertPropertyMembership,
} = await import("../migratePropertyEntities");

const tag = `t682-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
const ownerClerk = `${tag}-owner`;
const memberClerk = `${tag}-member`;
const otherClerk = `${tag}-other`;
const allClerks = [ownerClerk, memberClerk, otherClerk];

let ownerAcct: number;
let memberAcct: number;
let otherAcct: number;
let propertyLinkedId: number;
let propertyBootstrapId: number;
let entityLinkedId: number;
const entityIdsToCleanup: number[] = [];

async function createOutwardAccount(clerk: string): Promise<number> {
  const [row] = await db
    .insert(outwardAccountsTable)
    .values({
      ownerClerkId: clerk,
      kind: "home",
      title: `${tag}-${clerk}-skin`,
      displayName: clerk,
    })
    .returning({ id: outwardAccountsTable.id });
  return row.id;
}

beforeAll(async () => {
  // Make sure the side table the migration helpers depend on exists,
  // even when the boot migration hasn't been run in this environment.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS property_entity_links (
      property_id integer PRIMARY KEY,
      entity_id integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS property_entity_links_entity_idx
      ON property_entity_links (entity_id);
  `);

  await db.insert(usersTable).values([
    {
      clerkId: ownerClerk,
      email: `${tag}-owner@example.test`,
      name: "Owner",
      username: `owner_${tag}`,
    },
    {
      clerkId: memberClerk,
      email: `${tag}-member@example.test`,
      name: "Member",
      username: `member_${tag}`,
    },
    {
      clerkId: otherClerk,
      email: `${tag}-other@example.test`,
      name: "Other",
      username: `other_${tag}`,
    },
  ]);

  ownerAcct = await createOutwardAccount(ownerClerk);
  memberAcct = await createOutwardAccount(memberClerk);
  otherAcct = await createOutwardAccount(otherClerk);

  // Property A: pre-linked to a hand-rolled entity row (the post-
  // migration shape that the helpers see for any property created
  // before the helper touches it).
  const [propA] = await db
    .insert(propertiesTable)
    .values({
      name: `${tag}-prop-linked`,
      address: "1 Linked Lane",
      type: "home",
      ownerClerkId: ownerClerk,
      ownerOutwardAccountId: ownerAcct,
    })
    .returning({ id: propertiesTable.id });
  propertyLinkedId = propA.id;

  const [entityA] = await db
    .insert(entitiesTable)
    .values({
      kind: "residential_property",
      name: `${tag}-entity-linked`,
      controllerOutwardAccountId: ownerAcct,
      controllerUserClerkId: ownerClerk,
      createdByUserClerkId: ownerClerk,
    })
    .returning({ id: entitiesTable.id });
  entityLinkedId = entityA.id;
  entityIdsToCleanup.push(entityA.id);

  await db.execute(sql`
    INSERT INTO property_entity_links (property_id, entity_id)
    VALUES (${propertyLinkedId}, ${entityLinkedId})
    ON CONFLICT (property_id) DO NOTHING
  `);

  // Property B: created without an entity link to exercise the
  // self-bootstrap path inside upsertPropertyMembership / the helpers.
  const [propB] = await db
    .insert(propertiesTable)
    .values({
      name: `${tag}-prop-bootstrap`,
      address: "2 Bootstrap Loop",
      type: "home",
      ownerClerkId: ownerClerk,
      ownerOutwardAccountId: ownerAcct,
    })
    .returning({ id: propertiesTable.id });
  propertyBootstrapId = propB.id;
});

afterAll(async () => {
  // Order matters: children before parents. Each step is guarded so a
  // failed beforeAll doesn't cascade into noisy afterAll errors that
  // hide the real failure.
  const propIds = [propertyLinkedId, propertyBootstrapId].filter(
    (id): id is number => typeof id === "number",
  );
  if (propIds.length > 0) {
    await db.execute(
      sql`DELETE FROM property_entity_links WHERE property_id = ANY(${sql.raw(
        `ARRAY[${propIds.join(",")}]::integer[]`,
      )})`,
    );
  }
  if (entityIdsToCleanup.length > 0) {
    await db
      .delete(entityMembersTable)
      .where(inArray(entityMembersTable.entityId, entityIdsToCleanup));
    await db
      .delete(entitiesTable)
      .where(inArray(entitiesTable.id, entityIdsToCleanup));
  }
  if (propIds.length > 0) {
    await db
      .delete(propertiesTable)
      .where(inArray(propertiesTable.id, propIds));
  }
  await db
    .delete(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.ownerClerkId, allClerks));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, allClerks));
});

async function clearMemberships() {
  // Delete every entity_members row tied to any link our test owns.
  // Bootstrapped entities (created by upsertPropertyMembership on
  // propertyBootstrapId) are tracked via the link table, so we can
  // discover them and wipe them between tests.
  const links = await db.execute<{ entity_id: number }>(sql`
    SELECT entity_id FROM property_entity_links
    WHERE property_id = ANY(${sql.raw(
      `ARRAY[${[propertyLinkedId, propertyBootstrapId].join(",")}]::integer[]`,
    )})
  `);
  const entityIds = links.rows.map((r) => r.entity_id);
  if (entityIds.length > 0) {
    await db
      .delete(entityMembersTable)
      .where(inArray(entityMembersTable.entityId, entityIds));
  }
}

describe("upsertPropertyMembership (#664/#682)", () => {
  it("creates a new entity_members row on first call and returns the legacy property-membership shape", async () => {
    await clearMemberships();
    const created = await upsertPropertyMembership({
      propertyId: propertyLinkedId,
      userClerkId: memberClerk,
      userOutwardAccountId: memberAcct,
      role: "member",
      classification: "worker",
      tradeType: "plumbing",
      companyName: "Acme Plumbing",
      phone: "555-0100",
      notifyJobStarted: true,
      notifyJobCompleted: false,
    });
    expect(created).not.toBeNull();
    expect(created?.propertyId).toBe(propertyLinkedId);
    expect(created?.userClerkId).toBe(memberClerk);
    expect(created?.userOutwardAccountId).toBe(memberAcct);
    expect(created?.classification).toBe("worker");
    expect(created?.tradeType).toBe("plumbing");
    expect(created?.companyName).toBe("Acme Plumbing");
    expect(created?.phone).toBe("555-0100");
    expect(created?.notifyJobStarted).toBe(true);
    expect(created?.notifyJobCompleted).toBe(false);
    expect(created?.archivedAt).toBeNull();

    // Confirm it really landed on entity_members.
    const rows = await db
      .select()
      .from(entityMembersTable)
      .where(
        and(
          eq(entityMembersTable.entityId, entityLinkedId),
          eq(entityMembersTable.userClerkId, memberClerk),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("approved");
    expect(rows[0].permissions?.classification).toBe("worker");
    expect(rows[0].permissions?.tradeType).toBe("plumbing");
  });

  it("updates an existing row in place and preserves untouched permission fields (PATCH semantics)", async () => {
    await clearMemberships();
    await upsertPropertyMembership({
      propertyId: propertyLinkedId,
      userClerkId: memberClerk,
      userOutwardAccountId: memberAcct,
      role: "member",
      classification: "worker",
      tradeType: "plumbing",
      companyName: "Acme Plumbing",
      notes: "first note",
      notifyJobStarted: true,
    });
    const updated = await upsertPropertyMembership({
      propertyId: propertyLinkedId,
      userClerkId: memberClerk,
      userOutwardAccountId: memberAcct,
      // Only touch phone — every other field must be preserved.
      phone: "555-0200",
    });
    expect(updated).not.toBeNull();
    expect(updated?.phone).toBe("555-0200");
    expect(updated?.tradeType).toBe("plumbing");
    expect(updated?.companyName).toBe("Acme Plumbing");
    expect(updated?.notes).toBe("first note");
    expect(updated?.classification).toBe("worker");
    expect(updated?.notifyJobStarted).toBe(true);

    // Still exactly one entity_members row — we updated, not duplicated.
    const rows = await db
      .select()
      .from(entityMembersTable)
      .where(
        and(
          eq(entityMembersTable.entityId, entityLinkedId),
          eq(entityMembersTable.userClerkId, memberClerk),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("flips role on update and recomputes the entity-members role from the new role", async () => {
    await clearMemberships();
    await upsertPropertyMembership({
      propertyId: propertyLinkedId,
      userClerkId: memberClerk,
      userOutwardAccountId: memberAcct,
      role: "member",
      classification: "worker",
    });
    const promoted = await upsertPropertyMembership({
      propertyId: propertyLinkedId,
      userClerkId: memberClerk,
      userOutwardAccountId: memberAcct,
      role: "admin",
    });
    expect(promoted?.role).toBe("admin");
    const [row] = await db
      .select()
      .from(entityMembersTable)
      .where(
        and(
          eq(entityMembersTable.entityId, entityLinkedId),
          eq(entityMembersTable.userClerkId, memberClerk),
        ),
      );
    expect(row.role).toBe("admin");
  });

  it("setting archivedAt flips status to removed; clearing it flips status back to approved", async () => {
    await clearMemberships();
    await upsertPropertyMembership({
      propertyId: propertyLinkedId,
      userClerkId: memberClerk,
      userOutwardAccountId: memberAcct,
      role: "member",
    });
    const archived = await upsertPropertyMembership({
      propertyId: propertyLinkedId,
      userClerkId: memberClerk,
      userOutwardAccountId: memberAcct,
      archivedAt: new Date(),
    });
    expect(archived?.archivedAt).not.toBeNull();
    let [row] = await db
      .select()
      .from(entityMembersTable)
      .where(
        and(
          eq(entityMembersTable.entityId, entityLinkedId),
          eq(entityMembersTable.userClerkId, memberClerk),
        ),
      );
    expect(row.status).toBe("removed");
    expect(row.archivedAt).not.toBeNull();

    const restored = await upsertPropertyMembership({
      propertyId: propertyLinkedId,
      userClerkId: memberClerk,
      userOutwardAccountId: memberAcct,
      archivedAt: null,
    });
    expect(restored?.archivedAt).toBeNull();
    [row] = await db
      .select()
      .from(entityMembersTable)
      .where(
        and(
          eq(entityMembersTable.entityId, entityLinkedId),
          eq(entityMembersTable.userClerkId, memberClerk),
        ),
      );
    expect(row.status).toBe("approved");
    expect(row.archivedAt).toBeNull();
  });

  it("self-bootstraps the entity + link for a property that had none", async () => {
    await clearMemberships();
    const created = await upsertPropertyMembership({
      propertyId: propertyBootstrapId,
      userClerkId: memberClerk,
      userOutwardAccountId: memberAcct,
      role: "member",
    });
    expect(created).not.toBeNull();

    // The link must now exist for that property.
    const linkRows = await db.execute<{ entity_id: number }>(sql`
      SELECT entity_id FROM property_entity_links
      WHERE property_id = ${propertyBootstrapId}
    `);
    expect(linkRows.rows).toHaveLength(1);
    const bootstrappedEntityId = linkRows.rows[0].entity_id;
    if (!entityIdsToCleanup.includes(bootstrappedEntityId)) {
      entityIdsToCleanup.push(bootstrappedEntityId);
    }

    // …and the entity_members row must live on that bootstrapped entity.
    const memberRows = await db
      .select()
      .from(entityMembersTable)
      .where(
        and(
          eq(entityMembersTable.entityId, bootstrappedEntityId),
          eq(entityMembersTable.userClerkId, memberClerk),
        ),
      );
    expect(memberRows).toHaveLength(1);
  });
});

describe("getMembershipForProperty (#664/#682)", () => {
  it("reads from entity_members for a property with an existing link", async () => {
    await clearMemberships();
    await upsertPropertyMembership({
      propertyId: propertyLinkedId,
      userClerkId: memberClerk,
      userOutwardAccountId: memberAcct,
      role: "member",
      classification: "worker",
      tradeType: "electrical",
    });
    const got = await getMembershipForProperty(propertyLinkedId, memberClerk);
    expect(got).not.toBeNull();
    expect(got?.tradeType).toBe("electrical");
    expect(got?.classification).toBe("worker");
  });

  it("returns null when the property has no entity_members row for that user", async () => {
    await clearMemberships();
    const got = await getMembershipForProperty(propertyLinkedId, memberClerk);
    expect(got).toBeNull();
  });
});

describe("listMembersForProperty (#664/#682)", () => {
  it("returns every entity_members row for the property's entity", async () => {
    await clearMemberships();
    await upsertPropertyMembership({
      propertyId: propertyLinkedId,
      userClerkId: memberClerk,
      userOutwardAccountId: memberAcct,
      role: "member",
      classification: "worker",
    });
    await upsertPropertyMembership({
      propertyId: propertyLinkedId,
      userClerkId: otherClerk,
      userOutwardAccountId: otherAcct,
      role: "member",
      classification: "collaborator",
    });
    const list = await listMembersForProperty(propertyLinkedId);
    const byClerk = new Map(list.map((m) => [m.userClerkId, m]));
    expect(byClerk.get(memberClerk)?.classification).toBe("worker");
    expect(byClerk.get(otherClerk)?.classification).toBe("collaborator");
    expect(list).toHaveLength(2);
  });
});

describe("archiveEntityMemberForProperty (#664/#682)", () => {
  it("sets status=removed and stamps archivedAt on the matching entity_members row", async () => {
    await clearMemberships();
    await upsertPropertyMembership({
      propertyId: propertyLinkedId,
      userClerkId: memberClerk,
      userOutwardAccountId: memberAcct,
      role: "member",
    });
    await archiveEntityMemberForProperty(propertyLinkedId, memberClerk);
    const [row] = await db
      .select()
      .from(entityMembersTable)
      .where(
        and(
          eq(entityMembersTable.entityId, entityLinkedId),
          eq(entityMembersTable.userClerkId, memberClerk),
        ),
      );
    expect(row.status).toBe("removed");
    expect(row.archivedAt).not.toBeNull();
  });

  it("ignores rows that are already archived", async () => {
    await clearMemberships();
    await upsertPropertyMembership({
      propertyId: propertyLinkedId,
      userClerkId: memberClerk,
      userOutwardAccountId: memberAcct,
      role: "member",
    });
    await archiveEntityMemberForProperty(propertyLinkedId, memberClerk);
    const [first] = await db
      .select()
      .from(entityMembersTable)
      .where(
        and(
          eq(entityMembersTable.entityId, entityLinkedId),
          eq(entityMembersTable.userClerkId, memberClerk),
        ),
      );
    const firstArchivedAt = first.archivedAt!;
    // Re-archiving must not bump the timestamp because the WHERE
    // clause filters to archivedAt IS NULL.
    await archiveEntityMemberForProperty(propertyLinkedId, memberClerk);
    const [second] = await db
      .select()
      .from(entityMembersTable)
      .where(
        and(
          eq(entityMembersTable.entityId, entityLinkedId),
          eq(entityMembersTable.userClerkId, memberClerk),
        ),
      );
    expect(second.archivedAt?.getTime()).toBe(firstArchivedAt.getTime());
  });
});

describe("listMembershipsForUser (#664/#682)", () => {
  it("returns one row per linked property where the user is a member", async () => {
    await clearMemberships();
    await upsertPropertyMembership({
      propertyId: propertyLinkedId,
      userClerkId: memberClerk,
      userOutwardAccountId: memberAcct,
      role: "member",
      classification: "worker",
      tradeType: "linked-trade",
    });
    await upsertPropertyMembership({
      propertyId: propertyBootstrapId,
      userClerkId: memberClerk,
      userOutwardAccountId: memberAcct,
      role: "member",
      classification: "collaborator",
      tradeType: "bootstrap-trade",
    });
    // Track the bootstrapped entity for cleanup.
    const linkRow = await db.execute<{ entity_id: number }>(sql`
      SELECT entity_id FROM property_entity_links WHERE property_id = ${propertyBootstrapId}
    `);
    const bootstrappedEntityId = linkRow.rows[0]?.entity_id;
    if (
      bootstrappedEntityId != null &&
      !entityIdsToCleanup.includes(bootstrappedEntityId)
    ) {
      entityIdsToCleanup.push(bootstrappedEntityId);
    }

    const list = await listMembershipsForUser(memberClerk);
    const byProp = new Map(list.map((m) => [m.propertyId, m]));
    expect(byProp.get(propertyLinkedId)?.tradeType).toBe("linked-trade");
    expect(byProp.get(propertyBootstrapId)?.tradeType).toBe("bootstrap-trade");
  });

  it("filters to a specific outward account when activeOutwardAccountId is provided", async () => {
    await clearMemberships();
    await upsertPropertyMembership({
      propertyId: propertyLinkedId,
      userClerkId: memberClerk,
      userOutwardAccountId: memberAcct,
      role: "member",
    });
    const matched = await listMembershipsForUser(memberClerk, {
      activeOutwardAccountId: memberAcct,
    });
    expect(matched.map((m) => m.propertyId)).toContain(propertyLinkedId);
    const skipped = await listMembershipsForUser(memberClerk, {
      activeOutwardAccountId: otherAcct,
    });
    expect(skipped.find((m) => m.propertyId === propertyLinkedId)).toBeUndefined();
  });
});

describe("listMembershipsForUsersOnProperty (#664/#682)", () => {
  it("filters the property's full member list down to the requested clerk ids", async () => {
    await clearMemberships();
    await upsertPropertyMembership({
      propertyId: propertyLinkedId,
      userClerkId: memberClerk,
      userOutwardAccountId: memberAcct,
      role: "member",
    });
    await upsertPropertyMembership({
      propertyId: propertyLinkedId,
      userClerkId: otherClerk,
      userOutwardAccountId: otherAcct,
      role: "member",
    });
    const filtered = await listMembershipsForUsersOnProperty(
      propertyLinkedId,
      [memberClerk],
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].userClerkId).toBe(memberClerk);
  });

  it("returns an empty array when given no clerk ids", async () => {
    await clearMemberships();
    await upsertPropertyMembership({
      propertyId: propertyLinkedId,
      userClerkId: memberClerk,
      userOutwardAccountId: memberAcct,
      role: "member",
    });
    const out = await listMembershipsForUsersOnProperty(propertyLinkedId, []);
    expect(out).toEqual([]);
  });

  it("returns an empty array when none of the requested clerk ids are on the property", async () => {
    await clearMemberships();
    await upsertPropertyMembership({
      propertyId: propertyLinkedId,
      userClerkId: memberClerk,
      userOutwardAccountId: memberAcct,
      role: "member",
    });
    const out = await listMembershipsForUsersOnProperty(propertyLinkedId, [
      `${tag}-nobody`,
    ]);
    expect(out).toEqual([]);
  });
});

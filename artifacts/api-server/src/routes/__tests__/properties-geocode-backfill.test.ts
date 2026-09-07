/**
 * End-to-end test for the "Find on map" backfill banner on the property screen.
 *
 * Covers task #194: "Test the 'Find on map' backfill end-to-end".
 *
 * What this test exercises:
 *   - POST /api/properties/:propertyId/geocode persists placeId/lat/lng on a
 *     property that has an address but no map coordinates yet (this is the
 *     "tap the banner" path on a legacy property).
 *   - After backfill, the property the client refetches contains the new
 *     placeId/lat/lng — which is exactly what flips `needsMapBackfill` to
 *     false on the client and hides the banner.
 *   - A property that already has placeId/lat/lng does NOT trigger the
 *     banner: `needsMapBackfill` is false and the row is left alone server-
 *     side.
 *   - POST /api/properties/:propertyId/geocode is a no-op when the property
 *     already has place data — the existing placeId/lat/lng survive even when
 *     a different value is posted (defense against accidentally clobbering a
 *     manually-picked location).
 *   - Only owners / admins can backfill: a non-admin member is rejected with
 *     403 and the row stays untouched.
 *   - Bad payloads (missing placeId, out-of-range lat/lng) are rejected with
 *     400 before any write.
 *
 * Client side reference (`artifacts/round-house/app/property/[id].tsx`):
 *
 *   const needsMapBackfill =
 *     canManage &&
 *     !!property.address &&
 *     property.address.trim().length > 0 &&
 *     !property.placeId &&
 *     property.latitude == null &&
 *     property.longitude == null;
 *
 * The banner (`MapBackfillBanner.tsx`) calls Google Places Search Text to get
 * a placeId/lat/lng for the address, then POSTs them to this endpoint. The
 * server is the source of truth for "do we already have map data?", so this
 * test pins that contract.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    const uid = req.headers["x-test-user"];
    if (!uid) {
      _res.status(401).json({ error: "missing x-test-user" });
      return;
    }
    req.userId = String(uid);
    next();
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {
    normalizeObjectEntityPath(p: string) {
      return p;
    }
    async deleteObjectEntity(_p: string) {}
  },
}));

vi.mock("../../lib/objectAccess", () => ({
  assertCallerOwnsUploads: async () => {},
}));

vi.mock("../../lib/push", () => ({
  sendPushToUser: vi.fn(),
  sendPushToUsers: vi.fn(),
}));

vi.mock("../../lib/notificationPrefs", () => ({
  filterRecipientsByPref: async (ids: string[]) => ids,
  shouldNotify: async () => false,
}));

vi.mock("../../lib/expireMutes", () => ({
  clearExpiredMutesForProperties: async () => {},
  clearExpiredMutesForProperty: async () => {},
}));

const { db, propertiesTable, outwardAccountsTable, usersTable } = await import(
  "@workspace/db"
);
const { upsertPropertyMembership, purgeEntityForProperty } = await import(
  "../../lib/migratePropertyEntities"
);

async function ensureSkin(clerkId: string): Promise<number> {
  const [existing] = await db
    .select({ id: outwardAccountsTable.id })
    .from(outwardAccountsTable)
    .where(eq(outwardAccountsTable.ownerClerkId, clerkId))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(outwardAccountsTable)
    .values({ ownerClerkId: clerkId, kind: "home", title: clerkId })
    .returning({ id: outwardAccountsTable.id });
  return created.id;
}
const propertiesRouter = (await import("../properties")).default;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", propertiesRouter);
  return app;
}

const tag = `t194-${Date.now()}`;
const ids = {
  owner: `${tag}-owner`,
  member: `${tag}-member`,
};

let legacyPropertyId: number;
let geocodedPropertyId: number;
let app: Express;

const EXISTING_PLACE = {
  placeId: "ChIJexisting_already_set",
  latitude: 37.4219983,
  longitude: -122.084,
};

const RESOLVED_PLACE = {
  placeId: "ChIJresolved_from_places_search",
  latitude: 40.7484,
  longitude: -73.9857,
};

async function seed() {
  await db
    .insert(usersTable)
    .values(
      Object.entries(ids).map(([role, clerkId]) => ({
        clerkId,
        email: `${clerkId}@example.test`,
        name: role,
        username: clerkId,
      })),
    )
    .onConflictDoNothing();

  // Legacy property: has an address but no placeId/lat/lng. This is the row
  // the banner should show up for.
  const [legacy] = await db
    .insert(propertiesTable)
    .values({
      name: `${tag}-legacy`,
      address: "1600 Amphitheatre Parkway, Mountain View, CA",
      type: "home",
      ownerClerkId: ids.owner,
    })
    .returning();
  legacyPropertyId = legacy.id;

  // Already-geocoded property: has a placeId, lat and lng. The banner should
  // never appear here, and the geocode endpoint must leave it alone.
  const [geocoded] = await db
    .insert(propertiesTable)
    .values({
      name: `${tag}-geocoded`,
      address: "Pre-geocoded address",
      type: "home",
      ownerClerkId: ids.owner,
      placeId: EXISTING_PLACE.placeId,
      latitude: EXISTING_PLACE.latitude,
      longitude: EXISTING_PLACE.longitude,
    })
    .returning();
  geocodedPropertyId = geocoded.id;

  const ownerSkin = await ensureSkin(ids.owner);
  const memberSkin = await ensureSkin(ids.member);
  await upsertPropertyMembership({
    propertyId: legacyPropertyId,
    userClerkId: ids.owner,
    userOutwardAccountId: ownerSkin,
    role: "owner",
  });
  await upsertPropertyMembership({
    propertyId: legacyPropertyId,
    userClerkId: ids.member,
    userOutwardAccountId: memberSkin,
    role: "member",
  });
  await upsertPropertyMembership({
    propertyId: geocodedPropertyId,
    userClerkId: ids.owner,
    userOutwardAccountId: ownerSkin,
    role: "owner",
  });
}

beforeAll(async () => {
  app = makeApp();
  await seed();
});

afterAll(async () => {
  await purgeEntityForProperty(legacyPropertyId);
  await purgeEntityForProperty(geocodedPropertyId);
  await db.delete(propertiesTable).where(eq(propertiesTable.id, legacyPropertyId));
  await db.delete(propertiesTable).where(eq(propertiesTable.id, geocodedPropertyId));
  for (const clerkId of Object.values(ids)) {
    await db
      .delete(outwardAccountsTable)
      .where(eq(outwardAccountsTable.ownerClerkId, clerkId));
    await db.delete(usersTable).where(eq(usersTable.clerkId, clerkId));
  }
});

describe("Property geocode backfill — Find on map banner", () => {
  it("a legacy property with no placeId/lat/lng is in the banner-eligible state, and tapping the banner backfills the coordinates and removes that state", async () => {
    // Pre-condition: this is the row state that triggers `needsMapBackfill` on
    // the client. If this assertion ever fails, the banner would never render
    // for any property and the rest of the test is meaningless.
    const [before] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, legacyPropertyId));
    expect(before.placeId).toBeNull();
    expect(before.latitude).toBeNull();
    expect(before.longitude).toBeNull();
    expect(before.address.trim().length).toBeGreaterThan(0);

    // Tap the banner. The MapBackfillBanner posts the placeId/lat/lng it
    // resolved from Google Places Search Text to this endpoint.
    const res = await request(app)
      .post(`/api/properties/${legacyPropertyId}/geocode`)
      .set("x-test-user", ids.owner)
      .send({
        placeId: RESOLVED_PLACE.placeId,
        latitude: RESOLVED_PLACE.latitude,
        longitude: RESOLVED_PLACE.longitude,
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: legacyPropertyId,
      placeId: RESOLVED_PLACE.placeId,
      latitude: RESOLVED_PLACE.latitude,
      longitude: RESOLVED_PLACE.longitude,
    });

    // The DB row was actually updated — not just the response.
    const [after] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, legacyPropertyId));
    expect(after.placeId).toBe(RESOLVED_PLACE.placeId);
    expect(after.latitude).toBe(RESOLVED_PLACE.latitude);
    expect(after.longitude).toBe(RESOLVED_PLACE.longitude);

    // Now `needsMapBackfill` evaluates to false for this property, so the
    // banner is gone on the next render. Mirror that exact predicate here.
    const stillNeedsBackfill =
      !!after.address &&
      after.address.trim().length > 0 &&
      !after.placeId &&
      after.latitude == null &&
      after.longitude == null;
    expect(stillNeedsBackfill).toBe(false);
  });

  it("a property that already has placeId/lat/lng never enters the banner-eligible state — the banner does not appear for already-geocoded properties", async () => {
    const [row] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, geocodedPropertyId));

    // Same predicate the client uses for `needsMapBackfill`.
    const needsBackfill =
      !!row.address &&
      row.address.trim().length > 0 &&
      !row.placeId &&
      row.latitude == null &&
      row.longitude == null;
    expect(needsBackfill).toBe(false);
    expect(row.placeId).toBe(EXISTING_PLACE.placeId);
    expect(row.latitude).toBe(EXISTING_PLACE.latitude);
    expect(row.longitude).toBe(EXISTING_PLACE.longitude);
  });

  it("POST /properties/:id/geocode is a no-op when the property already has placeId/lat/lng — a posted value cannot overwrite an existing geocode", async () => {
    const res = await request(app)
      .post(`/api/properties/${geocodedPropertyId}/geocode`)
      .set("x-test-user", ids.owner)
      .send({
        placeId: "ChIJshould_not_overwrite",
        latitude: 1.2345,
        longitude: 6.789,
      });
    expect(res.status).toBe(200);
    // Response reflects the pre-existing values, not the posted ones.
    expect(res.body).toMatchObject({
      id: geocodedPropertyId,
      placeId: EXISTING_PLACE.placeId,
      latitude: EXISTING_PLACE.latitude,
      longitude: EXISTING_PLACE.longitude,
    });

    // And the DB row was not touched.
    const [after] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, geocodedPropertyId));
    expect(after.placeId).toBe(EXISTING_PLACE.placeId);
    expect(after.latitude).toBe(EXISTING_PLACE.latitude);
    expect(after.longitude).toBe(EXISTING_PLACE.longitude);
  });

  it("a non-admin member cannot backfill the geocode (403) and the row is unchanged", async () => {
    // Reset the legacy row to the un-geocoded state, since the first test
    // backfilled it.
    await db
      .update(propertiesTable)
      .set({ placeId: null, latitude: null, longitude: null })
      .where(eq(propertiesTable.id, legacyPropertyId));

    const res = await request(app)
      .post(`/api/properties/${legacyPropertyId}/geocode`)
      .set("x-test-user", ids.member)
      .send({
        placeId: RESOLVED_PLACE.placeId,
        latitude: RESOLVED_PLACE.latitude,
        longitude: RESOLVED_PLACE.longitude,
      });
    expect(res.status).toBe(403);

    const [after] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, legacyPropertyId));
    expect(after.placeId).toBeNull();
    expect(after.latitude).toBeNull();
    expect(after.longitude).toBeNull();
  });

  it("rejects malformed payloads with 400 before writing anything", async () => {
    const missingPlace = await request(app)
      .post(`/api/properties/${legacyPropertyId}/geocode`)
      .set("x-test-user", ids.owner)
      .send({ latitude: 10, longitude: 10 });
    expect(missingPlace.status).toBe(400);

    const badLat = await request(app)
      .post(`/api/properties/${legacyPropertyId}/geocode`)
      .set("x-test-user", ids.owner)
      .send({ placeId: "x", latitude: 999, longitude: 10 });
    expect(badLat.status).toBe(400);

    const badLng = await request(app)
      .post(`/api/properties/${legacyPropertyId}/geocode`)
      .set("x-test-user", ids.owner)
      .send({ placeId: "x", latitude: 10, longitude: -999 });
    expect(badLng.status).toBe(400);

    const [after] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, legacyPropertyId));
    expect(after.placeId).toBeNull();
    expect(after.latitude).toBeNull();
    expect(after.longitude).toBeNull();
  });
});

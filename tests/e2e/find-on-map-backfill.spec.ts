import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

const FIREBASE_API_KEY = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;

function uid(n = 6): string {
  return Math.random().toString(36).slice(2, 2 + n);
}

async function firebaseSignUp(
  email: string,
  password: string,
): Promise<{ idToken: string; localId: string }> {
  if (!FIREBASE_API_KEY) throw new Error("EXPO_PUBLIC_FIREBASE_API_KEY is not set");
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  if (!r.ok) throw new Error(`Firebase signUp failed: ${r.status} ${await r.text()}`);
  const j = (await r.json()) as { idToken: string; localId: string };
  return { idToken: j.idToken, localId: j.localId };
}

async function bypassOnboarding(
  idToken: string,
  clerkId: string,
  baseURL: string,
): Promise<void> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const meRes = await fetch(new URL("/api/users/me", baseURL).toString(), {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!meRes.ok) throw new Error(`GET /api/users/me failed: ${meRes.status} ${await meRes.text()}`);

  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    await pg.query(
      `UPDATE users
         SET avatar_url = 'public/seed-avatar.png',
             identity_completed_at = NOW()
         WHERE clerk_id = $1`,
      [clerkId],
    );
    const modeRow = await pg.query<{ id: number }>(
      `INSERT INTO user_modes (user_clerk_id, kind, intake_data, intake_completed_at)
         VALUES ($1, 'home', '{}'::jsonb, NOW())
         ON CONFLICT (user_clerk_id, kind)
           DO UPDATE SET intake_completed_at = EXCLUDED.intake_completed_at
         RETURNING id`,
      [clerkId],
    );
    const modeId = modeRow.rows[0].id;
    await pg.query(`UPDATE users SET last_active_mode_id = $1 WHERE clerk_id = $2`, [modeId, clerkId]);
  } finally {
    await pg.end();
  }
}

async function createProperty(
  idToken: string,
  baseURL: string,
  body: Record<string, unknown>,
): Promise<{ id: number; placeId: string | null; latitude: number | null; longitude: number | null }> {
  const r = await fetch(new URL("/api/properties", baseURL).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST /api/properties failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as {
    id: number;
    placeId: string | null;
    latitude: number | null;
    longitude: number | null;
  };
}

async function fetchProperty(
  idToken: string,
  baseURL: string,
  propertyId: number,
): Promise<{ id: number; placeId: string | null; latitude: number | null; longitude: number | null }> {
  const r = await fetch(new URL(`/api/properties/${propertyId}`, baseURL).toString(), {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!r.ok) throw new Error(`GET /api/properties/${propertyId} failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as {
    id: number;
    placeId: string | null;
    latitude: number | null;
    longitude: number | null;
  };
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/");
  await page.getByPlaceholder(/you@example\.com/i).fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByText("Sign in", { exact: true }).last().click();
  // Wait for the (tabs) shell to load — the Profile tab label appears.
  await page
    .getByText("Profile", { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
}

const RESOLVED = {
  placeId: "ChIJfind_on_map_e2e_resolved",
  latitude: 40.7484,
  longitude: -73.9857,
};

const PRE_GEOCODED = {
  placeId: "ChIJpre_geocoded_e2e",
  latitude: 37.4219983,
  longitude: -122.084,
};

// NOTE: This spec drives the actual MapBackfillBanner UI. The Google Places
// Search Text endpoint is intercepted via page.route so the test never hits
// the live Google API and the resolved values are deterministic.
test.describe("Property: Find on map backfill banner", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL || !PLACES_API_KEY,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY, DATABASE_URL, and EXPO_PUBLIC_GOOGLE_PLACES_API_KEY",
  );

  test("legacy property shows the banner; tapping it backfills coords and the banner disappears", async ({
    page,
    baseURL,
  }) => {
    const email = `find-on-map-${uid(8)}@example.test`;
    const password = "Pass1234!";
    const legacyName = `LegacyHouse ${uid(4)}`;

    const { idToken, localId: clerkId } = await firebaseSignUp(email, password);
    await bypassOnboarding(idToken, clerkId, baseURL!);

    // Create the legacy property via API: an address but no placeId/lat/lng.
    // This is the exact row state that triggers the banner on the property
    // screen (`needsMapBackfill` in `app/property/[id].tsx`).
    const legacy = await createProperty(idToken, baseURL!, {
      name: legacyName,
      address: "1600 Amphitheatre Parkway, Mountain View, CA",
      type: "home",
    });
    expect(legacy.placeId).toBeNull();
    expect(legacy.latitude).toBeNull();
    expect(legacy.longitude).toBeNull();

    // Intercept the Google Places Search Text call the banner makes so the
    // test is deterministic and never hits the live API.
    let placesCalls = 0;
    await page.route("https://places.googleapis.com/v1/places:searchText", async (route) => {
      placesCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          places: [
            {
              id: RESOLVED.placeId,
              location: { latitude: RESOLVED.latitude, longitude: RESOLVED.longitude },
            },
          ],
        }),
      });
    });

    await signIn(page, email, password);

    // Navigate directly to the property screen.
    await page.goto(`/property/${legacy.id}`);

    // The banner's title is "Find this on the map" — wait for it to render.
    const bannerTitle = page.getByText("Find this on the map", { exact: true });
    await expect(bannerTitle).toBeVisible({ timeout: 20_000 });

    // Tap the banner. The whole row is a Pressable, so click the title.
    await bannerTitle.click();

    // The banner should disappear once the backfill mutation resolves and the
    // property query is invalidated/refetched (the client `needsMapBackfill`
    // predicate now evaluates to false).
    await expect(bannerTitle).toBeHidden({ timeout: 15_000 });

    // The Places mock was actually consulted.
    expect(placesCalls).toBeGreaterThanOrEqual(1);

    // The DB row was updated with the values returned by the (mocked) Places
    // call — confirm via the API.
    const after = await fetchProperty(idToken, baseURL!, legacy.id);
    expect(after.placeId).toBe(RESOLVED.placeId);
    expect(after.latitude).toBe(RESOLVED.latitude);
    expect(after.longitude).toBe(RESOLVED.longitude);
  });

  test("a property that already has placeId/lat/lng never shows the banner", async ({
    page,
    baseURL,
  }) => {
    const email = `find-on-map-skip-${uid(8)}@example.test`;
    const password = "Pass1234!";
    const geocodedName = `GeocodedHouse ${uid(4)}`;

    const { idToken, localId: clerkId } = await firebaseSignUp(email, password);
    await bypassOnboarding(idToken, clerkId, baseURL!);

    const geocoded = await createProperty(idToken, baseURL!, {
      name: geocodedName,
      address: "Already-geocoded address",
      type: "home",
      placeId: PRE_GEOCODED.placeId,
      latitude: PRE_GEOCODED.latitude,
      longitude: PRE_GEOCODED.longitude,
    });
    expect(geocoded.placeId).toBe(PRE_GEOCODED.placeId);
    expect(geocoded.latitude).toBe(PRE_GEOCODED.latitude);
    expect(geocoded.longitude).toBe(PRE_GEOCODED.longitude);

    // If the banner ever fires Google Places, fail loudly — it must not.
    let placesCalls = 0;
    await page.route("https://places.googleapis.com/v1/places:searchText", async (route) => {
      placesCalls += 1;
      await route.fulfill({ status: 500, body: "should not be called" });
    });

    await signIn(page, email, password);
    await page.goto(`/property/${geocoded.id}`);

    // Wait for the property screen to settle — the property name is in the
    // hero section and is a stable signal that the screen has rendered.
    await expect(page.getByText(geocodedName, { exact: false }).first()).toBeVisible({
      timeout: 20_000,
    });

    // Give the page a beat to render any below-the-fold sections.
    await page.waitForTimeout(1_000);

    // Banner must not be on the page at all.
    await expect(page.getByText("Find this on the map", { exact: true })).toHaveCount(0);
    expect(placesCalls).toBe(0);
  });
});

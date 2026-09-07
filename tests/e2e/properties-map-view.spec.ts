import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

const FIREBASE_API_KEY = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

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

interface CreatedProperty {
  id: number;
}

async function createProperty(
  idToken: string,
  baseURL: string,
  body: Record<string, unknown>,
): Promise<CreatedProperty> {
  const r = await fetch(new URL("/api/properties", baseURL).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST /api/properties failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as CreatedProperty;
}

async function deleteProperty(
  idToken: string,
  baseURL: string,
  id: number,
): Promise<void> {
  await fetch(new URL(`/api/properties/${id}`, baseURL).toString(), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${idToken}` },
  }).catch(() => {});
}

async function signInUI(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/");
  await page.getByPlaceholder(/you@example\.com/i).fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  // The Sign-in Pressable on RN web is a plain div without a role; the
  // bottom-most "Sign in" text node is the submit button.
  await page.getByText("Sign in", { exact: true }).last().click();
  await page
    .getByText("Properties", { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
}

// NOTE: This spec runs only against the Expo web build. On web the map view
// uses `PropertiesMapView.web.tsx`, which renders mappable properties as
// clickable pin rows (accessibilityLabel="Map pin: <name>") instead of a
// real map embed. The same Properties tab toggle/navigation logic is shared
// with native; for native device coverage see the manual test note in
// `tests/manual/`.
test.describe("Properties tab: list/map view toggle", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("toggles list/map, shows pins for mapped properties, navigates from pin and 'Not on map' rows", async ({
    page,
    baseURL,
  }) => {
    const suffix = uid(6);
    const email = `props-map-${uid(8)}@example.test`;
    const password = "Pass1234!";

    // Provision a Firebase user and skip the identity/mode/intake gates.
    const { idToken, localId: clerkId } = await firebaseSignUp(email, password);
    await bypassOnboarding(idToken, clerkId, baseURL!);

    // Seed: two properties WITH coords and one WITHOUT.
    const alpha = await createProperty(idToken, baseURL!, {
      name: `Mapped Alpha ${suffix}`,
      address: "1 Alpha St",
      type: "home",
      coverColor: "#C8693A",
      latitude: 37.7749,
      longitude: -122.4194,
    });
    const beta = await createProperty(idToken, baseURL!, {
      name: `Mapped Beta ${suffix}`,
      address: "2 Beta Ave",
      type: "home",
      coverColor: "#3A7DC8",
      latitude: 34.0522,
      longitude: -118.2437,
    });
    const gamma = await createProperty(idToken, baseURL!, {
      name: `Unmapped Gamma ${suffix}`,
      address: "",
      type: "home",
      coverColor: "#43A047",
    });

    try {
      await signInUI(page, email, password);

      // Navigate to the Properties tab.
      const propertiesTabBtn = page.getByRole("button", { name: /^Properties$/i }).first();
      if (await propertiesTabBtn.isVisible().catch(() => false)) {
        await propertiesTabBtn.click();
      } else {
        await page.getByText(/^Properties$/).first().click();
      }

      const alphaName = `Mapped Alpha ${suffix}`;
      const betaName = `Mapped Beta ${suffix}`;
      const gammaName = `Unmapped Gamma ${suffix}`;

      // ===== List view: all three rows visible =====
      await expect(page.getByText(alphaName)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(betaName)).toBeVisible();
      await expect(page.getByText(gammaName)).toBeVisible();

      const showMap = page.getByLabel("Show map view");
      const showList = page.getByLabel("Show list view");
      await expect(showMap).toBeVisible();
      await expect(showList).toBeVisible();

      // ===== Switch to map view =====
      await showMap.click();

      const alphaPin = page.getByLabel(`Map pin: ${alphaName}`);
      const betaPin = page.getByLabel(`Map pin: ${betaName}`);
      const gammaPin = page.getByLabel(`Map pin: ${gammaName}`);

      await expect(alphaPin).toBeVisible({ timeout: 10_000 });
      await expect(betaPin).toBeVisible();
      // Gamma has no coords, so it must NOT have a pin.
      await expect(gammaPin).toHaveCount(0);

      // "Not on map" section visible with the unmapped property.
      await expect(page.getByText(/^Not on map \(\d+\)$/)).toBeVisible();
      await expect(page.getByText(gammaName)).toBeVisible();

      // ===== Tap the unmapped row -> navigates to property detail =====
      await page.getByText(gammaName).first().click();
      await expect(page).toHaveURL(new RegExp(`/property/${gamma.id}(\\b|$|\\?|/)`), {
        timeout: 15_000,
      });
      await expect(page.getByText(gammaName).first()).toBeVisible({ timeout: 15_000 });

      // ===== Back to /properties, switch to map again, tap a pin =====
      await page.goBack();
      await expect(page.getByLabel("Show map view")).toBeVisible({ timeout: 15_000 });
      await page.getByLabel("Show map view").click();

      await expect(page.getByLabel(`Map pin: ${alphaName}`)).toBeVisible({ timeout: 10_000 });
      await page.getByLabel(`Map pin: ${alphaName}`).click();
      await expect(page).toHaveURL(new RegExp(`/property/${alpha.id}(\\b|$|\\?|/)`), {
        timeout: 15_000,
      });
      await expect(page.getByText(alphaName).first()).toBeVisible({ timeout: 15_000 });

      // ===== Back, switch to list, all three properties are visible again =====
      await page.goBack();
      await expect(page.getByLabel("Show list view")).toBeVisible({ timeout: 15_000 });
      await page.getByLabel("Show list view").click();
      await expect(page.getByText(alphaName)).toBeVisible();
      await expect(page.getByText(betaName)).toBeVisible();
      await expect(page.getByText(gammaName)).toBeVisible();
      // The "Not on map" sheet is gone in list view.
      await expect(page.getByText(/^Not on map \(\d+\)$/)).toHaveCount(0);
    } finally {
      // Cleanup created properties even if assertions failed.
      await deleteProperty(idToken, baseURL!, alpha.id);
      await deleteProperty(idToken, baseURL!, beta.id);
      await deleteProperty(idToken, baseURL!, gamma.id);
    }
  });
});

import { test, expect, type Page, type BrowserContext, type Locator } from "@playwright/test";
import { Client } from "pg";
import { insertPropertyMember } from "./_helpers/propertyMembers";

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

async function bypassOnboarding(idToken: string, clerkId: string, baseURL: string): Promise<void> {
  const meRes = await fetch(new URL("/api/users/me", baseURL).toString(), {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!meRes.ok) {
    throw new Error(`GET /api/users/me failed: ${meRes.status} ${await meRes.text()}`);
  }
  const pg = new Client({ connectionString: DATABASE_URL! });
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
    await pg.query(`UPDATE users SET last_active_mode_id = $1 WHERE clerk_id = $2`, [
      modeRow.rows[0].id,
      clerkId,
    ]);
  } finally {
    await pg.end();
  }
}

async function seedProperty(args: {
  ownerClerkId: string;
  name: string;
  address: string;
}): Promise<{ propertyId: number }> {
  const pg = new Client({ connectionString: DATABASE_URL! });
  await pg.connect();
  try {
    const propRow = await pg.query<{ id: number }>(
      // cover_photo_url is set to a non-/objects/ URL so the EditPropertyModal
      // Save button enables AND the api-server's PUT /properties/:id skips
      // the upload-ownership assertion (which only fires for /objects/ paths).
      `INSERT INTO properties (name, address, type, owner_clerk_id, cover_color, cover_photo_url)
         VALUES ($1, $2, 'home', $3, '#C8693A', 'https://example.test/cover.png')
       RETURNING id`,
      [args.name, args.address, args.ownerClerkId],
    );
    const propertyId = propRow.rows[0].id;
    await insertPropertyMember(pg, {
      propertyId,
      userClerkId: args.ownerClerkId,
      role: "owner",
    });
    return { propertyId };
  } finally {
    await pg.end();
  }
}

async function readPropertyAddress(propertyId: number): Promise<string> {
  const pg = new Client({ connectionString: DATABASE_URL! });
  await pg.connect();
  try {
    const r = await pg.query<{ address: string }>(
      `SELECT address FROM properties WHERE id = $1`,
      [propertyId],
    );
    return r.rows[0]?.address ?? "";
  } finally {
    await pg.end();
  }
}

async function signInViaUI(page: Page, email: string, password: string): Promise<void> {
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`[browser:err] ${m.text()}`);
  });
  page.on("pageerror", (e) => console.log(`[browser:throw] ${e.message}`));
  await page.goto("/");
  const emailInput = page.getByPlaceholder(/you@example\.com/i);
  await emailInput.waitFor({ state: "visible", timeout: 45_000 });
  await emailInput.fill(email);
  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.fill(password);
  await passwordInput.press("Enter");
  await expect(page.getByText("Properties").first()).toBeVisible({ timeout: 45_000 });
}

type PlacesMode = "ok" | "error";

interface PlacesMockHandle {
  setMode(mode: PlacesMode): void;
  autocompleteCalls(): number;
  detailsCalls(): number;
}

const AUTOCOMPLETE_PAYLOAD = {
  suggestions: [
    {
      placePrediction: {
        placeId: "PLACE_MAIN_ST",
        structuredFormat: {
          mainText: { text: "123 Main St" },
          secondaryText: { text: "Springfield, IL, USA" },
        },
      },
    },
    {
      placePrediction: {
        placeId: "PLACE_MAIN_AVE",
        structuredFormat: {
          mainText: { text: "123 Main Ave" },
          secondaryText: { text: "Springfield, IL, USA" },
        },
      },
    },
    {
      placePrediction: {
        placeId: "PLACE_MAIN_BLVD",
        structuredFormat: {
          mainText: { text: "123 Main Blvd" },
          secondaryText: { text: "Springfield, IL, USA" },
        },
      },
    },
  ],
};

const FORMATTED: Record<string, string> = {
  PLACE_MAIN_ST: "123 Main Street, Springfield, IL 62701, USA",
  PLACE_MAIN_AVE: "123 Main Avenue, Springfield, IL 62702, USA",
  PLACE_MAIN_BLVD: "123 Main Boulevard, Springfield, IL 62703, USA",
};

/** Install a Playwright route handler intercepting all calls to
 *  https://places.googleapis.com so the autocomplete component never reaches
 *  the real Google service. The returned handle lets the test flip between
 *  "ok" (returns canned suggestions/details) and "error" (returns 503). */
async function installPlacesMock(context: BrowserContext): Promise<PlacesMockHandle> {
  let mode: PlacesMode = "ok";
  let autocompleteCalls = 0;
  let detailsCalls = 0;
  await context.route("https://places.googleapis.com/**", async (route) => {
    const url = route.request().url();
    if (mode === "error") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "unavailable" } }),
      });
      return;
    }
    if (url.endsWith(":autocomplete")) {
      autocompleteCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(AUTOCOMPLETE_PAYLOAD),
      });
      return;
    }
    const m = url.match(/\/places\/([^/?]+)/);
    if (m) {
      detailsCalls += 1;
      const placeId = m[1];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ formattedAddress: FORMATTED[placeId] ?? "" }),
      });
      return;
    }
    await route.fulfill({ status: 404, body: "" });
  });
  return {
    setMode: (m) => {
      mode = m;
    },
    autocompleteCalls: () => autocompleteCalls,
    detailsCalls: () => detailsCalls,
  };
}

/** Type a string one character at a time so the 350ms debounced fetch
 *  in AddressAutocompleteInput fires while the input is focused. */
async function slowType(input: Locator, text: string): Promise<void> {
  for (const ch of text) {
    await input.type(ch, { delay: 60 });
  }
}

async function clearInput(input: Locator): Promise<void> {
  await input.click();
  await input.press("Control+A").catch(() => {});
  await input.press("Meta+A").catch(() => {});
  await input.press("Delete");
}

async function openEditPropertyModal(page: Page): Promise<void> {
  // The "Edit Property" entry sits in a settings/menu sheet on the property
  // detail page. Try to open that sheet first; if the entry is already
  // visible (some layouts render it inline), the click is a no-op.
  const entry = page.getByText("Edit Property").first();
  if (!(await entry.isVisible({ timeout: 1_500 }).catch(() => false))) {
    const triggers = [
      '[aria-label="Property settings"]',
      '[aria-label="Settings"]',
      '[aria-label="More"]',
      '[aria-label="Open menu"]',
    ];
    for (const sel of triggers) {
      const t = page.locator(sel).first();
      if (await t.isVisible({ timeout: 500 }).catch(() => false)) {
        await t.click().catch(() => {});
        break;
      }
    }
  }
  await page.getByText("Edit Property").first().click();
  // Wait for the address field of the modal to be present.
  await page.getByPlaceholder("Street address").first().waitFor({ state: "visible", timeout: 10_000 });
}

test.describe("Property address autocomplete", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("Add Property: typing surfaces suggestions and tapping one fills the formatted address", async ({
    page,
    context,
    baseURL,
  }) => {
    const tag = uid(5);
    const email = `addr-add-${tag}@example.test`;
    const password = "Pass1234!";

    const places = await installPlacesMock(context);
    const { idToken, localId: clerkId } = await firebaseSignUp(email, password);
    await bypassOnboarding(idToken, clerkId, baseURL!);
    await signInViaUI(page, email, password);

    // Land on Properties tab. Either the empty-state CTA or the header "+"
    // opens the Add Property modal.
    await page.getByText("Properties").first().click();

    const emptyCta = page.getByText("Create Property Profile").first();
    if (await emptyCta.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await emptyCta.click();
    } else {
      await page
        .locator('[aria-label="Add property"], [aria-label="Add Property"]')
        .first()
        .click()
        .catch(async () => {
          await page.getByText(/^\+$/).first().click().catch(() => {});
        });
    }

    await expect(page.getByText("Add Property").first()).toBeVisible({ timeout: 10_000 });

    const addressInput = page.getByPlaceholder("Street address").first();
    await addressInput.waitFor({ state: "visible" });
    await addressInput.click();
    await slowType(addressInput, "123 Main");

    // Mocked dropdown options.
    const opt = page.getByText("123 Main Ave, Springfield, IL, USA").first();
    await expect(opt).toBeVisible({ timeout: 5_000 });
    expect(places.autocompleteCalls()).toBeGreaterThanOrEqual(1);

    await opt.click();

    // Optimistic update sets the prediction text first, then resolves to the
    // formatted address from the Place Details fetch.
    await expect(addressInput).toHaveValue(FORMATTED.PLACE_MAIN_AVE, { timeout: 5_000 });
    expect(places.detailsCalls()).toBeGreaterThanOrEqual(1);

    // Dismiss the modal — Add Property requires a cover photo upload through
    // the web file picker, which is out of scope for this address-focused test.
    await page.getByText("Cancel").first().click();
  });

  test("Edit Property: address pre-fills, typing surfaces suggestions, picking one replaces the value", async ({
    page,
    context,
    baseURL,
  }) => {
    const tag = uid(5);
    const email = `addr-edit-${tag}@example.test`;
    const password = "Pass1234!";
    const seedAddress = "500 Old Address Rd, Anywhere, USA";

    const places = await installPlacesMock(context);
    const { idToken, localId: clerkId } = await firebaseSignUp(email, password);
    await bypassOnboarding(idToken, clerkId, baseURL!);
    const seeded = await seedProperty({
      ownerClerkId: clerkId,
      name: `Edit Addr ${tag}`,
      address: seedAddress,
    });

    await signInViaUI(page, email, password);
    await page.goto(`/property/${seeded.propertyId}`);
    await expect(page.getByText(`Edit Addr ${tag}`).first()).toBeVisible({ timeout: 30_000 });

    const gotIt = page.getByText("Got it").first();
    if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await gotIt.click();
      await expect(gotIt).toBeHidden({ timeout: 5_000 });
    }

    await openEditPropertyModal(page);

    const addressInput = page.getByPlaceholder("Street address").first();
    // Pre-fill is the seeded address.
    await expect(addressInput).toHaveValue(seedAddress, { timeout: 10_000 });

    // Focusing + typing a fresh query trips the debounced fetch.
    await clearInput(addressInput);
    await slowType(addressInput, "123 Main");

    const opt = page.getByText("123 Main St, Springfield, IL, USA").first();
    await expect(opt).toBeVisible({ timeout: 5_000 });
    expect(places.autocompleteCalls()).toBeGreaterThanOrEqual(1);

    await opt.click();
    // Re-pick replaces the value with the formatted address.
    await expect(addressInput).toHaveValue(FORMATTED.PLACE_MAIN_ST, { timeout: 5_000 });

    await page.getByText("Cancel").first().click();
  });

  test("Fallback: when the Places API errors, the field still accepts free text and saves it", async ({
    page,
    context,
    baseURL,
  }) => {
    const tag = uid(5);
    const email = `addr-fallback-${tag}@example.test`;
    const password = "Pass1234!";
    const seedAddress = "500 Old Address Rd, Anywhere, USA";
    const newAddress = `999 Free Text Lane #${tag}, Test City`;

    const places = await installPlacesMock(context);
    places.setMode("error");
    const { idToken, localId: clerkId } = await firebaseSignUp(email, password);
    await bypassOnboarding(idToken, clerkId, baseURL!);
    const seeded = await seedProperty({
      ownerClerkId: clerkId,
      name: `Fallback Addr ${tag}`,
      address: seedAddress,
    });

    await signInViaUI(page, email, password);
    await page.goto(`/property/${seeded.propertyId}`);
    await expect(page.getByText(`Fallback Addr ${tag}`).first()).toBeVisible({ timeout: 30_000 });

    const gotIt = page.getByText("Got it").first();
    if (await gotIt.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await gotIt.click();
      await expect(gotIt).toBeHidden({ timeout: 5_000 });
    }

    await openEditPropertyModal(page);

    const addressInput = page.getByPlaceholder("Street address").first();
    await expect(addressInput).toHaveValue(seedAddress, { timeout: 10_000 });
    await clearInput(addressInput);
    await slowType(addressInput, newAddress);

    // No suggestion dropdown should ever appear in error mode — the
    // component trips its 3-failure breaker and stays disabled.
    await expect(page.getByText("123 Main St, Springfield, IL, USA")).toHaveCount(0);
    await expect(addressInput).toHaveValue(newAddress);

    // Save the edit through the modal header's primary button.
    await page.getByText(/^Save( Changes)?$/).first().click();

    // Modal should close.
    await expect(page.getByPlaceholder("Street address")).toHaveCount(0, { timeout: 10_000 });

    // Persisted in the database verbatim.
    await expect
      .poll(() => readPropertyAddress(seeded.propertyId), { timeout: 10_000 })
      .toBe(newAddress);
  });
});

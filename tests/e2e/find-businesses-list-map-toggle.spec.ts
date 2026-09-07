/**
 * End-to-end tests for the Businesses lane list/map toggle on /find.
 *
 * Covers task #201 — the Businesses lane on /find has a List/Map view
 * toggle. Previously there was no automated coverage that:
 *   1. Toggling List ↔ Map preserves the active filters and the same
 *      result set is shown after switching back to list.
 *   2. With zero matching results in map mode the user still sees a
 *      sensible empty-state ("No businesses match"), not a blank map.
 *   3. Switching back to list preserves the underlying query (no extra
 *      refetch / no lost rows).
 *
 * Web vs. native — important caveats this spec is honest about:
 *   - This Playwright spec runs against the Expo web build. On web,
 *     `BusinessesMapView` resolves to `BusinessesMapView.web.tsx`, a
 *     placeholder that renders "Map view" + a count message instead of
 *     a real map (real maps depend on `react-native-maps`, which is
 *     native-only). So the assertions below validate the web map
 *     placeholder copy, not real Markers / Callouts.
 *   - The native-only behaviors that the task spec also lists —
 *     tapping a Marker's Callout to open the public profile, and the
 *     in-map "switch to list view" hint when results have no service
 *     area — only exist in `BusinessesMapView.tsx` (native). They are
 *     captured as a manual iOS/Android device test follow-up.
 */
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

/** Skip the identity / mode-picker / intake gates for the caller so the
 *  app drops them straight into (tabs) and we can navigate to /find. */
async function bypassOnboardingHomeowner(
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
    await pg.query(`UPDATE users SET last_active_mode_id = $1 WHERE clerk_id = $2`, [
      modeRow.rows[0].id,
      clerkId,
    ]);
  } finally {
    await pg.end();
  }
}

type SeedTradePro = {
  clerkId: string;
  username: string;
  companyName: string;
  trade: string;
  primaryZip: string | null;
  region: string | null;
};

/** Seed a trade-pro user + user_modes row that the /api/businesses/search
 *  endpoint will pick up. Uses a unique tag in the companyName so we can
 *  isolate our results from any other trade pros that already exist in
 *  the shared dev database via the `name=` ILIKE filter. */
async function seedTradePro(args: {
  tag: string;
  label: string; // unique per pro within the test, e.g. "alpha"
  trade: string;
  primaryZip: string | null;
  region: string | null;
}): Promise<SeedTradePro> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const clerkId = `t201-${args.tag}-${args.label}`;
  const username = `t201_${args.tag}_${args.label}`;
  const companyName = `t201-${args.tag} ${args.label}`;
  const intake: Record<string, unknown> = {
    companyName,
    trade: args.trade,
  };
  if (args.region) intake.region = args.region;
  if (args.primaryZip) intake.primaryZip = args.primaryZip;

  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    await pg.query(
      `INSERT INTO users (clerk_id, email, name, username)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (clerk_id) DO NOTHING`,
      [clerkId, `${clerkId}@example.test`, companyName, username],
    );
    await pg.query(
      `INSERT INTO user_modes (user_clerk_id, kind, intake_data, intake_completed_at)
         VALUES ($1, 'trade_pro', $2::jsonb, NOW())
         ON CONFLICT (user_clerk_id, kind)
           DO UPDATE SET intake_data = EXCLUDED.intake_data,
                         intake_completed_at = EXCLUDED.intake_completed_at`,
      [clerkId, JSON.stringify(intake)],
    );
  } finally {
    await pg.end();
  }
  return {
    clerkId,
    username,
    companyName,
    trade: args.trade,
    primaryZip: args.primaryZip,
    region: args.region,
  };
}

async function cleanupSeededPros(clerkIds: string[]): Promise<void> {
  if (!DATABASE_URL || clerkIds.length === 0) return;
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    await pg.query(`DELETE FROM user_modes WHERE user_clerk_id = ANY($1::text[])`, [clerkIds]);
    await pg.query(`DELETE FROM users WHERE clerk_id = ANY($1::text[])`, [clerkIds]);
  } finally {
    await pg.end();
  }
}

async function signInViaUI(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/");
  await page.getByPlaceholder(/you@example\.com/i).fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  // The Sign-in Pressable on RN web renders as a div without an explicit
  // role; the page also has a "Sign in" heading, so target the bottom-most
  // "Sign in" text node which is the button.
  await page.getByText("Sign in", { exact: true }).last().click();
  // Wait for (tabs) shell — the bottom Profile tab label appears.
  await page
    .getByText("Profile", { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
}

/** Navigate to /find and switch the segmented control to the
 *  Businesses lane. The lane segment label has no role="tab" / button
 *  semantics on RN web, so we click the text node directly. */
async function gotoFindBusinesses(page: Page): Promise<void> {
  await page.goto("/find");
  await page
    .getByText("Find", { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
  await page.getByText("Businesses", { exact: true }).first().click();
  await expect(page.getByPlaceholder(/^ZIP$/)).toBeVisible({ timeout: 10_000 });
}

/** Apply trade + ZIP + name filters. The name filter uses a unique tag
 *  so we only pull back our seeded rows even though the dev DB is
 *  shared with other test runs and user data. */
async function applyBusinessFilters(
  page: Page,
  args: { tradeLabel: string; zip: string; nameContains: string },
): Promise<void> {
  // Trade picker: Pressable with placeholder "Type of work" → opens a list.
  await page.getByText("Type of work", { exact: true }).first().click();
  await page.getByText(args.tradeLabel, { exact: true }).first().click();
  await page.getByPlaceholder(/^ZIP$/).fill(args.zip);
  await page.getByPlaceholder(/Business name/i).fill(args.nameContains);
}

test.describe("Find / Businesses: list ↔ map toggle", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("toggle preserves filters & results, no-results state in map mode, and back-to-list keeps results", async ({
    page,
    baseURL,
  }) => {
    const tag = uid(6);
    const email = `find-map-toggle-${tag}@example.test`;
    const password = "Pass1234!";

    // Provision the caller (homeowner) and skip onboarding gates.
    const { idToken, localId: callerClerkId } = await firebaseSignUp(email, password);
    await bypassOnboardingHomeowner(idToken, callerClerkId, baseURL!);

    // Seed three trade pros:
    //   alpha — plumber, ZIP 10001, with a service-area region
    //   beta  — plumber, ZIP 10001, with a service-area region
    //   gamma — carpenter, ZIP 60606, NO service-area region (covers the
    //           "results without a known service area" path — on native
    //           this triggers the in-map "switch to list view" hint;
    //           on web we only verify gamma still appears in list view
    //           after toggling)
    const seededClerkIds: string[] = [];
    try {
      const alpha = await seedTradePro({
        tag,
        label: "alpha",
        trade: "plumber",
        primaryZip: "10001",
        region: "Anytown, NY",
      });
      const beta = await seedTradePro({
        tag,
        label: "beta",
        trade: "plumber",
        primaryZip: "10001",
        region: "Otherville, NY",
      });
      const gamma = await seedTradePro({
        tag,
        label: "gamma",
        trade: "carpenter",
        primaryZip: "60606",
        region: null, // intentionally no service area
      });
      seededClerkIds.push(alpha.clerkId, beta.clerkId, gamma.clerkId);

      await signInViaUI(page, email, password);

      // ===== Scenario 1: Toggle preserves filters and same results =====
      await gotoFindBusinesses(page);
      await applyBusinessFilters(page, {
        tradeLabel: "Plumber",
        zip: "10001",
        nameContains: `t201-${tag}`,
      });

      // List view shows alpha and beta and not the carpenter (gamma).
      const alphaRow = page.getByText(alpha.companyName, { exact: true });
      const betaRow = page.getByText(beta.companyName, { exact: true });
      const gammaRow = page.getByText(gamma.companyName, { exact: true });
      await expect(alphaRow.first()).toBeVisible({ timeout: 15_000 });
      await expect(betaRow.first()).toBeVisible();
      expect(await gammaRow.count()).toBe(0);

      // Toggle to Map view. The toggle Pressables expose
      // accessibilityLabel="List view" / "Map view" (see ViewToggleBtn
      // in app/find.tsx).
      await page.getByLabel("Map view").click();

      // The List FlatList rows should be gone; the web map placeholder
      // (BusinessesMapView.web.tsx) should be visible with the count
      // for our 2 seeded plumbers.
      await expect(alphaRow).toHaveCount(0, { timeout: 10_000 });
      await expect(betaRow).toHaveCount(0);
      await expect(
        page.getByText(/Map preview is available in the mobile app \(2 businesses\)/i),
      ).toBeVisible({ timeout: 10_000 });

      // The toggle row is still rendered (hasFilter is true); the Map
      // toggle is the active one.
      await expect(page.getByLabel("Map view")).toBeVisible();
      await expect(page.getByLabel("List view")).toBeVisible();

      // Toggle back to List — same two rows, no extras, no carpenter.
      await page.getByLabel("List view").click();
      await expect(alphaRow.first()).toBeVisible({ timeout: 10_000 });
      await expect(betaRow.first()).toBeVisible();
      expect(await gammaRow.count()).toBe(0);

      // The trade + ZIP + name inputs were preserved across the toggle.
      await expect(page.getByText("Plumber", { exact: true }).first()).toBeVisible();
      await expect(page.getByPlaceholder(/^ZIP$/)).toHaveValue("10001");
      await expect(page.getByPlaceholder(/Business name/i)).toHaveValue(`t201-${tag}`);

      // ===== Scenario 2: No-results state in map mode =====
      // Change the name filter to something that won't match anything in
      // our seeded set so businesses.length === 0 but hasFilter is still
      // true (the toggle row stays visible and we can switch to map).
      await page.getByPlaceholder(/Business name/i).fill(`t201-${tag}-nope-${uid(4)}`);
      await expect(page.getByText("No businesses match", { exact: false })).toBeVisible({
        timeout: 10_000,
      });
      // Switch to Map. With businesses.length === 0, find.tsx renders
      // the EmptyHint instead of the map view, so the same "No
      // businesses match" copy stays visible (the right empty state for
      // "no results" regardless of selected view).
      await page.getByLabel("Map view").click();
      await expect(page.getByText("No businesses match", { exact: false })).toBeVisible();
      // The toggle row is still rendered (hasFilter is still true) so
      // the user can switch back without re-entering filters.
      await expect(page.getByLabel("List view")).toBeVisible();

      // ===== Scenario 3: Service-area-less results survive toggle =====
      // Re-filter to gamma (carpenter, no `region`). Toggle to Map and
      // back to List, and confirm gamma still appears — i.e. the
      // toggle does not mutate the underlying query and a result with
      // no service area is not silently dropped from list view.
      //
      // Native-only assertion (NOT exercised here): on iOS/Android,
      // BusinessesMapView shows "No locations to map" + "Switch to list
      // view to see them all." for this case. That copy lives in
      // BusinessesMapView.tsx and only renders against react-native-maps
      // on a native build. See the manual device follow-up.
      await page.getByLabel("List view").click();
      await page.getByText("Plumber", { exact: true }).first().click();
      await page.getByText("Carpenter", { exact: true }).first().click();
      await page.getByPlaceholder(/^ZIP$/).fill("60606");
      await page.getByPlaceholder(/Business name/i).fill(`t201-${tag}`);

      await expect(gammaRow.first()).toBeVisible({ timeout: 15_000 });

      // Toggle to Map: the web placeholder shows the count for gamma.
      await page.getByLabel("Map view").click();
      await expect(
        page.getByText(/Map preview is available in the mobile app \(1 business\)/i),
      ).toBeVisible({ timeout: 10_000 });

      // Toggling back to list still surfaces gamma.
      await page.getByLabel("List view").click();
      await expect(gammaRow.first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await cleanupSeededPros(seededClerkIds);
    }
  });
});

/**
 * E2E coverage for the avatar "Start over" onboarding flow (task #626).
 *
 * Task #625 added a "Start over — pick a different hat" affordance on
 * `app/(onboarding)/intake.tsx`, plus a hardware-back confirm and the
 * `DELETE /users/me/modes/:modeId` endpoint that backs it. The endpoint
 * has unit coverage; this spec exercises the mobile-web flow:
 *
 *   A. Pick a skin → land on intake → start typing.
 *   B. Tap Start Over and CANCEL the confirm — typed data must remain.
 *   C. Tap Start Over and CONFIRM — the in-progress user_modes row is
 *      deleted, the URL is back on /(onboarding)/mode-picker, and the
 *      previously-picked tile is pickable again (not stuck disabled
 *      under the "Already activated" copy).
 *   D. Re-pick the same skin — a fresh intake renders with an empty
 *      placeName input, proving the abandoned mode's intake_data did
 *      not bleed into the new one.
 *
 * The Android hardware-back path is documented as device-only in the
 * companion test plan: react-native-web's BackHandler is a no-op so
 * Playwright cannot fire it. The same `startOver()` callback the back
 * handler calls when `canStartOver` is true is exercised end-to-end here.
 *
 * Companion plan: artifacts/round-house/e2e/avatar-start-over.test-plan.md
 */
import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

const FIREBASE_API_KEY = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

function uid(n = 8): string {
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
  return (await r.json()) as { idToken: string; localId: string };
}

async function withDb<T>(fn: (pg: Client) => Promise<T>): Promise<T> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    return await fn(pg);
  } finally {
    await pg.end();
  }
}

/**
 * Bypass IDENTITY only (not mode-picker / intake): we want the user to
 * land on the mode picker so the test can drive the picker → intake →
 * start over flow for real. Lazy-create the users row via the
 * auth-middleware GET, then mark identity complete.
 */
async function bypassIdentityOnly(
  idToken: string,
  clerkId: string,
  baseURL: string,
): Promise<void> {
  const meRes = await fetch(new URL("/api/users/me", baseURL).toString(), {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!meRes.ok) {
    throw new Error(`GET /api/users/me failed: ${meRes.status} ${await meRes.text()}`);
  }
  await withDb(async (pg) => {
    await pg.query(
      `UPDATE users
         SET avatar_url = 'public/seed-avatar.png',
             identity_completed_at = NOW()
       WHERE clerk_id = $1`,
      [clerkId],
    );
  });
}

async function fetchModeRow(
  clerkId: string,
  modeId: number,
): Promise<{ id: number; intakeData: unknown } | null> {
  return withDb(async (pg) => {
    const r = await pg.query<{ id: number; intake_data: unknown }>(
      `SELECT id, intake_data
         FROM user_modes
         WHERE id = $1 AND user_clerk_id = $2`,
      [modeId, clerkId],
    );
    if (r.rows.length === 0) return null;
    return { id: r.rows[0].id, intakeData: r.rows[0].intake_data };
  });
}

async function fetchLastActiveModeId(clerkId: string): Promise<number | null> {
  return withDb(async (pg) => {
    const r = await pg.query<{ last_active_mode_id: number | null }>(
      `SELECT last_active_mode_id FROM users WHERE clerk_id = $1`,
      [clerkId],
    );
    return r.rows[0]?.last_active_mode_id ?? null;
  });
}

async function cleanup(clerkId: string): Promise<void> {
  if (!DATABASE_URL || !clerkId) return;
  await withDb(async (pg) => {
    await pg.query(`DELETE FROM outward_accounts WHERE owner_clerk_id = $1`, [clerkId]);
    await pg.query(`DELETE FROM user_modes WHERE user_clerk_id = $1`, [clerkId]);
    await pg.query(`DELETE FROM users WHERE clerk_id = $1`, [clerkId]);
  });
}

async function signInViaUI(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/");
  const emailInput = page.getByPlaceholder(/you@example\.com/i);
  await emailInput.waitFor({ state: "visible", timeout: 45_000 });
  await emailInput.fill(email);
  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.fill(password);
  await passwordInput.press("Enter");
  // The auto-provisioned `collab` baseline mode (see
  // ensureCollabBaselineMode in the api-server) makes the profile
  // status report "ready" right after sign-in, so a fresh user lands
  // on /(tabs), NOT /(onboarding)/mode-picker. We wait for that
  // transition and then navigate explicitly to the picker — the
  // onboarding _layout allows `ready + onPicker` to render so the
  // user can still re-enter the picker to add another hat.
  await page.waitForURL((url) => !url.pathname.includes("sign-in"), { timeout: 45_000 });
}

/** Locate a TextInput by walking from its visible label to the input
 * inside the same row, the same trick personal-profile-editor.spec.ts
 * uses to avoid grabbing dev-overlay inputs by index. */
function inputForLabel(page: Page, label: string) {
  return page
    .getByText(label, { exact: true })
    .first()
    .locator(`xpath=ancestor::*[descendant::input][1]`)
    .locator("input")
    .first();
}

test.describe("Avatar Start-Over onboarding flow (#626)", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("pick → type → cancel keeps data; pick → type → confirm discards mode and re-enables tile; re-pick lands on a fresh intake", async ({
    page,
    baseURL,
  }) => {
    const tag = uid(6);
    const email = `start-over-${tag}@example.test`;
    const password = "Pass1234!";

    page.on("pageerror", (e) => console.log(`[browser:throw] ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") console.log(`[browser:err] ${m.text()}`);
    });

    // Per-test toggleable dialog handler. RN-web's Alert.alert with
    // cancel + destructive maps to window.confirm: accept → destructive
    // (Start over), dismiss → Cancel. We flip the mode between the
    // cancel branch and the confirm branch.
    let dialogMode: "accept" | "dismiss" = "dismiss";
    let dialogCount = 0;
    page.on("dialog", (d) => {
      dialogCount += 1;
      if (dialogMode === "accept") d.accept().catch(() => {});
      else d.dismiss().catch(() => {});
    });

    let clerkId = "";
    try {
      const signup = await firebaseSignUp(email, password);
      clerkId = signup.localId;
      await bypassIdentityOnly(signup.idToken, clerkId, baseURL!);

      await signInViaUI(page, email, password);

      // ===== A. Land on the mode picker; pick "Home"; type a value =====
      await page.goto("/(onboarding)/mode-picker");
      await expect(page.getByText("Pick your first hat", { exact: true })).toBeVisible({
        timeout: 45_000,
      });

      const homeTile = page.getByText("Home", { exact: true }).first();
      await expect(homeTile).toBeVisible();

      // Capture the activate response so we know the modeId the test
      // is operating on (and can later assert it really got deleted).
      const activatePromise = page.waitForResponse(
        (r) =>
          /\/api\/users\/me\/modes(\?|$)/.test(r.url()) &&
          r.request().method() === "POST",
        { timeout: 20_000 },
      );
      await homeTile.click();
      const activateResp = await activatePromise;
      expect(
        activateResp.ok(),
        `activate POST should succeed; got ${activateResp.status()} ${await activateResp.text()}`,
      ).toBeTruthy();
      const activated = (await activateResp.json()) as { id: number; kind: string };
      expect(activated.kind).toBe("home");
      const firstModeId = activated.id;

      // We're now on /(onboarding)/intake. Wait for the placeName input.
      const placeName1 = inputForLabel(page, "Property");
      await expect(placeName1).toBeVisible({ timeout: 20_000 });
      const typedValue = `Riverhouse ${tag}`;
      await placeName1.fill(typedValue);
      await expect(placeName1).toHaveValue(typedValue);

      // ===== B. Cancel branch — typed data is preserved =====
      dialogMode = "dismiss";
      dialogCount = 0;

      // No DELETE should fire on cancel.
      let sawDelete = false;
      const deleteListener = (resp: import("@playwright/test").Response) => {
        if (
          /\/api\/users\/me\/modes\/\d+(\?|$)/.test(resp.url()) &&
          resp.request().method() === "DELETE"
        ) {
          sawDelete = true;
        }
      };
      page.on("response", deleteListener);

      await page
        .getByLabel("Start over and pick a different hat")
        .first()
        .click();

      // Give the dialog a moment to surface and be dismissed.
      await page.waitForTimeout(500);
      expect(dialogCount).toBeGreaterThanOrEqual(1);
      expect(sawDelete).toBe(false);
      page.off("response", deleteListener);

      // Still on intake; placeName still holds the typed value.
      await expect(inputForLabel(page, "Property")).toHaveValue(typedValue);
      // The mode row in the DB is untouched and still has no intake.
      const stillThere = await fetchModeRow(clerkId, firstModeId);
      expect(stillThere?.id).toBe(firstModeId);

      // ===== C. Confirm branch — mode is discarded, picker shows tile pickable again =====
      dialogMode = "accept";
      dialogCount = 0;

      const deletePromise = page.waitForResponse(
        (r) =>
          new RegExp(`/api/users/me/modes/${firstModeId}(\\?|$)`).test(r.url()) &&
          r.request().method() === "DELETE",
        { timeout: 20_000 },
      );
      await page
        .getByLabel("Start over and pick a different hat")
        .first()
        .click();
      const deleteResp = await deletePromise;
      expect(deleteResp.status()).toBe(204);

      // Back on the picker — assert by header copy and URL.
      await expect(page.getByText("Pick your first hat", { exact: true })).toBeVisible({
        timeout: 20_000,
      });
      await expect.poll(() => new URL(page.url()).pathname).toMatch(/mode-picker$/);

      // The discarded mode row is gone.
      const gone = await fetchModeRow(clerkId, firstModeId);
      expect(gone).toBeNull();
      // users.last_active_mode_id MUST NOT still point at the deleted row
      // (the discard endpoint clears the pointer when it does). It can
      // legitimately remain at the auto-provisioned collab baseline
      // mode that the api-server seeds on first GET /users/me, so we
      // only assert the negative — never the deleted id.
      const lastActive = await fetchLastActiveModeId(clerkId);
      expect(lastActive).not.toBe(firstModeId);

      // The "Home" tile is pickable again — it must NOT be stuck
      // under the "Already activated" disabled copy. We assert via the
      // visible description text (which flips to "Already activated"
      // when disabled) and by re-firing a fresh activate POST below.
      await expect(
        page.getByText(/I run a place I care about/i).first(),
      ).toBeVisible();
      await expect(page.getByText("Already activated").first()).toHaveCount(0);

      // ===== D. Re-pick → fresh intake with empty placeName =====
      const reActivatePromise = page.waitForResponse(
        (r) =>
          /\/api\/users\/me\/modes(\?|$)/.test(r.url()) &&
          r.request().method() === "POST",
        { timeout: 20_000 },
      );
      await page.getByText("Home", { exact: true }).first().click();
      const reActivateResp = await reActivatePromise;
      expect(reActivateResp.ok()).toBeTruthy();
      const reActivated = (await reActivateResp.json()) as { id: number; kind: string };
      expect(reActivated.kind).toBe("home");
      // A genuinely new row, not the discarded one.
      expect(reActivated.id).not.toBe(firstModeId);

      const placeName2 = inputForLabel(page, "Property");
      await expect(placeName2).toBeVisible({ timeout: 20_000 });
      // Empty: the abandoned mode's data did not bleed into the new mode.
      await expect(placeName2).toHaveValue("");
    } finally {
      await cleanup(clerkId);
    }
  });
});

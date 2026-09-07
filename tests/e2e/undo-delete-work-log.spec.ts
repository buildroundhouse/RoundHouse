import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

const FIREBASE_API_KEY = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

function uid(n = 6): string {
  return Math.random().toString(36).slice(2, 2 + n);
}

async function firebaseSignUp(email: string, password: string): Promise<{ idToken: string; localId: string }> {
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

/** Hit /api/users/me once so the server inserts the users row, then mutate
 *  the row + insert a user_modes row to skip the identity / mode-picker /
 *  intake onboarding gates. */
async function bypassOnboarding(idToken: string, clerkId: string, baseURL: string): Promise<void> {
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

/** The Capture FAB has accessibility role="button" but no label. Locate it
 *  by its position (last button in the bottom-right) using the icon class.
 *  We fall back to clicking by coordinates derived from layout. */
async function tapCaptureFab(page: Page): Promise<void> {
  // CaptureFAB is a Pressable with a child Feather "edit-3" icon. On RN web,
  // the icon renders as a <span>/<i> with class containing the glyph code.
  // We just click the only round terracotta button positioned bottom-right.
  const fab = page.locator(
    'div[style*="position: absolute"][style*="bottom"] [role="button"]',
  ).last();
  await fab.waitFor({ state: "visible", timeout: 15_000 });
  await fab.click();
}

test.describe("Property work log: optimistic delete with Undo", () => {
  test.skip(!FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL");

  test("delete shows snackbar; Undo restores; row stays gone after window", async ({ page, baseURL }) => {
    const email = `undo-test-${uid(8)}@example.test`;
    const password = "Pass1234!";
    const propertyName = `UndoHouse ${uid(4)}`;
    const logNote = `UndoTarget ${uid(4)}`;

    // 1) Create the Firebase account out-of-band so we don't depend on the UI.
    const { idToken, localId: clerkId } = await firebaseSignUp(email, password);
    await bypassOnboarding(idToken, clerkId, baseURL!);

    // 2) Sign into the app via the UI so the Firebase web SDK has a session.
    await page.goto("/");
    // The unauthenticated app routes to /(auth)/sign-in.
    await page.getByPlaceholder(/you@example\.com/i).fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();

    // After sign-in + onboarding bypass, we land in (tabs).
    await expect(page.locator('div[style*="position: absolute"][style*="bottom"]'))
      .toBeVisible({ timeout: 20_000 });

    // 3) Create a property + work log via the Capture FAB.
    await tapCaptureFab(page);
    // The "Log work" modal opens directly. Property input is for new-property name.
    const propertyInput = page.getByPlaceholder(/Maple St\. job|river house/i);
    await propertyInput.waitFor({ state: "visible", timeout: 10_000 });
    await propertyInput.fill(propertyName);
    await page.getByPlaceholder(/What did you do\?/i).fill(logNote);
    await page.getByRole("button", { name: /^save$/i }).click();

    // 4) Navigate Properties -> our property -> Logs tab.
    await page.getByRole("button", { name: /^Properties$/i }).first().click().catch(async () => {
      // Tab may render as a link/text rather than a button on RN web.
      await page.getByText(/^Properties$/).first().click();
    });
    await page.getByText(propertyName, { exact: false }).first().click();
    await page.getByText(/^Logs$/).first().click();

    const row = page.locator('div', { hasText: logNote }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    // 5) Delete -> snackbar appears with countdown + Undo.
    await page.getByLabel("Delete work log").first().click();
    await expect(row).toHaveCount(0, { timeout: 5_000 });
    const snackbar = page.getByText(/Work log deleted/);
    await expect(snackbar).toBeVisible();
    await expect(snackbar).toContainText(/·\s*[1-5]s/);
    const undoBtn = page.getByLabel("Undo delete");
    await expect(undoBtn).toBeVisible();

    // 6) Tap Undo -> row restored, snackbar gone.
    await undoBtn.click();
    await expect(snackbar).toBeHidden({ timeout: 3_000 });
    await expect(page.locator('div', { hasText: logNote }).first()).toBeVisible();

    // 7) Delete again, wait past the 5s window, row stays gone, snackbar gone.
    await page.getByLabel("Delete work log").first().click();
    await expect(page.getByText(/Work log deleted/)).toBeVisible();
    await page.waitForTimeout(7_000);
    await expect(page.getByText(/Work log deleted/)).toBeHidden();
    await expect(page.locator('div', { hasText: logNote })).toHaveCount(0);

    // 8) Reload and verify the deletion was finalized server-side.
    await page.reload();
    await page.getByText(/^Logs$/).first().click().catch(() => undefined);
    await expect(page.locator('div', { hasText: logNote })).toHaveCount(0, { timeout: 10_000 });
  });
});

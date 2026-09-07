import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { insertPropertyMember, readPropertyNotifyPrefs } from "./_helpers/propertyMembers";

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
    await pg.query(`UPDATE users SET last_active_mode_id = $1 WHERE clerk_id = $2`, [
      modeRow.rows[0].id,
      clerkId,
    ]);
  } finally {
    await pg.end();
  }
}

type SeededProperty = {
  id: number;
  name: string;
  notifyJobStarted: boolean | null;
  notifyJobCompleted: boolean | null;
};

/** Seed properties owned by the user with mixed prior per-field overrides:
 *   A: notifyJobStarted=true,  notifyJobCompleted=null   (partial, true)
 *   B: notifyJobStarted=false, notifyJobCompleted=false  (both off)
 *   C: notifyJobStarted=null,  notifyJobCompleted=null   (no overrides)
 *   Z: notifyJobStarted=true,  notifyJobCompleted=false  (control - never selected)
 *  All inserts run in a single pg connection for speed.
 */
async function seedPropertiesWithMixedOverrides(args: {
  ownerClerkId: string;
  tag: string;
}): Promise<{ a: SeededProperty; b: SeededProperty; c: SeededProperty; z: SeededProperty }> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    async function makeProp(
      label: string,
      ns: boolean | null,
      nc: boolean | null,
    ): Promise<SeededProperty> {
      const name = `BulkUndo ${args.tag} ${label}`;
      const r = await pg.query<{ id: number }>(
        `INSERT INTO properties (name, address, type, owner_clerk_id)
           VALUES ($1, '1 Test Way', 'home', $2) RETURNING id`,
        [name, args.ownerClerkId],
      );
      const id = r.rows[0].id;
      await insertPropertyMember(pg, {
        propertyId: id,
        userClerkId: args.ownerClerkId,
        role: "owner",
        notifyJobStarted: ns,
        notifyJobCompleted: nc,
      });
      return { id, name, notifyJobStarted: ns, notifyJobCompleted: nc };
    }
    const a = await makeProp("A-startedTrue", true, null);
    const b = await makeProp("B-bothOff", false, false);
    const c = await makeProp("C-default", null, null);
    const z = await makeProp("Z-untouched", true, false);
    return { a, b, c, z };
  } finally {
    await pg.end();
  }
}

/** Read the four override pairs in a single connection for speed. */
async function readAllOverrides(
  ownerClerkId: string,
  ids: number[],
): Promise<Map<number, { notifyJobStarted: boolean | null; notifyJobCompleted: boolean | null }>> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    return await readPropertyNotifyPrefs(pg, ownerClerkId, ids);
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
  await expect(page.getByText("Profile", { exact: true }).first()).toBeVisible({
    timeout: 45_000,
  });
}

async function openBulkPicker(page: Page): Promise<void> {
  const profileBtn = page.getByRole("button", { name: /^Profile$/i }).first();
  if (await profileBtn.isVisible().catch(() => false)) {
    await profileBtn.click();
  } else {
    await page.getByText(/^Profile$/).first().click();
  }
  const trigger = page.getByLabel("Mute job alerts on multiple properties");
  await trigger.waitFor({ state: "visible", timeout: 15_000 });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await expect(page.getByText("Bulk job alerts").last()).toBeVisible({ timeout: 10_000 });
}

const PASSWORD = "Pass1234!";

/** All interactive elements inside the modal now expose accessibilityLabel,
 *  which RN Web maps to aria-label. We use .last() because the modal is a
 *  portal rendered after the underlying Profile screen, which may carry the
 *  same labels in its own property card list. */
async function clickByLabel(page: Page, label: string): Promise<void> {
  const target = page.getByLabel(label).last();
  await target.waitFor({ state: "visible", timeout: 10_000 });
  await target.scrollIntoViewIfNeeded().catch(() => {});
  await target.click();
}

async function setupAndOpenPicker(
  page: Page,
  baseURL: string,
  tag: string,
): Promise<{
  clerkId: string;
  seeded: Awaited<ReturnType<typeof seedPropertiesWithMixedOverrides>>;
}> {
  const email = `bulk-prop-undo-${tag}@example.test`;
  const { idToken, localId: clerkId } = await firebaseSignUp(email, PASSWORD);
  await bypassOnboarding(idToken, clerkId, baseURL);
  const seeded = await seedPropertiesWithMixedOverrides({ ownerClerkId: clerkId, tag });
  await signInViaUI(page, email, PASSWORD);
  await openBulkPicker(page);
  return { clerkId, seeded };
}

test.describe("BulkPropertyMutePickerModal: Undo banner", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("Apply mute-started across mixed prior overrides; Undo restores each property to its exact prior per-field values", async ({
    page,
    baseURL,
  }) => {
    const tag = uid(5);
    const { clerkId, seeded } = await setupAndOpenPicker(page, baseURL!, tag);

    // Select A (started:true), B (both off), C (no override). Leave Z alone.
    await clickByLabel(page, `Toggle selection of ${seeded.a.name}`);
    await clickByLabel(page, `Toggle selection of ${seeded.b.name}`);
    await clickByLabel(page, `Toggle selection of ${seeded.c.name}`);
    await expect(page.getByText("3 selected")).toBeVisible();

    // Apply bulk mute_started.
    await clickByLabel(page, "Mute job started");

    const banner = page.getByText(/Muted job-started alerts on 3 properties\./);
    await expect(banner).toBeVisible({ timeout: 10_000 });
    const undoBtn = page.getByLabel("Undo bulk property change");
    await expect(undoBtn).toBeVisible();

    // Undo immediately, well inside the 5s window.
    await undoBtn.click();
    await expect(banner).toBeHidden({ timeout: 5_000 });

    // Each selected property must be restored to its EXACT prior per-field
    // value (true / false / null) and the unselected control property Z must
    // be unchanged. One pg connection, one query, for speed.
    const after = await readAllOverrides(
      clerkId,
      [seeded.a.id, seeded.b.id, seeded.c.id, seeded.z.id],
    );
    expect(after.get(seeded.a.id)).toEqual({ notifyJobStarted: true, notifyJobCompleted: null });
    expect(after.get(seeded.b.id)).toEqual({ notifyJobStarted: false, notifyJobCompleted: false });
    expect(after.get(seeded.c.id)).toEqual({ notifyJobStarted: null, notifyJobCompleted: null });
    expect(after.get(seeded.z.id)).toEqual({ notifyJobStarted: true, notifyJobCompleted: false });
  });

  test("Undo banner auto-dismisses after ~5s when Undo is not tapped", async ({
    page,
    baseURL,
  }) => {
    const tag = uid(5);
    const { seeded } = await setupAndOpenPicker(page, baseURL!, tag);

    await clickByLabel(page, `Toggle selection of ${seeded.c.name}`);
    await clickByLabel(page, "Mute job started");
    // While pendingUndo is set, the modal renders the Undo banner with the
    // tappable "Undo" button labeled "Undo bulk property change" alongside the
    // success-message text. After ~5s the timer fires, pendingUndo is cleared,
    // and both the Undo affordance AND the success-message text must disappear
    // together so users don't think the change can still be undone.
    const undoBtn = page.getByLabel("Undo bulk property change");
    const successText = page.getByText(/Muted job-started alerts on 1 property\./);
    await expect(undoBtn).toBeVisible({ timeout: 10_000 });
    await expect(successText).toBeVisible();
    await page.waitForTimeout(6_500);
    await expect(undoBtn).toBeHidden();
    await expect(successText).toBeHidden();
  });

  test("Banner clears when the user changes the selection, edits search, toggles Only-overridden, or closes the modal", async ({
    page,
    baseURL,
  }) => {
    const tag = uid(5);
    const { seeded } = await setupAndOpenPicker(page, baseURL!, tag);

    // ---- (1) Changing the selection clears the banner ----
    await clickByLabel(page, `Toggle selection of ${seeded.a.name}`);
    await clickByLabel(page, "Mute job completed");
    const banner1 = page.getByText(/Muted job-completed alerts on 1 property\./);
    await expect(banner1).toBeVisible({ timeout: 10_000 });
    // toggle() is wired to clearUndo() — tapping any property row dismisses.
    await clickByLabel(page, `Toggle selection of ${seeded.b.name}`);
    await expect(banner1).toBeHidden({ timeout: 3_000 });
    // Reset selection so subsequent counts are predictable.
    await clickByLabel(page, `Toggle selection of ${seeded.b.name}`);
    await expect(page.getByText("0 selected")).toBeVisible();

    // ---- (2) Editing the search query clears the banner ----
    await clickByLabel(page, `Toggle selection of ${seeded.a.name}`);
    await clickByLabel(page, "Reset to default");
    const banner2 = page.getByText(/Reset on 1 property\./);
    await expect(banner2).toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder("Search properties").fill("BulkUndo");
    await expect(banner2).toBeHidden({ timeout: 3_000 });
    await page.getByPlaceholder("Search properties").fill("");

    // ---- (3) Toggling "Only overridden" clears the banner ----
    await clickByLabel(page, `Toggle selection of ${seeded.b.name}`);
    await clickByLabel(page, "Mute job completed");
    const banner3 = page.getByText(/Muted job-completed alerts on 1 property\./);
    await expect(banner3).toBeVisible({ timeout: 10_000 });
    await clickByLabel(page, "Only overridden");
    await expect(banner3).toBeHidden({ timeout: 3_000 });
    await clickByLabel(page, "Only overridden");

    // ---- (4) Closing the modal removes the banner ----
    await clickByLabel(page, `Toggle selection of ${seeded.a.name}`);
    await clickByLabel(page, "Turn on job started");
    const banner4 = page.getByText(/Turned on job-started alerts on 1 property\./);
    await expect(banner4).toBeVisible({ timeout: 10_000 });
    await clickByLabel(page, "Done");
    await expect(page.getByText("Bulk job alerts")).toBeHidden({ timeout: 5_000 });
    await expect(banner4).toBeHidden();
  });
});

import { test, expect, type Page, type Request } from "@playwright/test";
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
  // First /users/me upserts the row so we can update it.
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
    // user_modes has no full unique constraint on (user_clerk_id, kind)
    // outside of the *_collab kinds, so insert without ON CONFLICT — this
    // user is fresh.
    const modeRow = await pg.query<{ id: number }>(
      `INSERT INTO user_modes (user_clerk_id, kind, intake_data, intake_completed_at)
         VALUES ($1, 'home', '{}'::jsonb, NOW())
         RETURNING id`,
      [clerkId],
    );
    const modeId = modeRow.rows[0].id;
    await pg.query(`UPDATE users SET last_active_mode_id = $1 WHERE clerk_id = $2`, [
      modeId,
      clerkId,
    ]);
  } finally {
    await pg.end();
  }
}

async function listOutwardAccounts(
  idToken: string,
  baseURL: string,
): Promise<{
  accounts: Array<{ id: number; title: string; displayName: string; kind: string }>;
  activeOutwardAccountId: number | null;
}> {
  const r = await fetch(new URL("/api/outward-accounts", baseURL).toString(), {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!r.ok) {
    throw new Error(`GET /api/outward-accounts failed: ${r.status} ${await r.text()}`);
  }
  return (await r.json()) as {
    accounts: Array<{ id: number; title: string; displayName: string; kind: string }>;
    activeOutwardAccountId: number | null;
  };
}

async function gotoProfileTab(page: Page): Promise<void> {
  // RN-web renders the tab as a Pressable. Try the role first, then fall
  // back to the visible label.
  const profileBtn = page.getByRole("button", { name: /^Profile$/i }).first();
  if (await profileBtn.isVisible().catch(() => false)) {
    await profileBtn.click();
  } else {
    await page.getByText(/^Profile$/).first().click();
  }
  // The PUBLIC PROFILE section header on the profile screen indicates the
  // switcher has mounted.
  await page
    .getByText(/^PUBLIC PROFILE$/)
    .first()
    .waitFor({ state: "visible", timeout: 20_000 });
  await page
    .getByText(/^PUBLIC PROFILE$/)
    .first()
    .scrollIntoViewIfNeeded();
}

test.describe("Public-profile switcher: switch + create + edit + header propagation", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("creates a profile, switches to it, edits its display name, and the active id is sent on later requests", async ({
    page,
    baseURL,
  }) => {
    const email = `switcher-${uid(8)}@example.test`;
    const password = "Pass1234!";
    const newDisplay = `Persona ${uid(5)}`;
    const newTitle = `Side gig ${uid(5)}`;
    const editedDisplay = `${newDisplay} (renamed)`;

    // 1) Provision a Firebase user, then jump past identity / mode-picker /
    //    intake so the (tabs) shell renders immediately on sign-in.
    const { idToken, localId: clerkId } = await firebaseSignUp(email, password);
    await bypassOnboarding(idToken, clerkId, baseURL!);

    // The first authenticated read against the API auto-seeds a default
    // outward account for the user (lazy ensureDefaultOutwardAccount).
    const before = await listOutwardAccounts(idToken, baseURL!);
    expect(before.accounts.length).toBeGreaterThan(0);
    const seededId = before.activeOutwardAccountId!;
    expect(seededId).not.toBeNull();

    // 2) Capture every authenticated request fired by the app so we can
    //    assert the header propagates the active id.
    const apiRequests: Array<{ url: string; activeId: string | null }> = [];
    page.on("request", (req: Request) => {
      const u = req.url();
      if (!u.includes("/api/")) return;
      apiRequests.push({
        url: u,
        activeId: req.headers()["x-active-outward-account-id"] ?? null,
      });
    });

    // 3) Sign in via the UI so the in-page Firebase SDK has a session.
    await page.goto("/");
    await page.getByPlaceholder(/you@example\.com/i).fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.getByText("Sign in", { exact: true }).last().click();

    // Wait for the (tabs) shell to mount.
    await page
      .getByText("Profile", { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });

    // 4) Open the Profile tab and confirm the switcher shows the seeded
    //    profile in the active pill.
    await gotoProfileTab(page);

    const switcherPill = page.getByLabel("Switch or add public profile").first();
    await expect(switcherPill).toBeVisible();

    // 5) Open the switcher overlay and create a brand-new public profile.
    // The Expo web shell stacks an absolutely-positioned GestureHandlerRoot
    // overlay on top of the tab content, intercepting pointer events.
    // Dispatch the click directly on the Pressable element — react-native-web
    // Pressables forward DOM `click` events to onPress.
    await switcherPill.scrollIntoViewIfNeeded();
    await switcherPill.evaluate((el) => {
      (el as HTMLElement).click();
    });
    const createRow = page.getByLabel("Create a new public profile").first();
    await expect(createRow).toBeVisible();
    await createRow.click();

    // The editor modal renders the shared OutwardAccountForm. Fill in
    // title + display name, opt in to "make active", and submit.
    const titleField = page
      .locator('input[placeholder*="My weekend painting business" i]')
      .first();
    await titleField.fill(newTitle);
    const displayField = page
      .locator('input[placeholder*="Cardinal Painting" i]')
      .first();
    await displayField.fill(newDisplay);

    // Submit the create form. We deliberately leave the "Switch to this
    // account when I save" toggle alone — switching is exercised in step 6.
    await page
      .getByText("Create profile", { exact: true })
      .first()
      .click({ force: true });

    // Editor closes when the create mutation resolves.
    await expect(
      page.getByText("Create profile", { exact: true }),
    ).toBeHidden({ timeout: 15_000 });

    // 6) Assert the server now has the new account, and grab its id.
    const after = await listOutwardAccounts(idToken, baseURL!);
    const created = after.accounts.find((a) => a.title === newTitle);
    expect(created, "new outward account should exist").toBeTruthy();

    // 7) Switch to the brand-new account (it's not yet active because we
    //    deliberately left the activate toggle alone). This fires a real
    //    server-side switch mutation and invalidates every query — verify
    //    both the persisted active id and that subsequent /api/* requests
    //    carry the new id in the x-active-outward-account-id header.
    apiRequests.length = 0;
    await switcherPill.evaluate((el) => {
      (el as HTMLElement).click();
    });
    await page
      .getByLabel(`Switch to ${newTitle}`)
      .first()
      .evaluate((el) => {
        (el as HTMLElement).click();
      });

    // The switcher pill on the profile screen should re-render with the
    // new account's title once the switch lands.
    await expect(
      switcherPill.getByText(newTitle, { exact: false }),
    ).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500);

    const afterNewSwitch = await listOutwardAccounts(idToken, baseURL!);
    expect(afterNewSwitch.activeOutwardAccountId).toBe(created!.id);
    const sawNewIdHeader = apiRequests.some(
      (r) => r.activeId === String(created!.id) && r.url.includes("/api/"),
    );
    expect(
      sawNewIdHeader,
      `expected at least one /api/* request to carry x-active-outward-account-id=${created!.id}; saw ${JSON.stringify(
        apiRequests.slice(-10),
      )}`,
    ).toBe(true);

    // 9) Switch back to the originally-seeded account so we validate the
    //    round-trip works in the other direction too.
    apiRequests.length = 0;
    const seededAccount = before.accounts.find((a) => a.id === seededId)!;
    const seededTitle =
      seededAccount.title?.trim() ||
      seededAccount.displayName?.trim() ||
      seededAccount.companyName?.trim() ||
      // Default mode label used by the switcher when no override is set.
      "Home";
    await switcherPill.evaluate((el) => {
      (el as HTMLElement).click();
    });
    await page
      .getByLabel(`Switch to ${seededTitle}`)
      .first()
      .evaluate((el) => {
        (el as HTMLElement).click();
      });

    // Pill re-renders with the seeded persona once the second switch lands.
    await expect(
      switcherPill.getByText(seededTitle, { exact: false }),
    ).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500);

    const afterSeededSwitch = await listOutwardAccounts(idToken, baseURL!);
    expect(afterSeededSwitch.activeOutwardAccountId).toBe(seededId);
    const sawSeededHeader = apiRequests.some(
      (r) => r.activeId === String(seededId) && r.url.includes("/api/"),
    );
    expect(
      sawSeededHeader,
      `expected at least one /api/* request to carry x-active-outward-account-id=${seededId} after the second switch; saw ${JSON.stringify(
        apiRequests.slice(-10),
      )}`,
    ).toBe(true);

    // 10) Edit the new profile via the switcher and rename its display.
    await switcherPill.evaluate((el) => {
      (el as HTMLElement).click();
    });
    await page.getByLabel(`Edit ${newTitle}`).first().click({ force: true });
    const displayFieldEdit = page
      .locator('input[placeholder*="Cardinal Painting" i]')
      .first();
    await displayFieldEdit.fill(editedDisplay);
    await page
      .getByText("Save changes", { exact: true })
      .first()
      .evaluate((el) => {
        (el as HTMLElement).click();
      });

    // Modal closes; the persisted update sticks server-side.
    await expect(
      page.getByText("Save changes", { exact: true }),
    ).toBeHidden({ timeout: 10_000 });

    const afterEdit = await listOutwardAccounts(idToken, baseURL!);
    const renamed = afterEdit.accounts.find((a) => a.id === created!.id);
    expect(renamed?.displayName).toBe(editedDisplay);
  });

  test("creating a new profile with the 'Switch to this account when I save' toggle enabled auto-activates it", async ({
    page,
    baseURL,
  }) => {
    const email = `switcher-auto-${uid(8)}@example.test`;
    const password = "Pass1234!";
    const newDisplay = `AutoPersona ${uid(5)}`;
    const newTitle = `Auto gig ${uid(5)}`;

    const { idToken, localId: clerkId } = await firebaseSignUp(email, password);
    await bypassOnboarding(idToken, clerkId, baseURL!);

    const before = await listOutwardAccounts(idToken, baseURL!);
    const seededId = before.activeOutwardAccountId!;
    expect(seededId).not.toBeNull();

    await page.goto("/");
    await page.getByPlaceholder(/you@example\.com/i).fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.getByText("Sign in", { exact: true }).last().click();

    await page
      .getByText("Profile", { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });

    await gotoProfileTab(page);

    const switcherPill = page.getByLabel("Switch or add public profile").first();
    await expect(switcherPill).toBeVisible();
    await switcherPill.scrollIntoViewIfNeeded();
    await switcherPill.evaluate((el) => {
      (el as HTMLElement).click();
    });
    const createRow = page.getByLabel("Create a new public profile").first();
    await expect(createRow).toBeVisible();
    await createRow.click();

    const titleField = page
      .locator('input[placeholder*="My weekend painting business" i]')
      .first();
    await titleField.fill(newTitle);
    const displayField = page
      .locator('input[placeholder*="Cardinal Painting" i]')
      .first();
    await displayField.fill(newDisplay);

    // Enable the activate-on-save toggle via its accessible name. This is
    // the path the toggle was given an accessibilityRole/Label for — no
    // DOM-ancestor walking required.
    const activateToggle = page
      .getByRole("button", { name: "Switch to this account when I save" })
      .first();
    await expect(activateToggle).toBeVisible();
    await activateToggle.click();

    await page
      .getByText("Create profile", { exact: true })
      .first()
      .click({ force: true });

    await expect(
      page.getByText("Create profile", { exact: true }),
    ).toBeHidden({ timeout: 15_000 });

    // Server-side: the new account exists AND it's the active one.
    const after = await listOutwardAccounts(idToken, baseURL!);
    const created = after.accounts.find((a) => a.title === newTitle);
    expect(created, "new outward account should exist").toBeTruthy();
    expect(after.activeOutwardAccountId).toBe(created!.id);

    // The pill on the profile screen should reflect the new active persona.
    await expect(
      switcherPill.getByText(newTitle, { exact: false }),
    ).toBeVisible({ timeout: 15_000 });
  });
});

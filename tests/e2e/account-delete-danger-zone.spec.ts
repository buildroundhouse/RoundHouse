import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
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

type Seeded = { primaryId: number; sideId: number; spareId: number };

async function bypassOnboardingAndSeedAccounts(
  _idToken: string,
  clerkId: string,
  email: string,
): Promise<Seeded> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  // Insert the user row directly (skipping the api server's lazy
  // /api/users/me path which also tries to seed a default outward
  // account and may collide with the dev DB schema). Seeding three
  // outward accounts below means the lazy creator is a no-op when the
  // app eventually calls /api/users/me.
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    const username = "danger" + Math.random().toString(36).slice(2, 8);
    await pg.query(
      `INSERT INTO users (clerk_id, email, name, username, avatar_url, identity_completed_at)
         VALUES ($1, $2, $3, $4, 'public/seed-avatar.png', NOW())
         ON CONFLICT (clerk_id) DO UPDATE
           SET username = EXCLUDED.username,
               avatar_url = EXCLUDED.avatar_url,
               identity_completed_at = EXCLUDED.identity_completed_at`,
      [clerkId, email, "Danger Tester", username],
    );
    await pg.query(
      `INSERT INTO user_modes (user_clerk_id, kind, intake_data, intake_completed_at)
         VALUES ($1, 'home', '{}'::jsonb, NOW())`,
      [clerkId],
    );
    async function makeAcct(label: string): Promise<number> {
      const r = await pg.query<{ id: number }>(
        `INSERT INTO outward_accounts (owner_clerk_id, kind, title, display_name)
           VALUES ($1, 'home', $2, $2) RETURNING id`,
        [clerkId, label],
      );
      return r.rows[0].id;
    }
    const primaryId = await makeAcct("Primary Skin");
    const sideId = await makeAcct("Side Skin");
    const spareId = await makeAcct("Spare Skin");
    await pg.query(`UPDATE users SET active_outward_account_id = $1 WHERE clerk_id = $2`, [
      primaryId,
      clerkId,
    ]);
    // One live connection that touches sideId so the impact preview reports 1.
    // The legacy from_clerk_id / to_clerk_id NOT NULL columns still live on the
    // table; both endpoints belong to the same user in this test.
    await pg.query(
      `INSERT INTO user_connections
         (from_outward_account_id, to_outward_account_id, from_clerk_id, to_clerk_id, kind, status)
         VALUES ($1, $2, $3, $3, 'collaborator', 'accepted')`,
      [primaryId, sideId, clerkId],
    );
    return { primaryId, sideId, spareId };
  } finally {
    await pg.end();
  }
}

async function readArchivedAt(
  table: "outward_accounts" | "user_connections",
  whereSql: string,
  params: unknown[],
): Promise<(Date | null)[]> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    const r = await pg.query<{ archived_at: Date | null }>(
      `SELECT archived_at FROM ${table} WHERE ${whereSql}`,
      params,
    );
    return r.rows.map((row) => row.archived_at);
  } finally {
    await pg.end();
  }
}

async function countLiveAccounts(clerkId: string): Promise<number> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    const r = await pg.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
         FROM outward_accounts
        WHERE owner_clerk_id = $1 AND archived_at IS NULL`,
      [clerkId],
    );
    return Number(r.rows[0].c);
  } finally {
    await pg.end();
  }
}

async function signInViaUI(page: Page, email: string, password: string, baseURL: string): Promise<void> {
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`[browser:err] ${m.text()}`);
  });
  page.on("pageerror", (e) => console.log(`[browser:throw] ${e.message}`));
  await page.goto(baseURL);
  const emailInput = page.getByPlaceholder(/you@example\.com/i);
  await emailInput.waitFor({ state: "visible", timeout: 45_000 });
  await emailInput.fill(email);
  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.fill(password);
  await passwordInput.press("Enter");
  // Wait for sign-in to complete and the app shell to settle past auth/onboarding.
  await page.waitForURL(
    (u) => !/sign-in|sign-up/.test(u.pathname),
    { timeout: 45_000 },
  );
  // And wait for the api client to attach the Firebase id token to /api/users/me.
  await page.waitForResponse(
    (r) => r.url().includes("/api/users/me") && r.status() === 200,
    { timeout: 45_000 },
  );
}

async function gotoAccountList(page: Page, baseURL: string): Promise<void> {
  await page.goto(new URL("/account", baseURL).toString());
  await expect(page.getByText("Outward-facing accounts").first()).toBeVisible({
    timeout: 30_000,
  });
}

async function openEditFor(page: Page, baseURL: string, accountId: number): Promise<void> {
  // The account list's "Edit" pill currently has no accessibilityLabel — multiple
  // cards expose the same "Edit" text. Routing directly is both reliable and
  // exactly what the pill's onPress handler does (router.push("/account/edit/:id")).
  await page.goto(new URL(`/account/edit/${accountId}`, baseURL).toString());
  await expect(page.getByText("Danger zone").first()).toBeVisible({ timeout: 15_000 });
}

async function apiDelete(
  request: APIRequestContext,
  baseURL: string,
  idToken: string,
  accountId: number,
): Promise<{ status: number; body: string }> {
  const res = await request.post(new URL(`/api/outward-accounts/${accountId}/delete`, baseURL).toString(), {
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    data: {},
  });
  return { status: res.status(), body: await res.text() };
}

const PASSWORD = "Pass1234!";

test.describe("Danger zone: Delete this account", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("blocked states + impact preview + post-delete switcher refresh", async ({
    page,
    request,
    baseURL,
  }) => {
    void baseURL;
    const tag = uid(8);
    const email = `danger-${tag}@example.test`;
    const resolvedBaseURL =
      baseURL ||
      process.env.E2E_BASE_URL ||
      (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://localhost:80");
    const { idToken, localId: clerkId } = await firebaseSignUp(email, PASSWORD);
    const seeded = await bypassOnboardingAndSeedAccounts(idToken, clerkId, email);

    await signInViaUI(page, email, PASSWORD, resolvedBaseURL);
    await gotoAccountList(page, resolvedBaseURL);

    // All three skins render; Primary is ACTIVE.
    await expect(page.getByText("Primary Skin", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Side Skin", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Spare Skin", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/ACTIVE/i).first()).toBeVisible();

    // ---- Scenario A: BLOCKED — editing the ACTIVE account ----
    // Primary has 1 outgoing connection (to Side), so the danger button text is
    // "Delete with history retained". The blocked-reason line still applies.
    await openEditFor(page, resolvedBaseURL, seeded.primaryId);
    const blockedActive = page.getByText(
      /Switch to another account before deleting this one\./i,
    );
    await expect(blockedActive).toBeVisible();
    const deleteBtnA = page
      .getByText(/Delete with history retained|Delete this account/, { exact: true })
      .first();
    await expect(deleteBtnA).toBeVisible();
    // Press it; nothing should happen (button is disabled / no-op when blocked).
    await deleteBtnA.click({ trial: false }).catch(() => {});
    await expect(page.getByText("Danger zone").first()).toBeVisible();
    // Server-side safety rail also refuses outright.
    const refuseActive = await apiDelete(request, resolvedBaseURL, idToken, seeded.primaryId);
    expect(refuseActive.status).toBe(409);

    // Back to /account.
    await page.goto(new URL("/account", resolvedBaseURL).toString());
    await expect(page.getByText("Outward-facing accounts").first()).toBeVisible();

    // ---- Scenario B: HAPPY PATH — delete a non-active account with one connection ----
    await openEditFor(page, resolvedBaseURL, seeded.sideId);
    // Impact preview mentions the connection count.
    await expect(
      page.getByText(/This account has\s+1\s+connection/i).first(),
    ).toBeVisible({ timeout: 15_000 });
    // Button text reflects the with-connections variant and is enabled (no
    // blocked-reason copy in the danger panel).
    await expect(
      page.getByText(/Delete with history retained/, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(
        /You need to keep at least one account\.|Switch to another account before deleting this one\./,
      ),
    ).toHaveCount(0);

    // react-native-web's Alert.alert does not surface the destructive choice to
    // Playwright. Fire the same POST the destructive callback would issue, then
    // assert the UI refreshes.
    const okSide = await apiDelete(request, resolvedBaseURL, idToken, seeded.sideId);
    expect(okSide.status).toBe(200);

    await page.goto(new URL("/account", resolvedBaseURL).toString());
    await expect(page.getByText("Outward-facing accounts").first()).toBeVisible();
    await expect(page.getByText("Side Skin", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Primary Skin", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Spare Skin", { exact: true }).first()).toBeVisible();

    // Soft-delete confirmed at the DB level for both account + connection.
    const sideArchived = await readArchivedAt("outward_accounts", "id = $1", [seeded.sideId]);
    expect(sideArchived[0]).not.toBeNull();
    const connArchived = await readArchivedAt(
      "user_connections",
      "from_outward_account_id = $1 AND to_outward_account_id = $2",
      [seeded.primaryId, seeded.sideId],
    );
    expect(connArchived[0]).not.toBeNull();

    // ---- Scenario C: BLOCKED — only remaining account ----
    // Knock Spare out so Primary is the lone surviving account.
    const okSpare = await apiDelete(request, resolvedBaseURL, idToken, seeded.spareId);
    expect(okSpare.status).toBe(200);

    await page.goto(new URL("/account", resolvedBaseURL).toString());
    await expect(page.getByText("Outward-facing accounts").first()).toBeVisible();
    await expect(page.getByText("Spare Skin", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Primary Skin", { exact: true }).first()).toBeVisible();

    // Editing Primary now: it's both the ACTIVE account AND the only one. The
    // component's precedence (isActive before isOnly) means the rendered copy
    // is the active-account line, but either blocked-reason wording satisfies
    // the requirement that the button be blocked here.
    await openEditFor(page, resolvedBaseURL, seeded.primaryId);
    const blockedReasonOnly = page.getByText(
      /(Switch to another account before deleting this one\.|You need to keep at least one account\. Create another one first\.)/,
    );
    await expect(blockedReasonOnly.first()).toBeVisible();
    // Primary's only outgoing connection (to Side) is now archived alongside
    // Side, so the with-connections branch flips back and the button reads
    // "Delete this account".
    const deleteBtnC = page
      .getByText(/Delete this account|Delete with history retained/, { exact: true })
      .first();
    await deleteBtnC.click({ trial: false }).catch(() => {});
    // Still on the edit screen; no navigation away.
    await expect(page.getByText("Danger zone").first()).toBeVisible();

    // Server safety rail still refuses with 409.
    const refuseLast = await apiDelete(request, resolvedBaseURL, idToken, seeded.primaryId);
    expect(refuseLast.status).toBe(409);
    expect(refuseLast.body).toMatch(
      /at least one outward account|Switch to another account|cannot delete/i,
    );

    // Final tally: exactly one live outward account remains.
    expect(await countLiveAccounts(clerkId)).toBe(1);
  });
});

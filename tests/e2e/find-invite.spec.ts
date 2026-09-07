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

/** Create the user row + skip the identity / mode-picker / intake gates so
 *  the app drops the test user straight into (tabs). */
async function bypassOnboarding(
  idToken: string,
  clerkId: string,
  baseURL: string,
  username?: string,
  displayName?: string,
): Promise<void> {
  const meRes = await fetch(new URL("/api/users/me", baseURL).toString(), {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!meRes.ok) {
    throw new Error(`GET /api/users/me failed: ${meRes.status} ${await meRes.text()}`);
  }
  const pg = new Client({ connectionString: DATABASE_URL! });
  await pg.connect();
  try {
    const sets: string[] = [
      `avatar_url = 'public/seed-avatar.png'`,
      `identity_completed_at = NOW()`,
    ];
    const params: unknown[] = [clerkId];
    if (username) {
      params.push(username);
      sets.push(`username = $${params.length}`);
    }
    if (displayName) {
      params.push(displayName);
      sets.push(`name = $${params.length}`);
    }
    const sql = `UPDATE users SET ${sets.join(", ")} WHERE clerk_id = $1`;
    await pg.query(sql, params);
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
  // RN web's Pressable does not expose role="button"; pressing Enter on the
  // password field triggers onSubmitEditing → handleSubmit which is the most
  // reliable cross-render path.
  await passwordInput.press("Enter");
  await expect(page.getByText("Properties").first())
    .toBeVisible({ timeout: 45_000 });
}

test.describe("Find: invite flow", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("People lane: searching for a missing person opens the invite modal and shows a confirmation banner after inviting", async ({
    page,
    baseURL,
  }) => {
    const tag = uid(6);
    const password = "Pass1234!";

    // Inviter: signs in and exercises the UI.
    const inviterEmail = `find-people-inviter-${tag}@example.test`;
    const inviter = await firebaseSignUp(inviterEmail, password);
    await bypassOnboarding(inviter.idToken, inviter.localId, baseURL!);

    // Target: a real user with a deterministic, unique username so the
    // UserSearchModal returns exactly one inviteable row.
    const targetEmail = `find-people-target-${tag}@example.test`;
    const targetUsername = `findtest_${tag}`;
    const targetName = `Find Test Target ${tag}`;
    const target = await firebaseSignUp(targetEmail, password);
    await bypassOnboarding(
      target.idToken,
      target.localId,
      baseURL!,
      targetUsername,
      targetName,
    );

    await signInViaUI(page, inviterEmail, password);
    await page.goto("/find");
    await expect(page.getByText("Find").first()).toBeVisible({ timeout: 30_000 });

    // 1. Search for a string that has no relationship matches and confirm
    //    the empty state + "Invite a person" CTA.
    const peopleSearch = page.getByPlaceholder(/Search by name or @username/i);
    await peopleSearch.waitFor({ state: "visible", timeout: 15_000 });
    await peopleSearch.fill(`zzzmissing_${tag}`);
    await expect(page.getByText("No matches")).toBeVisible({ timeout: 10_000 });
    const invitePersonCta = page.getByLabel("Invite a person");
    await expect(invitePersonCta).toBeVisible();

    // 2. Open the UserSearchModal and search for the deterministic target
    //    user. Assert at least one Invite pill is present and tap it.
    await invitePersonCta.dispatchEvent("click");
    const modalSearch = page.getByPlaceholder("Name or @username", { exact: true });
    await expect(modalSearch).toBeVisible({ timeout: 10_000 });
    await modalSearch.fill("");
    await modalSearch.fill(targetUsername);
    const inviteBtn = page.getByText("Invite", { exact: true }).first();
    await expect(inviteBtn).toBeVisible({ timeout: 15_000 });
    await inviteBtn.dispatchEvent("click");

    // 3. Modal closes and the green "Invite sent to <name>." banner appears
    //    on the Find screen.
    const banner = page.getByText(/^Invite sent to /).first();
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText(targetName);

    // Server-side: a pending collaborator connection now exists between the
    // two users.
    const pg = new Client({ connectionString: DATABASE_URL! });
    await pg.connect();
    try {
      // user_connections is now keyed by outward-account ids. Resolve
      // each user's outward accounts and look for any pending edge
      // between them in either direction.
      const { rows } = await pg.query<{ status: string; kind: string }>(
        `SELECT uc.status, uc.kind
           FROM user_connections uc
           JOIN outward_accounts oa_from ON oa_from.id = uc.from_outward_account_id
           JOIN outward_accounts oa_to   ON oa_to.id   = uc.to_outward_account_id
           WHERE (oa_from.owner_clerk_id = $1 AND oa_to.owner_clerk_id = $2)
              OR (oa_from.owner_clerk_id = $2 AND oa_to.owner_clerk_id = $1)`,
        [inviter.localId, target.localId],
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].status).toBe("pending");
      expect(rows[0].kind).toBe("collaborator");
    } finally {
      await pg.end();
    }
  });

  test("Businesses lane: no-results state opens the invite modal; both the email and share-link paths leave the user in a sane state", async ({
    page,
    baseURL,
  }) => {
    const tag = uid(6);
    const email = `find-biz-inviter-${tag}@example.test`;
    const password = "Pass1234!";

    const inviter = await firebaseSignUp(email, password);
    await bypassOnboarding(inviter.idToken, inviter.localId, baseURL!);

    await signInViaUI(page, email, password);
    await page.goto("/find");
    await expect(page.getByText("Find").first()).toBeVisible({ timeout: 30_000 });

    // Switch to the Businesses lane.
    await page.getByText("Businesses", { exact: true }).first().dispatchEvent("click");

    // Search for a name that won't match anything.
    const bizName = `ZZZ Nonexistent ${tag}`;
    const bizInput = page.getByPlaceholder(/Business name/i);
    await expect(bizInput).toBeVisible({ timeout: 10_000 });
    await bizInput.fill(bizName);

    // Empty state + Invite a business CTA.
    await expect(page.getByText("No businesses match")).toBeVisible({
      timeout: 15_000,
    });
    const inviteBizCta = page.getByLabel("Invite a business");
    await expect(inviteBizCta).toBeVisible();

    // === Email path: confirms the banner fires from BusinessInviteModal. ===
    await inviteBizCta.dispatchEvent("click");
    await expect(page.getByText("Invite a business").first()).toBeVisible({
      timeout: 10_000,
    });
    const emailInput = page.getByPlaceholder(/hello@business\.com/i);
    await emailInput.waitFor({ state: "visible", timeout: 10_000 });
    await emailInput.fill(`recipient-${tag}@example.test`);

    // The web build of Linking.openURL("mailto:") triggers a window.open for
    // a mailto URL. Playwright surfaces that as a popup; allow it (and any
    // dialog) to be auto-dismissed so it does not interfere with the modal.
    page.on("popup", (p) => {
      p.close().catch(() => {});
    });

    await page.getByText("Send email invite").dispatchEvent("click");

    const banner = page.getByText(/^Invite sent to /).first();
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText(bizName);

    // === Share-link path (success): stub navigator.share to resolve so the
    // modal commits the invite and fires the same banner. ===
    // Wait for the email-path banner to auto-dismiss (4s) then re-open the modal.
    await expect(banner).toBeHidden({ timeout: 6_000 });
    await inviteBizCta.dispatchEvent("click");
    await expect(page.getByText("Invite a business").first()).toBeVisible({
      timeout: 10_000,
    });

    // React Native Web's Share.share() delegates to navigator.share and
    // returns whatever it resolves with. The modal then checks
    // `result.action !== Share.dismissedAction` to fire onInviteSent, so we
    // stub navigator.share to resolve with a sharedAction-shaped object.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: () => Promise.resolve({ action: "sharedAction" }),
      });
    });

    await page.getByText("Share invite link").dispatchEvent("click");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText(bizName);
  });

  test("Businesses lane: share-link path surfaces an inline error when the device cannot share", async ({
    page,
    baseURL,
  }) => {
    const tag = uid(6);
    const email = `find-biz-share-err-${tag}@example.test`;
    const password = "Pass1234!";

    const inviter = await firebaseSignUp(email, password);
    await bypassOnboarding(inviter.idToken, inviter.localId, baseURL!);

    await signInViaUI(page, email, password);
    await page.goto("/find");
    await expect(page.getByText("Find").first()).toBeVisible({ timeout: 30_000 });
    await page.getByText("Businesses", { exact: true }).first().dispatchEvent("click");

    const bizName = `ZZZ Nonexistent ${tag}`;
    const bizInput = page.getByPlaceholder(/Business name/i);
    await expect(bizInput).toBeVisible({ timeout: 10_000 });
    await bizInput.fill(bizName);

    await expect(page.getByText("No businesses match")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByLabel("Invite a business").dispatchEvent("click");
    await expect(page.getByText("Invite a business").first()).toBeVisible({
      timeout: 10_000,
    });

    // Force navigator.share to reject so we exercise the catch branch.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: () =>
          Promise.reject(new Error("Share is not supported in this browser.")),
      });
    });

    await page.getByText("Share invite link").dispatchEvent("click");

    const errorMsg = page.getByText(
      /Share is not supported|Could not open share sheet/,
    );
    await expect(errorMsg.first()).toBeVisible({ timeout: 10_000 });
    // Modal stays open; no confirmation banner fires.
    await expect(page.getByText("Invite a business").first()).toBeVisible();
    await expect(page.getByText(/^Invite sent to /)).toHaveCount(0);
  });
});

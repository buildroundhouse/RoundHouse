/**
 * E2E coverage for the company-notices feature (#476).
 *
 * Flow:
 *   1. Sign up two fresh Firebase users — `admin` and `member`.
 *   2. Bypass onboarding for both so the app drops them straight into
 *      `(tabs)`.
 *   3. Seed a `trade_pro` outward account owned by `admin` and an
 *      `accepted` (non-admin) team seat for `member` on that same skin.
 *   4. Sign in as the admin in the default page, navigate to
 *      `/reminders`, post a notice from the Company Reminders section.
 *   5. Sign in as the member in a separate browser context, navigate to
 *      `/reminders`, verify the notice is visible, and tap "Got it" to
 *      dismiss it.
 *   6. Verify dismissal persists by reloading.
 *   7. Clean up the seeded rows in the database.
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

async function seedCompanyAndSeat(
  ownerClerkId: string,
  memberClerkId: string,
  companyName: string,
): Promise<{ companyId: number; seatId: number }> {
  const pg = new Client({ connectionString: DATABASE_URL! });
  await pg.connect();
  try {
    const company = await pg.query<{ id: number }>(
      `INSERT INTO outward_accounts
         (owner_clerk_id, kind, title, display_name, company_name, capability_state)
         VALUES ($1, 'trade_pro', $2, $2, $2, 'expanded')
         RETURNING id`,
      [ownerClerkId, companyName],
    );
    const companyId = company.rows[0].id;
    const seat = await pg.query<{ id: number }>(
      `INSERT INTO team_seats
         (company_outward_account_id, member_clerk_id, role, is_admin,
          permissions, status, accepted_at)
         VALUES ($1, $2, 'employee', false,
                 '{"manageTeam": false}'::jsonb, 'accepted', NOW())
         RETURNING id`,
      [companyId, memberClerkId],
    );
    return { companyId, seatId: seat.rows[0].id };
  } finally {
    await pg.end();
  }
}

async function cleanup(
  companyId: number | null,
  clerkIds: string[],
): Promise<void> {
  if (!DATABASE_URL) return;
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    if (companyId != null) {
      await pg.query(
        `DELETE FROM company_notice_acks
           WHERE notice_id IN
             (SELECT id FROM company_notices WHERE company_outward_account_id = $1)`,
        [companyId],
      );
      await pg.query(
        `DELETE FROM company_notices WHERE company_outward_account_id = $1`,
        [companyId],
      );
      await pg.query(
        `DELETE FROM team_seats WHERE company_outward_account_id = $1`,
        [companyId],
      );
      await pg.query(`DELETE FROM outward_accounts WHERE id = $1`, [companyId]);
    }
    if (clerkIds.length > 0) {
      await pg.query(
        `DELETE FROM outward_accounts WHERE owner_clerk_id = ANY($1::text[])`,
        [clerkIds],
      );
      await pg.query(
        `DELETE FROM user_modes WHERE user_clerk_id = ANY($1::text[])`,
        [clerkIds],
      );
      await pg.query(
        `DELETE FROM users WHERE clerk_id = ANY($1::text[])`,
        [clerkIds],
      );
    }
  } finally {
    await pg.end();
  }
}

async function signInViaUI(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
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
  // The (tabs) shell renders a "Reminders" link in the side stack as a
  // landmark we can wait on. Falling back to "Properties" mirrors other
  // specs and works for both home- and pro-mode dashboards.
  await expect(
    page.getByText(/Reminders|Properties/).first(),
  ).toBeVisible({ timeout: 45_000 });
}

test.describe("Company notices: post -> see -> dismiss (#476)", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("admin posts a notice; member sees it on /reminders and dismisses it", async ({
    browser,
    baseURL,
  }) => {
    const tag = uid(8);
    const password = "Pass1234!";
    const adminEmail = `cn-admin-${tag}@example.test`;
    const memberEmail = `cn-member-${tag}@example.test`;
    const companyName = `Acme E2E ${tag}`;
    const noticeTitle = `E2E notice ${tag}`;
    const noticeBody = `Posted by company-notices.spec at ${new Date().toISOString()}.`;

    let companyId: number | null = null;
    const cleanupClerkIds: string[] = [];

    try {
      const admin = await firebaseSignUp(adminEmail, password);
      cleanupClerkIds.push(admin.localId);
      await bypassOnboarding(admin.idToken, admin.localId, baseURL!);

      const member = await firebaseSignUp(memberEmail, password);
      cleanupClerkIds.push(member.localId);
      await bypassOnboarding(member.idToken, member.localId, baseURL!);

      // Make admin the owner of a trade_pro skin and seat the member on
      // it as an accepted (non-admin) employee. This is what makes the
      // composer button appear for the admin and the notice visible to
      // the member.
      const seeded = await seedCompanyAndSeat(
        admin.localId,
        member.localId,
        companyName,
      );
      companyId = seeded.companyId;

      // ===== Admin: post the notice =====
      const adminCtx = await browser.newContext();
      const adminPage = await adminCtx.newPage();
      await signInViaUI(adminPage, adminEmail, password);
      await adminPage.goto("/reminders");
      await expect(
        adminPage.getByText("Company Reminders").first(),
      ).toBeVisible({ timeout: 30_000 });

      const composerBtn = adminPage
        .getByText("Post a company notice", { exact: true })
        .first();
      await expect(composerBtn).toBeVisible({ timeout: 15_000 });
      await composerBtn.click();

      await expect(
        adminPage.getByText("New company notice", { exact: true }),
      ).toBeVisible({ timeout: 10_000 });
      await adminPage
        .getByPlaceholder(/Title \(e\.g\. Holiday hours\)/)
        .fill(noticeTitle);
      await adminPage
        .getByPlaceholder(/What does the team need to know\?/)
        .fill(noticeBody);
      await adminPage.getByText("Post notice", { exact: true }).click();

      // The admin sees their own notice in the list (with both
      // Acknowledge and Delete affordances since canDelete=true).
      await expect(
        adminPage.getByLabel(`Acknowledge ${noticeTitle}`),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        adminPage.getByLabel(`Delete ${noticeTitle}`),
      ).toBeVisible();

      // ===== Member: see and dismiss the notice =====
      const memberCtx = await browser.newContext();
      const memberPage = await memberCtx.newPage();
      await signInViaUI(memberPage, memberEmail, password);
      await memberPage.goto("/reminders");
      await expect(
        memberPage.getByText("Company Reminders").first(),
      ).toBeVisible({ timeout: 30_000 });

      // The notice authored by the admin shows up for the member.
      const memberAck = memberPage.getByLabel(`Acknowledge ${noticeTitle}`);
      await expect(memberAck).toBeVisible({ timeout: 20_000 });
      // Member is not an admin of the skin, so canDelete=false and the
      // Delete button must NOT be rendered for them.
      await expect(
        memberPage.getByLabel(`Delete ${noticeTitle}`),
      ).toHaveCount(0);
      // Member is not in any postable company, so the composer button
      // is hidden for them.
      await expect(
        memberPage.getByText("Post a company notice", { exact: true }),
      ).toHaveCount(0);

      await memberAck.click();
      // The acknowledged notice is removed from the live feed.
      await expect(
        memberPage.getByLabel(`Acknowledge ${noticeTitle}`),
      ).toHaveCount(0, { timeout: 15_000 });

      // Reload — the dismissal persists because it was sent to the
      // server, not just stashed in local state.
      await memberPage.reload();
      await expect(
        memberPage.getByText("Company Reminders").first(),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        memberPage.getByLabel(`Acknowledge ${noticeTitle}`),
      ).toHaveCount(0);

      await adminCtx.close();
      await memberCtx.close();
    } finally {
      await cleanup(companyId, cleanupClerkIds);
    }
  });
});

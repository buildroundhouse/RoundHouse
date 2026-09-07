/**
 * E2E coverage for company-notice read receipts (#485).
 *
 * The new `NoticeReadByRow` under each `CompanyNoticeRow` in the
 * Reminders hub should:
 *   - render `Acknowledged by X of N` plus the acknowledgers' avatars/
 *     names ONLY for the notice's sender or for users with
 *     manageTeam / isAdmin on the company; non-admin recipients must
 *     never see the row.
 *   - update from `Acknowledged by 0 of N` to `Acknowledged by 1 of N`
 *     (and surface the acknowledger's name) after a member taps
 *     "Got it".
 *
 * Flow:
 *   1. Sign up two fresh Firebase users — `admin` and `member` — and
 *      bypass onboarding for both. Set `users.name` for the member so
 *      the read-by names row is deterministic.
 *   2. Seed a `trade_pro` outward account owned by `admin` with one
 *      accepted, non-admin seat for `member`. recipientCount = 2.
 *   3. Sign in as the admin in one context, post a notice on
 *      `/reminders`, and assert the read-by row reads
 *      `Acknowledged by 0 of 2` with no names line.
 *   4. Sign in as the member in a separate context, navigate to
 *      `/reminders`, and assert the read-by row is NOT rendered for
 *      the member (no `Acknowledged by` text inside the notice card).
 *      Then tap "Got it" to acknowledge.
 *   5. Reload the admin's `/reminders` and assert the read-by row now
 *      reads `Acknowledged by 1 of 2` and the names line shows the
 *      member's seeded `users.name`.
 *   6. Clean up the seeded rows (notice, acks, seat, company, users).
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
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
  displayName?: string,
): Promise<void> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const meRes = await fetch(new URL("/api/users/me", baseURL).toString(), {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!meRes.ok) throw new Error(`GET /api/users/me failed: ${meRes.status} ${await meRes.text()}`);
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    if (displayName) {
      await pg.query(
        `UPDATE users
           SET avatar_url = 'public/seed-avatar.png',
               name = $2,
               identity_completed_at = NOW()
           WHERE clerk_id = $1`,
        [clerkId, displayName],
      );
    } else {
      await pg.query(
        `UPDATE users
           SET avatar_url = 'public/seed-avatar.png',
               identity_completed_at = NOW()
           WHERE clerk_id = $1`,
        [clerkId],
      );
    }
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
  await expect(
    page.getByText(/Reminders|Properties/).first(),
  ).toBeVisible({ timeout: 45_000 });
}

/**
 * Locate the notice card (the wrapping `View` rendered by
 * `CompanyNoticeRow`) for a given title. We use the Acknowledge
 * button's accessibility label as the anchor and walk up to the
 * card container so visible-text assertions are scoped to that one
 * row, not to the whole Company Reminders section.
 */
function noticeCard(page: Page, title: string): Locator {
  // The Acknowledge button is inside `noticeActionsRow`, which is
  // inside `noticeCard`. On Expo web each `View` becomes a `div`, so
  // walking up to the third ancestor lands on the card. Using
  // `:scope` + `xpath=ancestor::div[contains(@class, "noticeCard")]`
  // would be brittle (RNW class hashes are not stable), so we
  // anchor on the title `Text` element and rely on the card being
  // its closest non-text-wrapper ancestor that also contains the
  // Acknowledge button.
  return page
    .getByLabel(`Acknowledge ${title}`)
    .locator(
      'xpath=ancestor::*[descendant::*[contains(normalize-space(.), "' +
        title +
        '")]][1]',
    );
}

test.describe("Company notice read receipts (#485)", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("admin sees Acknowledged by X of N + acknowledger; member never sees the row", async ({
    browser,
    baseURL,
  }) => {
    const tag = uid(8);
    const password = "Pass1234!";
    const adminEmail = `cn-rr-admin-${tag}@example.test`;
    const memberEmail = `cn-rr-member-${tag}@example.test`;
    const memberDisplayName = `Riley Member ${tag}`;
    const companyName = `Acme RR ${tag}`;
    const noticeTitle = `Read receipts e2e ${tag}`;
    const noticeBody = `Posted by company-notice-read-receipts.spec at ${new Date().toISOString()}.`;

    let companyId: number | null = null;
    const cleanupClerkIds: string[] = [];

    try {
      const admin = await firebaseSignUp(adminEmail, password);
      cleanupClerkIds.push(admin.localId);
      await bypassOnboarding(admin.idToken, admin.localId, baseURL!);

      const member = await firebaseSignUp(memberEmail, password);
      cleanupClerkIds.push(member.localId);
      await bypassOnboarding(
        member.idToken,
        member.localId,
        baseURL!,
        memberDisplayName,
      );

      const seeded = await seedCompanyAndSeat(
        admin.localId,
        member.localId,
        companyName,
      );
      companyId = seeded.companyId;

      // ===== Admin: post the notice and verify pre-ack read-by row =====
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

      await expect(
        adminPage.getByLabel(`Acknowledge ${noticeTitle}`),
      ).toBeVisible({ timeout: 15_000 });

      // The seeded company has 2 recipients (owner + 1 seat). Pre-ack,
      // the read-by row should show "Acknowledged by 0 of 2" inside
      // the admin's notice card.
      const adminCard = noticeCard(adminPage, noticeTitle);
      await expect(adminCard.getByText(/Acknowledged by 0 of 2/)).toBeVisible({
        timeout: 15_000,
      });
      // No acknowledgers yet → no names line under the summary.
      await expect(
        adminCard.getByText(memberDisplayName, { exact: true }),
      ).toHaveCount(0);

      // ===== Member: never sees the read-by row, then acks =====
      const memberCtx = await browser.newContext();
      const memberPage = await memberCtx.newPage();
      await signInViaUI(memberPage, memberEmail, password);
      await memberPage.goto("/reminders");
      await expect(
        memberPage.getByText("Company Reminders").first(),
      ).toBeVisible({ timeout: 30_000 });

      const memberAck = memberPage.getByLabel(`Acknowledge ${noticeTitle}`);
      await expect(memberAck).toBeVisible({ timeout: 20_000 });

      // Inside the member's view of the notice card there must be NO
      // "Acknowledged by ..." summary — non-admin recipients don't
      // get the read-by row. (The notice itself has the substring
      // "Acknowledge" in its button label, hence the strict regex.)
      const memberCard = noticeCard(memberPage, noticeTitle);
      await expect(memberCard.getByText(/Acknowledged by/)).toHaveCount(0);

      // Sanity: composer button is not rendered for the non-admin.
      await expect(
        memberPage.getByText("Post a company notice", { exact: true }),
      ).toHaveCount(0);

      await memberAck.click();
      await expect(
        memberPage.getByLabel(`Acknowledge ${noticeTitle}`),
      ).toHaveCount(0, { timeout: 15_000 });

      // ===== Admin: count + acknowledger update =====
      // Re-navigate to force the /company-notices query to refetch.
      await adminPage.goto("/reminders");
      await expect(
        adminPage.getByText("Company Reminders").first(),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        adminPage.getByLabel(`Acknowledge ${noticeTitle}`),
      ).toBeVisible({ timeout: 15_000 });

      const adminCardAfter = noticeCard(adminPage, noticeTitle);
      await expect(
        adminCardAfter.getByText(/Acknowledged by 1 of 2/),
      ).toBeVisible({ timeout: 15_000 });
      // The names line under the summary should now show the
      // acknowledger's seeded display name.
      await expect(
        adminCardAfter.getByText(memberDisplayName, { exact: true }),
      ).toBeVisible();
      // The avatar stack should now render an actual acknowledger
      // avatar — either the seeded `users.avatar_url` Image or, if
      // the avatar URL didn't resolve, a fallback bubble whose
      // initial matches `ackInitial(member)` (first letter of the
      // display name, uppercased). The pre-ack people-glyph
      // fallback should be gone.
      const memberInitial = memberDisplayName.trim().charAt(0).toUpperCase();
      await expect(
        adminCardAfter
          .locator('img[src*="seed-avatar"], :text-is("' + memberInitial + '")')
          .first(),
      ).toBeVisible({ timeout: 10_000 });

      await adminCtx.close();
      await memberCtx.close();
    } finally {
      await cleanup(companyId, cleanupClerkIds);
    }
  });
});

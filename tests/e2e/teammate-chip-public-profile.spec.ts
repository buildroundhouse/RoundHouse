/**
 * E2E coverage for #558: admin-seeded teammate chips render on the
 * lead's public profile (added by #557 via the `chip` / `chipOther`
 * fields on `PublicTeamMember` and the `GET /users/:userId/team`
 * route).
 *
 * Scenario:
 *   - Admin (Trade Pro lead) has an accepted teammate (no chip set).
 *   - Admin opens ManageTeamModal on /my-team and uses the
 *     `Change chip` row to set the teammate's chip to "Other…" with
 *     free text "Lead Plumber". The PATCH succeeds.
 *   - A separate visitor signs in, finds the admin via /find, opens
 *     `PublicProfileModal`, and sees the teammate row inside the
 *     TEAM section subtitle as `@username · Employee · Lead Plumber`.
 *
 * Companion design doc:
 *   artifacts/round-house/e2e/teammate-chip-public-profile.test-plan.md
 *
 * Mirrors the per-test signup + SQL seed + cleanup pattern of
 * `per-client-pro-tag.spec.ts` so each run is deterministic and
 * isolated.
 */
import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

const FIREBASE_API_KEY = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

const CHIP_FREE_TEXT = "Lead Plumber";

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

/**
 * Force the API to lazily provision a `users` row for the new
 * Firebase user, then in SQL flip onboarding flags and (re-)seed
 * the user_modes / outward_accounts / users.visibility fields the
 * relevant flows depend on.
 *
 * `visibilityTeam = true` is required on the lead so the
 * `GET /users/:userId/team` route returns the seeded teammate to
 * non-owner viewers (the route returns `[]` otherwise — see
 * artifacts/api-server/src/routes/users.ts).
 *
 * The `member` kind only needs a signed-in `users` row + name +
 * username — it has no outward account and never needs to sign in
 * for this test.
 */
async function seedAccount(
  idToken: string,
  clerkId: string,
  baseURL: string,
  opts:
    | {
        kind: "trade_pro";
        displayName: string;
        username: string;
        companyName: string;
        visibilityTeam: boolean;
      }
    | {
        kind: "home";
        displayName: string;
        username: string;
      }
    | {
        kind: "member";
        displayName: string;
        username: string;
      },
): Promise<{ outwardAccountId: number | null; userModeId: number | null }> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  // Touch /users/me so the row exists.
  const meRes = await fetch(new URL("/api/users/me", baseURL).toString(), {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!meRes.ok) {
    throw new Error(`GET /api/users/me failed: ${meRes.status} ${await meRes.text()}`);
  }
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    if (opts.kind === "trade_pro") {
      await pg.query(
        `UPDATE users
           SET name = $2,
               username = $3,
               avatar_url = 'public/seed-avatar.png',
               identity_completed_at = NOW(),
               services = '[{"name":"Plumbing"}]'::jsonb,
               visibility = $4::jsonb
           WHERE clerk_id = $1`,
        [
          clerkId,
          opts.displayName,
          opts.username,
          JSON.stringify({ team: opts.visibilityTeam }),
        ],
      );
      const intake = {
        companyName: opts.companyName,
        ownerName: opts.displayName,
        trade: "plumber",
        experience: "5-10",
        region: "E2E Region",
        primaryZip: "10001",
        services: [{ name: "Plumbing" }],
      };
      const modeRow = await pg.query<{ id: number }>(
        `INSERT INTO user_modes (user_clerk_id, kind, intake_data, intake_completed_at)
           VALUES ($1, 'trade_pro', $2::jsonb, NOW())
           RETURNING id`,
        [clerkId, JSON.stringify(intake)],
      );
      const userModeId = modeRow.rows[0].id;
      const outward = await pg.query<{ id: number }>(
        `INSERT INTO outward_accounts
           (owner_clerk_id, kind, title, display_name, company_name,
            source_user_mode_id, capability_state)
           VALUES ($1, 'trade_pro', $2, $2, $2, $3, 'expanded')
           RETURNING id`,
        [clerkId, opts.companyName, userModeId],
      );
      const outwardAccountId = outward.rows[0].id;
      await pg.query(
        `UPDATE users
           SET last_active_mode_id = $1,
               active_outward_account_id = $2
           WHERE clerk_id = $3`,
        [userModeId, outwardAccountId, clerkId],
      );
      return { outwardAccountId, userModeId };
    }
    if (opts.kind === "home") {
      await pg.query(
        `UPDATE users
           SET name = $2,
               username = $3,
               avatar_url = 'public/seed-avatar.png',
               identity_completed_at = NOW()
           WHERE clerk_id = $1`,
        [clerkId, opts.displayName, opts.username],
      );
      const modeRow = await pg.query<{ id: number }>(
        `INSERT INTO user_modes (user_clerk_id, kind, intake_data, intake_completed_at)
           VALUES ($1, 'home', '{"placeName":"E2E Home","matters":["maintenance"]}'::jsonb, NOW())
           RETURNING id`,
        [clerkId],
      );
      const userModeId = modeRow.rows[0].id;
      const outward = await pg.query<{ id: number }>(
        `INSERT INTO outward_accounts
           (owner_clerk_id, kind, title, display_name,
            source_user_mode_id, capability_state)
           VALUES ($1, 'home', $2, $2, $3, 'expanded')
           RETURNING id`,
        [clerkId, opts.displayName, userModeId],
      );
      const outwardAccountId = outward.rows[0].id;
      await pg.query(
        `UPDATE users
           SET last_active_mode_id = $1,
               active_outward_account_id = $2
           WHERE clerk_id = $3`,
        [userModeId, outwardAccountId, clerkId],
      );
      return { outwardAccountId, userModeId };
    }
    // member
    await pg.query(
      `UPDATE users
         SET name = $2,
             username = $3,
             avatar_url = 'public/seed-avatar.png',
             identity_completed_at = NOW()
         WHERE clerk_id = $1`,
      [clerkId, opts.displayName, opts.username],
    );
    return { outwardAccountId: null, userModeId: null };
  } finally {
    await pg.end();
  }
}

/**
 * Insert the admin → member team-membership row at status `accepted`,
 * role `employee`, with chip + chipOther cleared. The test then drives
 * the chip update from the UI.
 */
async function seedTeamMembership(
  leadClerkId: string,
  memberClerkId: string,
): Promise<number> {
  const pg = new Client({ connectionString: DATABASE_URL! });
  await pg.connect();
  try {
    const row = await pg.query<{ id: number }>(
      `INSERT INTO user_team_members
         (lead_clerk_id, member_clerk_id, role, status, accepted_at)
         VALUES ($1, $2, 'employee', 'accepted', NOW())
         RETURNING id`,
      [leadClerkId, memberClerkId],
    );
    return row.rows[0].id;
  } finally {
    await pg.end();
  }
}

async function cleanup(
  outwardAccountIds: number[],
  clerkIds: string[],
): Promise<void> {
  if (!DATABASE_URL) return;
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    if (clerkIds.length > 0) {
      await pg.query(
        `DELETE FROM user_team_members
           WHERE lead_clerk_id = ANY($1::text[])
              OR member_clerk_id = ANY($1::text[])`,
        [clerkIds],
      );
    }
    if (outwardAccountIds.length > 0) {
      await pg.query(
        `DELETE FROM user_connections
           WHERE from_outward_account_id = ANY($1::int[])
              OR to_outward_account_id = ANY($1::int[])`,
        [outwardAccountIds],
      );
      await pg.query(
        `DELETE FROM outward_accounts WHERE id = ANY($1::int[])`,
        [outwardAccountIds],
      );
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
  // Land somewhere inside the (tabs) shell.
  await expect(
    page.getByText(/Reminders|Properties|Clients|My Team/).first(),
  ).toBeVisible({ timeout: 45_000 });
}

test.describe("Teammate chip on public profile (#558)", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("admin saves teammate chip from ManageTeamModal; visitor sees it on the public profile", async ({
    browser,
    baseURL,
  }) => {
    const tag = uid(8);
    const password = "Pass1234!";
    const adminEmail = `tcc-admin-${tag}@example.test`;
    const visitorEmail = `tcc-visitor-${tag}@example.test`;
    const memberEmail = `tcc-member-${tag}@example.test`;
    const adminName = `Admin ${tag}`;
    const adminUsername = `admin_${tag}`.toLowerCase();
    const visitorName = `Visitor ${tag}`;
    const visitorUsername = `visitor_${tag}`.toLowerCase();
    const memberName = `Mate ${tag}`;
    const memberUsername = `mate_${tag}`.toLowerCase();
    const companyName = `TCC Co ${tag}`;

    const cleanupClerkIds: string[] = [];
    const cleanupOutwardIds: number[] = [];

    try {
      const admin = await firebaseSignUp(adminEmail, password);
      cleanupClerkIds.push(admin.localId);
      const adminSeed = await seedAccount(admin.idToken, admin.localId, baseURL!, {
        kind: "trade_pro",
        displayName: adminName,
        username: adminUsername,
        companyName,
        visibilityTeam: true,
      });
      if (adminSeed.outwardAccountId) cleanupOutwardIds.push(adminSeed.outwardAccountId);

      const member = await firebaseSignUp(memberEmail, password);
      cleanupClerkIds.push(member.localId);
      await seedAccount(member.idToken, member.localId, baseURL!, {
        kind: "member",
        displayName: memberName,
        username: memberUsername,
      });

      const visitor = await firebaseSignUp(visitorEmail, password);
      cleanupClerkIds.push(visitor.localId);
      const visitorSeed = await seedAccount(visitor.idToken, visitor.localId, baseURL!, {
        kind: "home",
        displayName: visitorName,
        username: visitorUsername,
      });
      if (visitorSeed.outwardAccountId) cleanupOutwardIds.push(visitorSeed.outwardAccountId);

      await seedTeamMembership(admin.localId, member.localId);

      // ===== A. Admin: set the chip via ManageTeamModal =====
      const adminCtx = await browser.newContext();
      const adminPage = await adminCtx.newPage();
      await signInViaUI(adminPage, adminEmail, password);
      await adminPage.goto("/my-team");
      // The Trade Pro Teammates section header is the deterministic
      // landmark for the admin's manage-team surface.
      await expect(
        adminPage.getByText("Trade Pro Teammates", { exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        adminPage.getByText(memberName, { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });

      // Open ManageTeamModal via the section's "Manage" affordance.
      // Multiple "Manage" texts can exist on screen; scope to the one
      // grouped with the user-plus icon next to the section header by
      // taking the first match — the my-team teamSection passes
      // onManage to TeamSection's headerRow Manage button.
      await adminPage.getByText("Manage", { exact: true }).first().click();
      await expect(
        adminPage.getByText("Manage team", { exact: true }),
      ).toBeVisible({ timeout: 10_000 });

      // The TEAMMATE CHIPS section renders one row per member with a
      // trailing "Change chip" pressable. Tap that row for the seeded
      // teammate.
      const chipRow = adminPage
        .getByText(memberName, { exact: false })
        .filter({ hasText: "No chip" })
        .first();
      await expect(chipRow).toBeVisible({ timeout: 10_000 });
      await chipRow.click();

      // ChangeChipSheet is open; pick "Other…" then type the free text.
      await expect(
        adminPage.getByText("Change chip", { exact: true }).first(),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        adminPage.getByText(`For ${memberName}`, { exact: true }),
      ).toBeVisible();
      // ManageTeamModal renders TWO chip sections: one in the invite
      // form (visible behind the sheet) and one inside ChangeChipSheet.
      // Both contain a literal "Other…" pill and a "Describe…" input,
      // so we MUST scope to the sheet (anchored on the unique
      // "For <member>" + "Save" + "Other…" trio) to avoid driving the
      // invite form.
      const sheet = adminPage
        .getByText(`For ${memberName}`, { exact: true })
        .locator(
          'xpath=ancestor::*[descendant::*[normalize-space(.)="Save"] and descendant::*[normalize-space(.)="Other…"]][1]',
        );
      await expect(sheet).toBeVisible({ timeout: 5_000 });
      const otherText = sheet.getByText("Other…", { exact: true }).first();
      await expect(otherText).toBeVisible({ timeout: 5_000 });
      // RNW Pressable wraps the Text in a div that listens for `click`,
      // but the surrounding ScrollView intercepts pointer events from
      // Playwright's input pipeline. Dispatch a synthetic click that
      // bubbles up to the Pressable to fire onPress directly.
      await otherText.evaluate((el) => {
        (el as HTMLElement).dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      const describeInput = sheet.getByPlaceholder("Describe…").first();
      await expect(describeInput).toBeVisible({ timeout: 5_000 });
      await describeInput.fill(CHIP_FREE_TEXT);

      // PATCH /users/me/team/:memberClerkId/chip should succeed.
      const patchPromise = adminPage.waitForResponse(
        (resp) =>
          /\/api\/users\/me\/team\/[^/]+\/chip/.test(resp.url()) &&
          resp.request().method() === "PATCH",
        { timeout: 15_000 },
      );
      await sheet.getByText("Save", { exact: true }).first().click();
      const patchResp = await patchPromise;
      expect(
        patchResp.ok(),
        `PATCH /users/me/team/*/chip should succeed; got ${patchResp.status()} ${await patchResp.text()}`,
      ).toBeTruthy();
      const patchJson = (await patchResp.json()) as {
        ok: boolean;
        chip: string | null;
        chipOther: string | null;
      };
      expect(patchJson.chip).toBe("other");
      expect(patchJson.chipOther).toBe(CHIP_FREE_TEXT);

      // The TEAMMATE CHIPS row now shows the chosen label.
      await expect(
        adminPage
          .getByText(memberName, { exact: false })
          .filter({ hasText: CHIP_FREE_TEXT })
          .first(),
      ).toBeVisible({ timeout: 10_000 });

      // ===== B. Visitor: opens admin's public profile and sees chip =====
      const visitorCtx = await browser.newContext();
      const visitorPage = await visitorCtx.newPage();
      await signInViaUI(visitorPage, visitorEmail, password);
      await visitorPage.goto("/find");

      // The "Find people" search box uses a debounced query into
      // useSearchUsers; type the admin's username for an exact match.
      const peopleSearch = visitorPage
        .getByPlaceholder(/Name or @username/)
        .first();
      await expect(peopleSearch).toBeVisible({ timeout: 15_000 });
      await peopleSearch.fill(adminUsername);

      const adminHandle = visitorPage
        .getByText(`@${adminUsername}`, { exact: true })
        .first();
      await expect(adminHandle).toBeVisible({ timeout: 15_000 });

      // Open PublicProfileModal AND wait for the GET /users/:id/team
      // request that backs TeamSection. Run them concurrently so the
      // listener attaches before the modal mounts.
      await Promise.all([
        visitorPage.waitForResponse(
          (resp) =>
            /\/api\/users\/[^/]+\/team(\?|$)/.test(resp.url()) &&
            resp.request().method() === "GET",
          { timeout: 30_000 },
        ),
        adminHandle.click(),
      ]);

      // The TEAM section header renders only when the team route
      // returned at least one member. The teammate row's subtitle
      // line (built by TeamSection) reads
      // `@<username> · Employee · Lead Plumber`.
      await expect(
        visitorPage.getByText("TEAM", { exact: true }).first(),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        visitorPage.getByText(memberName, { exact: true }).first(),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        visitorPage
          .getByText(
            new RegExp(
              `@${memberUsername}\\s*·\\s*Employee\\s*·\\s*${CHIP_FREE_TEXT}`,
            ),
          )
          .first(),
      ).toBeVisible({ timeout: 10_000 });

      await adminCtx.close();
      await visitorCtx.close();
    } finally {
      await cleanup(cleanupOutwardIds, cleanupClerkIds);
    }
  });
});

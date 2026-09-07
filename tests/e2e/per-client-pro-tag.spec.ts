/**
 * E2E coverage for the per-client pro tag flow (#520 + #523).
 *
 * Scenario:
 *   - A connected (Trade Pro, homeowner) pair exists.
 *   - When the pro has NOT picked a per-client tag, the homeowner
 *     opening the pro's PublicProfileModal sees the generic role
 *     pill (`Plumber`).
 *   - When the pro picks a service title + on-site identity for that
 *     specific client via the `Tag` affordance on the Clients tab,
 *     the homeowner subsequently opening the pro's profile sees the
 *     composed `Service · Identity` line under the pro's name and the
 *     role pill is no longer rendered.
 *
 * Companion design doc:
 *   artifacts/round-house/e2e/per-client-pro-tag.test-plan.md
 *
 * Mirrors the per-test signup + SQL seed + cleanup pattern from
 * `company-notice-read-receipts.spec.ts` so each run is deterministic
 * and isolated.
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";

const FIREBASE_API_KEY = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

const SERVICE_NAME = "Plumbing";
const ON_SITE_IDENTITY_LABEL = "Specialist";
const ON_SITE_IDENTITY_VALUE = "specialist";
const TRADE_KEY = "plumber";
const TRADE_LABEL = "Plumber";

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
 * Firebase user (the auth middleware does this on the first
 * authenticated request), then in SQL flip onboarding-completed flags
 * and (re-)seed the user_modes / outward_accounts / users.services
 * fields the per-client tag flow depends on.
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
        services: string[];
      }
    | {
        kind: "home";
        displayName: string;
        username: string;
      },
): Promise<{ outwardAccountId: number; userModeId: number }> {
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
               services = $4::jsonb
           WHERE clerk_id = $1`,
        [
          clerkId,
          opts.displayName,
          opts.username,
          JSON.stringify(opts.services.map((name) => ({ name }))),
        ],
      );
      const intake = {
        companyName: opts.companyName,
        ownerName: opts.displayName,
        trade: TRADE_KEY,
        experience: "5-10",
        region: "E2E Region",
        primaryZip: "10001",
        services: opts.services.map((name) => ({ name })),
      };
      const modeRow = await pg.query<{ id: number }>(
        `INSERT INTO user_modes (user_clerk_id, kind, intake_data, intake_completed_at)
           VALUES ($1, 'trade_pro', $2::jsonb, NOW())
           ON CONFLICT (user_clerk_id, kind) DO UPDATE
             SET intake_data = EXCLUDED.intake_data,
                 intake_completed_at = EXCLUDED.intake_completed_at
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
    // home
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
         ON CONFLICT (user_clerk_id, kind) DO UPDATE
           SET intake_completed_at = EXCLUDED.intake_completed_at
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
  } finally {
    await pg.end();
  }
}

/**
 * Insert the two `user_connections` rows that wire the pro and
 * homeowner together. Direction matters here:
 *
 *   - `client → pro` (kind=core, accepted, all tag fields NULL): the
 *     row that backs `PublicProfileModal.connection` for the
 *     homeowner viewing the pro AND the row the pro PATCHes from
 *     `pro-self-tag`. The pro is the to-side, satisfying the
 *     `serviceTitle` / `onSiteIdentity` authz check on
 *     `PATCH /users/me/connections/:id`.
 *   - `pro → client` (kind=client, accepted): surfaces the
 *     homeowner on the pro's Clients tab so the Tag affordance is
 *     reachable.
 */
async function seedConnectionPair(
  proOutwardAccountId: number,
  clientOutwardAccountId: number,
): Promise<{ clientToProId: number; proToClientId: number }> {
  const pg = new Client({ connectionString: DATABASE_URL! });
  await pg.connect();
  try {
    const c2p = await pg.query<{ id: number }>(
      `INSERT INTO user_connections
         (from_outward_account_id, to_outward_account_id, kind, status,
          requested_at, responded_at)
         VALUES ($1, $2, 'core', 'accepted', NOW(), NOW())
         RETURNING id`,
      [clientOutwardAccountId, proOutwardAccountId],
    );
    const p2c = await pg.query<{ id: number }>(
      `INSERT INTO user_connections
         (from_outward_account_id, to_outward_account_id, kind, status,
          requested_at, responded_at)
         VALUES ($1, $2, 'client', 'accepted', NOW(), NOW())
         RETURNING id`,
      [proOutwardAccountId, clientOutwardAccountId],
    );
    return { clientToProId: c2p.rows[0].id, proToClientId: p2c.rows[0].id };
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

/**
 * Scope assertions to the PublicProfileModal hero block by anchoring
 * on the pro's display name `Text` and walking up to the closest
 * ancestor that also contains the `@username` handle. RNW class names
 * are hashed and unstable, so we anchor on visible text rather than
 * styles. The hero block is the only place in the modal that contains
 * BOTH the display name and the handle.
 */
function publicProfileHero(page: Page, name: string, username: string): Locator {
  return page
    .getByText(name, { exact: true })
    .first()
    .locator(
      `xpath=ancestor::*[descendant::*[normalize-space(.)="@${username}"]][1]`,
    );
}

test.describe("Per-client pro tag (#520 + #523)", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("homeowner sees role pill, then composed Service · Identity after the pro tags them", async ({
    browser,
    baseURL,
  }) => {
    const tag = uid(8);
    const password = "Pass1234!";
    const proEmail = `pct-pro-${tag}@example.test`;
    const clientEmail = `pct-client-${tag}@example.test`;
    const proName = `Pro ${tag}`;
    const proUsername = `pro_${tag}`.toLowerCase();
    const clientName = `Client ${tag}`;
    const clientUsername = `client_${tag}`.toLowerCase();
    const companyName = `PCT Co ${tag}`;

    const cleanupClerkIds: string[] = [];
    const cleanupOutwardIds: number[] = [];

    try {
      const pro = await firebaseSignUp(proEmail, password);
      cleanupClerkIds.push(pro.localId);
      const proSeed = await seedAccount(pro.idToken, pro.localId, baseURL!, {
        kind: "trade_pro",
        displayName: proName,
        username: proUsername,
        companyName,
        services: [SERVICE_NAME],
      });
      cleanupOutwardIds.push(proSeed.outwardAccountId);

      const client = await firebaseSignUp(clientEmail, password);
      cleanupClerkIds.push(client.localId);
      const clientSeed = await seedAccount(client.idToken, client.localId, baseURL!, {
        kind: "home",
        displayName: clientName,
        username: clientUsername,
      });
      cleanupOutwardIds.push(clientSeed.outwardAccountId);

      await seedConnectionPair(proSeed.outwardAccountId, clientSeed.outwardAccountId);

      // ===== A. Homeowner: fallback role pill, no per-client tag =====
      const clientCtx = await browser.newContext();
      const clientPage = await clientCtx.newPage();
      await signInViaUI(clientPage, clientEmail, password);
      await clientPage.goto("/my-team");
      await expect(
        clientPage.getByText(proName, { exact: true }).first(),
      ).toBeVisible({ timeout: 30_000 });

      await clientPage.getByText(proName, { exact: true }).first().click();
      // Modal header is "Profile" — wait until it appears so we know
      // the modal has mounted before scoping locators.
      await expect(
        clientPage.getByText("Profile", { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });

      const heroBefore = publicProfileHero(clientPage, proName, proUsername);
      await expect(heroBefore.getByText(proName, { exact: true })).toBeVisible();
      await expect(heroBefore.getByText(`@${proUsername}`, { exact: true })).toBeVisible();
      // Fallback role pill resolves from intake.trade = "plumber".
      await expect(heroBefore.getByText(TRADE_LABEL, { exact: true })).toBeVisible({
        timeout: 10_000,
      });
      // No per-client tag yet — neither the service title nor any
      // on-site identity label should appear in the hero block.
      await expect(heroBefore.getByText(SERVICE_NAME, { exact: true })).toHaveCount(0);
      for (const label of ["Contractor", "Handyman", "Specialist", "Technician", "Vendor"]) {
        await expect(heroBefore.getByText(label, { exact: true })).toHaveCount(0);
      }

      // ===== B. Pro: tag themselves for this client =====
      const proCtx = await browser.newContext();
      const proPage = await proCtx.newPage();
      await signInViaUI(proPage, proEmail, password);
      await proPage.goto("/clients");
      // The Clients tab renders the homeowner row; the Tag affordance
      // exposes a deterministic accessibilityLabel pre-tag.
      const tagBtn = proPage.getByLabel(`Tag yourself for ${clientName}`);
      await expect(tagBtn).toBeVisible({ timeout: 30_000 });
      // No `Edit tag` affordance and no `You show up as:` preview yet.
      await expect(
        proPage.getByLabel(`Change how you show up for ${clientName}`),
      ).toHaveCount(0);
      await expect(proPage.getByText(/You show up as:/)).toHaveCount(0);

      await tagBtn.click();
      await expect(
        proPage.getByText("How do you show up?", { exact: true }),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        proPage.getByText(`For ${clientName}`, { exact: true }),
      ).toBeVisible();
      // The pro's seeded `users.services` populates the chip group.
      await expect(
        proPage.getByText(/at least one Service/),
      ).toHaveCount(0);

      // Pick the service title chip then the on-site identity chip.
      await proPage.getByText(SERVICE_NAME, { exact: true }).first().click();
      await proPage
        .getByText(ON_SITE_IDENTITY_LABEL, { exact: true })
        .first()
        .click();

      // PATCH /users/me/connections/:id must accept the pro's
      // serviceTitle + onSiteIdentity update — the pro is the
      // to-side on the client→pro row, so authz allows it.
      const patchPromise = proPage.waitForResponse(
        (resp) =>
          /\/api\/users\/me\/connections\/\d+/.test(resp.url()) &&
          resp.request().method() === "PATCH",
        { timeout: 15_000 },
      );
      await proPage.getByText("Save", { exact: true }).first().click();
      const patchResp = await patchPromise;
      expect(
        patchResp.ok(),
        `PATCH /users/me/connections/* should succeed; got ${patchResp.status()} ${await patchResp.text()}`,
      ).toBeTruthy();

      // Modal closes and the Tag affordance flips to the edit label.
      await expect(
        proPage.getByText("How do you show up?", { exact: true }),
      ).toHaveCount(0, { timeout: 10_000 });
      await expect(
        proPage.getByLabel(`Change how you show up for ${clientName}`),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        proPage.getByText(
          `You show up as: ${SERVICE_NAME} · ${ON_SITE_IDENTITY_LABEL}`,
          { exact: true },
        ),
      ).toBeVisible();

      // ===== C. Homeowner: composed per-client tag now renders =====
      // Force a clean refetch by reloading /my-team in the existing
      // context — the cached profile from step A would otherwise mask
      // the new tag fields until the next focus refetch.
      await clientPage.reload();
      await clientPage.goto("/my-team");
      await expect(
        clientPage.getByText(proName, { exact: true }).first(),
      ).toBeVisible({ timeout: 30_000 });
      await clientPage.getByText(proName, { exact: true }).first().click();
      await expect(
        clientPage.getByText("Profile", { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });

      const heroAfter = publicProfileHero(clientPage, proName, proUsername);
      await expect(heroAfter.getByText(proName, { exact: true })).toBeVisible();
      await expect(heroAfter.getByText(`@${proUsername}`, { exact: true })).toBeVisible();
      // Composed line: label = service title, chip = identity. They
      // render as separate `Text` nodes joined by ` · `.
      await expect(heroAfter.getByText(SERVICE_NAME, { exact: true })).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        heroAfter.getByText(ON_SITE_IDENTITY_LABEL, { exact: true }),
      ).toBeVisible();
      // The hasPerClientTag branch in PublicProfileModal short-circuits
      // the role pill — `Plumber` must NOT appear in the hero block
      // anymore.
      await expect(heroAfter.getByText(TRADE_LABEL, { exact: true })).toHaveCount(0);

      // Composed presentation: the label, the ` · ` separator, and the
      // chip render as three sibling `Text` nodes inside the
      // `perClientTagRow`. Assert the visible text of the hero block
      // contains them in order so a regression that flips the order,
      // drops the separator, or renders the chip ahead of the label
      // is caught explicitly.
      await expect(heroAfter).toContainText(
        new RegExp(`${SERVICE_NAME}\\s*·\\s*${ON_SITE_IDENTITY_LABEL}`),
      );

      // Negative: no OTHER on-site identity label leaks into the hero
      // block after tagging (defends against future chip-list
      // refactors that might double-render).
      for (const label of ["Contractor", "Handyman", "Technician", "Vendor"]) {
        await expect(heroAfter.getByText(label, { exact: true })).toHaveCount(0);
      }

      await proCtx.close();
      await clientCtx.close();
    } finally {
      await cleanup(cleanupOutwardIds, cleanupClerkIds);
    }
  });
});

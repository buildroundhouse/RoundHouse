/**
 * E2E coverage for #678: PublicProfileModal renders the picked outward
 * account ("skin") avatar — typically the company / brand image of an
 * operator skin — instead of the underlying owner's personal headshot
 * when the modal is opened from a row tied to a specific OA.
 *
 * Scenario:
 *   - One owner has TWO non-archived operator skins (kind = `facilities`):
 *       OA-A: companyName "WithLogo …", avatar_url = `public/oa-logo-…png`
 *       OA-B: companyName "NoLogo …",   avatar_url = NULL
 *   - The owner's user-level avatar is set to `public/owner-avatar-…png`.
 *   - A visitor signs in, opens /find, and types the owner's @username.
 *     The People search returns one row per OA (server-side join), so
 *     both OA-A and OA-B render as their own rows.
 *
 * Assertions:
 *   - Case A — open modal from the OA-A row (which carries the OA's
 *     `outwardAccountId`). The hero <img> src MUST resolve to OA-A's
 *     `oa-logo` path (the picked skin's company logo wins).
 *   - Case B — close, then open from the OA-B row. OA-B exists (so the
 *     server returns `counterpartOutwardAccount`) but has no avatar of
 *     its own, so the modal MUST fall back to the owner's
 *     `owner-avatar` path. A regression that always falls back to the
 *     owner's avatar would pass case B but FAIL case A; a regression
 *     that always uses the OA's avatar (even when null) would FAIL
 *     case B because the hero would be blank / placeholder.
 *
 * Mirrors the per-test signup + SQL seed + cleanup pattern of
 * `teammate-chip-public-profile.spec.ts` so each run is deterministic.
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

async function touchUsersMe(idToken: string, baseURL: string): Promise<void> {
  const r = await fetch(new URL("/api/users/me", baseURL).toString(), {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!r.ok) throw new Error(`GET /api/users/me failed: ${r.status} ${await r.text()}`);
}

/**
 * Seed an "owner" user with:
 *   - personal `users.avatar_url` pointing at the owner-avatar path
 *   - active `home` mode (so the owner has a sane mode + can sign in)
 *   - two non-archived operator skins (kind = facilities):
 *       withLogo: companyName + avatar_url set
 *       noLogo:   companyName set, avatar_url NULL
 *   - `users.visibility` opens the team chip surfaces (not strictly
 *     required for this spec but harmless and matches sibling tests).
 *
 * Returns OA ids so the cleanup helper can drop them.
 */
async function seedOwnerWithTwoSkins(
  idToken: string,
  clerkId: string,
  baseURL: string,
  opts: {
    displayName: string;
    username: string;
    ownerAvatarPath: string;
    withLogoCompany: string;
    withLogoAvatarPath: string;
    noLogoCompany: string;
  },
): Promise<{ withLogoOaId: number; noLogoOaId: number; ownerModeId: number }> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  await touchUsersMe(idToken, baseURL);
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    await pg.query(
      `UPDATE users
         SET name = $2,
             username = $3,
             avatar_url = $4,
             identity_completed_at = NOW(),
             visibility = '{"team":true}'::jsonb
         WHERE clerk_id = $1`,
      [clerkId, opts.displayName, opts.username, opts.ownerAvatarPath],
    );
    const modeRow = await pg.query<{ id: number }>(
      `INSERT INTO user_modes (user_clerk_id, kind, intake_data, intake_completed_at)
         VALUES ($1, 'home', '{"placeName":"E2E Home","matters":["maintenance"]}'::jsonb, NOW())
         RETURNING id`,
      [clerkId],
    );
    const ownerModeId = modeRow.rows[0].id;
    // The collab baseline OA is auto-created by /users/me (already
    // touched above) — it's `kind='collab'` and is excluded from
    // /users/search by the route's `ne(kind,'collab')` filter, so it
    // does not affect this test.
    const withLogoRow = await pg.query<{ id: number }>(
      `INSERT INTO outward_accounts
         (owner_clerk_id, kind, title, display_name, company_name,
          avatar_url, capability_state)
         VALUES ($1, 'facilities', $2, $2, $2, $3, 'expanded')
         RETURNING id`,
      [clerkId, opts.withLogoCompany, opts.withLogoAvatarPath],
    );
    const noLogoRow = await pg.query<{ id: number }>(
      `INSERT INTO outward_accounts
         (owner_clerk_id, kind, title, display_name, company_name,
          avatar_url, capability_state)
         VALUES ($1, 'facilities', $2, $2, $2, NULL, 'expanded')
         RETURNING id`,
      [clerkId, opts.noLogoCompany],
    );
    await pg.query(
      `UPDATE users SET last_active_mode_id = $1 WHERE clerk_id = $2`,
      [ownerModeId, clerkId],
    );
    return {
      withLogoOaId: withLogoRow.rows[0].id,
      noLogoOaId: noLogoRow.rows[0].id,
      ownerModeId,
    };
  } finally {
    await pg.end();
  }
}

/**
 * Seed a minimal `home` visitor so they can sign in and reach /find
 * past the onboarding gate.
 */
async function seedHomeVisitor(
  idToken: string,
  clerkId: string,
  baseURL: string,
  opts: { displayName: string; username: string },
): Promise<void> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  await touchUsersMe(idToken, baseURL);
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    await pg.query(
      `UPDATE users
         SET name = $2,
             username = $3,
             avatar_url = 'public/visitor-avatar.png',
             identity_completed_at = NOW()
         WHERE clerk_id = $1`,
      [clerkId, opts.displayName, opts.username],
    );
    const modeRow = await pg.query<{ id: number }>(
      `INSERT INTO user_modes (user_clerk_id, kind, intake_data, intake_completed_at)
         VALUES ($1, 'home', '{"placeName":"E2E Visitor","matters":["maintenance"]}'::jsonb, NOW())
         RETURNING id`,
      [clerkId],
    );
    await pg.query(
      `UPDATE users SET last_active_mode_id = $1 WHERE clerk_id = $2`,
      [modeRow.rows[0].id, clerkId],
    );
  } finally {
    await pg.end();
  }
}

async function cleanup(clerkIds: string[]): Promise<void> {
  if (!DATABASE_URL || clerkIds.length === 0) return;
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
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
 * Pull the rendered hero <img>'s src. The PublicProfileModal Image
 * carries `testID="public-profile-hero-avatar"` which RN-web maps to
 * `data-testid` so this selector is stable across re-renders.
 */
async function readHeroAvatarSrc(page: Page): Promise<string> {
  const hero = page.locator('[data-testid="public-profile-hero-avatar"]').first();
  await expect(hero).toBeVisible({ timeout: 15_000 });
  // RN-web renders <Image source={{ uri }}> as a <div> whose
  // background-image style holds the URL, with a hidden child <img>
  // (opacity:0) that mirrors the same `src` for screen-reader / alt
  // semantics. Either signal carries the resolved URL — read whichever
  // exists. This avoids tying the assertion to RN-web's exact
  // implementation choice.
  return await hero.evaluate((el) => {
    const node = el as HTMLElement;
    if (node.tagName.toLowerCase() === "img") {
      return (node as HTMLImageElement).src ?? "";
    }
    const innerImg = node.querySelector("img") as HTMLImageElement | null;
    if (innerImg && innerImg.src) return innerImg.src;
    const bg = node.style.backgroundImage || "";
    // background-image: url("…")  →  capture the url contents.
    const m = bg.match(/url\(["']?([^"')]+)["']?\)/);
    return m ? m[1] : "";
  });
}

test.describe("PublicProfileModal: picked-skin avatar swap (#678)", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("hero avatar shows the picked OA's logo, and falls back to the owner's avatar when the OA has none", async ({
    browser,
    baseURL,
  }) => {
    const tag = uid(8);
    const password = "Pass1234!";
    const ownerEmail = `pps-owner-${tag}@example.test`;
    const visitorEmail = `pps-visit-${tag}@example.test`;
    const ownerName = `Owner ${tag}`;
    const ownerUsername = `owner_${tag}`.toLowerCase();
    const visitorName = `Visitor ${tag}`;
    const visitorUsername = `visitor_${tag}`.toLowerCase();
    const ownerAvatarPath = `public/owner-avatar-${tag}.png`;
    const withLogoAvatarPath = `public/oa-logo-${tag}.png`;
    const withLogoCompany = `WithLogo ${tag}`;
    const noLogoCompany = `NoLogo ${tag}`;

    const cleanupClerkIds: string[] = [];

    try {
      const owner = await firebaseSignUp(ownerEmail, password);
      cleanupClerkIds.push(owner.localId);
      await seedOwnerWithTwoSkins(owner.idToken, owner.localId, baseURL!, {
        displayName: ownerName,
        username: ownerUsername,
        ownerAvatarPath,
        withLogoCompany,
        withLogoAvatarPath,
        noLogoCompany,
      });

      const visitor = await firebaseSignUp(visitorEmail, password);
      cleanupClerkIds.push(visitor.localId);
      await seedHomeVisitor(visitor.idToken, visitor.localId, baseURL!, {
        displayName: visitorName,
        username: visitorUsername,
      });

      // ===== Visitor: sign in and search for the owner =====
      const visitorCtx = await browser.newContext();
      const visitorPage = await visitorCtx.newPage();
      try {
        // The avatar paths we seeded (`public/oa-logo-…png`,
        // `public/owner-avatar-…png`) are *not* uploaded to storage —
        // we only want to assert the rendered URL, not exercise the
        // object-storage stack. RN-web's <Image> only emits the inner
        // <img> tag (and keeps its `backgroundImage` style) when the
        // browser successfully loads the URL; on a 404 it tears the img
        // down and we lose our DOM signal. Stub the network so the load
        // succeeds with a 1x1 PNG. This intercept is scoped to this
        // test's tag so it can't shadow real assets in parallel runs.
        const png1x1 = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
          "base64",
        );
        await visitorCtx.route(
          (url) =>
            url.pathname.includes(`oa-logo-${tag}`) ||
            url.pathname.includes(`owner-avatar-${tag}`),
          (route) =>
            route.fulfill({
              status: 200,
              contentType: "image/png",
              body: png1x1,
            }),
        );

        await signInViaUI(visitorPage, visitorEmail, password);
        await visitorPage.goto("/find");

        const peopleSearch = visitorPage
          .getByPlaceholder(/Name or @username/)
          .first();
        await expect(peopleSearch).toBeVisible({ timeout: 15_000 });
        await peopleSearch.fill(ownerUsername);

        // The People search returns one row per non-archived operator
        // skin, so BOTH WithLogo and NoLogo rows must show up on the
        // owner's @username.
        const withLogoRow = visitorPage
          .getByText(withLogoCompany, { exact: true })
          .first();
        const noLogoRow = visitorPage
          .getByText(noLogoCompany, { exact: true })
          .first();
        await expect(withLogoRow).toBeVisible({ timeout: 15_000 });
        await expect(noLogoRow).toBeVisible({ timeout: 15_000 });

        // ===== Case A: open the WithLogo OA — hero shows OA's logo =====
        // Wait for the GET /api/users/:id?outwardAccountId=… response
        // that backs the modal so we can be sure the OA payload made
        // it back before reading the rendered <img>.
        const [respA] = await Promise.all([
          visitorPage.waitForResponse(
            (resp) =>
              /\/api\/users\/[^/]+\?[^ ]*outwardAccountId=/.test(resp.url()) &&
              resp.request().method() === "GET",
            { timeout: 30_000 },
          ),
          withLogoRow.click(),
        ]);
        expect(
          respA.ok(),
          `GET /users/:id?outwardAccountId=… should succeed; got ${respA.status()}`,
        ).toBeTruthy();
        const bodyA = (await respA.json()) as {
          counterpartOutwardAccount: { avatarUrl: string | null } | null;
          user: { avatarUrl: string | null };
        };
        // Sanity: the API path is honoured (server returned the picked
        // OA with its avatar). The picked-skin avatar swap is the
        // rendering that depends on this payload.
        expect(bodyA.counterpartOutwardAccount?.avatarUrl).toBe(withLogoAvatarPath);
        expect(bodyA.user.avatarUrl).toBe(ownerAvatarPath);

        const heroSrcA = await readHeroAvatarSrc(visitorPage);
        expect(
          heroSrcA,
          `Hero avatar must be the picked OA's logo when the OA has its own avatar; got ${heroSrcA}`,
        ).toContain(`oa-logo-${tag}`);
        expect(
          heroSrcA,
          `Hero avatar must NOT silently fall back to the owner's avatar when an OA-with-avatar was picked; got ${heroSrcA}`,
        ).not.toContain(`owner-avatar-${tag}`);

        // Close the modal so we can reopen it on the second OA. The
        // header's close (X) Pressable carries an accessibilityLabel so
        // we can target it deterministically (RN-web maps it to
        // aria-label).
        await visitorPage
          .getByLabel("Close profile")
          .first()
          .click();
        await expect(
          visitorPage.locator('[data-testid="public-profile-hero-avatar"]').first(),
        ).toBeHidden({ timeout: 10_000 });

        // ===== Case B: open the NoLogo OA — hero falls back to owner =====
        const [respB] = await Promise.all([
          visitorPage.waitForResponse(
            (resp) =>
              /\/api\/users\/[^/]+\?[^ ]*outwardAccountId=/.test(resp.url()) &&
              resp.request().method() === "GET",
            { timeout: 30_000 },
          ),
          noLogoRow.click(),
        ]);
        expect(
          respB.ok(),
          `GET /users/:id?outwardAccountId=… should succeed; got ${respB.status()}`,
        ).toBeTruthy();
        const bodyB = (await respB.json()) as {
          counterpartOutwardAccount: { avatarUrl: string | null } | null;
          user: { avatarUrl: string | null };
        };
        // Server returns the OA but with NULL avatarUrl, so the modal
        // MUST fall back to the owner's user-level avatar.
        expect(bodyB.counterpartOutwardAccount).not.toBeNull();
        expect(bodyB.counterpartOutwardAccount?.avatarUrl).toBeNull();
        expect(bodyB.user.avatarUrl).toBe(ownerAvatarPath);

        const heroSrcB = await readHeroAvatarSrc(visitorPage);
        expect(
          heroSrcB,
          `Hero avatar must fall back to the owner's avatar when the picked OA has no avatar; got ${heroSrcB}`,
        ).toContain(`owner-avatar-${tag}`);
        expect(
          heroSrcB,
          `Hero avatar must NOT carry an OA-logo URL when the picked OA has no avatar; got ${heroSrcB}`,
        ).not.toContain(`oa-logo-${tag}`);
      } finally {
        await visitorCtx.close();
      }
    } finally {
      await cleanup(cleanupClerkIds);
    }
  });
});

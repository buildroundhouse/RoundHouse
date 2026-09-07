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
  opts?: {
    username?: string;
    displayName?: string;
    services?: { name: string; isCustom?: boolean }[];
    /** When true, also flip the visibility.services flag so the chips render
     *  on the public profile for stranger viewers. */
    publicServices?: boolean;
  },
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
    if (opts?.username) {
      params.push(opts.username);
      sets.push(`username = $${params.length}`);
    }
    if (opts?.displayName) {
      params.push(opts.displayName);
      sets.push(`name = $${params.length}`);
    }
    if (opts?.services) {
      params.push(JSON.stringify(opts.services));
      sets.push(`services = $${params.length}::jsonb`);
    }
    if (opts?.publicServices) {
      // Merge — don't clobber any existing visibility flags the row may have.
      sets.push(
        `visibility = COALESCE(visibility, '{}'::jsonb) || '{"services": true}'::jsonb`,
      );
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
  await passwordInput.press("Enter");
  await expect(page.getByText("Properties").first())
    .toBeVisible({ timeout: 45_000 });
}

test.describe("Find: service-tag people search", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("Tapping a service chip on a public profile opens the people-search modal pre-filtered to that service, the result list reflects the filter, and clearing the chip restores the typeahead empty state", async ({
    page,
    baseURL,
  }) => {
    const tag = uid(6);
    const password = "Pass1234!";

    // Service the test pivots on. Mixed casing on the seed entry vs the chip
    // label exercises the case-insensitive match in /users/search?service=.
    const SERVICE = `Drain Cleaning ${tag}`;
    const SERVICE_LOWER = SERVICE.toLowerCase();

    // Viewer: signs in and drives the UI.
    const viewerEmail = `svc-tag-viewer-${tag}@example.test`;
    const viewer = await firebaseSignUp(viewerEmail, password);
    await bypassOnboarding(viewer.idToken, viewer.localId, baseURL!);

    // The "anchor" pro: the one whose public profile we open and whose chip
    // we tap. Their services list contains SERVICE in lowercase.
    const anchorEmail = `svc-tag-anchor-${tag}@example.test`;
    const anchorUsername = `svctaganchor_${tag}`;
    const anchorName = `Svc Tag Anchor ${tag}`;
    const anchor = await firebaseSignUp(anchorEmail, password);
    await bypassOnboarding(anchor.idToken, anchor.localId, baseURL!, {
      username: anchorUsername,
      displayName: anchorName,
      services: [{ name: SERVICE_LOWER }],
      publicServices: true,
    });

    // A second pro who ALSO offers SERVICE — they must appear in the
    // service-filtered result list alongside the anchor.
    const matchEmail = `svc-tag-match-${tag}@example.test`;
    const matchUsername = `svctagmatch_${tag}`;
    const matchName = `Svc Tag Match ${tag}`;
    const matchPro = await firebaseSignUp(matchEmail, password);
    await bypassOnboarding(matchPro.idToken, matchPro.localId, baseURL!, {
      username: matchUsername,
      displayName: matchName,
      services: [{ name: SERVICE }],
    });

    // A third pro with a DIFFERENT service — must NOT appear under the
    // service filter, even though their name shares the tag suffix.
    const otherEmail = `svc-tag-other-${tag}@example.test`;
    const otherUsername = `svctagother_${tag}`;
    const otherName = `Svc Tag Other ${tag}`;
    const otherPro = await firebaseSignUp(otherEmail, password);
    await bypassOnboarding(otherPro.idToken, otherPro.localId, baseURL!, {
      username: otherUsername,
      displayName: otherName,
      services: [{ name: `Roof Inspection ${tag}` }],
    });

    await signInViaUI(page, viewerEmail, password);
    await page.goto("/find");
    await expect(page.getByText("Find").first()).toBeVisible({ timeout: 30_000 });

    // ---------------------------------------------------------------------
    // Step 1: Open the UserSearchModal via the "Invite a person" CTA, then
    // search for the anchor by username and tap the row to open
    // PublicProfileModal. (This is the same path the find-invite spec uses
    // to surface a non-related user.)
    // ---------------------------------------------------------------------
    const peopleSearch = page.getByPlaceholder(/Search by name or @username/i);
    await peopleSearch.waitFor({ state: "visible", timeout: 15_000 });
    await peopleSearch.fill(`zzzmissing_${tag}`);
    await expect(page.getByText("No matches")).toBeVisible({ timeout: 10_000 });
    await page.getByLabel("Invite a person").dispatchEvent("click");

    const modalSearch = page.getByPlaceholder("Name or @username", { exact: true });
    await expect(modalSearch).toBeVisible({ timeout: 10_000 });
    await modalSearch.fill(anchorUsername);

    // Anchor row appears in the modal — tap their name to open the public
    // profile (UserSearchModal.onUserPress -> setOpenClerkId in find.tsx).
    const anchorRow = page.getByText(anchorName, { exact: true }).first();
    await expect(anchorRow).toBeVisible({ timeout: 15_000 });
    await anchorRow.dispatchEvent("click");

    // ---------------------------------------------------------------------
    // Step 2: Confirm the public profile renders the service chip and tap it.
    // ---------------------------------------------------------------------
    const chip = page.getByLabel(`Find other pros offering ${SERVICE_LOWER}`);
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await chip.dispatchEvent("click");

    // ---------------------------------------------------------------------
    // Step 3: Assert the people-search modal reopens with SERVICE as an
    // active filter (the "Offers: <service>" chip is the visible signal).
    // ---------------------------------------------------------------------
    await expect(modalSearch).toBeVisible({ timeout: 15_000 });
    const filterChip = page.getByText(`Offers: ${SERVICE_LOWER}`, { exact: true });
    await expect(filterChip).toBeVisible({ timeout: 15_000 });

    // ---------------------------------------------------------------------
    // Step 4: The result list reflects the service filter — both pros that
    // offer SERVICE are listed (anchor + matchPro), and the unrelated pro is
    // not.
    // ---------------------------------------------------------------------
    await expect(page.getByText(matchName, { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(anchorName, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(otherName, { exact: true })).toHaveCount(0);

    // ---------------------------------------------------------------------
    // Step 5: Clearing the chip restores the empty/typeahead state.
    // ---------------------------------------------------------------------
    await page.getByLabel("Clear service filter").dispatchEvent("click");
    await expect(filterChip).toHaveCount(0);
    await expect(
      page.getByText("Type a name or username to search.", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    // The matched pros are no longer rendered now that the filter is gone
    // and the search box is empty.
    await expect(page.getByText(matchName, { exact: true })).toHaveCount(0);
    await expect(page.getByText(anchorName, { exact: true })).toHaveCount(0);
  });
});

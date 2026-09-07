/**
 * E2E coverage for the Ignore button on incoming team-up requests
 * (task #598).
 *
 * The Invites screen (`artifacts/round-house/app/invites.tsx`) renders
 * a third button — Ignore — on each incoming team-up request row,
 * alongside Decline and Accept. The Ignore button is purely
 * client-side: it only shows a dismissable banner and does NOT call
 * `POST /api/users/:userId/team-up/respond`, so the underlying
 * `user_connections` row stays `status='pending'` and survives a
 * refetch of `GET /api/users/me/team-up-requests`.
 *
 * This spec asserts:
 *   1. Both incoming requests render with `accessibilityLabel`s that
 *      include the requester's name on Accept / Decline / Ignore.
 *   2. Tapping Ignore on Pro A surfaces the literal banner text
 *      "You can come back to this request later.", does not fire the
 *      respond endpoint, and the row is still rendered after the
 *      query is invalidated by remounting the screen.
 *   3. Tapping Decline on the sibling Pro B row still hits the
 *      respond endpoint, removes that row, and leaves Pro A's row
 *      untouched (parity with the pre-existing flow is preserved).
 *
 * Companion design doc:
 *   artifacts/round-house/e2e/ignore-team-up-request.test-plan.md
 *
 * Mirrors the per-test signup + SQL seed + cleanup pattern from
 * `personal-profile-editor.spec.ts` and `find-invite.spec.ts` so the
 * run is deterministic and isolated.
 */
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
  return (await r.json()) as { idToken: string; localId: string };
}

interface ViewerSeed {
  clerkId: string;
  outwardAccountId: number;
}

interface ProSeed {
  clerkId: string;
  outwardAccountId: number;
  name: string;
  connectionId: number;
}

/**
 * Create the viewer's `users` row + a `home` mode/outward-account so
 * sign-in lands directly in `(tabs)`, then mark the home outward
 * account as active so the team-up listing endpoint resolves it.
 */
async function seedViewer(
  idToken: string,
  clerkId: string,
  baseURL: string,
  rawName: string,
  username: string,
): Promise<ViewerSeed> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  // Lazy-create the users row via the auth-middleware insert.
  const meRes = await fetch(new URL("/api/users/me", baseURL).toString(), {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!meRes.ok) {
    throw new Error(`GET /api/users/me failed: ${meRes.status} ${await meRes.text()}`);
  }
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    await pg.query(
      `UPDATE users
         SET name = $2,
             username = $3,
             avatar_url = 'public/seed-avatar.png',
             identity_completed_at = NOW()
         WHERE clerk_id = $1`,
      [clerkId, rawName, username],
    );
    const homeMode = await pg.query<{ id: number }>(
      `INSERT INTO user_modes (user_clerk_id, kind, intake_data, intake_completed_at)
         VALUES ($1, 'home', '{}'::jsonb, NOW())
         RETURNING id`,
      [clerkId],
    );
    const homeOutward = await pg.query<{ id: number }>(
      `INSERT INTO outward_accounts
         (owner_clerk_id, kind, title, display_name,
          source_user_mode_id, capability_state)
         VALUES ($1, 'home', $2, $2, $3, 'expanded')
         RETURNING id`,
      [clerkId, `${rawName} Home`, homeMode.rows[0].id],
    );
    await pg.query(
      `UPDATE users
         SET last_active_mode_id = $1,
             active_outward_account_id = $2
         WHERE clerk_id = $3`,
      [homeMode.rows[0].id, homeOutward.rows[0].id, clerkId],
    );
    return { clerkId, outwardAccountId: homeOutward.rows[0].id };
  } finally {
    await pg.end();
  }
}

/**
 * Seed a Trade Pro counterparty (no Firebase needed — only the
 * `users` row is read by the team-up listing endpoint to compose
 * `otherName` / `otherCompanyName`) and the matching pending
 * `user_connections` row pointing FROM the pro's `trade_pro` outward
 * account TO the viewer's outward account.
 */
async function seedProAndPendingRequest(
  tag: string,
  slot: string,
  displayName: string,
  companyName: string,
  viewerOutwardAccountId: number,
): Promise<ProSeed> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const proClerkId = `seed_${slot}_${tag}`;
  const username = `${slot}_${tag}`.slice(0, 24).toLowerCase();
  const email = `${username}@example.test`;
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    await pg.query(
      `INSERT INTO users (clerk_id, email, name, username, avatar_url, identity_completed_at)
         VALUES ($1, $2, $3, $4, 'public/seed-avatar.png', NOW())
         ON CONFLICT (clerk_id) DO NOTHING`,
      [proClerkId, email, displayName, username],
    );
    const proMode = await pg.query<{ id: number }>(
      `INSERT INTO user_modes (user_clerk_id, kind, intake_data, intake_completed_at)
         VALUES ($1, 'trade_pro', '{}'::jsonb, NOW())
         RETURNING id`,
      [proClerkId],
    );
    const proOutward = await pg.query<{ id: number }>(
      `INSERT INTO outward_accounts
         (owner_clerk_id, kind, title, display_name, company_name,
          source_user_mode_id, capability_state)
         VALUES ($1, 'trade_pro', $2, $2, $3, $4, 'expanded')
         RETURNING id`,
      [proClerkId, displayName, companyName, proMode.rows[0].id],
    );
    await pg.query(
      `UPDATE users
         SET last_active_mode_id = $1,
             active_outward_account_id = $2
         WHERE clerk_id = $3`,
      [proMode.rows[0].id, proOutward.rows[0].id, proClerkId],
    );
    const conn = await pg.query<{ id: number }>(
      `INSERT INTO user_connections
         (from_outward_account_id, to_outward_account_id, kind, status,
          requested_at, personal_note)
         VALUES ($1, $2, 'core', 'pending', NOW(), $3)
         RETURNING id`,
      [
        proOutward.rows[0].id,
        viewerOutwardAccountId,
        `Hi from ${displayName} — would love to team up.`,
      ],
    );
    return {
      clerkId: proClerkId,
      outwardAccountId: proOutward.rows[0].id,
      name: displayName,
      connectionId: conn.rows[0].id,
    };
  } finally {
    await pg.end();
  }
}

async function cleanup(clerkIds: string[]): Promise<void> {
  if (!DATABASE_URL) return;
  const filtered = clerkIds.filter(Boolean);
  if (filtered.length === 0) return;
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    // user_connections cascade: gather the outward-account ids for all
    // owners we created and nuke any rows touching them, then drop the
    // outward accounts and modes themselves.
    const accts = await pg.query<{ id: number }>(
      `SELECT id FROM outward_accounts WHERE owner_clerk_id = ANY($1::text[])`,
      [filtered],
    );
    const acctIds = accts.rows.map((r) => r.id);
    if (acctIds.length > 0) {
      await pg.query(
        `DELETE FROM user_connections
           WHERE from_outward_account_id = ANY($1::int[])
              OR to_outward_account_id   = ANY($1::int[])`,
        [acctIds],
      );
    }
    await pg.query(`DELETE FROM outward_accounts WHERE owner_clerk_id = ANY($1::text[])`, [
      filtered,
    ]);
    await pg.query(`DELETE FROM user_modes WHERE user_clerk_id = ANY($1::text[])`, [filtered]);
    await pg.query(`DELETE FROM users WHERE clerk_id = ANY($1::text[])`, [filtered]);
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
  // Homeowner skin lands on the (tabs) layout where Properties is the
  // first tab title that's reliably visible.
  await expect(page.getByText("Properties").first()).toBeVisible({ timeout: 45_000 });
}

test.describe("Ignore team-up request (#598)", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("Ignore shows the banner, does not call the respond API, and leaves the row in place after a refetch; sibling Decline still removes its row", async ({
    page,
    baseURL,
  }) => {
    const tag = uid(8);
    const password = "Pass1234!";
    const viewerEmail = `ignore-tu-viewer-${tag}@example.test`;
    const viewerName = `Ignore TU Viewer ${tag}`;
    const viewerUsername = `ignore_tu_${tag}`.toLowerCase();

    let viewerClerkId = "";
    let proAClerkId = "";
    let proBClerkId = "";

    try {
      const signup = await firebaseSignUp(viewerEmail, password);
      viewerClerkId = signup.localId;
      const viewer = await seedViewer(
        signup.idToken,
        viewerClerkId,
        baseURL!,
        viewerName,
        viewerUsername,
      );

      const proAName = `Ignore Pro A ${tag}`;
      const proBName = `Decline Pro B ${tag}`;
      const proA = await seedProAndPendingRequest(
        tag,
        "ignorepro_a",
        proAName,
        `${proAName} Co.`,
        viewer.outwardAccountId,
      );
      proAClerkId = proA.clerkId;
      const proB = await seedProAndPendingRequest(
        tag,
        "declinepro_b",
        proBName,
        `${proBName} Co.`,
        viewer.outwardAccountId,
      );
      proBClerkId = proB.clerkId;

      // Track every POST to /team-up/respond. The Ignore handler MUST
      // NOT trigger this endpoint; the Decline handler MUST.
      const respondCalls: { url: string; body: string }[] = [];
      const recordRespond = (req: Request) => {
        if (req.method() === "POST" && /\/api\/users\/[^/]+\/team-up\/respond$/.test(req.url())) {
          respondCalls.push({ url: req.url(), body: req.postData() ?? "" });
        }
      };
      page.on("request", recordRespond);

      // Auto-accept any native dialogs (defensive — none are expected).
      page.on("dialog", (d) => {
        d.accept().catch(() => {});
      });

      await signInViaUI(page, viewerEmail, password);

      // Navigate to the Invites screen and wait for the team-up
      // section to render both seeded rows.
      await page.goto("/invites");
      await expect(page.getByText("My invites", { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        page.getByText("Team-up requests", { exact: true }),
      ).toBeVisible({ timeout: 30_000 });

      // Both rows render with accessibility labels that include the
      // requester's name on each of the three buttons.
      const labelsForName = (name: string) => ({
        accept: page.getByLabel(`Accept request from ${name}`),
        decline: page.getByLabel(`Decline request from ${name}`),
        ignore: page.getByLabel(`Ignore request from ${name}`),
      });
      const a = labelsForName(proAName);
      const b = labelsForName(proBName);

      await expect(a.accept).toBeVisible({ timeout: 15_000 });
      await expect(a.decline).toBeVisible();
      await expect(a.ignore).toBeVisible();
      await expect(b.accept).toBeVisible();
      await expect(b.decline).toBeVisible();
      await expect(b.ignore).toBeVisible();

      // ===== Tap Ignore on Pro A =====
      // The button is a Pressable; on RN web it renders as a div with
      // aria-label, so dispatchEvent("click") is the most reliable
      // synthetic-click path.
      respondCalls.length = 0;
      await a.ignore.dispatchEvent("click");

      // Banner text appears verbatim.
      await expect(
        page.getByText("You can come back to this request later.", { exact: true }),
      ).toBeVisible({ timeout: 5_000 });

      // Pro A's row is still rendered (Ignore must not remove the row).
      await expect(a.ignore).toBeVisible();
      await expect(b.ignore).toBeVisible();

      // No respond POST has fired.
      expect(
        respondCalls,
        `Ignore must not call POST /team-up/respond, but got: ${JSON.stringify(respondCalls)}`,
      ).toHaveLength(0);

      // ===== Force a refetch by remounting the screen =====
      // Navigate to the (tabs) root and back to /invites — Expo
      // router remounts InvitesScreen, which re-issues
      // GET /api/users/me/team-up-requests. The row must still be
      // returned because Ignore did not mutate the DB.
      await page.goto("/");
      await expect(page.getByText("Properties").first()).toBeVisible({
        timeout: 30_000,
      });
      await page.goto("/invites");
      await expect(page.getByText("My invites", { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        page.getByText("Team-up requests", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });

      // Re-locate the buttons after remount.
      const aAfter = labelsForName(proAName);
      const bAfter = labelsForName(proBName);
      await expect(aAfter.ignore).toBeVisible({ timeout: 15_000 });
      await expect(bAfter.ignore).toBeVisible();

      // Still no respond calls anywhere along the way.
      expect(respondCalls).toHaveLength(0);

      // ===== Tap Decline on Pro B for parity =====
      const declinePromise = page.waitForResponse(
        (r) =>
          /\/api\/users\/[^/]+\/team-up\/respond$/.test(r.url()) &&
          r.request().method() === "POST",
        { timeout: 15_000 },
      );
      await bAfter.decline.dispatchEvent("click");
      const declineResp = await declinePromise;
      expect(
        declineResp.ok(),
        `Decline POST should succeed; got ${declineResp.status()} ${await declineResp.text()}`,
      ).toBeTruthy();

      // Decline POST went to the Pro B clerk id and used action=decline.
      const declineCall = respondCalls.find((c) =>
        c.url.endsWith(`/api/users/${proB.clerkId}/team-up/respond`),
      );
      expect(declineCall, `Expected Decline POST for ${proB.clerkId}`).toBeTruthy();
      expect(declineCall!.body).toContain('"action":"decline"');

      // Pro B row is gone after handleRespond invalidates the query.
      await expect(bAfter.decline).toHaveCount(0, { timeout: 15_000 });
      // Pro A row is still there — Decline on a sibling row must not
      // affect the Ignored row.
      await expect(aAfter.ignore).toBeVisible();

      // Decline-banner copy is what handleRespond emits.
      await expect(
        page.getByText(`Declined the request from ${proBName}.`, { exact: true }),
      ).toBeVisible({ timeout: 5_000 });

      // No accept-style POST sneaked in; only the single decline call.
      const acceptCalls = respondCalls.filter((c) => c.body.includes('"action":"accept"'));
      expect(acceptCalls).toHaveLength(0);
    } finally {
      await cleanup([viewerClerkId, proAClerkId, proBClerkId]);
    }
  });
});

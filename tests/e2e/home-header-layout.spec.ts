import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

const FIREBASE_API_KEY = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

function uid(n = 8): string {
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

async function withDb<T>(fn: (pg: Client) => Promise<T>): Promise<T> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    return await fn(pg);
  } finally {
    await pg.end();
  }
}

async function bypassOnboarding(
  idToken: string,
  clerkId: string,
  baseURL: string,
  displayName: string,
): Promise<void> {
  // Hit /api/users/me so the server creates the users row from the verified token.
  const meRes = await fetch(new URL("/api/users/me", baseURL).toString(), {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!meRes.ok) throw new Error(`GET /api/users/me failed: ${meRes.status} ${await meRes.text()}`);

  await withDb(async (pg) => {
    await pg.query(
      `UPDATE users
         SET name = $2,
             avatar_url = 'public/seed-avatar.png',
             identity_completed_at = NOW()
       WHERE clerk_id = $1`,
      [clerkId, displayName],
    );
    const modeRow = await pg.query<{ id: number }>(
      `INSERT INTO user_modes (user_clerk_id, kind, intake_data, intake_completed_at)
         VALUES (
           $1,
           'home',
           '{"placeName":"Test House","neighborhood":"Testville","matters":["upkeep"]}'::jsonb,
           NOW()
         )
         ON CONFLICT (user_clerk_id, kind)
           DO UPDATE SET intake_completed_at = EXCLUDED.intake_completed_at,
                         intake_data = EXCLUDED.intake_data
         RETURNING id`,
      [clerkId],
    );
    const modeId = modeRow.rows[0].id;
    await pg.query(
      `UPDATE users SET last_active_mode_id = $1 WHERE clerk_id = $2`,
      [modeId, clerkId],
    );
  });
}

async function signInViaUI(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/");
  await page.getByPlaceholder(/you@example\.com/i).fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  // The Sign-in Pressable on RN web is a div without an explicit role; the
  // bottom-most "Sign in" text node is the submit button.
  await page.getByText("Sign in", { exact: true }).last().click();
  // Wait for the (tabs) shell — the Profile tab label appears in the bottom bar.
  await page
    .getByText("Profile", { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
}

async function gotoHome(page: Page): Promise<void> {
  await page.goto("/");
  // Wait for the header to render — the avatar button has a unique aria-label.
  await page.getByLabel("Open profile").first().waitFor({ state: "visible", timeout: 15_000 });
}

const PILL_LABEL_RE = /^Open inbox\./;

test.describe("Home header layout (counts, taps, long names)", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("greeting, counts, taps and long-name layout all behave correctly", async ({
    page,
    baseURL,
  }) => {
    const email = `home-header-${uid(10)}@example.test`;
    const password = "Pass1234!";
    const firstName = "Alex";
    const fullName = `${firstName} Tester`;

    const { idToken, localId: clerkId } = await firebaseSignUp(email, password);
    await bypassOnboarding(idToken, clerkId, baseURL!, fullName);

    // Make sure the test user starts with a clean inbox/notification state.
    await withDb(async (pg) => {
      await pg.query(`DELETE FROM notifications WHERE user_clerk_id = $1`, [clerkId]);
      await pg.query(
        `DELETE FROM messages WHERE sender_clerk_id = $1 OR recipient_clerk_id = $1`,
        [clerkId],
      );
    });

    await signInViaUI(page, email, password);
    await gotoHome(page);

    // ---- Greeting ----
    await expect(page.getByText(new RegExp(`^Hi, ${firstName}$`))).toBeVisible();

    // ---- All-caught-up state ----
    const pill = page.getByLabel(PILL_LABEL_RE).first();
    await expect(pill).toBeVisible();
    await expect(pill).toContainText(/All caught up/i);

    // ---- Header buttons exist and search button is on-screen ----
    const avatar = page.getByLabel("Open profile").first();
    const search = page.getByLabel("Search people and businesses").first();
    await expect(avatar).toBeVisible();
    await expect(search).toBeVisible();
    const searchBox = await search.boundingBox();
    expect(searchBox).not.toBeNull();
    expect((searchBox?.x ?? 0) + (searchBox?.width ?? 0)).toBeLessThanOrEqual(400);

    // ---- Inject 3 unread notifications + 1 inbound message from a fake user B ----
    const clerkB = `test_b_${uid(10)}`;
    await withDb(async (pg) => {
      await pg.query(
        `INSERT INTO notifications (user_clerk_id, type, title, body, is_read)
         SELECT $1, 'message', 'New message', 'Test ' || g, false FROM generate_series(1,3) g`,
        [clerkId],
      );
      await pg.query(
        `INSERT INTO users (clerk_id, email, name, username, avatar_url,
                             identity_completed_at, created_at, updated_at)
         VALUES ($1, $2, 'Bob B', $3, '', NOW(), NOW(), NOW())`,
        [clerkB, `b-${uid(8)}@example.test`, `bob_${uid(8)}`],
      );
      await pg.query(
        `INSERT INTO messages (sender_clerk_id, recipient_clerk_id, content, is_read)
         VALUES ($1, $2, 'Hi from B', false)`,
        [clerkB, clerkId],
      );
    });

    // Reload to refetch notifications + unanswered-count queries.
    await gotoHome(page);

    // Pill aria-label is "Open inbox. <unseen> unseen, <notAnswered> not answered."
    const populatedPill = page.getByLabel(PILL_LABEL_RE).first();
    await expect(populatedPill).toHaveAttribute(
      "aria-label",
      /Open inbox\.\s*3 unseen,\s*1 not answered\./,
    );
    // Sanity-check the API matches what we render.
    const notifJson = await (
      await fetch(new URL("/api/notifications", baseURL!).toString(), {
        headers: { Authorization: `Bearer ${idToken}` },
      })
    ).json();
    expect(notifJson.unreadCount).toBe(3);
    const unansweredJson = await (
      await fetch(new URL("/api/messages/unanswered-count", baseURL!).toString(), {
        headers: { Authorization: `Bearer ${idToken}` },
      })
    ).json();
    expect(unansweredJson.count).toBe(1);

    // ---- Tap navigation ----
    await page.getByLabel("Open profile").first().click();
    await expect.poll(() => page.url(), { timeout: 10_000 }).toMatch(/\/profile/);

    await gotoHome(page);
    await page.getByLabel(PILL_LABEL_RE).first().click();
    await expect.poll(() => page.url(), { timeout: 10_000 }).toMatch(/\/notifications/);

    await gotoHome(page);
    await page.getByLabel("Search people and businesses").first().click();
    // The placeholder route is currently /find (the dedicated /search route ships
    // with task #172). Accept either /find or /search-placeholder for forward-compat.
    await expect
      .poll(() => page.url(), { timeout: 10_000 })
      .toMatch(/\/(find|search-placeholder)/);

    // ---- A replies to B; "not answered" drops to 0 ----
    await withDb(async (pg) => {
      await pg.query(
        `INSERT INTO messages (sender_clerk_id, recipient_clerk_id, content, is_read)
         VALUES ($1, $2, 'Thanks B', true)`,
        [clerkId, clerkB],
      );
    });
    await gotoHome(page);
    await expect(page.getByLabel(PILL_LABEL_RE).first()).toHaveAttribute(
      "aria-label",
      /Open inbox\.\s*3 unseen,\s*0 not answered\./,
    );

    // ---- Long first name: layout must not break ----
    const longName = "Maximillianus Reginald Esquire";
    await withDb(async (pg) => {
      await pg.query(`UPDATE users SET name = $2 WHERE clerk_id = $1`, [clerkId, longName]);
    });
    await gotoHome(page);
    // Greeting starts with the long first name and is ellipsized via numberOfLines=1
    // (maxWidth: 110). The text node is still present and the search button stays
    // fully inside the 400px viewport.
    await expect(page.getByText(/^Hi, Maximillianus/)).toBeVisible();
    const longSearch = page.getByLabel("Search people and businesses").first();
    const longSearchBox = await longSearch.boundingBox();
    expect(longSearchBox).not.toBeNull();
    expect((longSearchBox?.x ?? 0) + (longSearchBox?.width ?? 0)).toBeLessThanOrEqual(400);
    // Header is a single row — the avatar's center y is within a few pixels of the
    // search button's center y (no wrap).
    const longAvatarBox = await page.getByLabel("Open profile").first().boundingBox();
    expect(longAvatarBox).not.toBeNull();
    const avatarCenterY = (longAvatarBox?.y ?? 0) + (longAvatarBox?.height ?? 0) / 2;
    const searchCenterY = (longSearchBox?.y ?? 0) + (longSearchBox?.height ?? 0) / 2;
    expect(Math.abs(avatarCenterY - searchCenterY)).toBeLessThanOrEqual(4);

    // ---- Cleanup ----
    await withDb(async (pg) => {
      await pg.query(
        `DELETE FROM messages
           WHERE sender_clerk_id = ANY($1::text[])
              OR recipient_clerk_id = ANY($1::text[])`,
        [[clerkId, clerkB]],
      );
      await pg.query(`DELETE FROM notifications WHERE user_clerk_id = ANY($1::text[])`, [
        [clerkId, clerkB],
      ]);
      await pg.query(`DELETE FROM user_modes WHERE user_clerk_id = ANY($1::text[])`, [
        [clerkId, clerkB],
      ]);
      await pg.query(`DELETE FROM users WHERE clerk_id = ANY($1::text[])`, [[clerkId, clerkB]]);
    });
  });
});

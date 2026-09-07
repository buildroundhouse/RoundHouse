import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
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

/**
 * Create the user row + skip identity / mode-picker / intake gates so
 * the app stops trying to send the test user to onboarding.
 */
async function bypassOnboarding(
  idToken: string,
  clerkId: string,
  baseURL: string,
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
    await pg.query(
      `UPDATE users
         SET avatar_url = 'public/seed-avatar.png',
             identity_completed_at = NOW(),
             name = 'Cap Tester'
         WHERE clerk_id = $1`,
      [clerkId],
    );
    const modeRow = await pg.query<{ id: number }>(
      `INSERT INTO user_modes (user_clerk_id, kind, intake_data, intake_completed_at)
         VALUES ($1, 'home', '{}'::jsonb, NOW())
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
  // Linking.openURL on web opens sms:/mailto: links in a popup. Auto-close
  // them so the test isn't left waiting on an external handler.
  page.on("popup", (p) => {
    p.close().catch(() => {});
  });
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

/**
 * Send a real invite by hitting POST /api/app-invites with the user's
 * Firebase ID token. This is the same endpoint the Share Round House
 * modal calls, so it exercises the same code path that updates dailyUsed.
 */
async function sendInviteViaApi(
  request: APIRequestContext,
  idToken: string,
  recipientName: string,
  recipientPhone: string,
): Promise<void> {
  const res = await request.post("/api/app-invites", {
    headers: { Authorization: `Bearer ${idToken}` },
    data: { recipientName, recipientPhone, invitedKind: "home" },
  });
  if (!res.ok()) {
    throw new Error(
      `POST /api/app-invites failed: ${res.status()} ${await res.text()}`,
    );
  }
}

/**
 * Bulk DB seed used as a setup accelerator only — to push the count
 * close to a threshold without sending 16 real invites and waiting on
 * 16 round-trips. Real send/resend transitions are still exercised
 * across the threshold boundaries.
 */
async function seedInvites(
  clerkId: string,
  count: number,
  tag: string,
): Promise<void> {
  const pg = new Client({ connectionString: DATABASE_URL! });
  await pg.connect();
  try {
    // app_invites no longer carries from_clerk_id directly — it's
    // derived from the sender's outward account. Look up (or fail
    // loudly if the caller forgot to seed one) the user's default
    // outward account and stamp every seeded row with it.
    const { rows: acctRows } = await pg.query<{ id: number }>(
      `SELECT id FROM outward_accounts
         WHERE owner_clerk_id = $1 AND archived_at IS NULL
         ORDER BY id ASC LIMIT 1`,
      [clerkId],
    );
    if (acctRows.length === 0) {
      throw new Error(
        `seedInvites: no outward account for ${clerkId}; call POST /api/app-invites once first to lazy-seed it`,
      );
    }
    const senderAccountId = acctRows[0].id;
    await pg.query(
      `INSERT INTO app_invites
         (sender_outward_account_id, recipient_name, recipient_phone, invited_kind,
          token, status, created_at, sent_at, expires_at)
       SELECT $1,
              'Seed ' || gs,
              '555' || lpad((floor(random()*1e9)::bigint + gs)::text, 10, '0'),
              'home',
              $2 || '-' || gs || '-' || floor(extract(epoch from now()) * 1000)::bigint,
              'sent',
              NOW() - interval '1 hour',
              NOW() - interval '1 hour',
              NOW() + interval '60 days'
         FROM generate_series(1, $3::int) gs`,
      [senderAccountId, tag, count],
    );
  } finally {
    await pg.end();
  }
}

async function deleteInvitesAndUser(clerkId: string): Promise<void> {
  const pg = new Client({ connectionString: DATABASE_URL! });
  await pg.connect();
  try {
    await pg.query(
      `DELETE FROM app_invites
         WHERE sender_outward_account_id IN (
           SELECT id FROM outward_accounts WHERE owner_clerk_id = $1
         )`,
      [clerkId],
    );
    await pg.query(
      `UPDATE users SET last_active_mode_id = NULL, active_outward_account_id = NULL
         WHERE clerk_id = $1`,
      [clerkId],
    );
    await pg.query(`DELETE FROM outward_accounts WHERE owner_clerk_id = $1`, [clerkId]);
    await pg.query(`DELETE FROM user_modes WHERE user_clerk_id = $1`, [clerkId]);
    await pg.query(`DELETE FROM users WHERE clerk_id = $1`, [clerkId]);
  } finally {
    await pg.end();
  }
}

/** Convert "#RRGGBB" → "rgb(R, G, B)" as Chromium reports computed colors. */
function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

const NEUTRAL_BORDER = hexToRgb("#CED0D4"); // light-theme colors.border
const AMBER_BORDER = hexToRgb("#E0B400");
const DESTRUCTIVE_BORDER = hexToRgb("#E41E3F"); // light-theme colors.destructive

test.describe("People I've invited: daily invite cap banner", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("banner copy and color update across send + resend, crossing the low-warning and limit-reached thresholds", async ({
    page,
    request,
    baseURL,
  }) => {
    const tag = uid(6);
    const password = "Pass1234!";
    const email = `cap-banner-${tag}@example.test`;

    const inviter = await firebaseSignUp(email, password);
    await bypassOnboarding(inviter.idToken, inviter.localId, baseURL!);

    try {
      await signInViaUI(page, email, password);
      await page.goto("/people-i-invited");
      await expect(page.getByText("People I've invited").first()).toBeVisible({
        timeout: 30_000,
      });

      // ---------- 1. Default state, fresh user: "0 of 20". ----------
      const defaultBanner = page.getByTestId("daily-cap-banner-default");
      await expect(defaultBanner).toBeVisible({ timeout: 15_000 });
      await expect(defaultBanner).toContainText("0 of 20 invites used today.");
      await expect(defaultBanner).not.toContainText("left in the next 24 hours");
      await expect(defaultBanner).toHaveCSS("border-color", NEUTRAL_BORDER);
      await expect(page.getByTestId("daily-cap-banner-low")).toHaveCount(0);
      await expect(page.getByTestId("daily-cap-banner-reached")).toHaveCount(0);

      // ---------- 2. Send a real invite via the same endpoint the Share
      //              Round House modal hits → count should bump to 1. ----------
      const firstPhone = `5550100${Math.floor(Math.random() * 9000 + 1000)}`;
      await sendInviteViaApi(
        request,
        inviter.idToken,
        "Real Send",
        firstPhone,
      );
      await page.reload();
      await expect(page.getByText("People I've invited").first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId("daily-cap-banner-default")).toContainText(
        "1 of 20 invites used today.",
      );

      // ---------- 3. Resend the invite from the UI (Resend pill on the
      //              just-created row). The screen auto-refreshes the
      //              share-context query on success — no reload needed.
      //              dailyUsed is computed by created_at, so a resend
      //              must NOT bump the count. ----------
      const resendPill = page.getByText("Resend", { exact: true }).first();
      await expect(resendPill).toBeVisible({ timeout: 15_000 });
      // Arm the wait BEFORE the click so we can't miss a fast response.
      const shareCtxAfterResend = page.waitForResponse(
        (r) =>
          r.url().includes("/api/app-invites/share-context") && r.status() === 200,
        { timeout: 15_000 },
      );
      await resendPill.dispatchEvent("click");
      await shareCtxAfterResend;
      await expect(page.getByTestId("daily-cap-banner-default")).toContainText(
        "1 of 20 invites used today.",
      );
      await expect(page.getByTestId("daily-cap-banner-low")).toHaveCount(0);

      // ---------- 4. Seed 15 more (to 16 total) so the next real send
      //              crosses into the low-warning bucket. ----------
      await seedInvites(inviter.localId, 15, `cap-pre-low-${tag}`);
      const seventeenthPhone = `5550200${Math.floor(Math.random() * 9000 + 1000)}`;
      await sendInviteViaApi(
        request,
        inviter.idToken,
        "Crosses Low",
        seventeenthPhone,
      );
      await page.reload();
      await expect(page.getByText("People I've invited").first()).toBeVisible({
        timeout: 30_000,
      });

      const lowBanner = page.getByTestId("daily-cap-banner-low");
      await expect(lowBanner).toBeVisible({ timeout: 15_000 });
      await expect(lowBanner).toContainText(
        "17 of 20 invites used today — 3 left in the next 24 hours.",
      );
      await expect(lowBanner).toHaveCSS("border-color", AMBER_BORDER);
      await expect(page.getByTestId("daily-cap-banner-default")).toHaveCount(0);
      await expect(page.getByTestId("daily-cap-banner-reached")).toHaveCount(0);

      // ---------- 5. Three more real sends → 20 total → limit reached. ----------
      for (let i = 0; i < 3; i++) {
        const phone = `5550300${Math.floor(Math.random() * 9000 + 1000) + i}`;
        await sendInviteViaApi(
          request,
          inviter.idToken,
          `Crosses Cap ${i + 1}`,
          phone,
        );
      }
      await page.reload();
      await expect(page.getByText("People I've invited").first()).toBeVisible({
        timeout: 30_000,
      });

      const reachedBanner = page.getByTestId("daily-cap-banner-reached");
      await expect(reachedBanner).toBeVisible({ timeout: 15_000 });
      await expect(reachedBanner).toContainText(
        "You've hit your daily invite limit (20 per 24 hours). Try again tomorrow.",
      );
      await expect(reachedBanner).toHaveCSS("border-color", DESTRUCTIVE_BORDER);
      await expect(page.getByTestId("daily-cap-banner-default")).toHaveCount(0);
      await expect(page.getByTestId("daily-cap-banner-low")).toHaveCount(0);

      // ---------- 6. A further send must now be rejected with 429 and
      //              the banner stays in the limit-reached state. ----------
      const overflowPhone = `5550400${Math.floor(Math.random() * 9000 + 1000)}`;
      const overflow = await request.post("/api/app-invites", {
        headers: { Authorization: `Bearer ${inviter.idToken}` },
        data: {
          recipientName: "Over Cap",
          recipientPhone: overflowPhone,
          invitedKind: "home",
        },
      });
      expect(overflow.status()).toBe(429);
      await page.reload();
      await expect(page.getByText("People I've invited").first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId("daily-cap-banner-reached")).toContainText(
        "You've hit your daily invite limit (20 per 24 hours). Try again tomorrow.",
      );
    } finally {
      await deleteInvitesAndUser(inviter.localId);
    }
  });
});

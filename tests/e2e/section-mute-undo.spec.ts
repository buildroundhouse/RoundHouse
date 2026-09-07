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
    const modeId = modeRow.rows[0].id;
    await pg.query(`UPDATE users SET last_active_mode_id = $1 WHERE clerk_id = $2`, [modeId, clerkId]);
  } finally {
    await pg.end();
  }
}

async function fetchPrefs(
  idToken: string,
  baseURL: string,
): Promise<{ prefs: { type: string; enabled: boolean }[] }> {
  const r = await fetch(
    new URL("/api/users/me/notification-prefs", baseURL).toString(),
    { headers: { Authorization: `Bearer ${idToken}` } },
  );
  if (!r.ok) throw new Error(`GET notification-prefs failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as { prefs: { type: string; enabled: boolean }[] };
}

async function fetchMe(
  idToken: string,
  baseURL: string,
): Promise<{ notifyJobStarted?: boolean; notifyJobCompleted?: boolean }> {
  const r = await fetch(new URL("/api/users/me", baseURL).toString(), {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!r.ok) throw new Error(`GET /api/users/me failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as {
    notifyJobStarted?: boolean;
    notifyJobCompleted?: boolean;
  };
}

async function setBulkPrefs(
  idToken: string,
  baseURL: string,
  types: string[],
  enabled: boolean,
): Promise<void> {
  const r = await fetch(
    new URL("/api/users/me/notification-prefs/bulk", baseURL).toString(),
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ types, enabled }),
    },
  );
  if (!r.ok) throw new Error(`PUT notification-prefs/bulk failed: ${r.status} ${await r.text()}`);
}

async function gotoProfileNotifications(page: Page): Promise<void> {
  // Try to click the "Profile" tab; on RN web the tab can render as either a
  // button or a generic pressable with a text node.
  const profileBtn = page.getByRole("button", { name: /^Profile$/i }).first();
  if (await profileBtn.isVisible().catch(() => false)) {
    await profileBtn.click();
  } else {
    await page.getByText(/^Profile$/).first().click();
  }
  await page
    .getByText(/^NOTIFICATIONS$/)
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
  await page
    .getByText(/^NOTIFICATIONS$/)
    .first()
    .scrollIntoViewIfNeeded();
}

const JOBS_PREF_TYPES = [
  "assignment",
  "unassignment",
  "reassignment",
  "log",
  "rating",
];

// NOTE: This spec runs only against the Expo web build. For iOS/Android
// device coverage of the same three flows, see
// `tests/manual/section-mute-undo-device.md`.
test.describe("NotificationSettings: section-mute Undo banner", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("Undo restores all rows; auto-dismiss; toggling another section dismisses", async ({
    page,
    baseURL,
  }) => {
    const email = `section-mute-undo-${uid(8)}@example.test`;
    const password = "Pass1234!";

    // Provision a Firebase user and skip the identity/mode/intake gates.
    const { idToken, localId: clerkId } = await firebaseSignUp(email, password);
    await bypassOnboarding(idToken, clerkId, baseURL!);

    // Sign in via the UI so the web Firebase SDK has a session.
    await page.goto("/");
    await page.getByPlaceholder(/you@example\.com/i).fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    // The Sign-in Pressable on RN web is a div without an explicit role —
    // it just has cursor:pointer. The page also has a "Sign in" heading,
    // so target the bottom-most "Sign in" text node which is the button.
    await page.getByText("Sign in", { exact: true }).last().click();

    // Wait for the (tabs) shell to load — the Profile tab label appears.
    await page
      .getByText("Profile", { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });

    await gotoProfileNotifications(page);

    // ===== Scenario A: Happy path (mute -> Undo restores everything) =====
    // Defaults: every Jobs row (5 prefs + 2 legacy) is on, so the master is on.
    const muteJobs = page.getByLabel("Turn off all Jobs notifications");
    await expect(muteJobs).toBeVisible({ timeout: 10_000 });
    await muteJobs.click();

    const mutedBanner = page.getByText(/Muted all Jobs notifications/);
    await expect(mutedBanner).toBeVisible();

    const undoBtn = page.getByLabel("Undo Jobs change");
    await expect(undoBtn).toBeVisible();
    await undoBtn.click();

    // Banner should clear and the master switch should flip back to on.
    await expect(mutedBanner).toBeHidden({ timeout: 5_000 });
    await expect(
      page.getByLabel("Turn off all Jobs notifications"),
    ).toBeVisible({ timeout: 10_000 });

    // Assert via the API that every previously-on Jobs row, including the
    // legacy notifyJobStarted / notifyJobCompleted fields, is on again.
    const prefsAfter = await fetchPrefs(idToken, baseURL!);
    const meAfter = await fetchMe(idToken, baseURL!);
    const prefMap = new Map(prefsAfter.prefs.map((p) => [p.type, p.enabled]));
    for (const t of JOBS_PREF_TYPES) {
      // Default is "on" when no row exists yet, so treat missing as true.
      expect(prefMap.get(t) ?? true, `Jobs pref ${t} should be on after Undo`).toBe(true);
    }
    expect(meAfter.notifyJobStarted ?? true).toBe(true);
    expect(meAfter.notifyJobCompleted ?? true).toBe(true);

    // ===== Scenario B: Toggling a different pref dismisses the banner =====
    // (Tested before auto-dismiss to avoid needing a reload between scenarios.)
    await page.getByLabel("Turn off all Jobs notifications").click();
    await expect(page.getByText(/Muted all Jobs notifications/)).toBeVisible();

    // Toggling any other pref calls clearUndo() in profile.tsx. The Messages
    // section master switch has a stable accessibility label.
    await page.getByLabel("Turn off all Messages notifications").click();

    // The Jobs-specific undo banner must be gone (clearUndo ran before the
    // Messages section's own pendingUndo was set, so the Jobs message no
    // longer shows).
    await expect(page.getByText(/Muted all Jobs notifications/)).toBeHidden({
      timeout: 3_000,
    });

    // ===== Scenario C: Banner auto-dismisses after ~5s =====
    // The Messages banner from the previous step is now on screen and on its
    // own auto-dismiss timer. Wait past the 5s window and verify it clears.
    const messagesBanner = page.getByText(/Muted all Messages notifications/);
    await expect(messagesBanner).toBeVisible();
    await page.waitForTimeout(6_500);
    await expect(messagesBanner).toBeHidden();
  });
});

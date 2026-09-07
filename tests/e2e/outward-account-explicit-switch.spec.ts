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
  // Touching /api/users/me kicks off the auto-create-user path AND lazily
  // seeds the user's first outward account via the
  // withActiveOutwardAccount middleware. After this call the user has
  // exactly one outward account.
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
         RETURNING id`,
      [clerkId],
    );
    const modeId = modeRow.rows[0].id;
    await pg.query(`UPDATE users SET last_active_mode_id = $1 WHERE clerk_id = $2`, [modeId, clerkId]);
  } finally {
    await pg.end();
  }
}

async function createOutwardAccount(
  idToken: string,
  baseURL: string,
  title: string,
  kind = "home",
): Promise<{ id: number; title: string }> {
  const r = await fetch(new URL("/api/outward-accounts", baseURL).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ kind, title, displayName: title }),
  });
  if (!r.ok) {
    throw new Error(`POST /api/outward-accounts failed: ${r.status} ${await r.text()}`);
  }
  return (await r.json()) as { id: number; title: string };
}

async function listOutwardAccounts(
  idToken: string,
  baseURL: string,
): Promise<{ accounts: { id: number; title: string | null }[]; activeOutwardAccountId: number | null }> {
  const r = await fetch(new URL("/api/outward-accounts", baseURL).toString(), {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!r.ok) throw new Error(`GET /api/outward-accounts failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as {
    accounts: { id: number; title: string | null }[];
    activeOutwardAccountId: number | null;
  };
}

async function setActiveOutwardAccount(
  idToken: string,
  baseURL: string,
  id: number,
): Promise<void> {
  const r = await fetch(
    new URL(`/api/outward-accounts/${id}/switch`, baseURL).toString(),
    {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}` },
    },
  );
  if (!r.ok) {
    throw new Error(`POST switch failed: ${r.status} ${await r.text()}`);
  }
}

async function openSwitcher(page: Page): Promise<void> {
  // Land on the Profile tab.
  const profileBtn = page.getByRole("button", { name: /^Profile$/i }).first();
  if (await profileBtn.isVisible().catch(() => false)) {
    await profileBtn.click();
  } else {
    await page.getByText(/^Profile$/).first().click();
  }
  // Open the OutwardAccountSwitcher overlay. Use .last() to bias toward
  // the Profile-tab copy (the one inside the visible scrollview).
  const pill = page.getByLabel("Switch or add public profile").last();
  await expect(pill).toBeVisible({ timeout: 30_000 });
  await pill.scrollIntoViewIfNeeded();
  // The Expo web shell stacks an absolutely-positioned GestureHandlerRoot
  // overlay on top of tab content that intercepts pointer events. Dispatch
  // the click directly so RN-web's Pressable receives onPress.
  await pill.evaluate((el) => {
    (el as HTMLElement).click();
  });
  await expect(page.getByText(/^YOUR PUBLIC PROFILES$/)).toBeVisible({
    timeout: 10_000,
  });
}

// NOTE: Web-only spec. This drives the OutwardAccountSwitcher through the
// *explicit* switch path (tap a "Switch to X" row — no archive involved)
// and verifies the same header invariant as the archive spec: every
// /api/* request issued at or after the explicit /switch carries the new
// active-account id and never the previous one. The switch mutation's
// global onSuccess (registered in app/_layout.tsx) pushes the new id into
// the api-client override synchronously so the wave of refetches kicked
// off by `queryClient.invalidateQueries()` already carry the new header.
test.describe("OutwardAccountSwitcher: explicit tap-to-switch", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("tapping Switch on a non-active row updates the active-account header on every subsequent request", async ({
    page,
    baseURL,
  }) => {
    const tag = uid(8);
    const email = `outward-switch-${tag}@example.test`;
    const password = "Pass1234!";

    const { idToken, localId: clerkId } = await firebaseSignUp(email, password);
    await bypassOnboarding(idToken, clerkId, baseURL!);

    // Seed two extra accounts so the user has three to choose from. Make
    // A active so we can tap-to-switch onto B and assert the header flips
    // from A's id to B's id.
    const titleA = `A-${tag}`;
    const titleB = `B-${tag}`;
    const a = await createOutwardAccount(idToken, baseURL!, titleA);
    const b = await createOutwardAccount(idToken, baseURL!, titleB);
    await setActiveOutwardAccount(idToken, baseURL!, a.id);

    // Capture every outgoing request's x-active-outward-account-id so we
    // can assert what the client sent after the explicit-switch flow.
    const headerLog: { url: string; value: string | null }[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (!/\/api\//.test(url)) return;
      headerLog.push({
        url,
        value: req.headers()["x-active-outward-account-id"] ?? null,
      });
    });

    // Sign in via the UI so the web Firebase SDK has a session.
    await page.goto("/");
    await page.getByPlaceholder(/you@example\.com/i).fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.getByText("Sign in", { exact: true }).last().click();

    await page
      .getByText("Profile", { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });

    await openSwitcher(page);

    // Sanity: A is the active row (has the check-circle adornment), and B
    // is present as a switchable row.
    const switchToB = page.getByLabel(`Switch to ${titleB}`);
    await expect(switchToB).toBeVisible({ timeout: 10_000 });

    // Mark a baseline so we only inspect requests issued after this point.
    const baseline = headerLog.length;

    // Tap-to-switch onto B. Dispatch the click on the Pressable directly
    // for the same overlay-interception reason openSwitcher uses.
    await switchToB.evaluate((el) => {
      (el as HTMLElement).click();
    });

    // Wait for the network to settle so all the post-switch refetch wave
    // (kicked off by `queryClient.invalidateQueries()` after the /switch
    // mutation resolves) has been captured by the request listener.
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(500);

    // Confirm the server agrees B is now the active account.
    const afterSwitch = await listOutwardAccounts(idToken, baseURL!);
    expect(afterSwitch.activeOutwardAccountId).toBe(b.id);

    const postClick = headerLog.slice(baseline);
    expect(
      postClick.length,
      "the explicit switch tap must trigger at least one app request",
    ).toBeGreaterThan(0);

    // Identify the exact moment the explicit /switch fired so we can
    // assert on every request issued at or after it.
    const explicitSwitchIdx = postClick.findIndex((e) =>
      /\/api\/outward-accounts\/\d+\/switch$/.test(e.url),
    );
    expect(
      explicitSwitchIdx,
      "tapping a Switch row should fire an explicit /switch request",
    ).toBeGreaterThanOrEqual(0);
    const afterSwitchReqs = postClick.slice(explicitSwitchIdx + 1);
    expect(
      afterSwitchReqs.length,
      "the explicit /switch must be followed by at least one app request to validate the live header",
    ).toBeGreaterThan(0);
    for (const r of afterSwitchReqs) {
      expect(
        r.value,
        `header on ${r.url} must not still be the previous active id (${a.id})`,
      ).not.toBe(String(a.id));
      expect(
        r.value,
        `header on ${r.url} must match the new active outward account id (${b.id})`,
      ).toBe(String(b.id));
    }
  });
});

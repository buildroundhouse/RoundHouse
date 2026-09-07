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
    // The (user_clerk_id, kind) unique index is conditional in the
    // schema (collab kinds only), so we can't use ON CONFLICT here. Each
    // test user is freshly minted so a plain INSERT is safe.
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
  // Open the OutwardAccountSwitcher overlay.
  // Both the Home tab and the Profile tab render an OutwardAccountSwitcher,
  // so the Profile-tab one is just the .first() that's actually visible
  // in the active tab. Use .last() to bias toward the Profile copy that
  // sits inside the visible scrollview.
  const pill = page.getByLabel("Switch or add public profile").last();
  await expect(pill).toBeVisible({ timeout: 30_000 });
  await pill.click();
  // The overlay header has a YOUR PUBLIC PROFILES label.
  await expect(page.getByText(/^YOUR PUBLIC PROFILES$/)).toBeVisible({
    timeout: 10_000,
  });
}

// NOTE: Web-only spec. This drives the OutwardAccountSwitcher through both
// archive paths (non-active row, then active row) and verifies the
// x-active-outward-account-id header that the api-client attaches reflects
// the new active account after the active-row archive triggers a switch.
test.describe("OutwardAccountSwitcher: archive a public profile", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("archive a non-active row removes it; archive the active row switches first and updates the active-account header", async ({
    page,
    baseURL,
  }) => {
    const tag = uid(8);
    const email = `outward-archive-${tag}@example.test`;
    const password = "Pass1234!";

    const { idToken, localId: clerkId } = await firebaseSignUp(email, password);
    await bypassOnboarding(idToken, clerkId, baseURL!);

    // Seed three accounts so we can run both archive scenarios in one
    // session: one non-active to archive, one active to archive, and one
    // fallback the client should switch onto when archiving the active.
    const titleA = `A-${tag}`;
    const titleB = `B-${tag}`;
    const titleC = `C-${tag}`;
    const a = await createOutwardAccount(idToken, baseURL!, titleA);
    const b = await createOutwardAccount(idToken, baseURL!, titleB);
    const c = await createOutwardAccount(idToken, baseURL!, titleC);
    // Make B the active one. After archiving the non-active A, B is still
    // the active. Then we archive B and the client must switch to either
    // C or the original auto-seeded account.
    await setActiveOutwardAccount(idToken, baseURL!, b.id);

    // RN web maps Alert.alert(cancel + destructive) onto window.confirm.
    // Auto-accept so the destructive Archive button fires.
    page.on("dialog", (d) => {
      d.accept().catch(() => {});
    });

    // Capture every outgoing request's x-active-outward-account-id so we
    // can assert what the client sent after the active-row archive flow.
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

    // ===== Scenario A: archive a non-active row =====
    // Active row has the check-circle adornment; archive A (non-active).
    const archiveA = page.getByLabel(`Archive ${titleA}`);
    await expect(archiveA).toBeVisible({ timeout: 10_000 });
    await archiveA.click();

    // The row should disappear from the panel as the list refreshes.
    await expect(page.getByLabel(`Switch to ${titleA}`)).toBeHidden({
      timeout: 10_000,
    });
    // B (active) and C should still be present.
    await expect(page.getByLabel(`Switch to ${titleB}`)).toBeVisible();
    await expect(page.getByLabel(`Switch to ${titleC}`)).toBeVisible();

    // Confirm via the API too — A is gone from the user's list.
    const afterA = await listOutwardAccounts(idToken, baseURL!);
    expect(afterA.accounts.find((x) => x.id === a.id)).toBeUndefined();
    expect(afterA.activeOutwardAccountId).toBe(b.id);

    // ===== Scenario B: archive the active row (B) =====
    // Mark a baseline so we only inspect requests issued after this point.
    const baseline = headerLog.length;

    const archiveB = page.getByLabel(`Archive ${titleB}`);
    await expect(archiveB).toBeVisible();
    await archiveB.click();

    // After the archive completes, B should be gone from the list and the
    // active checkmark should sit on C (or the auto-seeded fallback) — in
    // either case it must NOT be on B because B no longer exists.
    await expect(page.getByLabel(`Switch to ${titleB}`)).toBeHidden({
      timeout: 10_000,
    });

    // Verify the new active account via the API and that it differs from B.
    const afterB = await listOutwardAccounts(idToken, baseURL!);
    expect(afterB.accounts.find((x) => x.id === b.id)).toBeUndefined();
    expect(afterB.activeOutwardAccountId).not.toBe(b.id);
    expect(afterB.activeOutwardAccountId).not.toBeNull();
    const newActiveId = afterB.activeOutwardAccountId!;

    // After the active-row archive completes and the network settles,
    // EVERY app-issued request — including the wave of refetches kicked
    // off by `queryClient.invalidateQueries()` immediately after the
    // implicit /switch — must already carry the new active-account
    // header. The switch mutation's global onSuccess pushes the new id
    // into the api-client override synchronously, eliminating the prior
    // stale-header window.
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(500);

    const postArchive = headerLog.slice(baseline);
    expect(
      postArchive.length,
      "the active-row archive must trigger at least one app request",
    ).toBeGreaterThan(0);
    // Identify the exact moment the implicit /switch fired so we can
    // assert on every request issued at or after it.
    const implicitSwitchIdx = postArchive.findIndex((e) =>
      /\/api\/outward-accounts\/\d+\/switch$/.test(e.url),
    );
    expect(
      implicitSwitchIdx,
      "archiving the active row should fire an implicit /switch request",
    ).toBeGreaterThanOrEqual(0);
    const afterSwitch = postArchive.slice(implicitSwitchIdx + 1);
    expect(
      afterSwitch.length,
      "the implicit /switch must be followed by at least one app request to validate the live header",
    ).toBeGreaterThan(0);
    for (const r of afterSwitch) {
      expect(
        r.value,
        `header on ${r.url} must not be the archived B id`,
      ).not.toBe(String(b.id));
      expect(
        r.value,
        `header on ${r.url} must match the new active outward account id`,
      ).toBe(String(newActiveId));
    }
  });
});

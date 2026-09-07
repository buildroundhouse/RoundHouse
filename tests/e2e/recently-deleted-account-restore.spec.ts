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
  // Force-create the users row by hitting /api/users/me first.
  const meRes = await fetch(new URL("/api/users/me", baseURL).toString(), {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!meRes.ok)
    throw new Error(`GET /api/users/me failed: ${meRes.status} ${await meRes.text()}`);

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
    await pg.query(`UPDATE users SET last_active_mode_id = $1 WHERE clerk_id = $2`, [
      modeRow.rows[0].id,
      clerkId,
    ]);
  } finally {
    await pg.end();
  }
}

async function listOutwardAccounts(
  idToken: string,
  baseURL: string,
): Promise<{
  accounts: { id: number; kind: string; title: string | null; displayName: string | null }[];
  activeOutwardAccountId: number | null;
}> {
  const r = await fetch(new URL("/api/outward-accounts", baseURL).toString(), {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!r.ok)
    throw new Error(
      `GET /api/outward-accounts failed: ${r.status} ${await r.text()}`,
    );
  return (await r.json()) as Awaited<ReturnType<typeof listOutwardAccounts>>;
}

async function createOutwardAccount(
  idToken: string,
  baseURL: string,
  body: {
    kind: "trade_pro" | "home" | "facilities";
    title: string;
    displayName: string;
    companyName?: string;
  },
): Promise<{ id: number }> {
  const r = await fetch(new URL("/api/outward-accounts", baseURL).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok)
    throw new Error(
      `POST /api/outward-accounts failed: ${r.status} ${await r.text()}`,
    );
  return (await r.json()) as { id: number };
}

async function signInViaUI(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/");
  await page.getByPlaceholder(/you@example\.com/i).fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  // The Sign-in Pressable on RN web is a div without an explicit role —
  // there's also a "Sign in" heading on the same screen, so target the
  // last "Sign in" text node which is the button.
  await page.getByText("Sign in", { exact: true }).last().click();
  // Wait for the (tabs) shell to load — the Profile tab label appears.
  await page
    .getByText("Profile", { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 45_000 });
}

test.describe("Account settings: Recently deleted restore flow (#325)", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  // The Edit screen's delete confirmation is rendered by RN's Alert.alert,
  // which on react-native-web falls back to window.confirm. Auto-accept
  // every dialog so the destructive button's onPress fires.
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => {
      d.accept().catch(() => {});
    });
  });

  test("delete a non-active outward account, see it under Recently deleted with a relative-time label, restore it, and confirm it returns to the switcher with its connections live again", async ({
    page,
    baseURL,
  }) => {
    const tag = uid(6);
    const email = `recently-deleted-restore-${tag}@example.test`;
    const password = "Pass1234!";

    // ===== Test data =====
    // 1) Provision user A (the actor) via Firebase + bypass onboarding.
    const { idToken, localId: clerkId } = await firebaseSignUp(email, password);
    await bypassOnboarding(idToken, clerkId, baseURL!);

    // 2) Lazy-seed user A's primary "home" outward account by listing it
    //    (server side will insert one when the user has none yet) — this is
    //    the active skin and must NOT be the one we delete.
    const seeded = await listOutwardAccounts(idToken, baseURL!);
    expect(seeded.accounts.length).toBeGreaterThanOrEqual(1);
    const primaryId = seeded.activeOutwardAccountId;
    expect(primaryId).not.toBeNull();

    // 3) Create a second, NON-active outward account for user A — this is
    //    the one the test will delete and then restore.
    const secondaryDisplayName = `Trade Skin ${tag}`;
    const secondaryTitle = `trade_${tag}`;
    const created = await createOutwardAccount(idToken, baseURL!, {
      kind: "trade_pro",
      title: secondaryTitle,
      displayName: secondaryDisplayName,
      companyName: `Co ${tag}`,
    });
    const secondaryId = created.id;

    // 4) Provision user B + a home outward account for them via direct DB
    //    inserts, then wire a live connection between A's secondary skin
    //    and B's home skin so we can prove that restore re-activates the
    //    archived-along-with-account connections.
    const otherClerkId = `e2e-restore-other-${tag}`;
    let otherSkinId = 0;
    let connectionId = 0;
    {
      const pg = new Client({ connectionString: DATABASE_URL! });
      await pg.connect();
      try {
        await pg.query(
          `INSERT INTO users (clerk_id, email, name, username)
             VALUES ($1, $2, $3, $4)`,
          [
            otherClerkId,
            `${otherClerkId}@example.test`,
            `Other ${tag}`,
            `other_${tag}`,
          ],
        );
        const skin = await pg.query<{ id: number }>(
          `INSERT INTO outward_accounts (owner_clerk_id, kind, title, display_name)
             VALUES ($1, 'home', $2, $3) RETURNING id`,
          [otherClerkId, `home_${tag}`, `Other Home ${tag}`],
        );
        otherSkinId = skin.rows[0].id;
        const conn = await pg.query<{ id: number }>(
          `INSERT INTO user_connections (from_outward_account_id, to_outward_account_id, kind, status)
             VALUES ($1, $2, 'client', 'accepted') RETURNING id`,
          [secondaryId, otherSkinId],
        );
        connectionId = conn.rows[0].id;
      } finally {
        await pg.end();
      }
    }

    // ===== Sign in and navigate to the account screen =====
    await signInViaUI(page, email, password);
    await page.goto("/account");

    // The "Outward-facing accounts" section header must be visible and
    // both skins must be listed before we delete one.
    await expect(
      page.getByText("Outward-facing accounts", { exact: true }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(secondaryDisplayName).first()).toBeVisible();

    // ===== Delete the non-active secondary skin via the Edit screen =====
    // Going directly to the edit route avoids ambiguity with the "Edit"
    // button inside the primary card.
    await page.goto(`/account/edit/${secondaryId}`);

    // The danger zone button label flips between "Delete this account" and
    // "Delete with history retained" depending on connection count. The
    // skin we built has one live connection, so it should read the latter.
    const deleteBtn = page
      .getByText(/^(Delete with history retained|Delete this account)$/)
      .first();
    await expect(deleteBtn).toBeVisible({ timeout: 15_000 });
    await deleteBtn.scrollIntoViewIfNeeded();
    await deleteBtn.click();

    // After the delete completes, the screen routes back to /account.
    await page.waitForURL(/\/account(?:\?|$)/, { timeout: 30_000 });

    // ===== Verify the Recently deleted section + relative-time label =====
    const recentlyDeletedHeading = page.getByText("Recently deleted", { exact: true });
    await expect(recentlyDeletedHeading).toBeVisible({ timeout: 15_000 });
    // Section description includes the restore window in days.
    await expect(
      page.getByText(/Accounts you deleted in the last \d+ days\./),
    ).toBeVisible();
    // The deleted skin appears with a "Deleted ..." relative-time label.
    // We just deleted it, so it should be either "Deleted Nh ago" or
    // "Deleted 0 days ago"-style (the formatter falls back to hours when
    // days <= 0).
    await expect(page.getByText(secondaryDisplayName).first()).toBeVisible();
    await expect(
      page.getByText(/Deleted \d+(h ago| days? ago)/).first(),
    ).toBeVisible();

    // The deleted skin must NOT be in the live switcher list anymore:
    // its "Switch" pill (only rendered for non-active live skins) is gone
    // and the API agrees.
    {
      const live = await listOutwardAccounts(idToken, baseURL!);
      expect(live.accounts.find((a) => a.id === secondaryId)).toBeUndefined();
    }

    // ===== Restore via the per-row Restore button =====
    const restoreBtn = page.getByLabel(`Restore ${secondaryDisplayName}`);
    await expect(restoreBtn).toBeVisible();
    await restoreBtn.click();

    // After restore, the Recently deleted section disappears (only one
    // entry was in it) and the skin is back in the live switcher list.
    await expect(recentlyDeletedHeading).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(secondaryDisplayName).first()).toBeVisible();

    // API confirms the skin is in the live list again.
    {
      const live = await listOutwardAccounts(idToken, baseURL!);
      expect(live.accounts.find((a) => a.id === secondaryId)).toBeTruthy();
    }

    // DB confirms the previously-archived connection is live again.
    {
      const pg = new Client({ connectionString: DATABASE_URL! });
      await pg.connect();
      try {
        const r = await pg.query<{ archived_at: Date | null }>(
          `SELECT archived_at FROM user_connections WHERE id = $1`,
          [connectionId],
        );
        expect(r.rows[0]?.archived_at).toBeNull();
      } finally {
        await pg.end();
      }
    }

    // ===== Cleanup the second user we inserted directly =====
    {
      const pg = new Client({ connectionString: DATABASE_URL! });
      await pg.connect();
      try {
        await pg.query(`DELETE FROM user_connections WHERE id = $1`, [connectionId]);
        await pg.query(`DELETE FROM outward_accounts WHERE id = $1`, [otherSkinId]);
        await pg.query(`DELETE FROM users WHERE clerk_id = $1`, [otherClerkId]);
      } finally {
        await pg.end();
      }
    }
  });
});

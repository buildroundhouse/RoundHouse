/**
 * E2E coverage for the Trade Pro per-client tag flow (#520 / #524).
 *
 * Flow:
 *   1. Sign up a fresh Firebase user — `pro` — and seed a fully
 *      onboarded Trade Pro Postgres profile for them, including two
 *      services on the personal profile (Plumbing + HVAC) and a
 *      `trade_pro` outward account marked as both `last_active_mode`
 *      and `active_outward_account`.
 *   2. Seed a counterparty home-side outward account (`client`) and
 *      one accepted `user_connections` row of kind=`client` from the
 *      pro to the client, with all per-client tag fields cleared so
 *      each run starts deterministic.
 *   3. Sign in as the pro through the UI, navigate to /clients, and
 *      assert the seeded client row renders under the "CLIENTS"
 *      bucket with the bare "Tag" affordance (no preview line yet).
 *   4. Tap "Tag yourself for {client}", which mounts ConnectionTagModal
 *      in mode=`pro-self-tag`. Pick the "Plumbing" service chip and
 *      the "Contractor" on-site identity chip, then Save.
 *   5. Assert the row immediately renders the inline preview line
 *      "You show up as: Plumbing · Contractor" and the affordance
 *      flips to "Edit tag".
 *   6. Reload the page (full router refresh), wait for /clients to
 *      hydrate again, and assert the preview line is still there —
 *      proving the tag was persisted to the server, not just stashed
 *      in local query cache.
 *   7. Re-open the modal via "Change how you show up for {client}",
 *      switch the on-site identity chip to "Other…", type a custom
 *      label ("Lead inspector"), and Save.
 *   8. Assert the preview line updates in place to
 *      "You show up as: Plumbing · Lead inspector" and survives
 *      another full reload.
 *   9. Clean up the seeded user / outward / connection rows.
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

interface SeededPro {
  clerkId: string;
  outwardAccountId: number;
}

async function seedTradePro(
  pg: Client,
  clerkId: string,
  email: string,
  username: string,
  title: string,
  services: string[],
): Promise<SeededPro> {
  await pg.query(
    `INSERT INTO users (clerk_id, email, name, username, avatar_url,
                        identity_completed_at, services)
       VALUES ($1, $2, $3, $4, 'public/seed-avatar.png', NOW(), $5::jsonb)
       ON CONFLICT (clerk_id) DO UPDATE
         SET services = EXCLUDED.services,
             identity_completed_at = EXCLUDED.identity_completed_at`,
    [
      clerkId,
      email,
      email.split("@")[0],
      username,
      JSON.stringify(services.map((name) => ({ name }))),
    ],
  );
  const modeRow = await pg.query<{ id: number }>(
    `INSERT INTO user_modes (user_clerk_id, kind, intake_data, intake_completed_at)
       VALUES ($1, 'trade_pro', '{}'::jsonb, NOW())
       ON CONFLICT (user_clerk_id, kind)
         DO UPDATE SET intake_completed_at = EXCLUDED.intake_completed_at
       RETURNING id`,
    [clerkId],
  );
  const modeId = modeRow.rows[0].id;
  const acctRow = await pg.query<{ id: number }>(
    `INSERT INTO outward_accounts
       (owner_clerk_id, kind, title, display_name, source_user_mode_id)
       VALUES ($1, 'trade_pro', $2, $2, $3)
       RETURNING id`,
    [clerkId, title, modeId],
  );
  const outwardAccountId = acctRow.rows[0].id;
  await pg.query(
    `UPDATE users
       SET last_active_mode_id = $1,
           active_outward_account_id = $2
       WHERE clerk_id = $3`,
    [modeId, outwardAccountId, clerkId],
  );
  return { clerkId, outwardAccountId };
}

async function seedHomeClient(
  pg: Client,
  tag: string,
  displayName: string,
): Promise<{ clerkId: string; outwardAccountId: number; displayName: string }> {
  const clerkId = `seed_client_${tag}`;
  const username = `client_${tag}`.slice(0, 24).toLowerCase();
  const email = `${username}@example.test`;
  await pg.query(
    `INSERT INTO users (clerk_id, email, name, username, avatar_url,
                        identity_completed_at)
       VALUES ($1, $2, $3, $4, 'public/seed-avatar.png', NOW())
       ON CONFLICT (clerk_id) DO NOTHING`,
    [clerkId, email, displayName, username],
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
  const acctRow = await pg.query<{ id: number }>(
    `INSERT INTO outward_accounts
       (owner_clerk_id, kind, title, display_name, source_user_mode_id)
       VALUES ($1, 'home', $2, $2, $3)
       RETURNING id`,
    [clerkId, displayName, modeId],
  );
  const outwardAccountId = acctRow.rows[0].id;
  await pg.query(
    `UPDATE users
       SET last_active_mode_id = $1,
           active_outward_account_id = $2
       WHERE clerk_id = $3`,
    [modeId, outwardAccountId, clerkId],
  );
  return { clerkId, outwardAccountId, displayName };
}

async function seedClientConnection(
  pg: Client,
  fromOutwardAccountId: number,
  toOutwardAccountId: number,
): Promise<number> {
  const row = await pg.query<{ id: number }>(
    `INSERT INTO user_connections
       (from_outward_account_id, to_outward_account_id, kind, status,
        service_title, on_site_identity, on_site_identity_other,
        requested_at, responded_at)
       VALUES ($1, $2, 'client', 'accepted',
               NULL, NULL, NULL,
               NOW(), NOW())
       RETURNING id`,
    [fromOutwardAccountId, toOutwardAccountId],
  );
  return row.rows[0].id;
}

async function cleanup(
  clerkIds: string[],
  connectionIds: number[],
): Promise<void> {
  if (!DATABASE_URL) return;
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    if (connectionIds.length > 0) {
      await pg.query(
        `DELETE FROM user_connections WHERE id = ANY($1::int[])`,
        [connectionIds],
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

async function signInUI(page: Page, email: string, password: string): Promise<void> {
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`[browser:err] ${m.text()}`);
  });
  page.on("pageerror", (e) => console.log(`[browser:throw] ${e.message}`));
  await page.goto("/");
  await page
    .getByPlaceholder(/you@example\.com/i)
    .waitFor({ state: "visible", timeout: 45_000 });
  await page.getByPlaceholder(/you@example\.com/i).fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByText("Sign in", { exact: true }).last().click();
  await page
    .getByText("Profile", { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 45_000 });
}

async function gotoClients(page: Page, clientName: string): Promise<void> {
  await page.goto("/clients");
  await page.waitForLoadState("domcontentloaded");
  // The Trade Pro variant of /clients renders a "CLIENTS" bucket
  // header. If we ever fall through to the homeowner branch this will
  // surface as a clear failure rather than a flaky timeout.
  await expect(
    page.getByText(/^CLIENTS$/i).first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText(clientName, { exact: true }).first(),
  ).toBeVisible({ timeout: 20_000 });
}

test.describe("Trade Pro per-client tag flow (#520 / #524)", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("pro tags themselves on a client row, the row reflects + persists, and Other… free text round-trips", async ({
    page,
  }) => {
    const tag = uid(8);
    const password = "Pass1234!";
    const proEmail = `pct-pro-${tag}@example.test`;

    const { localId: proClerkId } = await firebaseSignUp(proEmail, password);

    const cleanupClerkIds: string[] = [proClerkId];
    const cleanupConnectionIds: number[] = [];
    let clientName = "";

    const pg = new Client({ connectionString: DATABASE_URL! });
    await pg.connect();
    try {
      const pro = await seedTradePro(
        pg,
        proClerkId,
        proEmail,
        `pct_pro_${tag}`.slice(0, 24).toLowerCase(),
        `Pro ${tag}`,
        ["Plumbing", "HVAC"],
      );
      const client = await seedHomeClient(pg, tag, `Client ${tag}`);
      cleanupClerkIds.push(client.clerkId);
      clientName = client.displayName;
      const connectionId = await seedClientConnection(
        pg,
        pro.outwardAccountId,
        client.outwardAccountId,
      );
      cleanupConnectionIds.push(connectionId);
    } finally {
      await pg.end();
    }

    try {
      await signInUI(page, proEmail, password);
      await gotoClients(page, clientName);

      // Pre-condition: no "You show up as:" line yet, and the affordance
      // is the bare "Tag" pill, not "Edit tag".
      await expect(
        page.getByText("You show up as:", { exact: false }),
      ).toHaveCount(0);
      const tagBtn = page.getByLabel(`Tag yourself for ${clientName}`);
      await expect(tagBtn).toBeVisible();

      // ===== Default-identity branch =====
      await tagBtn.click();
      await expect(
        page.getByText("How do you show up?", { exact: true }),
      ).toBeVisible({ timeout: 10_000 });
      // Subject line shows which client we're tagging for.
      await expect(
        page.getByText(`For ${clientName}`, { exact: true }),
      ).toBeVisible();

      // Pick the "Plumbing" service chip + "Contractor" on-site identity.
      await page.getByText("Plumbing", { exact: true }).first().click();
      await page.getByText("Contractor", { exact: true }).first().click();
      await page.getByText("Save", { exact: true }).click();

      // Modal closes, the row reflects the new tag, and the affordance
      // flips to "Edit tag".
      await expect(
        page.getByText("How do you show up?", { exact: true }),
      ).toHaveCount(0, { timeout: 10_000 });
      await expect(
        page.getByText("You show up as: Plumbing · Contractor", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByLabel(`Change how you show up for ${clientName}`),
      ).toBeVisible();

      // ===== Reload — persistence proves the value made it to the server,
      // not just to the local query cache. =====
      await page.reload();
      await gotoClients(page, clientName);
      await expect(
        page.getByText("You show up as: Plumbing · Contractor", { exact: true }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        page.getByLabel(`Change how you show up for ${clientName}`),
      ).toBeVisible();

      // ===== Other… / free-text branch =====
      await page.getByLabel(`Change how you show up for ${clientName}`).click();
      await expect(
        page.getByText("How do you show up?", { exact: true }),
      ).toBeVisible({ timeout: 10_000 });
      // Switch the on-site identity to Other… and type a custom value.
      await page.getByText("Other…", { exact: true }).first().click();
      const otherInput = page.getByPlaceholder("Describe…");
      await expect(otherInput).toBeVisible({ timeout: 5_000 });
      await otherInput.fill("Lead inspector");
      await page.getByText("Save", { exact: true }).click();

      await expect(
        page.getByText("How do you show up?", { exact: true }),
      ).toHaveCount(0, { timeout: 10_000 });
      await expect(
        page.getByText("You show up as: Plumbing · Lead inspector", {
          exact: true,
        }),
      ).toBeVisible({ timeout: 15_000 });

      // ===== Reload — the free-text Other… value persists too. =====
      await page.reload();
      await gotoClients(page, clientName);
      await expect(
        page.getByText("You show up as: Plumbing · Lead inspector", {
          exact: true,
        }),
      ).toBeVisible({ timeout: 20_000 });
    } finally {
      await cleanup(cleanupClerkIds, cleanupConnectionIds);
    }
  });
});

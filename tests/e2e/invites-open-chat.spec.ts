/**
 * E2E coverage for the Open chat shortcut after accepting a team-up
 * request (task #600 — verifies UX added in #597).
 *
 * The Invites screen (`artifacts/round-house/app/invites.tsx`) shows a
 * success banner after the recipient responds to a pending team-up
 * request. The banner only includes an **Open chat** action when the
 * action was `accept` (it sets `banner.openChatTarget` to the
 * requester's outward-account id, which keys the deep-link). On
 * `decline` the banner appears without the shortcut.
 *
 * This spec asserts:
 *   1. Tapping Decline shows the success banner WITHOUT an "Open
 *      chat" button.
 *   2. After re-seeding a fresh pending request, tapping Accept
 *      shows the banner WITH "Open chat".
 *   3. Tapping "Open chat" deep-links to `/inbox/{requesterAcctId}`
 *      (the requester's outward-account id, NOT clerk id).
 *   4. Sending a message from that thread persists into the
 *      `messages` table and is visible in the requester's
 *      `GET /api/messages/:other` fetch on next call.
 *
 * Mirrors the per-test signup + SQL seed + cleanup pattern from
 * `ignore-team-up-request.spec.ts`. The requester is also signed up
 * with Firebase so we can hit `GET /api/messages/:other` with their
 * Bearer token to verify the cross-side fetch (no second sign-in
 * round-trip in the browser).
 */
import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

const FIREBASE_API_KEY = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const BASE_URL =
  process.env.E2E_BASE_URL ||
  (process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "http://localhost:80");

function uid(n = 6): string {
  return Math.random().toString(36).slice(2, 2 + n);
}

interface FirebaseUser {
  idToken: string;
  refreshToken: string;
  localId: string;
}

async function firebaseSignUp(email: string, password: string): Promise<FirebaseUser> {
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
  return (await r.json()) as FirebaseUser;
}

interface SeedResult {
  clerkId: string;
  outwardAccountId: number;
}

/**
 * Lazy-create the user's `users` row through the auth-middleware
 * (`GET /api/users/me` insert path), then mark them onboarded and
 * give them a single outward account of the requested kind set
 * active. Returns the freshly-created outward account id.
 */
async function seedUser(opts: {
  idToken: string;
  clerkId: string;
  rawName: string;
  username: string;
  kind: "home" | "trade_pro";
  companyName?: string;
}): Promise<SeedResult> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const meRes = await fetch(new URL("/api/users/me", BASE_URL).toString(), {
    headers: { Authorization: `Bearer ${opts.idToken}` },
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
      [opts.clerkId, opts.rawName, opts.username],
    );
    const mode = await pg.query<{ id: number }>(
      `INSERT INTO user_modes (user_clerk_id, kind, intake_data, intake_completed_at)
         VALUES ($1, $2, '{}'::jsonb, NOW())
         RETURNING id`,
      [opts.clerkId, opts.kind],
    );
    const outward = await pg.query<{ id: number }>(
      `INSERT INTO outward_accounts
         (owner_clerk_id, kind, title, display_name, company_name,
          source_user_mode_id, capability_state)
         VALUES ($1, $2, $3, $3, $4, $5, 'expanded')
         RETURNING id`,
      [
        opts.clerkId,
        opts.kind,
        opts.rawName,
        opts.companyName ?? null,
        mode.rows[0].id,
      ],
    );
    await pg.query(
      `UPDATE users
         SET last_active_mode_id = $1,
             active_outward_account_id = $2
         WHERE clerk_id = $3`,
      [mode.rows[0].id, outward.rows[0].id, opts.clerkId],
    );
    return { clerkId: opts.clerkId, outwardAccountId: outward.rows[0].id };
  } finally {
    await pg.end();
  }
}

/**
 * Insert a `pending` `user_connections` row from the requester's
 * outward account to the recipient's outward account. Inserted
 * directly so the test does not pull in the system-message side
 * effects of `POST /api/users/:userId/connect`.
 */
async function seedPendingRequest(opts: {
  fromAcctId: number;
  toAcctId: number;
  personalNote: string;
}): Promise<number> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    const res = await pg.query<{ id: number }>(
      `INSERT INTO user_connections
         (from_outward_account_id, to_outward_account_id, kind, status,
          requested_at, personal_note)
         VALUES ($1, $2, 'client', 'pending', NOW(), $3)
         RETURNING id`,
      [opts.fromAcctId, opts.toAcctId, opts.personalNote],
    );
    return res.rows[0].id;
  } finally {
    await pg.end();
  }
}

async function clearConnectionsBetween(a: number, b: number): Promise<void> {
  if (!DATABASE_URL) return;
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    await pg.query(
      `DELETE FROM user_connections
         WHERE (from_outward_account_id = $1 AND to_outward_account_id = $2)
            OR (from_outward_account_id = $2 AND to_outward_account_id = $1)`,
      [a, b],
    );
  } finally {
    await pg.end();
  }
}

async function readConnections(a: number, b: number) {
  if (!DATABASE_URL) return [];
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    const r = await pg.query<{
      from_outward_account_id: number;
      to_outward_account_id: number;
      status: string;
      responded_at: Date | null;
      archived_at: Date | null;
    }>(
      `SELECT from_outward_account_id, to_outward_account_id, status,
              responded_at, archived_at
         FROM user_connections
        WHERE (from_outward_account_id = $1 AND to_outward_account_id = $2)
           OR (from_outward_account_id = $2 AND to_outward_account_id = $1)`,
      [a, b],
    );
    return r.rows;
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
    await pg.query(
      `DELETE FROM messages
         WHERE sender_clerk_id    = ANY($1::text[])
            OR recipient_clerk_id = ANY($1::text[])`,
      [filtered],
    );
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
  await page.goto(BASE_URL + "/");
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

test.describe("Open chat shortcut after team-up accept (#600)", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("Decline hides Open chat; Accept shows it, deep-links to the thread, and the requester receives the message on next fetch", async ({
    page,
  }) => {
    const tag = uid(8);
    const password = "Pass1234!";

    const recipientEmail = `oc-recipient-${tag}@example.test`;
    const recipientName = `Open Chat Recipient ${tag}`;
    const recipientUsername = `oc_recipient_${tag}`.toLowerCase();

    const requesterEmail = `oc-requester-${tag}@example.test`;
    const requesterName = `Open Chat Requester ${tag}`;
    const requesterUsername = `oc_requester_${tag}`.toLowerCase();

    let recipientClerkId = "";
    let requesterClerkId = "";

    try {
      const recipientFb = await firebaseSignUp(recipientEmail, password);
      recipientClerkId = recipientFb.localId;
      const recipient = await seedUser({
        idToken: recipientFb.idToken,
        clerkId: recipientClerkId,
        
        rawName: recipientName,
        username: recipientUsername,
        kind: "home",
      });

      const requesterFb = await firebaseSignUp(requesterEmail, password);
      requesterClerkId = requesterFb.localId;
      const requester = await seedUser({
        idToken: requesterFb.idToken,
        clerkId: requesterClerkId,
        
        rawName: requesterName,
        username: requesterUsername,
        kind: "trade_pro",
        companyName: `${requesterName} Co.`,
      });

      page.on("dialog", (d) => {
        d.accept().catch(() => {});
      });

      await signInViaUI(page, recipientEmail, password);

      // ===== Path A: Decline =====
      await seedPendingRequest({
        fromAcctId: requester.outwardAccountId,
        toAcctId: recipient.outwardAccountId,
        personalNote: `Decline path note ${tag}`,
      });

      await page.goto(BASE_URL + "/invites");
      await expect(page.getByText("My invites", { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText("Team-up requests", { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      const declineBtn = page.getByLabel(`Decline request from ${requesterName}`);
      await expect(declineBtn).toBeVisible({ timeout: 15_000 });
      await declineBtn.dispatchEvent("click");

      await expect(
        page.getByText(`Declined the request from ${requesterName}.`, { exact: true }),
      ).toBeVisible({ timeout: 5_000 });

      // The Open chat shortcut MUST NOT appear on a decline banner.
      await expect(page.getByLabel("Open chat")).toHaveCount(0);
      await expect(page.getByText("Open chat", { exact: true })).toHaveCount(0);

      const declineRows = await readConnections(
        requester.outwardAccountId,
        recipient.outwardAccountId,
      );
      expect(declineRows).toHaveLength(1);
      expect(declineRows[0].status).toBe("declined");
      expect(declineRows[0].responded_at).not.toBeNull();

      // ===== Path B: Accept =====
      await clearConnectionsBetween(
        requester.outwardAccountId,
        recipient.outwardAccountId,
      );
      await seedPendingRequest({
        fromAcctId: requester.outwardAccountId,
        toAcctId: recipient.outwardAccountId,
        personalNote: `Accept path note ${tag}`,
      });

      // Force a refetch by remounting the screen.
      await page.goto(BASE_URL + "/");
      await expect(page.getByText("Properties").first()).toBeVisible({
        timeout: 30_000,
      });
      await page.goto(BASE_URL + "/invites");
      await expect(page.getByText("Team-up requests", { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      const acceptBtn = page.getByLabel(`Accept request from ${requesterName}`);
      await expect(acceptBtn).toBeVisible({ timeout: 15_000 });

      const respondPromise = page.waitForResponse(
        (r) =>
          /\/api\/users\/[^/]+\/team-up\/respond$/.test(r.url()) &&
          r.request().method() === "POST",
        { timeout: 15_000 },
      );
      await acceptBtn.dispatchEvent("click");
      const respondRes = await respondPromise;
      expect(
        respondRes.ok(),
        `Accept POST should succeed; got ${respondRes.status()} ${await respondRes.text()}`,
      ).toBeTruthy();

      await expect(
        page.getByText(`You're now connected with ${requesterName}.`, { exact: true }),
      ).toBeVisible({ timeout: 5_000 });

      const openChatBtn = page.getByLabel("Open chat");
      await expect(openChatBtn).toBeVisible({ timeout: 5_000 });

      const acceptRows = await readConnections(
        requester.outwardAccountId,
        recipient.outwardAccountId,
      );
      const acceptedRows = acceptRows.filter(
        (r) => r.status === "accepted" && r.archived_at == null,
      );
      expect(
        acceptedRows.length,
        `Both directions of the connection should be accepted; got ${JSON.stringify(acceptRows)}`,
      ).toBe(2);

      // ===== Tap Open chat → deep-link, send a message, persist =====
      await openChatBtn.dispatchEvent("click");

      // The deep link uses the requester's outward-account id, not
      // clerk id (the heart of #597).
      await page.waitForURL(
        new RegExp(`/inbox/${requester.outwardAccountId}(?:[/?#]|$)`),
        { timeout: 15_000 },
      );

      const composer = page.getByPlaceholder("Message");
      await expect(composer).toBeVisible({ timeout: 15_000 });
      const messageBody = `Hello from accept path ${tag}`;
      await composer.fill(messageBody);

      const sendBtn = page.getByLabel("Send message");
      await expect(sendBtn).toBeEnabled({ timeout: 5_000 });

      const sendPromise = page.waitForResponse(
        (r) =>
          /\/api\/messages\/[^/]+$/.test(r.url()) &&
          r.request().method() === "POST",
        { timeout: 15_000 },
      );
      await sendBtn.dispatchEvent("click");
      const sendRes = await sendPromise;
      expect(
        sendRes.ok(),
        `Send POST should succeed (team-up gate must be lifted); got ${sendRes.status()} ${await sendRes.text()}`,
      ).toBeTruthy();

      // Outgoing bubble shows up in the thread.
      await expect(page.getByText(messageBody, { exact: true })).toBeVisible({
        timeout: 10_000,
      });

      // ===== Path C: Requester (other side) sees the message on next fetch =====
      // We hit the API directly with the requester's Bearer token rather
      // than re-driving the browser through a second sign-in: this is
      // exactly what the requester's app would do on next fetch and
      // proves the message rounded-trip cleanly into the conversation
      // they would see in their inbox.
      const requesterConvRes = await fetch(
        new URL(
          `/api/messages/${recipient.outwardAccountId}`,
          BASE_URL,
        ).toString(),
        { headers: { Authorization: `Bearer ${requesterFb.idToken}` } },
      );
      expect(requesterConvRes.ok).toBeTruthy();
      const requesterConv = (await requesterConvRes.json()) as {
        messages: Array<{ content: string; senderClerkId: string }>;
      };
      const incoming = requesterConv.messages.find(
        (m) => m.content === messageBody && m.senderClerkId === recipientClerkId,
      );
      expect(
        incoming,
        `Requester should see the new message on next fetch. Got: ${JSON.stringify(requesterConv.messages)}`,
      ).toBeTruthy();
    } finally {
      await cleanup([recipientClerkId, requesterClerkId]);
    }
  });
});

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

type SkinKind = "home" | "trade_pro" | "facilities";

interface SeededOwner {
  clerkId: string;
  username: string;
  outwardAccountId: number;
}

/**
 * Insert a fully-onboarded user with a single outward account of the
 * given skin kind, marked active, and return enough handles to wire up
 * connections without round-tripping through the API.
 *
 * Mirrors what the existing per-skin specs do: bypasses identity +
 * intake by writing directly to PG so the app routes straight into
 * (tabs) without any onboarding redirects.
 */
async function seedOwner(
  pg: Client,
  clerkId: string,
  email: string,
  username: string,
  skin: SkinKind,
  title: string,
): Promise<SeededOwner> {
  await pg.query(
    `INSERT INTO users (clerk_id, email, name, username, avatar_url, identity_completed_at)
       VALUES ($1, $2, $3, $4, 'public/seed-avatar.png', NOW())
       ON CONFLICT (clerk_id) DO NOTHING`,
    [clerkId, email, email.split("@")[0], username],
  );
  const modeRow = await pg.query<{ id: number }>(
    `INSERT INTO user_modes (user_clerk_id, kind, intake_data, intake_completed_at)
       VALUES ($1, $2, '{}'::jsonb, NOW())
       ON CONFLICT (user_clerk_id, kind)
         DO UPDATE SET intake_completed_at = EXCLUDED.intake_completed_at
       RETURNING id`,
    [clerkId, skin],
  );
  const modeId = modeRow.rows[0].id;
  const acctRow = await pg.query<{ id: number }>(
    `INSERT INTO outward_accounts
       (owner_clerk_id, kind, title, display_name, source_user_mode_id)
       VALUES ($1, $2, $3, $3, $4)
       RETURNING id`,
    [clerkId, skin, title, modeId],
  );
  const outwardAccountId = acctRow.rows[0].id;
  await pg.query(
    `UPDATE users
       SET last_active_mode_id = $1,
           active_outward_account_id = $2
       WHERE clerk_id = $3`,
    [modeId, outwardAccountId, clerkId],
  );
  return { clerkId, username, outwardAccountId };
}

/**
 * Seed a counterparty user (no Firebase auth — they only need to exist
 * so the connection row resolves to a person with a name/username on
 * the relationships endpoint). Returns the outward account id we can
 * point a connection at.
 */
async function seedCounterparty(
  pg: Client,
  tag: string,
  slug: string,
  displayName: string,
  skin: SkinKind,
): Promise<{ clerkId: string; outwardAccountId: number; displayName: string }> {
  const clerkId = `seed_${slug}_${tag}`;
  const username = `${slug}_${tag}`.slice(0, 24).toLowerCase();
  const email = `${username}@example.test`;
  await pg.query(
    `INSERT INTO users (clerk_id, email, name, username, avatar_url, identity_completed_at)
       VALUES ($1, $2, $3, $4, 'public/seed-avatar.png', NOW())
       ON CONFLICT (clerk_id) DO NOTHING`,
    [clerkId, email, displayName, username],
  );
  const modeRow = await pg.query<{ id: number }>(
    `INSERT INTO user_modes (user_clerk_id, kind, intake_data, intake_completed_at)
       VALUES ($1, $2, '{}'::jsonb, NOW())
       ON CONFLICT (user_clerk_id, kind)
         DO UPDATE SET intake_completed_at = EXCLUDED.intake_completed_at
       RETURNING id`,
    [clerkId, skin],
  );
  const modeId = modeRow.rows[0].id;
  const acctRow = await pg.query<{ id: number }>(
    `INSERT INTO outward_accounts
       (owner_clerk_id, kind, title, display_name, source_user_mode_id)
       VALUES ($1, $2, $3, $3, $4)
       RETURNING id`,
    [clerkId, skin, displayName, modeId],
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

interface ConnectionSeed {
  fromOutwardAccountId: number;
  toOutwardAccountId: number;
  kind: "client" | "core" | "collaborator";
  classification?: "worker" | "outside_service_provider" | null;
  cadence?: "occasional" | "recurring" | null;
}

async function seedConnection(pg: Client, c: ConnectionSeed): Promise<void> {
  await pg.query(
    `INSERT INTO user_connections
       (from_outward_account_id, to_outward_account_id, kind, status,
        classification, cadence, requested_at, responded_at)
       VALUES ($1, $2, $3, 'accepted', $4, $5, NOW(), NOW())`,
    [
      c.fromOutwardAccountId,
      c.toOutwardAccountId,
      c.kind,
      c.classification ?? null,
      c.cadence ?? null,
    ],
  );
}

async function signInUI(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/");
  await page.getByPlaceholder(/you@example\.com/i).fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByText("Sign in", { exact: true }).last().click();
  // Wait for the tab bar to render (Profile is the rightmost tab and is
  // always present once we're inside (tabs)).
  await page
    .getByText("Profile", { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
}

async function gotoMyTeam(page: Page): Promise<void> {
  await page.goto("/my-team");
  await page.waitForLoadState("domcontentloaded");
  // The screen renders the "My Team" title once the tab is mounted.
  await expect(page.getByText("My Team", { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
  // Give the relationships query a beat to resolve.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500);
}

/**
 * Per-skin My Team layout (#504). The screen renders three different
 * bucket stacks based on the active outward account's `companyKind`.
 * This spec seeds a homeowner, a trade pro, and a facility manager
 * (each with mixed-cadence and mixed-classification connections),
 * signs in as each, and asserts the bucket headings + sub-headings
 * + that a recurring pro lands under "Recurring" while an occasional
 * pro lands under "Occasional".
 *
 * Every test runs as its own freshly-seeded user so no two tests can
 * accidentally see each other's connection rows.
 */
test.describe("My Team — per-skin layout", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("Homeowner: Trade Pros bucket splits Occasional vs Recurring + Friends section", async ({
    page,
  }) => {
    const tag = uid(8);
    const email = `myteam-home-${tag}@example.test`;
    const password = "Pass1234!";

    const { idToken, localId: clerkId } = await firebaseSignUp(email, password);
    void idToken;

    const pg = new Client({ connectionString: DATABASE_URL! });
    await pg.connect();
    let recurringName: string;
    let occasionalName: string;
    let friendName: string;
    try {
      const owner = await seedOwner(
        pg,
        clerkId,
        email,
        `home_${tag}`.slice(0, 24).toLowerCase(),
        "home",
        `Home ${tag}`,
      );
      const recurringPro = await seedCounterparty(
        pg,
        tag,
        "recpro",
        `RecurringPro ${tag}`,
        "trade_pro",
      );
      const occasionalPro = await seedCounterparty(
        pg,
        tag,
        "occpro",
        `OccasionalPro ${tag}`,
        "trade_pro",
      );
      const friend = await seedCounterparty(
        pg,
        tag,
        "friend",
        `Friend ${tag}`,
        "home",
      );
      recurringName = recurringPro.displayName;
      occasionalName = occasionalPro.displayName;
      friendName = friend.displayName;

      await seedConnection(pg, {
        fromOutwardAccountId: owner.outwardAccountId,
        toOutwardAccountId: recurringPro.outwardAccountId,
        kind: "core",
        cadence: "recurring",
      });
      await seedConnection(pg, {
        fromOutwardAccountId: owner.outwardAccountId,
        toOutwardAccountId: occasionalPro.outwardAccountId,
        kind: "core",
        cadence: "occasional",
      });
      await seedConnection(pg, {
        fromOutwardAccountId: owner.outwardAccountId,
        toOutwardAccountId: friend.outwardAccountId,
        kind: "collaborator",
      });
    } finally {
      await pg.end();
    }

    await signInUI(page, email, password);
    await gotoMyTeam(page);

    // Top-level buckets for Homeowner.
    await expect(page.getByText("Trade Pros", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText("Friends & Collaborators", { exact: true }).first(),
    ).toBeVisible();
    // Trade Pro buckets that should NOT exist on Homeowner.
    await expect(page.getByText("Clients", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Outside Services", { exact: true })).toHaveCount(0);

    // Cadence sub-headings under Trade Pros.
    await expect(page.getByText("Occasional", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Recurring", { exact: true }).first()).toBeVisible();

    // Recurring pro is rendered after the "Recurring" sub-header and
    // before any other top-level header, and the occasional pro lives
    // under "Occasional". We assert the recurring name appears in the
    // DOM strictly between "Recurring" and the next bucket header.
    const recurringIdx = await page.evaluate((name) => {
      const recHeader = [...document.querySelectorAll("*")].find(
        (el) => el.textContent?.trim() === "Recurring",
      );
      const occHeader = [...document.querySelectorAll("*")].find(
        (el) => el.textContent?.trim() === "Occasional",
      );
      const target = [...document.querySelectorAll("*")].find(
        (el) => el.textContent?.trim() === name,
      );
      if (!recHeader || !target || !occHeader) return -1;
      const recPos = (recHeader.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING) ? 1 : -1;
      const occPos = (occHeader.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING) ? 1 : -1;
      // recurring name must be after Recurring header AND after Occasional
      // header (Occasional renders first when both are present).
      return recPos === 1 && occPos === 1 ? 1 : 0;
    }, recurringName);
    expect(recurringIdx, `${recurringName} should render under Recurring`).toBe(1);

    const occasionalIdx = await page.evaluate(
      ([occName, recName]) => {
        const occHeader = [...document.querySelectorAll("*")].find(
          (el) => el.textContent?.trim() === "Occasional",
        );
        const recHeader = [...document.querySelectorAll("*")].find(
          (el) => el.textContent?.trim() === "Recurring",
        );
        const target = [...document.querySelectorAll("*")].find(
          (el) => el.textContent?.trim() === occName,
        );
        if (!occHeader || !recHeader || !target) return -1;
        const afterOcc =
          (occHeader.compareDocumentPosition(target) &
            Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        const beforeRec =
          (recHeader.compareDocumentPosition(target) &
            Node.DOCUMENT_POSITION_PRECEDING) !== 0;
        return afterOcc && beforeRec ? 1 : 0;
      },
      [occasionalName, recurringName] as const,
    );
    expect(occasionalIdx, `${occasionalName} should render under Occasional`).toBe(1);

    // Friend appears in the Friends & Collaborators bucket.
    await expect(page.getByText(friendName, { exact: true }).first()).toBeVisible();
  });

  test("Trade Pro: Clients + Trade Pro Teammates + Outside Services (Occasional/Recurring) + Friends", async ({
    page,
  }) => {
    const tag = uid(8);
    const email = `myteam-tp-${tag}@example.test`;
    const password = "Pass1234!";

    const { idToken, localId: clerkId } = await firebaseSignUp(email, password);
    void idToken;

    const pg = new Client({ connectionString: DATABASE_URL! });
    await pg.connect();
    let clientName: string;
    let recurringPartnerName: string;
    let occasionalPartnerName: string;
    try {
      const owner = await seedOwner(
        pg,
        clerkId,
        email,
        `tp_${tag}`.slice(0, 24).toLowerCase(),
        "trade_pro",
        `TradePro ${tag}`,
      );
      const client = await seedCounterparty(
        pg,
        tag,
        "client",
        `Client ${tag}`,
        "home",
      );
      const recurringPartner = await seedCounterparty(
        pg,
        tag,
        "recout",
        `RecurringOutside ${tag}`,
        "trade_pro",
      );
      const occasionalPartner = await seedCounterparty(
        pg,
        tag,
        "occout",
        `OccasionalOutside ${tag}`,
        "trade_pro",
      );
      clientName = client.displayName;
      recurringPartnerName = recurringPartner.displayName;
      occasionalPartnerName = occasionalPartner.displayName;

      await seedConnection(pg, {
        fromOutwardAccountId: owner.outwardAccountId,
        toOutwardAccountId: client.outwardAccountId,
        kind: "client",
      });
      await seedConnection(pg, {
        fromOutwardAccountId: owner.outwardAccountId,
        toOutwardAccountId: recurringPartner.outwardAccountId,
        kind: "core",
        classification: "outside_service_provider",
        cadence: "recurring",
      });
      await seedConnection(pg, {
        fromOutwardAccountId: owner.outwardAccountId,
        toOutwardAccountId: occasionalPartner.outwardAccountId,
        kind: "core",
        classification: "outside_service_provider",
        cadence: "occasional",
      });
    } finally {
      await pg.end();
    }

    await signInUI(page, email, password);
    await gotoMyTeam(page);

    // Top-level Trade Pro buckets.
    await expect(page.getByText("Clients", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText("Trade Pro Teammates", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Outside Services", { exact: true }).first(),
    ).toBeVisible();
    // The Homeowner-only "Trade Pros" header must not render here.
    await expect(page.getByText("Trade Pros", { exact: true })).toHaveCount(0);

    // Cadence sub-headings under Outside Services.
    await expect(page.getByText("Occasional", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Recurring", { exact: true }).first()).toBeVisible();

    // Client + both outside services are visible by name.
    await expect(page.getByText(clientName, { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText(recurringPartnerName, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(occasionalPartnerName, { exact: true }).first(),
    ).toBeVisible();

    // Recurring lands under Recurring; Occasional lands under Occasional.
    const cadenceOk = await page.evaluate(
      ([recName, occName]) => {
        const recHeader = [...document.querySelectorAll("*")].find(
          (el) => el.textContent?.trim() === "Recurring",
        );
        const occHeader = [...document.querySelectorAll("*")].find(
          (el) => el.textContent?.trim() === "Occasional",
        );
        const recRow = [...document.querySelectorAll("*")].find(
          (el) => el.textContent?.trim() === recName,
        );
        const occRow = [...document.querySelectorAll("*")].find(
          (el) => el.textContent?.trim() === occName,
        );
        if (!recHeader || !occHeader || !recRow || !occRow) return false;
        const recAfterRec =
          (recHeader.compareDocumentPosition(recRow) &
            Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        const occAfterOcc =
          (occHeader.compareDocumentPosition(occRow) &
            Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        const occBeforeRec =
          (recHeader.compareDocumentPosition(occRow) &
            Node.DOCUMENT_POSITION_PRECEDING) !== 0;
        return recAfterRec && occAfterOcc && occBeforeRec;
      },
      [recurringPartnerName, occasionalPartnerName] as const,
    );
    expect(cadenceOk, "outside services must split by cadence").toBe(true);
  });

  test("Facility Manager: Facility Teammates + Friends only (no Outside Services here)", async ({
    page,
  }) => {
    const tag = uid(8);
    const email = `myteam-fm-${tag}@example.test`;
    const password = "Pass1234!";

    const { idToken, localId: clerkId } = await firebaseSignUp(email, password);
    void idToken;

    const pg = new Client({ connectionString: DATABASE_URL! });
    await pg.connect();
    let friendName: string;
    try {
      const owner = await seedOwner(
        pg,
        clerkId,
        email,
        `fm_${tag}`.slice(0, 24).toLowerCase(),
        "facilities",
        `Facility ${tag}`,
      );
      const friend = await seedCounterparty(
        pg,
        tag,
        "fmfriend",
        `FacilityFriend ${tag}`,
        "home",
      );
      friendName = friend.displayName;

      await seedConnection(pg, {
        fromOutwardAccountId: owner.outwardAccountId,
        toOutwardAccountId: friend.outwardAccountId,
        kind: "collaborator",
      });
    } finally {
      await pg.end();
    }

    await signInUI(page, email, password);
    await gotoMyTeam(page);

    // Facility Teammates header is rendered (even with no teammates the
    // header + empty-card render together).
    await expect(
      page.getByText("Facility Teammates", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Friends & Collaborators", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText(friendName, { exact: true }).first()).toBeVisible();

    // Buckets that belong to the Trade Pro / Homeowner skins must NOT
    // appear under My Team for a Facility Manager. (Outside Services
    // for FMs lives on the left lower-nav tab — `clients.tsx` — not
    // here.)
    await expect(page.getByText("Outside Services", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Trade Pros", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Clients", { exact: true })).toHaveCount(0);
    await expect(
      page.getByText("Trade Pro Teammates", { exact: true }),
    ).toHaveCount(0);
  });
});

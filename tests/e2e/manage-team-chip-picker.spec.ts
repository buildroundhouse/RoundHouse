import { test, expect, type Locator, type Page } from "@playwright/test";
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

type SkinKind = "trade_pro" | "facilities";

interface SeededOwner {
  clerkId: string;
  outwardAccountId: number;
}

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
  return { clerkId, outwardAccountId };
}

interface SeededCounterparty {
  clerkId: string;
  email: string;
  username: string;
  name: string;
}

/**
 * Seed a counterparty user without Firebase. The lead invites them by
 * `email`, so the server only needs a `users` row to resolve the target.
 */
async function seedCounterparty(
  pg: Client,
  tag: string,
  slot: string,
  displayName: string,
): Promise<SeededCounterparty> {
  const clerkId = `seed_${slot}_${tag}`;
  const username = `${slot}_${tag}`.slice(0, 24).toLowerCase();
  const email = `${username}@example.test`;
  await pg.query(
    `INSERT INTO users (clerk_id, email, name, username, avatar_url, identity_completed_at)
       VALUES ($1, $2, $3, $4, 'public/seed-avatar.png', NOW())
       ON CONFLICT (clerk_id) DO NOTHING`,
    [clerkId, email, displayName, username],
  );
  return { clerkId, email, username, name: displayName };
}

/**
 * Pre-seed an already-accepted personal-team row. Required for the
 * trade_pro skin because the /my-team screen renders only a top-level
 * EmptyState (which routes to /invite, a different feature) when both
 * relationships AND team members are empty. With at least one team row
 * the in-place "Manage" affordance becomes visible inside TeamSection.
 */
async function seedAcceptedTeammate(
  pg: Client,
  leadClerkId: string,
  memberClerkId: string,
): Promise<void> {
  await pg.query(
    `INSERT INTO user_team_members
       (lead_clerk_id, member_clerk_id, role, status, accepted_at)
       VALUES ($1, $2, 'employee', 'accepted', NOW())`,
    [leadClerkId, memberClerkId],
  );
}

async function signInUI(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/");
  await page.getByPlaceholder(/you@example\.com/i).fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByText("Sign in", { exact: true }).last().click();
  await page
    .getByText("Profile", { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
}

async function gotoMyTeam(page: Page): Promise<void> {
  await page.goto("/my-team");
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByText("My Team", { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(500);
}

/**
 * Open the in-place ManageTeamModal by tapping the small "Manage" link
 * inside the TeamSection card's TEAM header. This is NOT the same as
 * the screen's top-of-page "Invite a teammate" pill, which routes to
 * /invite (a different feature).
 */
async function openManageModal(page: Page): Promise<void> {
  await page.getByText("Manage", { exact: true }).first().click();
  await expect(
    page.getByText("Manage team", { exact: true }).first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText("INVITE BY USERNAME OR EMAIL", { exact: true }).first(),
  ).toBeVisible();
}

/**
 * Locate the change-chip sheet by its unique "For {name}" caption, then
 * walk up to a containing scrollview that holds the chip pills + Save.
 * Both the sheet and the underlying invite section render the same chip
 * labels (e.g. "Carpentry"), so unscoped getByText matches are
 * ambiguous; this helper lets us click pills *within* the sheet only.
 */
function sheetScope(page: Page, memberName: string): Locator {
  // Smallest div containing BOTH the unique "For {name}" caption and
  // the sheet's footer "Save" button — that is the ChangeChipSheet
  // root. .last() picks the innermost such ancestor.
  return page
    .locator("div")
    .filter({ has: page.getByText(`For ${memberName}`, { exact: true }) })
    .filter({ has: page.getByText("Save", { exact: true }) })
    .last();
}

/**
 * Open the per-row Change chip sheet for the given teammate by clicking
 * the TEAMMATE CHIPS row that ends with `· {currentLabel}`.
 */
async function openChangeChipSheet(
  page: Page,
  memberName: string,
  currentLabel: string,
): Promise<void> {
  await page
    .getByText(new RegExp(`${memberName}\\s*·\\s*${currentLabel}`))
    .first()
    .click({ force: true });
  await expect(
    page.getByText("Change chip", { exact: true }).first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText(`For ${memberName}`, { exact: true }),
  ).toBeVisible();
  // Sheet uses animationType="slide" — wait for the slide-in to settle
  // before tapping a chip pill, otherwise the press lands during the
  // transition and the Pressable's onPress can be swallowed.
  await page.waitForTimeout(600);
}

/**
 * #548 — Admin chip-picker invite flow on ManageTeamModal.
 *
 * Verifies, for both the Trade Pro and Facility company-skin
 * vocabularies, that:
 *   1. Inviting with the curated chip persists and renders in
 *      TeamSection's subtitle.
 *   2. Inviting with the "Other…" + free-text branch persists and
 *      renders the free-text label in the same subtitle slot.
 *   3. The per-row "Change chip" sheet PATCHes
 *      /api/users/me/team/{memberClerkId}/chip and the UI re-renders
 *      with the new label resolved through the active vocabulary.
 *
 * Each test seeds its own owner + counterparties so runs cannot bleed
 * into one another.
 */
test.describe("Admin chip-picker invite flow (ManageTeamModal #548)", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("Trade Pro vocabulary: curated invite, Other-on-invite, per-row PATCH", async ({
    page,
  }) => {
    const tag = uid();
    const email = `chip-tp-${tag}@example.test`;
    const password = "Pass1234!";

    const { localId: clerkId } = await firebaseSignUp(email, password);

    const pg = new Client({ connectionString: DATABASE_URL! });
    await pg.connect();
    let mateA: SeededCounterparty;
    let mateB: SeededCounterparty;
    let mateC: SeededCounterparty;
    try {
      const owner = await seedOwner(
        pg,
        clerkId,
        email,
        `tp_${tag}`.slice(0, 24).toLowerCase(),
        "trade_pro",
        `TradePro ${tag}`,
      );
      mateA = await seedCounterparty(pg, tag, "tpmateA", `Mate A ${tag}`);
      mateB = await seedCounterparty(pg, tag, "tpmateB", `Mate B ${tag}`);
      mateC = await seedCounterparty(pg, tag, "tpmateC", `Mate C ${tag}`);
      // Pre-seeded accepted teammate so the in-place "Manage" affordance
      // is visible (otherwise /my-team falls back to its top-level
      // EmptyState that routes to /invite).
      await seedAcceptedTeammate(pg, owner.clerkId, mateA.clerkId);
    } finally {
      await pg.end();
    }

    await signInUI(page, email, password);
    await gotoMyTeam(page);

    await expect(
      page.getByText("Trade Pro Teammates", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText(mateA.name, { exact: true }).first()).toBeVisible();

    await openManageModal(page);

    // Vocabulary check: Trade Pro pills present, Facility-only labels absent.
    await expect(
      page.getByText("CHIP (OPTIONAL)", { exact: true }).first(),
    ).toBeVisible();
    for (const label of ["Plumbing", "Carpentry", "Electrical", "Painting", "Roofing", "Landscaping"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText("Maintenance", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Housekeeping", { exact: true })).toHaveCount(0);

    const inviteInput = page.getByPlaceholder("@username or someone@email.com");

    // ---- (1a) Invite mateB with curated chip "Plumbing" ----
    await inviteInput.fill(mateB.email);
    // Sheet is not open here, so "Plumbing" pill is unambiguous.
    await page.getByText("Plumbing", { exact: true }).first().click({ force: true });
    const inviteRespB = page.waitForResponse(
      (r) => r.url().includes("/api/users/me/team") && r.request().method() === "POST" && r.ok(),
      { timeout: 15_000 },
    );
    await page.getByText("Send invite", { exact: true }).first().click({ force: true });
    await inviteRespB;
    await expect(
      page.getByText(new RegExp(`@${mateB.username}.*Employee.*Plumbing.*Pending`)).first(),
    ).toBeVisible({ timeout: 10_000 });

    // ---- (1b) Invite mateC with "Other…" + free text "Apprentice" ----
    await inviteInput.fill(mateC.email);
    // Sheet still not open — Other… in invite section is unambiguous.
    await page.getByText("Other…", { exact: true }).first().click({ force: true });
    await page.getByPlaceholder("Describe…").fill("Apprentice");
    const inviteRespC = page.waitForResponse(
      (r) => r.url().includes("/api/users/me/team") && r.request().method() === "POST" && r.ok(),
      { timeout: 15_000 },
    );
    await page.getByText("Send invite", { exact: true }).first().click({ force: true });
    await inviteRespC;
    // Subtitle for mateC shows the free-text label "Apprentice" instead
    // of a curated one.
    await expect(
      page.getByText(new RegExp(`@${mateC.username}.*Employee.*Apprentice.*Pending`)).first(),
    ).toBeVisible({ timeout: 10_000 });

    // ---- (2) Per-row Change chip on mateA: curated "Carpentry" ----
    // mateA was seeded with no chip so its row reads "· No chip".
    await expect(
      page.getByText(new RegExp(`${mateA.name}\\s*·\\s*No chip`)).first(),
    ).toBeVisible();
    await openChangeChipSheet(page, mateA.name, "No chip");

    const sheetA = sheetScope(page, mateA.name);
    await sheetA.getByText("Carpentry", { exact: true }).first().click({ force: true });
    await page.waitForTimeout(300); // let React state propagate before Save
    const patchRespA = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/users/me/team/${mateA.clerkId}/chip`) &&
        r.request().method() === "PATCH" &&
        r.ok(),
      { timeout: 15_000 },
    );
    await page.getByText("Save", { exact: true }).first().click({ force: true });
    const patchedA = await patchRespA;
    expect(patchedA.url()).toContain(`/api/users/me/team/${mateA.clerkId}/chip`);
    const bodyA = patchedA.request().postDataJSON() as { chip?: string; chipOther?: string };
    expect(bodyA.chip).toBe("carpentry");

    await expect(
      page.getByText(new RegExp(`${mateA.name}\\s*·\\s*Carpentry`)).first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(new RegExp(`@${mateA.username}.*Employee.*Carpentry`)).first(),
    ).toBeVisible();

    // ---- (3) Per-row Change chip on mateB: change Plumbing → Roofing ----
    await openChangeChipSheet(page, mateB.name, "Plumbing");
    const sheetB = sheetScope(page, mateB.name);
    await sheetB.getByText("Roofing", { exact: true }).first().click({ force: true });
    const patchRespB = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/users/me/team/${mateB.clerkId}/chip`) &&
        r.request().method() === "PATCH" &&
        r.ok(),
      { timeout: 15_000 },
    );
    await page.getByText("Save", { exact: true }).first().click({ force: true });
    await patchRespB;
    await expect(
      page.getByText(new RegExp(`${mateB.name}\\s*·\\s*Roofing`)).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Final DB assertion: persisted state for all three rows.
    const pg2 = new Client({ connectionString: DATABASE_URL! });
    await pg2.connect();
    try {
      const rows = await pg2.query<{
        member_clerk_id: string;
        chip: string | null;
        chip_other: string | null;
      }>(
        `SELECT member_clerk_id, chip, chip_other
           FROM user_team_members
          WHERE lead_clerk_id = $1
          ORDER BY member_clerk_id`,
        [clerkId],
      );
      const byId = new Map(rows.rows.map((r) => [r.member_clerk_id, r]));
      expect(byId.get(mateA.clerkId)).toMatchObject({ chip: "carpentry", chip_other: null });
      expect(byId.get(mateB.clerkId)).toMatchObject({ chip: "roofing", chip_other: null });
      expect(byId.get(mateC.clerkId)).toMatchObject({ chip: "other", chip_other: "Apprentice" });
    } finally {
      await pg2.end();
    }
  });

  test("Facility vocabulary: curated invite, Other-on-invite, per-row PATCH", async ({
    page,
  }) => {
    const tag = uid();
    const email = `chip-fm-${tag}@example.test`;
    const password = "Pass1234!";

    const { localId: clerkId } = await firebaseSignUp(email, password);

    const pg = new Client({ connectionString: DATABASE_URL! });
    await pg.connect();
    let mateA: SeededCounterparty;
    let mateB: SeededCounterparty;
    let mateC: SeededCounterparty;
    try {
      await seedOwner(
        pg,
        clerkId,
        email,
        `fm_${tag}`.slice(0, 24).toLowerCase(),
        "facilities",
        `Facility ${tag}`,
      );
      mateA = await seedCounterparty(pg, tag, "fmmateA", `FMate A ${tag}`);
      mateB = await seedCounterparty(pg, tag, "fmmateB", `FMate B ${tag}`);
      mateC = await seedCounterparty(pg, tag, "fmmateC", `FMate C ${tag}`);
      await seedAcceptedTeammate(pg, clerkId, mateA.clerkId);
    } finally {
      await pg.end();
    }

    await signInUI(page, email, password);
    await gotoMyTeam(page);

    await expect(
      page.getByText("Facility Teammates", { exact: true }).first(),
    ).toBeVisible();

    await openManageModal(page);

    // Vocabulary check: Facility pills present, Trade Pro-only labels absent.
    for (const label of ["Maintenance", "Housekeeping", "Gardener", "Security", "Concierge", "Office"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText("Plumbing", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Electrical", { exact: true })).toHaveCount(0);

    const inviteInput = page.getByPlaceholder("@username or someone@email.com");

    // ---- (1a) Invite mateB with curated "Maintenance" ----
    await inviteInput.fill(mateB.email);
    await page.getByText("Maintenance", { exact: true }).first().click({ force: true });
    const inviteRespB = page.waitForResponse(
      (r) => r.url().includes("/api/users/me/team") && r.request().method() === "POST" && r.ok(),
      { timeout: 15_000 },
    );
    await page.getByText("Send invite", { exact: true }).first().click({ force: true });
    await inviteRespB;
    await expect(
      page.getByText(new RegExp(`@${mateB.username}.*Employee.*Maintenance.*Pending`)).first(),
    ).toBeVisible({ timeout: 10_000 });

    // ---- (1b) Invite mateC with Other + "Night Watch" ----
    await inviteInput.fill(mateC.email);
    await page.getByText("Other…", { exact: true }).first().click({ force: true });
    await page.getByPlaceholder("Describe…").fill("Night Watch");
    const inviteRespC = page.waitForResponse(
      (r) => r.url().includes("/api/users/me/team") && r.request().method() === "POST" && r.ok(),
      { timeout: 15_000 },
    );
    await page.getByText("Send invite", { exact: true }).first().click({ force: true });
    await inviteRespC;
    await expect(
      page.getByText(new RegExp(`@${mateC.username}.*Employee.*Night Watch.*Pending`)).first(),
    ).toBeVisible({ timeout: 10_000 });

    // ---- (2) Per-row Change chip on mateA: curated "Housekeeping" ----
    await openChangeChipSheet(page, mateA.name, "No chip");
    const sheetA = sheetScope(page, mateA.name);
    await sheetA.getByText("Housekeeping", { exact: true }).first().click({ force: true });
    const patchRespA = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/users/me/team/${mateA.clerkId}/chip`) &&
        r.request().method() === "PATCH" &&
        r.ok(),
      { timeout: 15_000 },
    );
    await page.getByText("Save", { exact: true }).first().click({ force: true });
    await patchRespA;
    await expect(
      page.getByText(new RegExp(`${mateA.name}\\s*·\\s*Housekeeping`)).first(),
    ).toBeVisible({ timeout: 10_000 });

    // ---- (3) Per-row Change chip on mateB: Maintenance → Gardener ----
    await openChangeChipSheet(page, mateB.name, "Maintenance");
    const sheetB = sheetScope(page, mateB.name);
    await sheetB.getByText("Gardener", { exact: true }).first().click({ force: true });
    const patchRespB = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/users/me/team/${mateB.clerkId}/chip`) &&
        r.request().method() === "PATCH" &&
        r.ok(),
      { timeout: 15_000 },
    );
    await page.getByText("Save", { exact: true }).first().click({ force: true });
    await patchRespB;
    await expect(
      page.getByText(new RegExp(`${mateB.name}\\s*·\\s*Gardener`)).first(),
    ).toBeVisible({ timeout: 10_000 });

    const pg2 = new Client({ connectionString: DATABASE_URL! });
    await pg2.connect();
    try {
      const rows = await pg2.query<{
        member_clerk_id: string;
        chip: string | null;
        chip_other: string | null;
      }>(
        `SELECT member_clerk_id, chip, chip_other
           FROM user_team_members
          WHERE lead_clerk_id = $1
          ORDER BY member_clerk_id`,
        [clerkId],
      );
      const byId = new Map(rows.rows.map((r) => [r.member_clerk_id, r]));
      expect(byId.get(mateA.clerkId)).toMatchObject({ chip: "housekeeping", chip_other: null });
      expect(byId.get(mateB.clerkId)).toMatchObject({ chip: "gardener", chip_other: null });
      expect(byId.get(mateC.clerkId)).toMatchObject({ chip: "other", chip_other: "Night Watch" });
    } finally {
      await pg2.end();
    }
  });
});

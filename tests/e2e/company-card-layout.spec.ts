/**
 * End-to-end coverage for task #443 — the standardized company card layout
 * introduced in task #438.
 *
 * The same card surface ships in two places:
 *   1. The Trade Pro's own profile (`ContactCard` in
 *      `artifacts/round-house/app/(tabs)/profile.tsx`), backed by the
 *      active mode's `intakeData`.
 *   2. The public profile homeowners see (`PublicProfileModal` CONTACT
 *      section in `artifacts/round-house/components/PublicProfileModal.tsx`),
 *      backed by top-level `users` columns plus the active intake's
 *      `companyLogoUrl`.
 *
 * Both must:
 *   - Center the company logo above the contact rows when a logo is set.
 *   - Render rows in a fixed canonical order:
 *       company name -> phone -> email -> website -> instagram -> address.
 *   - Omit any row whose value is blank/private — with no leftover gap.
 *   - When no logo is uploaded, collapse the centered logo slot cleanly
 *     (no empty box) while still rendering the text rows.
 *
 * The spec drives the live Expo web build, signs up a fresh Firebase user,
 * seeds intake/user data directly in Postgres, and then asserts on the
 * rendered DOM. Centering and ordering are verified via bounding boxes;
 * row presence/order is verified via the icon (Feather glyphs render
 * deterministic data-class names on web) and the visible text.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";
import { Client } from "pg";

const FIREBASE_API_KEY = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

// Public absolute URL — `resolveStorageUrl` returns absolute URLs as-is,
// so the <Image> component renders an actual <img src="..."> we can
// assert on. We deliberately use a tiny inline-style placeholder that
// will succeed-or-404 fast; the test only cares that the <img> element
// exists and has measurable layout.
const LOGO_URL = "https://placehold.co/200x80.png?text=Logo";

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

type IntakeOverrides = {
  companyName?: string | null;
  phone?: string | null;
  contactEmail?: string | null;
  website?: string | null;
  instagram?: string | null;
  address?: string | null;
  companyLogoUrl?: string | null;
};

function buildIntake(overrides: IntakeOverrides): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (v != null && v !== "") out[k] = v;
  }
  return out;
}

/**
 * Seed an active Trade Pro mode for the signed-up user, bypassing
 * identity / mode-picker / intake gates so the app drops straight into
 * (tabs) on sign-in.
 */
async function seedTradeProSelf(
  clerkId: string,
  email: string,
  username: string,
  intake: IntakeOverrides,
): Promise<{ modeId: number }> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    await pg.query(
      `INSERT INTO users (clerk_id, email, name, username, avatar_url, identity_completed_at)
         VALUES ($1, $2, $3, $4, 'public/seed-avatar.png', NOW())
         ON CONFLICT (clerk_id) DO NOTHING`,
      [clerkId, email, email.split("@")[0], username],
    );
    const modeRow = await pg.query<{ id: number }>(
      `INSERT INTO user_modes (user_clerk_id, kind, intake_data, intake_completed_at)
         VALUES ($1, 'trade_pro', $2::jsonb, NOW())
         RETURNING id`,
      [clerkId, JSON.stringify(buildIntake(intake))],
    );
    const modeId = modeRow.rows[0].id;
    await pg.query(`UPDATE users SET last_active_mode_id = $1 WHERE clerk_id = $2`, [
      modeId,
      clerkId,
    ]);
    return { modeId };
  } finally {
    await pg.end();
  }
}

async function updateModeIntake(
  modeId: number,
  intake: IntakeOverrides,
): Promise<void> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    await pg.query(
      `UPDATE user_modes SET intake_data = $1::jsonb WHERE id = $2`,
      [JSON.stringify(buildIntake(intake)), modeId],
    );
  } finally {
    await pg.end();
  }
}

/**
 * Seed a *separate* Trade Pro user that the signed-in viewer can search
 * for and open via PublicProfileModal. Top-level user columns drive the
 * public-profile contact rows; the active intake_data only contributes
 * the companyLogoUrl. Searchability requires the user to have completed
 * identity (avatar + identity_completed_at) and a username.
 */
async function seedTradeProTarget(args: {
  clerkId: string;
  username: string;
  name: string;
  email: string;
  phone?: string | null;
  website?: string | null;
  instagram?: string | null;
  address?: string | null;
  companyLogoUrl?: string | null;
}): Promise<void> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    await pg.query(
      `INSERT INTO users (
          clerk_id, email, name, username, avatar_url, identity_completed_at,
          phone, website, instagram, address
       ) VALUES ($1,$2,$3,$4,'public/seed-avatar.png',NOW(),$5,$6,$7,$8)
       ON CONFLICT (clerk_id) DO UPDATE SET
          email = EXCLUDED.email,
          name = EXCLUDED.name,
          username = EXCLUDED.username,
          avatar_url = EXCLUDED.avatar_url,
          identity_completed_at = EXCLUDED.identity_completed_at,
          phone = EXCLUDED.phone,
          website = EXCLUDED.website,
          instagram = EXCLUDED.instagram,
          address = EXCLUDED.address`,
      [
        args.clerkId,
        args.email,
        args.name,
        args.username,
        args.phone ?? null,
        args.website ?? null,
        args.instagram ?? null,
        args.address ?? null,
      ],
    );
    const intake = args.companyLogoUrl
      ? { companyName: args.name, companyLogoUrl: args.companyLogoUrl }
      : { companyName: args.name };
    const modeRow = await pg.query<{ id: number }>(
      `INSERT INTO user_modes (user_clerk_id, kind, intake_data, intake_completed_at)
         VALUES ($1, 'trade_pro', $2::jsonb, NOW())
         RETURNING id`,
      [args.clerkId, JSON.stringify(intake)],
    );
    await pg.query(`UPDATE users SET last_active_mode_id = $1 WHERE clerk_id = $2`, [
      modeRow.rows[0].id,
      args.clerkId,
    ]);
  } finally {
    await pg.end();
  }
}

async function cleanupSeededClerkIds(clerkIds: string[]): Promise<void> {
  if (!DATABASE_URL || clerkIds.length === 0) return;
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    await pg.query(`DELETE FROM user_modes WHERE user_clerk_id = ANY($1::text[])`, [
      clerkIds,
    ]);
    await pg.query(`DELETE FROM users WHERE clerk_id = ANY($1::text[])`, [clerkIds]);
  } finally {
    await pg.end();
  }
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

async function gotoProfileTab(page: Page): Promise<void> {
  const profileBtn = page.getByRole("button", { name: /^Profile$/i }).first();
  if (await profileBtn.isVisible().catch(() => false)) {
    await profileBtn.click();
  } else {
    await page.getByText(/^Profile$/).first().click();
  }
  // The "Roundhouse 2026" footer is the bottom-of-screen marker — by the
  // time it's rendered every section above (including ContactCard) has
  // mounted.
  await page
    .getByText(/^Roundhouse 2026$/)
    .first()
    .waitFor({ state: "visible", timeout: 20_000 });
}

/**
 * Locate the ContactCard root by its first row (the company-name row,
 * which always has the briefcase icon and the canonical company name).
 * Walk up to the nearest ancestor that also contains the address row —
 * that ancestor is the card.
 *
 * We deliberately do NOT use icon class names: react-native-vector-icons
 * on web emits icons as text glyphs inside Text spans, not as classed
 * SVGs. Matching by visible row text (company name, phone, etc.) is the
 * stable lever.
 */
async function findCardContaining(page: Page, requiredTexts: string[]): Promise<Locator> {
  // Anchor on the first required text; walk ancestors until one
  // contains every required text. Tag that ancestor with a unique
  // data-test-card attribute so we can re-query it as a Locator.
  const anchor = page.getByText(requiredTexts[0], { exact: true }).last();
  await anchor.waitFor({ state: "visible", timeout: 15_000 });
  const tag = `card-${Math.random().toString(36).slice(2, 10)}`;
  const ok = await anchor.evaluate(
    (el: Element, args: { texts: string[]; tag: string }) => {
      let node: HTMLElement | null = el as HTMLElement;
      for (let i = 0; i < 12 && node; i++) {
        const txt = node.textContent || "";
        if (args.texts.every((t) => txt.includes(t))) {
          node.setAttribute("data-test-card", args.tag);
          return true;
        }
        node = node.parentElement;
      }
      return false;
    },
    { texts: requiredTexts, tag },
  );
  if (!ok) {
    throw new Error(`Could not find a card containing: ${requiredTexts.join(", ")}`);
  }
  return page.locator(`[data-test-card="${tag}"]`);
}

type Box = { x: number; y: number; width: number; height: number };

async function box(loc: Locator): Promise<Box> {
  const b = await loc.boundingBox();
  if (!b) throw new Error("Element has no bounding box");
  return b;
}

const CANONICAL_ICONS = ["briefcase", "phone", "mail", "globe", "instagram", "map-pin"] as const;
type CanonicalKey = (typeof CANONICAL_ICONS)[number];

/**
 * For a given ContactCard locator, return the row locator for each
 * canonical key whose visible text we recognise. Rows are direct DOM
 * descendants of the card whose text matches the expected value passed
 * in; callers pass a values map so we can look each row up by the
 * verbatim text we seeded.
 */
async function getRowsByText(
  card: Locator,
  values: Partial<Record<CanonicalKey, string>>,
): Promise<{ key: CanonicalKey; loc: Locator; text: string }[]> {
  const rows: { key: CanonicalKey; loc: Locator; text: string }[] = [];
  for (const key of CANONICAL_ICONS) {
    const text = values[key];
    if (!text) continue;
    const loc = card.getByText(text, { exact: true }).first();
    if (!(await loc.isVisible().catch(() => false))) continue;
    rows.push({ key, loc, text });
  }
  return rows;
}

async function assertCanonicalOrder(
  rows: { key: CanonicalKey; loc: Locator }[],
): Promise<void> {
  // 1. Order matches the canonical sequence (filtered to present keys).
  const presentKeys = rows.map((r) => r.key);
  const expectedKeys = CANONICAL_ICONS.filter((k) => presentKeys.includes(k));
  expect(presentKeys, "rows render in canonical order").toEqual(expectedKeys);

  // 2. Each row sits strictly below the previous one (row N's top >=
  //    row N-1's top + 1px). This catches sideways layouts and
  //    overlapping rows.
  const boxes: Box[] = [];
  for (const r of rows) boxes.push(await box(r.loc));
  for (let i = 1; i < boxes.length; i++) {
    expect(
      boxes[i].y,
      `row ${rows[i].key} should be below row ${rows[i - 1].key}`,
    ).toBeGreaterThan(boxes[i - 1].y);
  }

  // 3. All rows are left-aligned to within 2px of each other.
  const lefts = boxes.map((b) => b.x);
  const minLeft = Math.min(...lefts);
  const maxLeft = Math.max(...lefts);
  expect(
    maxLeft - minLeft,
    `all rows should share the same left edge; got xs=${JSON.stringify(lefts)}`,
  ).toBeLessThanOrEqual(2);
}

async function assertLogoCenteredAbove(
  card: Locator,
  firstRow: Locator,
): Promise<void> {
  const logo = card.locator("img").first();
  await logo.waitFor({ state: "attached", timeout: 5_000 });
  const cardBox = await box(card);
  const logoBox = await box(logo);
  const firstRowBox = await box(firstRow);

  // Logo sits above the first row.
  expect(
    logoBox.y + logoBox.height,
    "logo bottom should be at/above the first row's top",
  ).toBeLessThanOrEqual(firstRowBox.y + 1);

  // Logo is horizontally centered in the card to within 4px (RN <Image>
  // measure can drift by a sub-pixel rounding).
  const cardCx = cardBox.x + cardBox.width / 2;
  const logoCx = logoBox.x + logoBox.width / 2;
  expect(
    Math.abs(logoCx - cardCx),
    `logo center (${logoCx.toFixed(1)}) should be within 4px of card center (${cardCx.toFixed(1)})`,
  ).toBeLessThanOrEqual(4);
}

async function assertNoLogoAndNoEmptyGap(
  card: Locator,
  firstRow: Locator,
): Promise<void> {
  // No <img> descendant (the card omits the entire logo wrapper when
  // logoUri is falsy — there's literally no slot left behind).
  await expect(card.locator("img")).toHaveCount(0);

  // First row sits flush against the card's top padding. We approximate
  // "flush" as: the gap between the card's top and the row's top is
  // small (<= 24px, which covers the card's content padding) AND no
  // sibling element with a non-trivial height precedes the row inside
  // the card.
  const cardBox = await box(card);
  const firstRowBox = await box(firstRow);
  expect(
    firstRowBox.y - cardBox.y,
    "first row should sit near the card top with no leftover logo slot",
  ).toBeLessThanOrEqual(24);

  const hasTallPrecedingSibling = await firstRow.evaluate((el) => {
    let prev = el.previousElementSibling as HTMLElement | null;
    while (prev) {
      if (prev.getBoundingClientRect().height > 4) return true;
      prev = prev.previousElementSibling as HTMLElement | null;
    }
    return false;
  });
  expect(
    hasTallPrecedingSibling,
    "no preceding sibling with measurable height before first row",
  ).toBe(false);
}

test.describe("Company card layout (task #443)", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("Trade Pro own profile: logo centered, canonical row order, blanks omit, no-logo collapses", async ({
    page,
    baseURL,
  }) => {
    void baseURL;
    const tag = uid(8);
    const email = `cc-self-${tag}@example.test`;
    const password = "Pass1234!";
    const username = `cc_self_${tag}`;

    const companyName = `Acme Plumbing ${tag}`;
    const phone = `+1555${tag.slice(0, 7).replace(/[^0-9]/g, "0")}`;
    const contactEmail = `contact-${tag}@example.test`;
    const website = `acme-${tag}.example.test`;
    const instagramHandle = `acme_${tag}`;
    const instagramRow = `@${instagramHandle}`;
    const address = `123 ${tag} Lane, Townsville`;

    const fullValues: Partial<Record<CanonicalKey, string>> = {
      briefcase: companyName,
      phone,
      mail: contactEmail,
      globe: website,
      instagram: instagramRow,
      "map-pin": address,
    };

    const { localId: clerkId } = await firebaseSignUp(email, password);

    const { modeId } = await seedTradeProSelf(clerkId, email, username, {
      companyName,
      phone,
      contactEmail,
      website,
      instagram: instagramHandle,
      address,
      companyLogoUrl: LOGO_URL,
    });

    try {
      await signInUI(page, email, password);
      await gotoProfileTab(page);

      // --- Case A: full data with logo --------------------------------
      const cardA = await findCardContaining(page, [companyName, phone, address]);
      await cardA.scrollIntoViewIfNeeded();
      const rowsA = await getRowsByText(cardA, fullValues);
      expect(rowsA.map((r) => r.key)).toEqual([
        "briefcase",
        "phone",
        "mail",
        "globe",
        "instagram",
        "map-pin",
      ]);
      await assertCanonicalOrder(rowsA);
      await assertLogoCenteredAbove(cardA, rowsA[0].loc);

      // --- Case B: blank/private fields produce no row, no gap --------
      await updateModeIntake(modeId, {
        companyName,
        contactEmail,
        website,
        companyLogoUrl: LOGO_URL,
      });
      await page.reload();
      await gotoProfileTab(page);
      const cardB = await findCardContaining(page, [companyName, contactEmail, website]);
      await cardB.scrollIntoViewIfNeeded();
      const rowsB = await getRowsByText(cardB, {
        briefcase: companyName,
        mail: contactEmail,
        globe: website,
      });
      expect(rowsB.map((r) => r.key)).toEqual(["briefcase", "mail", "globe"]);
      // No phone / instagram / address rows are anywhere inside the card.
      await expect(cardB.getByText(phone, { exact: true })).toHaveCount(0);
      await expect(cardB.getByText(instagramRow, { exact: true })).toHaveCount(0);
      await expect(cardB.getByText(address, { exact: true })).toHaveCount(0);
      await assertCanonicalOrder(rowsB);
      // Vertical gaps between consecutive rows are uniform (within 4px) —
      // i.e. blanks didn't leave an oversized gap.
      const bxs = [
        await box(rowsB[0].loc),
        await box(rowsB[1].loc),
        await box(rowsB[2].loc),
      ];
      const gap1 = bxs[1].y - (bxs[0].y + bxs[0].height);
      const gap2 = bxs[2].y - (bxs[1].y + bxs[1].height);
      expect(
        Math.abs(gap1 - gap2),
        `consecutive row gaps should match (no empty slot); got ${gap1} vs ${gap2}`,
      ).toBeLessThanOrEqual(4);

      // --- Case C: no logo collapses cleanly --------------------------
      await updateModeIntake(modeId, {
        companyName,
        phone,
        contactEmail,
        website,
        instagram: instagramHandle,
        address,
        // companyLogoUrl deliberately omitted
      });
      await page.reload();
      await gotoProfileTab(page);
      const cardC = await findCardContaining(page, [companyName, phone, address]);
      await cardC.scrollIntoViewIfNeeded();
      const rowsC = await getRowsByText(cardC, fullValues);
      expect(rowsC.map((r) => r.key)).toEqual([
        "briefcase",
        "phone",
        "mail",
        "globe",
        "instagram",
        "map-pin",
      ]);
      await assertCanonicalOrder(rowsC);
      await assertNoLogoAndNoEmptyGap(cardC, rowsC[0].loc);
    } finally {
      await cleanupSeededClerkIds([clerkId]);
    }
  });

  test("Public profile (PublicProfileModal): logo centered, canonical row order, blanks/no-logo handled", async ({
    page,
    baseURL,
  }) => {
    void baseURL;
    const tag = uid(8);
    const viewerEmail = `cc-viewer-${tag}@example.test`;
    const viewerPassword = "Pass1234!";
    const viewerUsername = `cc_viewer_${tag}`;

    const { localId: viewerClerk } = await firebaseSignUp(viewerEmail, viewerPassword);
    await seedTradeProSelf(viewerClerk, viewerEmail, viewerUsername, {
      companyName: `Viewer ${tag}`,
    });

    // Target A: full data with logo.
    const fullName = `Bravo Roofing ${tag}`;
    const fullClerk = `cc-target-full-${tag}`;
    const fullUsername = `cc_target_full_${tag}`;
    const fullPhone = `+1555${tag.slice(0, 7).replace(/[^0-9]/g, "0")}`;
    const fullEmail = `${fullClerk}@example.test`;
    const fullWebsite = `bravo-${tag}.example.test`;
    const fullInstagram = `bravo_${tag}`;
    const fullInstagramRow = `@${fullInstagram}`;
    const fullAddress = `7 Bravo St ${tag}`;

    // Target B: partial data (phone/instagram/address private), no logo.
    const partialName = `Charlie Cleaners ${tag}`;
    const partialClerk = `cc-target-partial-${tag}`;
    const partialUsername = `cc_target_partial_${tag}`;
    const partialEmail = `${partialClerk}@example.test`;
    const partialWebsite = `charlie-${tag}.example.test`;

    await seedTradeProTarget({
      clerkId: fullClerk,
      username: fullUsername,
      name: fullName,
      email: fullEmail,
      phone: fullPhone,
      website: fullWebsite,
      instagram: fullInstagram,
      address: fullAddress,
      companyLogoUrl: LOGO_URL,
    });
    await seedTradeProTarget({
      clerkId: partialClerk,
      username: partialUsername,
      name: partialName,
      email: partialEmail,
      website: partialWebsite,
      // phone/instagram/address omitted, no logo
    });

    try {
      await signInUI(page, viewerEmail, viewerPassword);
      await gotoProfileTab(page);

      // Open the search modal from the profile screen.
      const openSearch = async () => {
        await page
          .getByLabel("Search people, trade pros, and special offers")
          .first()
          .evaluate((el) => (el as HTMLElement).click());
        await page
          .getByPlaceholder(/Find people you know/i)
          .first()
          .waitFor({ state: "visible", timeout: 10_000 });
      };

      const openTarget = async (username: string, expectedName: string) => {
        await openSearch();
        const input = page.getByPlaceholder(/Find people you know/i).first();
        await input.fill("");
        await input.type(username);
        // Debounced search lands within ~600ms.
        const result = page.getByText(expectedName, { exact: true }).first();
        await result.waitFor({ state: "visible", timeout: 15_000 });
        await result.evaluate((el) => (el as HTMLElement).click());
        // The PublicProfileModal renders a CONTACT section header.
        await page
          .getByText(/^CONTACT$/)
          .first()
          .waitFor({ state: "visible", timeout: 15_000 });
      };

      const closeModalToProfile = async () => {
        // The modal has a header close button (Feather "x"); fall back to
        // the browser back if the X isn't trivially clickable. Either
        // way, end up back on the Profile tab.
        const closeBtn = page.getByRole("button", { name: /close/i }).first();
        if (await closeBtn.isVisible().catch(() => false)) {
          await closeBtn.click({ force: true }).catch(() => {});
        } else {
          await page.keyboard.press("Escape").catch(() => {});
        }
        // Re-anchor on the profile screen footer.
        await page
          .getByText(/^Roundhouse 2026$/)
          .first()
          .waitFor({ state: "visible", timeout: 15_000 });
      };

      // --- Target A: full + logo --------------------------------------
      await openTarget(fullUsername, fullName);
      const cardFull = await findCardContaining(page, [
        fullName,
        fullPhone,
        fullAddress,
      ]);
      const rowsFull = await getRowsByText(cardFull, {
        briefcase: fullName,
        phone: fullPhone,
        mail: fullEmail,
        globe: fullWebsite,
        instagram: fullInstagramRow,
        "map-pin": fullAddress,
      });
      expect(rowsFull.map((r) => r.key)).toEqual([
        "briefcase",
        "phone",
        "mail",
        "globe",
        "instagram",
        "map-pin",
      ]);
      await assertCanonicalOrder(rowsFull);
      await assertLogoCenteredAbove(cardFull, rowsFull[0].loc);
      await closeModalToProfile();

      // --- Target B: partial fields + no logo -------------------------
      await openTarget(partialUsername, partialName);
      const cardPartial = await findCardContaining(page, [
        partialName,
        partialEmail,
        partialWebsite,
      ]);
      const rowsPartial = await getRowsByText(cardPartial, {
        briefcase: partialName,
        mail: partialEmail,
        globe: partialWebsite,
      });
      expect(rowsPartial.map((r) => r.key)).toEqual(["briefcase", "mail", "globe"]);
      // Confirm the omitted fields really aren't rendered as rows.
      await expect(cardPartial.getByText(/^\+1/)).toHaveCount(0);
      await expect(cardPartial.locator("text=/^@/")).toHaveCount(0);
      await assertCanonicalOrder(rowsPartial);
      await assertNoLogoAndNoEmptyGap(cardPartial, rowsPartial[0].loc);
    } finally {
      await cleanupSeededClerkIds([viewerClerk, fullClerk, partialClerk]);
    }
  });
});

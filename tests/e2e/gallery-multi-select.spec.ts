import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { insertPropertyMember } from "./_helpers/propertyMembers";

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

/** Same bypass-onboarding helper used by multi-select-photo-share.spec.ts:
 *  ensure the user row exists (via /api/users/me) then mark identity +
 *  intake completed and pin a default mode so app/index.tsx drops us
 *  straight into (tabs) after sign-in (the original "Enter your space"
 *  intake button blocked automated runs). */
async function bypassOnboarding(idToken: string, clerkId: string, baseURL: string): Promise<void> {
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

type Seeded = {
  propertyId: number;
  workOrderId: number;
  paths: [string, string, string];
};

async function seedWorkOrderWithThreePhotos(args: {
  ownerClerkId: string;
  tag: string;
}): Promise<Seeded> {
  const pg = new Client({ connectionString: DATABASE_URL! });
  await pg.connect();
  try {
    const propRow = await pg.query<{ id: number }>(
      `INSERT INTO properties (name, address, type, owner_clerk_id)
         VALUES ($1, '12 Gallery Select Lane', 'home', $2) RETURNING id`,
      [`GallerySelect ${args.tag}`, args.ownerClerkId],
    );
    const propertyId = propRow.rows[0].id;
    await insertPropertyMember(pg, {
      propertyId,
      userClerkId: args.ownerClerkId,
      role: "owner",
    });
    const paths: [string, string, string] = [
      `/test-photos/${args.tag}-a.png`,
      `/test-photos/${args.tag}-b.png`,
      `/test-photos/${args.tag}-c.png`,
    ];
    const now = new Date().toISOString();
    const attachments = paths.map((path) => ({
      path,
      kind: "image" as const,
      addedAt: now,
      addedByClerkId: args.ownerClerkId,
    }));
    const woRow = await pg.query<{ id: number }>(
      `INSERT INTO work_orders (
         property_id, title, description, priority, status,
         attachments, created_by_clerk_id, assignee_clerk_id
       ) VALUES ($1, $2, '', 'normal', 'open', $3::jsonb, $4, $4) RETURNING id`,
      [
        propertyId,
        `GallerySelect WO ${args.tag}`,
        JSON.stringify(attachments),
        args.ownerClerkId,
      ],
    );
    return { propertyId, workOrderId: woRow.rows[0].id, paths };
  } finally {
    await pg.end();
  }
}

async function signInViaUI(page: Page, email: string, password: string): Promise<void> {
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`[browser:err] ${m.text()}`);
  });
  page.on("pageerror", (e) => console.log(`[browser:throw] ${e.message}`));
  await page.goto("/");
  const emailInput = page.getByPlaceholder(/you@example\.com/i);
  await emailInput.waitFor({ state: "visible", timeout: 45_000 });
  await emailInput.fill(email);
  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.fill(password);
  await passwordInput.press("Enter");
  await expect(page.getByText("Properties").first()).toBeVisible({ timeout: 45_000 });
}

const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/** Walks up to the cursor:pointer ancestor (the RN-web Pressable wrapper)
 *  and dispatches a synthetic click. Mirrors the helper used by the
 *  PhotoViewer multi-select spec — RN-web Pressables don't expose
 *  role="button" so locator.click() can't reach them reliably. */
async function clickPressableAncestor(page: Page, selector: string, nth = 0): Promise<void> {
  const el = page.locator(selector).nth(nth);
  await el.waitFor({ state: "attached", timeout: 15_000 });
  await el.evaluate((node) => {
    let cur: HTMLElement | null = node as HTMLElement;
    while (cur && cur.parentElement) {
      const cursor = window.getComputedStyle(cur).cursor;
      if (cursor === "pointer") break;
      cur = cur.parentElement;
    }
    (cur ?? (node as HTMLElement)).dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

async function clickByAriaLabel(page: Page, label: string, nth = 0): Promise<void> {
  const el = page.locator(`[aria-label="${label}"]`).nth(nth);
  await el.waitFor({ state: "attached", timeout: 10_000 });
  await el.evaluate((node) => {
    (node as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

type SetupResult = {
  tag: string;
  seeded: Seeded;
  fetchedTestPhotoUrls: string[];
};

/** Shared setup: sign up a fresh Firebase user, bypass onboarding,
 *  seed a work order with three image attachments, install the
 *  navigator.share stub, and route /test-photos/** to a 1×1 PNG so
 *  share/download paths exercise real Blob/File creation. Returns the
 *  tag (used for path matchers) and the route-handler fetch log. */
async function setupGalleryScreen(
  page: Page,
  baseURL: string,
): Promise<SetupResult> {
  const tag = uid(5);
  const email = `gallery-multiselect-${tag}@example.test`;
  const password = "Pass1234!";

  const { idToken, localId: clerkId } = await firebaseSignUp(email, password);
  await bypassOnboarding(idToken, clerkId, baseURL);
  const seeded = await seedWorkOrderWithThreePhotos({ ownerClerkId: clerkId, tag });

  await page.addInitScript(() => {
    type CapturedShare = { count: number; text?: string; names: string[] };
    const win = window as unknown as { __capturedShares: CapturedShare[] };
    win.__capturedShares = [];
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: { files?: File[]; text?: string }) => {
        win.__capturedShares.push({
          count: data.files?.length ?? 0,
          text: data.text,
          names: (data.files ?? []).map((f) => f.name),
        });
      },
    });
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
  });

  const fetchedTestPhotoUrls: string[] = [];
  await page.route("**/test-photos/**", (route) => {
    fetchedTestPhotoUrls.push(route.request().url());
    return route.fulfill({
      status: 200,
      headers: { "content-type": "image/png" },
      body: ONE_PX_PNG,
    });
  });

  await signInViaUI(page, email, password);
  await page.goto(`/work-order/${seeded.workOrderId}`);
  await expect(page.getByText(`GallerySelect WO ${tag}`).first()).toBeVisible({
    timeout: 30_000,
  });
  await page
    .locator(`img[src*="${tag}-a"]`)
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });

  return { tag, seeded, fetchedTestPhotoUrls };
}

test.describe("Work-order gallery multi-select", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("Select mode toggles thumbnails without opening viewer, updates Share/Save counts, disables actions at zero, and shares only selected photos", async ({
    page,
    baseURL,
  }) => {
    const { tag, seeded, fetchedTestPhotoUrls } = await setupGalleryScreen(page, baseURL!);
    const galleryImg = (suffix: string) => `img[src*="${tag}-${suffix}"]`;

    // The Select toggle in the gallery header.
    await expect(page.locator('[aria-label="Pick photos to share or save"]')).toHaveCount(1);
    // Action bar is hidden before entering select mode.
    await expect(page.getByText("Tap photos to select")).toHaveCount(0);

    // Tap a thumbnail BEFORE entering select mode — this should open the
    // full-screen PhotoViewer (the existing onImagePress path). We assert
    // the "1 / 3" counter to confirm the viewer mounted, then close it
    // by reloading the screen so the Modal unmounts.
    await clickPressableAncestor(page, galleryImg("a"));
    await expect(page.getByText("1 / 3").first()).toBeVisible({ timeout: 10_000 });
    await page.goto(`/work-order/${seeded.workOrderId}`);
    await expect(page.getByText(`GallerySelect WO ${tag}`).first()).toBeVisible({
      timeout: 15_000,
    });
    await page.locator(galleryImg("a")).first().waitFor({ state: "visible", timeout: 15_000 });

    // Enter Select mode via the gallery header toggle.
    await clickByAriaLabel(page, "Pick photos to share or save");

    // Action bar appears with "Tap photos to select" and disabled
    // Share(0) / Download(0) buttons.
    await expect(page.getByText("Tap photos to select")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Share (0)").first()).toBeVisible();
    await expect(page.getByText("Download (0)").first()).toBeVisible();
    // The header toggle now reads "Done" and exposes the Exit a11y label.
    await expect(page.locator('[aria-label="Exit photo selection"]')).toHaveCount(1);
    await expect(page.locator('[aria-label="Pick photos to share or save"]')).toHaveCount(0);

    // Disabled-state semantics: the gallery's TouchableOpacity onPress
    // handlers early-return when no photos are selected (and the parent
    // also passes disabled={selectedCount===0}). Dispatching a click on
    // either action button must NOT trigger a fetch to /test-photos/**
    // and must NOT push anything onto the navigator.share stub.
    fetchedTestPhotoUrls.length = 0;
    await clickByAriaLabel(page, "Share selected photos");
    await clickByAriaLabel(page, "Download 0 photos");
    await page.waitForTimeout(400);
    expect(fetchedTestPhotoUrls).toHaveLength(0);
    const sharesAfterEmpty = await page.evaluate(
      () =>
        (window as unknown as { __capturedShares: { count: number }[] })
          .__capturedShares.length,
    );
    expect(sharesAfterEmpty).toBe(0);
    // The share-prompt modal must NOT have opened either.
    await expect(page.getByText("Add a note")).toHaveCount(0);

    // Tapping a thumbnail in select mode must NOT open the viewer.
    // Selectable thumbs expose the "Select this photo" a11y label.
    await page.locator('[aria-label="Select this photo"]').first().waitFor({
      state: "attached",
      timeout: 10_000,
    });
    await expect(page.locator('[aria-label="Select this photo"]')).toHaveCount(3);

    // Select photo A.
    await clickPressableAncestor(page, '[aria-label="Select this photo"]', 0);
    await expect(page.getByText("1 selected")).toBeVisible();
    await expect(page.getByText("Share (1)").first()).toBeVisible();
    await expect(page.getByText("Download (1)").first()).toBeVisible();
    // The viewer's "1 / 3" counter must NOT appear — selecting a thumb
    // toggles its check overlay instead of opening the full-screen modal.
    await expect(page.getByText("1 / 3")).toHaveCount(0);
    // The selected thumb flips its a11y label to "Deselect this photo".
    await expect(page.locator('[aria-label="Deselect this photo"]')).toHaveCount(1);
    await expect(page.locator('[aria-label="Select this photo"]')).toHaveCount(2);

    // Select photo C as well (now nth=1 of remaining "Select this photo"
    // chips because A is now "Deselect"). After two selections, both
    // count and button labels reflect "2".
    await clickPressableAncestor(page, '[aria-label="Select this photo"]', 1);
    await expect(page.getByText("2 selected")).toBeVisible();
    await expect(page.getByText("Share (2)").first()).toBeVisible();
    await expect(page.getByText("Download (2)").first()).toBeVisible();

    // Toggle photo A back OFF and the count must drop to "1 selected".
    await clickPressableAncestor(page, '[aria-label="Deselect this photo"]', 0);
    await expect(page.getByText("1 selected")).toBeVisible();
    await expect(page.getByText("Share (1)").first()).toBeVisible();

    // Re-select photo A so we have two selected.
    await clickPressableAncestor(page, '[aria-label="Select this photo"]', 0);
    await expect(page.getByText("2 selected")).toBeVisible();

    // Positive Share assertion: trigger Share from the gallery action
    // bar (NOT the full-screen viewer) and verify the share payload
    // contains exactly the two selected photos. This proves Select →
    // Share parity with the viewer's batch flow. The first share opens
    // the SharePromptModal; confirm via "Continue to share sheet".
    fetchedTestPhotoUrls.length = 0;
    await clickByAriaLabel(page, "Share 2 photos");
    await expect(page.getByText("Add a note")).toBeVisible({ timeout: 5_000 });
    await clickByAriaLabel(page, "Continue to share sheet");
    await page.waitForFunction(
      () =>
        (window as unknown as { __capturedShares: { count: number }[] })
          .__capturedShares.length > 0,
      undefined,
      { timeout: 15_000 },
    );
    const shares = await page.evaluate(
      () =>
        (window as unknown as { __capturedShares: { count: number; names: string[] }[] })
          .__capturedShares,
    );
    expect(shares).toHaveLength(1);
    expect(shares[0].count).toBe(2);
    // Identity assertion via route fetch log: only A + C, never B.
    const sharedJoined = fetchedTestPhotoUrls.join("|");
    expect(sharedJoined).toMatch(new RegExp(`${tag}-a`));
    expect(sharedJoined).toMatch(new RegExp(`${tag}-c`));
    expect(sharedJoined).not.toMatch(new RegExp(`${tag}-b`));

    // Tap Done — header toggle's a11y label flipped to "Exit photo selection".
    await clickByAriaLabel(page, "Exit photo selection");
    // Select mode exits: the action bar disappears and the toggle goes
    // back to "Pick photos to share or save".
    await expect(page.getByText(/^\d+ selected$/)).toHaveCount(0);
    await expect(page.getByText("Tap photos to select")).toHaveCount(0);
    await expect(page.getByText("Share (2)")).toHaveCount(0);
    await expect(page.locator('[aria-label="Pick photos to share or save"]')).toHaveCount(1);

    // Re-enter select mode and verify selection state is fresh: zero
    // selected, no "Deselect" chips visible. (gallerySelected was
    // cleared on the previous exit.)
    await clickByAriaLabel(page, "Pick photos to share or save");
    await expect(page.getByText("Tap photos to select")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Share (0)").first()).toBeVisible();
    await expect(page.locator('[aria-label="Deselect this photo"]')).toHaveCount(0);
    await expect(page.locator('[aria-label="Select this photo"]')).toHaveCount(3);
  });

  test("Save action triggers a download for each selected photo on web without crashing", async ({
    page,
    baseURL,
  }) => {
    const { tag, fetchedTestPhotoUrls } = await setupGalleryScreen(page, baseURL!);

    // Enter select mode and pick photos A and C (skip B).
    await clickByAriaLabel(page, "Pick photos to share or save");
    await page.locator('[aria-label="Select this photo"]').first().waitFor({
      state: "attached",
      timeout: 10_000,
    });
    await clickPressableAncestor(page, '[aria-label="Select this photo"]', 0); // A
    await clickPressableAncestor(page, '[aria-label="Select this photo"]', 1); // C
    await expect(page.getByText("2 selected")).toBeVisible();

    // Trigger Save (web: "Download N photos"). The web path inside
    // usePhotoBatchActions calls downloadOnWeb once per URL, spaced by
    // 250ms, then surfaces a toast. We assert the route handler saw
    // exactly the two selected photos and the toast appeared, which
    // together prove the action ran end-to-end without crashing.
    fetchedTestPhotoUrls.length = 0;
    await clickByAriaLabel(page, "Download 2 photos");
    await expect
      .poll(() => fetchedTestPhotoUrls.filter((u) => u.includes(`${tag}-`)).length, {
        timeout: 15_000,
      })
      .toBeGreaterThanOrEqual(2);
    const savedJoined = fetchedTestPhotoUrls.join("|");
    expect(savedJoined).toMatch(new RegExp(`${tag}-a`));
    expect(savedJoined).toMatch(new RegExp(`${tag}-c`));
    expect(savedJoined).not.toMatch(new RegExp(`${tag}-b`));
    await expect(
      page.getByText(/Started download for all 2 photos\.|Downloaded 2 of 2 photos\./).first(),
    ).toBeVisible({ timeout: 10_000 });

    // The screen must still be alive after the save run — assert the
    // gallery action bar is still present (no crash / unmount).
    await expect(page.getByText("2 selected")).toBeVisible();
    await expect(page.locator('[aria-label="Exit photo selection"]')).toHaveCount(1);
  });
});

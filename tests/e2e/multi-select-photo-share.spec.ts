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

/** Mirrors the bypass-onboarding helper in undo-delete-photo.spec.ts:
 *  ensure the user row exists (via /api/users/me) then mark identity +
 *  intake completed and pin a default mode so app/index.tsx drops us
 *  straight into (tabs) after sign-in. */
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

/** Seed a property + a single work order with three image attachments
 *  authored by the same user. Three so we can assert that an unselected
 *  photo never enters the share payload. */
async function seedWorkOrderWithThreePhotos(args: {
  ownerClerkId: string;
  tag: string;
}): Promise<Seeded> {
  const pg = new Client({ connectionString: DATABASE_URL! });
  await pg.connect();
  try {
    const propRow = await pg.query<{ id: number }>(
      `INSERT INTO properties (name, address, type, owner_clerk_id)
         VALUES ($1, '7 Multi Select Way', 'home', $2) RETURNING id`,
      [`MultiSelect ${args.tag}`, args.ownerClerkId],
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
        `MultiSelect WO ${args.tag}`,
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

/** A 1×1 transparent PNG, base64-decoded once at module load. We serve
 *  this for any /test-photos/<tag>-*.png request so PhotoViewer's web
 *  share path (which fetches each URL into a Blob) succeeds without
 *  needing real binary fixtures on the server. */
const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/** Walks up from the matched element to the nearest cursor:pointer
 *  ancestor (the RN-web Pressable / TouchableOpacity wrapper) and fires
 *  a synthetic click. Mirrors the helper in undo-delete-photo.spec.ts.
 *  Used because RN-web Pressables don't expose role="button" and the
 *  photo viewer's top-bar buttons live outside the mobile viewport, so
 *  Playwright's actionability checks reject locator.click(). */
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

/** Click an element directly by aria-label, dispatching a native click
 *  event so it bypasses Playwright's viewport actionability check. The
 *  PhotoViewer's top-bar action row sits to the right of the mobile
 *  viewport, so locator.click() would refuse with "outside of viewport". */
async function clickByAriaLabel(page: Page, label: string): Promise<void> {
  const el = page.locator(`[aria-label="${label}"]`).first();
  await el.waitFor({ state: "attached", timeout: 10_000 });
  await el.evaluate((node) => {
    (node as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

test.describe("PhotoViewer multi-select share/save", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("Select mode picks a subset, relabels share/save buttons, and only the selected photos enter the share payload", async ({
    page,
    baseURL,
  }) => {
    const tag = uid(5);
    const email = `photo-multiselect-${tag}@example.test`;
    const password = "Pass1234!";

    const { idToken, localId: clerkId } = await firebaseSignUp(email, password);
    await bypassOnboarding(idToken, clerkId, baseURL!);
    const seeded = await seedWorkOrderWithThreePhotos({ ownerClerkId: clerkId, tag });

    // Stub navigator.share BEFORE any page navigation so PhotoViewer's
    // web share path lands here with the exact payload it tried to send.
    // Captured count + text are read back via window evaluation.
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

    // Serve a real PNG body for our seeded paths so shareAllOnWeb's
    // fetch-into-Blob loop populates `files` instead of falling back
    // to the zip-download branch. Also record which URLs were fetched
    // so we can assert the share request fetched ONLY the selected
    // photos (filenameForUrl rewrites filenames to "roundhouse-<ts>"
    // so we can't recover the path identity from File.name alone).
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

    // Navigate straight to the work order detail screen.
    await page.goto(`/work-order/${seeded.workOrderId}`);
    await expect(page.getByText(`MultiSelect WO ${tag}`).first()).toBeVisible({
      timeout: 30_000,
    });

    // Open the photo viewer by clicking the first attachment thumbnail.
    // The TouchableOpacity wrapping the <img> is the cursor:pointer
    // ancestor; firing the click there triggers the parent's onPress.
    const imgSelector = `img[src*="${tag}-a"]`;
    await page.locator(imgSelector).first().waitFor({ state: "visible", timeout: 15_000 });
    await clickPressableAncestor(page, imgSelector);

    // The viewer is up: counter shows "1 / 3" because we opened on photo A.
    await expect(page.getByText("1 / 3").first()).toBeVisible({ timeout: 10_000 });
    // In non-select mode the share/save labels include the FULL count.
    await expect(page.getByText("Share all (3)").first()).toBeVisible();
    // Web build labels the bulk-save action "Save all (N)" (the per-photo
    // toolbar button is the one that switches to "Download…").
    await expect(page.getByText("Save all (3)").first()).toBeVisible();

    // Enter Select mode via its accessibility label.
    await clickByAriaLabel(page, "Pick photos to share or save");

    // Counter swaps to "0 selected" and the bulk buttons relabel + disable.
    await expect(page.getByText("0 selected").first()).toBeVisible();
    await expect(page.getByText("Share (0)").first()).toBeVisible();
    // Web build labels the bulk save action "Download (N)" when in
    // Select mode (the platform-conditional in PhotoViewer's button
    // uses Download/Save based on Platform.OS).
    await expect(page.getByText("Download (0)").first()).toBeVisible();
    // Disabled-state assertion: shareAllOnWeb / onSaveAll early-return when
    // selectMode && selectedUrls.length === 0, so dispatching the click
    // must NOT enqueue a navigator.share call.
    await clickByAriaLabel(page, "Share selected photos");
    await page.waitForTimeout(250);
    const sharesAfterEmptyClick = await page.evaluate(
      () =>
        (window as unknown as { __capturedShares: { count: number }[] }).__capturedShares.length,
    );
    expect(sharesAfterEmptyClick).toBe(0);
    // No share-prompt modal should have opened either.
    await expect(page.getByText("Add a note")).toHaveCount(0);

    // Select photos A and C (skip B) so we can verify the share payload
    // contains exactly two files corresponding to those two paths.
    // The select chip renders one Pressable per photo with a stable label;
    // chips are ordered A, B, C in DOM order regardless of FlatList scroll.
    const chipSelector = '[aria-label="Select this photo"]';
    await page.locator(chipSelector).first().waitFor({ state: "attached", timeout: 10_000 });
    await expect(page.locator(chipSelector)).toHaveCount(3);
    await clickPressableAncestor(page, chipSelector, 0); // photo A
    await clickPressableAncestor(page, chipSelector, 1); // photo C (B is now nth=1 of remaining)
    // After two selections, counter + button labels reflect "2".
    await expect(page.getByText("2 selected").first()).toBeVisible();
    await expect(page.getByText("Share (2)").first()).toBeVisible();
    await expect(page.getByText("Download (2)").first()).toBeVisible();

    // Trigger the share. The first share opens the SharePromptModal
    // (no "Don't ask again" yet); confirm via the "Continue to share
    // sheet" button to call runShare → shareAllOnWeb → navigator.share.
    await clickByAriaLabel(page, "Share selected photos");
    await expect(page.getByText("Add a note")).toBeVisible({ timeout: 5_000 });
    // Reset the fetch log so we measure only the share-time fetches,
    // not any earlier <Image src=...> preloads from rendering the viewer.
    fetchedTestPhotoUrls.length = 0;
    await clickByAriaLabel(page, "Continue to share sheet");

    // shareAllOnWeb fetches each URL into a File before invoking
    // navigator.share; wait for our stub to receive the call.
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
    expect(shares[0].names).toHaveLength(2);
    // Assert subset by IDENTITY, not just count: shareAllOnWeb fetched
    // each selected URL into a Blob, so the recorded request URLs are
    // the most reliable proxy for which photos actually entered the
    // share payload (filenameForUrl rewrites File.name to a generic
    // "roundhouse-<ts>.png" and discards the original basename).
    const sharedFetched = fetchedTestPhotoUrls.join("|");
    expect(sharedFetched).toMatch(new RegExp(`${tag}-a`));
    expect(sharedFetched).toMatch(new RegExp(`${tag}-c`));
    expect(sharedFetched).not.toMatch(new RegExp(`${tag}-b`));

    // After share completes, leave Select mode via its toggle button
    // (the toggle's accessibility label flips to "Exit photo selection"
    // while in select mode). The counter should snap back to "1 / 3".
    await clickByAriaLabel(page, "Exit photo selection");
    await expect(page.getByText("1 / 3").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Share all (3)").first()).toBeVisible();

    // Re-enter select mode and pick one photo so we can verify that
    // closing the viewer clears the selection (the useEffect on
    // `visible` resets both selectMode + selectedKeys).
    await clickByAriaLabel(page, "Pick photos to share or save");
    await clickPressableAncestor(page, '[aria-label="Select this photo"]', 0);
    await expect(page.getByText("1 selected").first()).toBeVisible();

    // Close the viewer by navigating away. Re-mounting the screen drops
    // the Modal entirely, which is the closest test-able analogue to
    // tapping the X close button (whose Pressable has no accessibility
    // label and lives outside the mobile viewport for click()).
    await page.goto(`/work-order/${seeded.workOrderId}`);
    await expect(page.getByText(`MultiSelect WO ${tag}`).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("1 selected")).toHaveCount(0);

    // Re-open the viewer and verify selection state is fresh: NOT in
    // select mode, counter reads "1 / 3", no chips visible at all.
    await page.locator(imgSelector).first().waitFor({ state: "visible", timeout: 10_000 });
    await clickPressableAncestor(page, imgSelector);
    await expect(page.getByText("1 / 3").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Share all (3)").first()).toBeVisible();
    await expect(page.locator('[aria-label="Select this photo"]')).toHaveCount(0);
    await expect(page.locator('[aria-label="Deselect this photo"]')).toHaveCount(0);
  });
});

import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { insertPropertyMember, purgeEntityForProperty } from "./_helpers/propertyMembers";

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

/** Create the user row + skip the identity / mode-picker / intake gates so
 *  the app drops the test user straight into (tabs). */
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
  logId: number;
  primaryPath: string;
  siblingPathA: string;
  siblingPathB: string;
};

/** Seed a property owned by `ownerClerkId`, optionally add `extraMember`
 *  with the given role, and create one work log authored by `authorClerkId`
 *  with one primary photo + two attachment photos. */
async function seedPropertyAndLog(args: {
  ownerClerkId: string;
  authorClerkId: string;
  extraMember?: { clerkId: string; role: "admin" | "member" };
  tag: string;
}): Promise<Seeded> {
  const pg = new Client({ connectionString: DATABASE_URL! });
  await pg.connect();
  try {
    const propRow = await pg.query<{ id: number }>(
      `INSERT INTO properties (name, address, type, owner_clerk_id)
         VALUES ($1, '1 Test Way', 'home', $2) RETURNING id`,
      [`PhotoUndo ${args.tag}`, args.ownerClerkId],
    );
    const propertyId = propRow.rows[0].id;
    await insertPropertyMember(pg, {
      propertyId,
      userClerkId: args.ownerClerkId,
      role: "owner",
    });
    if (args.authorClerkId !== args.ownerClerkId) {
      await insertPropertyMember(pg, {
        propertyId,
        userClerkId: args.authorClerkId,
        role: "member",
      });
    }
    if (args.extraMember) {
      await insertPropertyMember(pg, {
        propertyId,
        userClerkId: args.extraMember.clerkId,
        role: args.extraMember.role as "owner" | "admin" | "member",
      });
    }
    const primaryPath = `/test-photos/${args.tag}-primary.png`;
    const siblingPathA = `/test-photos/${args.tag}-sibling-a.png`;
    const siblingPathB = `/test-photos/${args.tag}-sibling-b.png`;
    const attachments = [
      { path: siblingPathA, kind: "image", addedAt: new Date().toISOString(), addedByClerkId: args.authorClerkId },
      { path: siblingPathB, kind: "image", addedAt: new Date().toISOString(), addedByClerkId: args.authorClerkId },
    ];
    const logRow = await pg.query<{ id: number }>(
      `INSERT INTO work_logs (property_id, author_clerk_id, note, photo_url, attachments, is_real_time)
         VALUES ($1, $2, $3, $4, $5::jsonb, true) RETURNING id`,
      [
        propertyId,
        args.authorClerkId,
        `Photo undo ${args.tag}`,
        primaryPath,
        JSON.stringify(attachments),
      ],
    );
    return {
      propertyId,
      logId: logRow.rows[0].id,
      primaryPath,
      siblingPathA,
      siblingPathB,
    };
  } finally {
    await pg.end();
  }
}

async function fetchLogState(
  baseURL: string,
  idToken: string,
  propertyId: number,
  logId: number,
): Promise<{ exists: boolean; photoUrl: string | null; attachmentPaths: string[] }> {
  const r = await fetch(
    new URL(`/api/properties/${propertyId}/logs?limit=50`, baseURL).toString(),
    { headers: { Authorization: `Bearer ${idToken}` } },
  );
  if (!r.ok) throw new Error(`list logs failed: ${r.status} ${await r.text()}`);
  const j = (await r.json()) as {
    logs: Array<{
      id: number;
      photoUrl: string | null;
      attachments?: Array<{ path: string }> | null;
    }>;
  };
  const log = j.logs.find((l) => l.id === logId);
  if (!log) return { exists: false, photoUrl: null, attachmentPaths: [] };
  return {
    exists: true,
    photoUrl: log.photoUrl ?? null,
    attachmentPaths: (log.attachments ?? []).map((a) => a.path),
  };
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
  // RN web's Pressable does not expose role="button" by default. Submitting
  // via Enter on the password field triggers `onSubmitEditing={handleSubmit}`
  // on the TextInput, which is the most reliable cross-render path.
  await passwordInput.press("Enter");
  // After sign-in + the DB-based onboarding bypass, app/index.tsx redirects
  // straight to (tabs). The Properties tab text is rendered in the tab bar.
  await expect(page.getByText("Properties").first())
    .toBeVisible({ timeout: 45_000 });
}

async function navigateToLogsTab(page: Page, propertyId: number): Promise<void> {
  // app/property/[id].tsx reads `tab` from useLocalSearchParams and uses it
  // as the initial tab — no need to click the tab strip.
  await page.goto(`/property/${propertyId}?tab=logs`);
  await expect(page.getByText("Work Logs").first()).toBeVisible({ timeout: 30_000 });
  // First-visit welcome dialog ("WELCOME TO THIS PROPERTY ... Got it") sits
  // on top of the tab content and intercepts clicks. Dismiss it if present.
  const gotIt = page.getByText("Got it").first();
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click();
    await expect(gotIt).toBeHidden({ timeout: 5_000 });
  }
}

/** The PhotoPreview overlays the work-log note with `accessibilityLabel={note}`,
 *  which renders as `<div aria-label="...">` on web. The overlay sits inside
 *  a parent Pressable; on RN web that Pressable doesn't expose role="button".
 *  In the LogsTab, the primary-photo wrapper is rendered before the sibling
 *  AttachmentList, so the FIRST overlay's parent Pressable is the primary.
 *  We dispatch a `click` directly on the parent so the click is not affected
 *  by viewport offsets (the modal viewer renders outside the mobile vp). */
async function openPrimaryPhotoViewer(page: Page, logNote: string): Promise<void> {
  const overlay = page.locator(`[aria-label="${logNote}"]`).first();
  await overlay.waitFor({ state: "visible", timeout: 15_000 });
  await overlay.evaluate((el) => {
    let node: HTMLElement | null = el as HTMLElement;
    // Walk up to the nearest cursor:pointer ancestor (the Pressable wrapper).
    while (node && node.parentElement) {
      const cursor = window.getComputedStyle(node).cursor;
      if (cursor === "pointer") break;
      node = node.parentElement;
    }
    (node ?? el).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

test.describe("Property work log: per-photo delete with Undo", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  // The PhotoViewer's trash button on web triggers `window.confirm`. Auto-accept.
  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => {
      d.accept().catch(() => {});
    });
  });

  // The browser-driven tests below cover the client-side 5-second undo timer
  // in PhotoViewer.tsx + app/property/[id].tsx for both the author and the
  // admin (non-author) permission paths. Backend contract semantics (which
  // path the undo timer ultimately POSTs to) are additionally pinned by the
  // synchronous integration suite at
  // artifacts/api-server/src/routes/__tests__/logs-attachments.test.ts.

  test("author: undo restores the photo; allowing the timer to expire deletes only that photo and preserves the log + siblings", async ({ page, baseURL }) => {
    const tag = uid(5);
    const email = `photo-undo-author-${tag}@example.test`;
    const password = "Pass1234!";

    const { idToken, localId: clerkId } = await firebaseSignUp(email, password);
    await bypassOnboarding(idToken, clerkId, baseURL!);

    const seeded = await seedPropertyAndLog({
      ownerClerkId: clerkId,
      authorClerkId: clerkId,
      tag,
    });

    await signInViaUI(page, email, password);
    await navigateToLogsTab(page, seeded.propertyId);

    // Open the photo viewer on the primary photo.
    await openPrimaryPhotoViewer(page, `Photo undo ${tag}`);
    const trash = page.getByLabel("Delete this photo");
    await expect(trash).toBeVisible({ timeout: 10_000 });

    // First delete -> snackbar appears with countdown + Undo. The PhotoViewer
    // is a full-screen modal whose top-right control row sits outside the
    // emulated mobile viewport, so dispatch a native click event directly
    // (Playwright's actionability checks would refuse a regular click).
    await trash.dispatchEvent("click");
    const snackbar = page.getByText(/^Photo deleted/);
    await expect(snackbar).toBeVisible({ timeout: 5_000 });
    await expect(snackbar).toContainText(/·\s*[1-5]s/);
    const undoBtn = page.getByLabel("Undo delete");
    await expect(undoBtn).toBeVisible();

    // Tap Undo well within the 5s window. Server should never see the call.
    await undoBtn.dispatchEvent("click");
    await expect(snackbar).toBeHidden({ timeout: 3_000 });

    // Server-side: nothing changed.
    const afterUndo = await fetchLogState(baseURL!, idToken, seeded.propertyId, seeded.logId);
    expect(afterUndo.exists).toBe(true);
    expect(afterUndo.photoUrl).toBe(seeded.primaryPath);
    expect(afterUndo.attachmentPaths.sort()).toEqual([seeded.siblingPathA, seeded.siblingPathB].sort());

    // Re-open viewer and delete again — this time let the timer expire.
    await openPrimaryPhotoViewer(page, `Photo undo ${tag}`);
    await page.getByLabel("Delete this photo").dispatchEvent("click");
    await expect(page.getByText(/^Photo deleted/)).toBeVisible();
    await page.waitForTimeout(7_000);
    await expect(page.getByText(/^Photo deleted/)).toBeHidden();

    // Server-side: only the primary photo is gone; sibling attachments + the
    // log row itself are preserved.
    const afterCommit = await fetchLogState(baseURL!, idToken, seeded.propertyId, seeded.logId);
    expect(afterCommit.exists).toBe(true);
    expect(afterCommit.photoUrl).toBeNull();
    expect(afterCommit.attachmentPaths.sort()).toEqual([seeded.siblingPathA, seeded.siblingPathB].sort());
  });

  test("admin (non-author): can delete a single photo from another user's log via the same UI flow", async ({ page, baseURL }) => {
    const tag = uid(5);
    const adminEmail = `photo-undo-admin-${tag}@example.test`;
    const authorEmail = `photo-undo-author2-${tag}@example.test`;
    const password = "Pass1234!";

    // Author owns the property + writes the log.
    const author = await firebaseSignUp(authorEmail, password);
    await bypassOnboarding(author.idToken, author.localId, baseURL!);

    // Admin is a separate user, added to the property with role=admin.
    const admin = await firebaseSignUp(adminEmail, password);
    await bypassOnboarding(admin.idToken, admin.localId, baseURL!);

    const seeded = await seedPropertyAndLog({
      ownerClerkId: author.localId,
      authorClerkId: author.localId,
      extraMember: { clerkId: admin.localId, role: "admin" },
      tag,
    });

    // Sign in as the admin (not the author) and exercise the same photo flow.
    await signInViaUI(page, adminEmail, password);
    await navigateToLogsTab(page, seeded.propertyId);

    await openPrimaryPhotoViewer(page, `Photo undo ${tag}`);
    const trash = page.getByLabel("Delete this photo");
    await expect(trash).toBeVisible({ timeout: 10_000 });

    await trash.dispatchEvent("click");
    const snackbar = page.getByText(/^Photo deleted/);
    await expect(snackbar).toBeVisible({ timeout: 5_000 });
    const undoBtn = page.getByLabel("Undo delete");
    await expect(undoBtn).toBeVisible();

    // Undo first to confirm the timer is also wired for the admin path.
    await undoBtn.dispatchEvent("click");
    await expect(snackbar).toBeHidden({ timeout: 3_000 });
    const afterUndo = await fetchLogState(baseURL!, author.idToken, seeded.propertyId, seeded.logId);
    expect(afterUndo.exists).toBe(true);
    expect(afterUndo.photoUrl).toBe(seeded.primaryPath);

    // Now actually commit the delete as admin.
    await openPrimaryPhotoViewer(page, `Photo undo ${tag}`);
    await page.getByLabel("Delete this photo").dispatchEvent("click");
    await expect(page.getByText(/^Photo deleted/)).toBeVisible();
    await page.waitForTimeout(7_000);

    const afterCommit = await fetchLogState(baseURL!, author.idToken, seeded.propertyId, seeded.logId);
    expect(afterCommit.exists).toBe(true);
    expect(afterCommit.photoUrl).toBeNull();
    expect(afterCommit.attachmentPaths.sort()).toEqual(
      [seeded.siblingPathA, seeded.siblingPathB].sort(),
    );
  });
});

import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

// E2E coverage for task #478 — Home side-tab overlay.
//
// The five right-edge side tabs on the Home timeline (Logs · Jobs ·
// Receipts · Reminders · Properties) used to push a new screen on tap.
// They now open as a dimmed left-anchored overlay that leaves the
// side-tab rail tappable, supports scrim-tap / X-button / swipe-right /
// re-tap-to-toggle dismissal (plus Android hardware back, which is
// covered by the manual device run referenced at the bottom of this
// file), and swaps content without closing when a different tab is
// tapped while a panel is open.
//
// What this spec asserts:
//   1. Tapping each of the 5 side tabs opens the overlay with the
//      expected panel title + content.
//   2. The overlay can be dismissed via scrim tap, the panel-header X
//      button, swipe-right (mouse drag), and by re-tapping the active
//      side tab.
//   3. Tapping a different side tab while one panel is open swaps the
//      content WITHOUT first closing — the overlay never unmounts
//      between the two panel renders.
//   4. The side-tab rail remains tappable while a panel is open
//      (verified implicitly by the swap test, since the rail tap has
//      to land for the swap to happen).
//   5. The standalone routes (/logs, /my-jobs, /invoices, /reminders,
//      /properties) still render as full screens when navigated to
//      directly — they are NOT wrapped in the overlay chrome.

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

async function withDb<T>(fn: (pg: Client) => Promise<T>): Promise<T> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    return await fn(pg);
  } finally {
    await pg.end();
  }
}

async function bypassOnboarding(
  idToken: string,
  clerkId: string,
  baseURL: string,
): Promise<void> {
  const meRes = await fetch(new URL("/api/users/me", baseURL).toString(), {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!meRes.ok) {
    throw new Error(`GET /api/users/me failed: ${meRes.status} ${await meRes.text()}`);
  }
  await withDb(async (pg) => {
    await pg.query(
      `UPDATE users
         SET avatar_url = 'public/seed-avatar.png',
             identity_completed_at = NOW()
       WHERE clerk_id = $1`,
      [clerkId],
    );
    const existing = await pg.query<{ id: number }>(
      `SELECT id FROM user_modes WHERE user_clerk_id = $1 AND kind = 'home' LIMIT 1`,
      [clerkId],
    );
    let modeId: number;
    if (existing.rows.length > 0) {
      modeId = existing.rows[0].id;
      await pg.query(`UPDATE user_modes SET intake_completed_at = NOW() WHERE id = $1`, [modeId]);
    } else {
      const inserted = await pg.query<{ id: number }>(
        `INSERT INTO user_modes (user_clerk_id, kind, intake_data, intake_completed_at)
           VALUES ($1, 'home', '{}'::jsonb, NOW()) RETURNING id`,
        [clerkId],
      );
      modeId = inserted.rows[0].id;
    }
    await pg.query(`UPDATE users SET last_active_mode_id = $1 WHERE clerk_id = $2`, [
      modeId,
      clerkId,
    ]);
  });
}

async function signInViaUI(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/");
  const emailInput = page.getByPlaceholder(/you@example\.com/i);
  await emailInput.waitFor({ state: "visible", timeout: 45_000 });
  await emailInput.fill(email);
  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.fill(password);
  await passwordInput.press("Enter");
  await expect(page.getByText("Profile", { exact: true }).first()).toBeVisible({
    timeout: 45_000,
  });
}

async function gotoHome(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Open profile").first().waitFor({ state: "visible", timeout: 20_000 });
}

// The HomeSidePanelOverlay renders a scrim Pressable AND a header X
// Pressable, BOTH labeled "Close panel". They are deterministic in
// document order: the scrim is appended before the panel, so .first()
// is the scrim and .last() is the X close button.
function xCloseTarget(page: Page) {
  return page.getByLabel("Close panel").last();
}

// The scrim Pressable spans most of the viewport but sits BEHIND the
// panel (which has the same width). Anywhere above the panel's
// topOffset (≈ 150px from the top of a 800px tall viewport) is
// exposed scrim, so clicking near the top-left lands on the scrim
// without intercepting the panel. We dispatch a synthetic mouse click
// at that coordinate so we don't depend on the locator's bounding box
// (which RN-web reports as zero-area for absolute scrim Pressables).
async function clickScrim(page: Page): Promise<void> {
  await page.mouse.click(20, 20);
}

async function openSideTab(page: Page, label: string): Promise<void> {
  // The side-tab Pressable advertises itself as "Open <label.lower>"
  // when closed and "Close <label.lower>" when active. Tap the open form.
  await page.getByLabel(`Open ${label}`).first().click();
}

async function reTapSideTab(page: Page, label: string): Promise<void> {
  // When a panel is open the side tab's accessibility label flips to
  // "Close <label>" — re-tap toggles the panel closed.
  await page.getByLabel(`Close ${label}`).first().click();
}

async function expectPanelOpen(page: Page, title: string): Promise<void> {
  // Panel header title is rendered inside the overlay with role=header.
  // The same title text may exist elsewhere (e.g. the screen's own
  // body) but the header version specifically renders with
  // role="header"/heading.
  await expect(
    page.getByRole("heading", { name: title }).first(),
  ).toBeVisible({ timeout: 10_000 });
}

async function expectPanelClosed(page: Page): Promise<void> {
  // Both Close-panel targets unmount once the close animation
  // completes. Poll until they're gone (allow ~500ms slack).
  await expect
    .poll(() => page.getByLabel("Close panel").count(), { timeout: 5_000 })
    .toBe(0);
}

test.describe("Home side-tab overlay (task #478)", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("opens each of the 5 side panels, dismisses via every web-supported method, swaps without closing, and standalone routes still render", async ({
    page,
    baseURL,
  }) => {
    const tag = uid(6);
    const email = `home-overlay-${tag}@example.test`;
    const password = "Pass1234!";

    page.on("pageerror", (e) => console.log(`[browser:throw] ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") console.log(`[browser:err] ${m.text()}`);
    });

    const { idToken, localId: clerkId } = await firebaseSignUp(email, password);
    await bypassOnboarding(idToken, clerkId, baseURL!);

    try {
      await signInViaUI(page, email, password);
      await gotoHome(page);

      // ---------------------------------------------------------------
      // 1) Each side tab opens the overlay with the expected content.
      // ---------------------------------------------------------------

      // Logs — embedded LogsScreen renders the "Create a new log"
      // primary, the "Photo" + "Note" quick-entry tiles, and the
      // "Search logs" placeholder.
      await openSideTab(page, "logs");
      await expectPanelOpen(page, "Logs");
      // RN-web sometimes propagates accessibilityLabel to both the
      // inner View and the wrapping Pressable, yielding count > 1 for
      // the same logical control. Assert visibility of the first
      // matching element instead of a strict count.
      await expect(page.getByLabel("Create a new log").first()).toBeVisible();
      await expect(page.getByLabel("Photo").first()).toBeVisible();
      await expect(page.getByLabel("Note").first()).toBeVisible();
      await expect(page.getByPlaceholder("Search logs").first()).toBeVisible();
      // Dismiss via scrim tap.
      await clickScrim(page);
      await expectPanelClosed(page);

      // Jobs — embedded MyJobsScreen renders the assigned-items
      // subtitle which is unique to that screen.
      await openSideTab(page, "jobs");
      await expectPanelOpen(page, "My Jobs");
      await expect(page.getByText(/assigned to you across all properties/i).first()).toBeVisible();
      // Dismiss via the panel-header X button.
      await xCloseTarget(page).click();
      await expectPanelClosed(page);

      // Receipts — embedded InvoicesScreen renders three segmented
      // tabs ("Invoices" / "Estimates" / "Receipts") and an empty
      // state ("No invoices yet" by default).
      await openSideTab(page, "receipts");
      await expectPanelOpen(page, "Receipts");
      await expect(page.getByText("No invoices yet").first()).toBeVisible();
      await expect(page.getByText("Estimates", { exact: true }).first()).toBeVisible();
      // Dismiss via re-tap on the same side tab.
      await reTapSideTab(page, "receipts");
      await expectPanelClosed(page);

      // Reminders — embedded RemindersScreen exposes a "+" button via
      // the overlay header's headerRight slot (accessibilityLabel
      // "Add reminder"). That button only renders when the overlay is
      // showing the Reminders panel, so its presence proves the
      // headerRight wiring works.
      await openSideTab(page, "reminders");
      await expectPanelOpen(page, "Reminders");
      await expect(page.getByLabel("Add reminder").first()).toBeVisible();
      // Dismiss via swipe-right (mouse drag). The PanResponder fires
      // when the gesture moves > 80px to the right.
      const panel = page.getByRole("heading", { name: "Reminders" }).first();
      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      const startX = (box!.x + box!.width / 2);
      const startY = (box!.y + box!.height / 2);
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      // Step the drag so React Native Web's PanResponder samples
      // multiple onPanResponderMove events before release.
      for (let i = 1; i <= 6; i++) {
        await page.mouse.move(startX + i * 30, startY);
      }
      await page.mouse.up();
      await expectPanelClosed(page);

      // Properties — embedded PropertiesScreen exposes the
      // list/map toggle (aria-labels "Show list view" + "Show map
      // view"). Properties is the trickiest panel because it
      // also has its own internal maps content; the list/map
      // toggle is the unambiguous content marker.
      await openSideTab(page, "properties");
      await expectPanelOpen(page, "Properties");
      await expect(page.getByLabel("Show list view").first()).toBeVisible();
      await expect(page.getByLabel("Show map view").first()).toBeVisible();
      // Dismiss via X again to bring us to a clean state for the
      // swap-without-close test below.
      await xCloseTarget(page).click();
      await expectPanelClosed(page);

      // ---------------------------------------------------------------
      // 2) Swapping panels: tapping a different side tab while a
      //    panel is open replaces the content WITHOUT unmounting
      //    the overlay first. We assert the overlay (Close-panel
      //    targets) stays mounted across the swap, AND that the
      //    side-tab rail is reachable while a panel is open (the
      //    second tap has to land on the rail for the swap to work).
      // ---------------------------------------------------------------
      await openSideTab(page, "logs");
      await expectPanelOpen(page, "Logs");
      // Confirm overlay is mounted.
      const closeCountWhileLogsOpen = await page.getByLabel("Close panel").count();
      expect(closeCountWhileLogsOpen).toBeGreaterThan(0);
      // Tap "Open properties" — the rail tab Pressable still has the
      // "Open <label>" form because Properties isn't the active panel.
      await openSideTab(page, "properties");
      // The header title swaps to "Properties" without an interim
      // close: the Close-panel targets must remain mounted across
      // the transition (we re-check immediately after the swap).
      await expectPanelOpen(page, "Properties");
      const closeCountAfterSwap = await page.getByLabel("Close panel").count();
      expect(closeCountAfterSwap).toBeGreaterThan(0);
      // The Logs-specific "Create a new log" primary should no
      // longer be in the DOM (the embedded LogsScreen has unmounted
      // and PropertiesScreen has taken its place).
      await expect(page.getByLabel("Create a new log")).toHaveCount(0);
      // Close before moving on.
      await xCloseTarget(page).click();
      await expectPanelClosed(page);

      // ---------------------------------------------------------------
      // 3) Standalone routes still work. Navigating directly to each
      //    /<route> renders the screen as a full-screen Stack page —
      //    NOT wrapped in the overlay chrome (no "Close panel"
      //    Pressable rendered).
      // ---------------------------------------------------------------
      const standaloneRoutes: Array<{ path: string; sentinelLabel?: string; sentinelText?: RegExp }> = [
        { path: "/logs", sentinelLabel: "Create a new log" },
        { path: "/my-jobs", sentinelText: /assigned to you across all properties/i },
        { path: "/invoices", sentinelText: /No invoices yet/i },
        { path: "/reminders", sentinelLabel: "Add reminder" },
        { path: "/properties", sentinelLabel: "Show list view" },
      ];
      for (const route of standaloneRoutes) {
        await page.goto(route.path);
        if (route.sentinelLabel) {
          await expect(page.getByLabel(route.sentinelLabel).first()).toBeVisible({
            timeout: 20_000,
          });
        } else if (route.sentinelText) {
          await expect(page.getByText(route.sentinelText).first()).toBeVisible({
            timeout: 20_000,
          });
        }
        // No overlay chrome is mounted on the standalone screen.
        await expect(page.getByLabel("Close panel")).toHaveCount(0);
      }
    } finally {
      await withDb(async (pg) => {
        await pg.query(`DELETE FROM user_modes WHERE user_clerk_id = $1`, [clerkId]);
        await pg.query(`DELETE FROM users WHERE clerk_id = $1`, [clerkId]);
      });
    }
  });
});

// Manual / device-only coverage (NOT run by Playwright):
//  - Android hardware back button: with a panel open, pressing the
//    system back button closes the panel (instead of leaving the tab
//    or popping a screen). Implemented via BackHandler in
//    HomeSidePanelOverlay; can only be exercised on a real Android
//    build, not the web preview Playwright drives.
//  - Open-from-tab origin animation: the panel scales in from the
//    tapped tab's vertical position. This is a visual-only check
//    best confirmed by eye on iOS + Android.
//  - VoiceOver / TalkBack announcements ("<panel> opened" /
//    "<panel> closed") emitted via AccessibilityInfo are spoken on
//    device but not surfaced through Playwright.

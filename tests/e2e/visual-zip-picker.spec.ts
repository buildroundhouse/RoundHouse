import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

/**
 * E2E coverage for the new visual ZIP picker (task #220).
 *
 * Walks a brand-new trade pro through:
 *   1. Sign up + identity bypass + mode picker (UI: "Trade Pro" tile).
 *   2. Trade-pro intake form with the visual ZipPicker — primary ZIP,
 *      three "nearby" suggestion chips, one manual ZIP.
 *   3. Reload + open Edit Profile → Service Area; verify the ZIPs
 *      persisted and that the editor preloads them.
 *   4. Remove one ZIP via the chip's "x", press Save.
 *   5. As a second signed-in user, hit /api/businesses/search?zip=…
 *      and assert the trade pro appears for primary + remaining
 *      additional ZIPs but NOT for the removed ZIP.
 *
 * Keeps the search verification on the API surface (rather than the
 * /find UI) so the spec stays focused on the picker.
 */

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

/**
 * Provision the user row server-side (via /api/users/me with the bearer
 * token), then mark identity as completed. We deliberately do NOT seed a
 * user_modes row, because we want the UI to land on the mode picker so
 * the trade-pro flow goes through the visual picker.
 */
async function provisionAndCompleteIdentity(
  idToken: string,
  clerkId: string,
  baseURL: string,
  username: string,
): Promise<void> {
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
              identity_completed_at = NOW(),
              username = $2
        WHERE clerk_id = $1`,
      [clerkId, username],
    );
  } finally {
    await pg.end();
  }
}

/**
 * Seed a trade_pro mode for the user directly in the DB (skipping the
 * intake UI) so editor-focused tests don't pay the ~60s cost of
 * mode-picker → form → submit. Marks identity complete, inserts a
 * trade_pro `user_modes` row with full intake_data + intake_completed_at,
 * and points last_active_mode_id at it so the app lands on the trade-pro
 * home tab after sign-in.
 */
async function seedTradeProMode(
  idToken: string,
  clerkId: string,
  baseURL: string,
  username: string,
  intake: { companyName: string; primaryZip: string; additionalZips: string[] },
): Promise<void> {
  const meRes = await fetch(new URL("/api/users/me", baseURL).toString(), {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!meRes.ok) {
    throw new Error(`GET /api/users/me failed: ${meRes.status} ${await meRes.text()}`);
  }
  const intakeData = {
    companyName: intake.companyName,
    trade: "general_contractor",
    experience: "5_10",
    region: "Austin, TX",
    primaryZip: intake.primaryZip,
    additionalZips: intake.additionalZips,
  };
  const pg = new Client({ connectionString: DATABASE_URL! });
  await pg.connect();
  try {
    await pg.query(
      `UPDATE users
          SET avatar_url = 'public/seed-avatar.png',
              identity_completed_at = NOW(),
              username = $2
        WHERE clerk_id = $1`,
      [clerkId, username],
    );
    // trade_pro is no longer globally unique on (user_clerk_id, kind) — users
    // can run multiple businesses. Do an explicit upsert by primary key.
    const existing = await pg.query<{ id: number }>(
      `SELECT id FROM user_modes WHERE user_clerk_id = $1 AND kind = 'trade_pro' LIMIT 1`,
      [clerkId],
    );
    let modeId: number;
    if (existing.rows.length > 0) {
      modeId = existing.rows[0].id;
      await pg.query(
        `UPDATE user_modes SET intake_data = $2::jsonb, intake_completed_at = NOW() WHERE id = $1`,
        [modeId, JSON.stringify(intakeData)],
      );
    } else {
      const inserted = await pg.query<{ id: number }>(
        `INSERT INTO user_modes (user_clerk_id, kind, intake_data, intake_completed_at)
           VALUES ($1, 'trade_pro', $2::jsonb, NOW())
           RETURNING id`,
        [clerkId, JSON.stringify(intakeData)],
      );
      modeId = inserted.rows[0].id;
    }
    await pg.query(`UPDATE users SET last_active_mode_id = $1 WHERE clerk_id = $2`, [
      modeId,
      clerkId,
    ]);
  } finally {
    await pg.end();
  }
}

/** Full bypass — for the search-side user, who doesn't need to touch the picker. */
async function bypassAllOnboarding(
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
    const existingHome = await pg.query<{ id: number }>(
      `SELECT id FROM user_modes WHERE user_clerk_id = $1 AND kind = 'home' LIMIT 1`,
      [clerkId],
    );
    let modeId: number;
    if (existingHome.rows.length > 0) {
      modeId = existingHome.rows[0].id;
      await pg.query(`UPDATE user_modes SET intake_completed_at = NOW() WHERE id = $1`, [modeId]);
    } else {
      const inserted = await pg.query<{ id: number }>(
        `INSERT INTO user_modes (user_clerk_id, kind, intake_data, intake_completed_at)
           VALUES ($1, 'home', '{}'::jsonb, NOW())
           RETURNING id`,
        [clerkId],
      );
      modeId = inserted.rows[0].id;
    }
    await pg.query(`UPDATE users SET last_active_mode_id = $1 WHERE clerk_id = $2`, [
      modeId,
      clerkId,
    ]);
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
  await emailInput.waitFor({ state: "visible", timeout: 60_000 });
  await emailInput.fill(email);
  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.fill(password);
  await passwordInput.press("Enter");
}

async function loadTradeProMode(
  clerkId: string,
): Promise<{ primaryZip: string | null; additionalZips: string[] } | null> {
  const pg = new Client({ connectionString: DATABASE_URL! });
  await pg.connect();
  try {
    const r = await pg.query<{
      intake_data: Record<string, unknown> | null;
    }>(
      `SELECT intake_data FROM user_modes WHERE user_clerk_id = $1 AND kind = 'trade_pro'`,
      [clerkId],
    );
    if (r.rowCount === 0) return null;
    const intake = (r.rows[0].intake_data ?? {}) as Record<string, unknown>;
    const primaryZip = typeof intake.primaryZip === "string" ? intake.primaryZip : null;
    const additionalZips = Array.isArray(intake.additionalZips)
      ? (intake.additionalZips as unknown[]).filter((z): z is string => typeof z === "string")
      : [];
    return { primaryZip, additionalZips };
  } finally {
    await pg.end();
  }
}

test.describe("Visual ZIP picker E2E", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("trade pro signs up, picks primary + nearby + manual ZIPs, edits service area, and is discoverable in /businesses/search for kept ZIPs only", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    const tag = uid(6);
    const password = "Pass1234!";

    // --- Trade pro user -----------------------------------------------------
    const tpEmail = `zip-picker-tp-${tag}@example.test`;
    const tpUsername = `zptp_${tag}`;
    const tp = await firebaseSignUp(tpEmail, password);
    await provisionAndCompleteIdentity(tp.idToken, tp.localId, baseURL!, tpUsername);

    // --- Searcher user (used to call /businesses/search at the end) -------
    const srEmail = `zip-picker-sr-${tag}@example.test`;
    const sr = await firebaseSignUp(srEmail, password);
    await bypassAllOnboarding(sr.idToken, sr.localId, baseURL!);

    // -----------------------------------------------------------------------
    // Part A: trade-pro signs in → mode picker → trade-pro intake → uses the
    //         visual ZipPicker → submits.
    // -----------------------------------------------------------------------
    await signInViaUI(page, tpEmail, password);

    // Mode picker tile for Trade Pro. RN web Pressables don't always expose
    // role=button, so target the tile by its visible label and dispatch a
    // synthetic click against the closest interactive ancestor.
    const tradeProTile = page.getByText("Trade Pro", { exact: true }).first();
    await tradeProTile.waitFor({ state: "visible", timeout: 60_000 });
    await tradeProTile.dispatchEvent("click");

    // Trade-pro intake form.
    const companyInput = page.getByPlaceholder("DMT Design Build");
    await companyInput.waitFor({ state: "visible", timeout: 30_000 });
    const companyName = `ZipE2E ${tag}`;
    await companyInput.fill(companyName);

    // Trade single-select.
    await page.getByText("General Contractor", { exact: true }).first().dispatchEvent("click");
    // Experience single-select — match the leading "5–10" option label.
    await page.getByText("5–10", { exact: false }).first().dispatchEvent("click");
    // Region (text).
    await page.getByPlaceholder("Austin, TX").fill("Austin, TX");
    // Primary ZIP.
    await page.getByPlaceholder("78701").fill("78701");

    // ZipPicker — pick the first three "nearby" suggestion chips dynamically
    // rather than hard-coding ZIPs, so the spec stays valid if the suggestion
    // ranking algorithm changes. accessibilityLabel maps to aria-label in
    // react-native-web, so we read the labels directly.
    const firstSuggestion = page.getByLabel(/^Add ZIP \d{5}$/).first();
    await firstSuggestion.waitFor({ state: "visible", timeout: 10_000 });
    const suggestionLabels = await page.getByLabel(/^Add ZIP \d{5}$/).all();
    expect(suggestionLabels.length).toBeGreaterThanOrEqual(3);
    const chosenNearby: string[] = [];
    for (const loc of suggestionLabels.slice(0, 3)) {
      const aria = (await loc.getAttribute("aria-label")) ?? "";
      const m = aria.match(/Add ZIP (\d{5})/);
      if (!m) throw new Error(`unexpected suggestion label: ${aria}`);
      chosenNearby.push(m[1]);
      await loc.dispatchEvent("click");
    }

    // Manual ZIP add — the picker exposes a numeric "ZIP" input + an "Add"
    // button. Pick a manual ZIP that is *not* in the nearby suggestion grid
    // so we exercise the manual-add code path. "73301" is in 733xx (Round
    // Rock area), distinct from the 787xx Austin sectional center used by
    // primary 78701, so it never appears as a nearby suggestion here.
    const MANUAL_ZIP = "73301";
    expect(chosenNearby).not.toContain(MANUAL_ZIP);
    const manualInput = page.getByPlaceholder("ZIP", { exact: true });
    await manualInput.fill(MANUAL_ZIP);
    await manualInput.press("Enter");

    // Submit intake.
    const submitBtn = page.getByText("Continue", { exact: true }).first();
    await submitBtn.dispatchEvent("click");

    // Successful submit lands on the trade-pro home tab ("Work").
    await expect(page.getByText("Work", { exact: true }).first()).toBeVisible({
      timeout: 60_000,
    });

    // DB sanity: primaryZip + four additional ZIPs persisted.
    const afterIntake = await loadTradeProMode(tp.localId);
    expect(afterIntake).not.toBeNull();
    expect(afterIntake!.primaryZip).toBe("78701");
    expect(new Set(afterIntake!.additionalZips)).toEqual(
      new Set(["78700", "78702", "78703", "73301"]),
    );

    // -----------------------------------------------------------------------
    // Part B: reload, open Edit Profile → Service Area, remove "73301", save.
    // -----------------------------------------------------------------------
    await page.reload();
    // After reload, the user is auto-routed to the home tab; navigate to the
    // profile tab.
    await page.goto("/profile");
    const editIdentity = page.getByLabel("Edit company identity");
    await editIdentity.waitFor({ state: "visible", timeout: 30_000 });
    await editIdentity.dispatchEvent("click");

    // Service Area row in the Edit Profile modal.
    const serviceAreaRow = page.getByLabel("Edit service area ZIPs");
    await serviceAreaRow.waitFor({ state: "visible", timeout: 15_000 });
    // The summary row should already reflect the 4 additional ZIPs persisted.
    await expect(serviceAreaRow).toContainText("Primary 78701");
    await expect(serviceAreaRow).toContainText("+4 other ZIPs");
    await serviceAreaRow.dispatchEvent("click");

    // The editor should preload all four chips. Then remove "73301".
    const removeChip = page.getByLabel("Remove ZIP 73301").first();
    await removeChip.waitFor({ state: "visible", timeout: 10_000 });
    await removeChip.dispatchEvent("click");
    // After removal, the remove-chip selector should no longer match.
    await expect(page.getByLabel("Remove ZIP 73301")).toHaveCount(0);

    // Save — scope the click to the Service Area editor's header to avoid
    // accidentally hitting the EditProfile modal's Save button (both are
    // present in the DOM while the editor is open). The Service Area
    // editor renders its header as a sibling of its "Service area" title,
    // so we anchor on that title and walk up to the shared header row.
    const serviceAreaTitle = page.getByText("Service area", { exact: true }).first();
    await serviceAreaTitle.waitFor({ state: "visible", timeout: 10_000 });
    const serviceAreaSave = serviceAreaTitle
      .locator("xpath=ancestor::*[.//*[normalize-space()='Save']][1]")
      .getByText("Save", { exact: true })
      .first();
    await serviceAreaSave.dispatchEvent("click");

    // The editor closes; eventually the parent Edit Profile modal also reflects
    // the new count. Poll the DB to confirm persistence (avoids racing the
    // server roundtrip vs. UI animation).
    await expect
      .poll(
        async () => {
          const m = await loadTradeProMode(tp.localId);
          return m?.additionalZips.includes("73301") ?? true;
        },
        { timeout: 15_000, intervals: [500, 1_000, 1_500] },
      )
      .toBe(false);

    const afterEdit = await loadTradeProMode(tp.localId);
    expect(afterEdit!.primaryZip).toBe("78701");
    expect(new Set(afterEdit!.additionalZips)).toEqual(
      new Set(["78700", "78702", "78703"]),
    );

    // -----------------------------------------------------------------------
    // Part C: a different signed-in user searches by ZIP. The trade pro
    // should appear for the primary ZIP and a kept additional ZIP, but NOT
    // for the removed ZIP "73301".
    // -----------------------------------------------------------------------
    async function searchByZip(zip: string): Promise<string[]> {
      const r = await fetch(
        new URL(
          `/api/businesses/search?zip=${encodeURIComponent(zip)}`,
          baseURL!,
        ).toString(),
        { headers: { Authorization: `Bearer ${sr.idToken}` } },
      );
      if (!r.ok) {
        throw new Error(`search ${zip} failed: ${r.status} ${await r.text()}`);
      }
      const j = (await r.json()) as {
        businesses: { companyName: string | null }[];
      };
      return j.businesses
        .map((b) => b.companyName ?? "")
        .filter((n) => n.length > 0);
    }

    const primaryHits = await searchByZip("78701");
    expect(primaryHits).toContain(companyName);

    const keptHits = await searchByZip("78703");
    expect(keptHits).toContain(companyName);

    const removedHits = await searchByZip("73301");
    expect(removedHits).not.toContain(companyName);
  });

  /**
   * Regression coverage for task #240 / fix in `ServiceAreaEditorModal.tsx`:
   * the local editor state was previously re-seeded from `activeMode` whenever
   * the reference changed (e.g. a background `useListMyModes` refetch fired
   * while the editor was open), silently overwriting the user's in-progress
   * edits — including a just-removed ZIP. A subsequent Save then wrote the
   * un-edited list back to the server.
   *
   * This test exercises the three save flows that previously masked or
   * triggered the bug:
   *   A. Remove a chip, force `useListMyModes` to refetch (window
   *      visibilitychange → React Query window-focus refetch), then Save.
   *      The removal must persist to the DB.
   *   B. Add a brand-new manual ZIP via the input + Add button, Save, and
   *      verify both the DB intake_data and `/businesses/search?zip=…`.
   *   C. Toggle the same nearby suggestion on/off twice (net no-op), Save,
   *      and verify the final DB state matches what's actually on screen
   *      (i.e. no spurious add/remove).
   */
  test("Service Area editor save flow survives mid-edit refetch, manual add, and double-toggle", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000);

    const tag = uid(6);
    const password = "Pass1234!";
    const PRIMARY_ZIP = "78701";
    // Three nearby ZIPs in the 787xx sectional center for primary 78701.
    // These match the first three "nearest by numeric distance" suggestions
    // that ZipPicker.nearbyZipSuggestions produces, so when the editor opens
    // they appear pre-selected (chips) AND are absent from the suggestion grid.
    const SEED_ZIPS = ["78700", "78702", "78703"];
    const companyName = `ZipSave ${tag}`;

    // Trade pro user — seed the trade_pro mode directly in DB so we bypass
    // the slow intake UI (mode picker → form → ZipPicker → submit) and jump
    // straight to /profile to exercise just the editor save flows.
    const tpEmail = `zip-save-tp-${tag}@example.test`;
    const tpUsername = `zpsv_${tag}`;
    const tp = await firebaseSignUp(tpEmail, password);
    await seedTradeProMode(tp.idToken, tp.localId, baseURL!, tpUsername, {
      companyName,
      primaryZip: PRIMARY_ZIP,
      additionalZips: SEED_ZIPS,
    });

    // Search-side user for /businesses/search verification in scenario B.
    const srEmail = `zip-save-sr-${tag}@example.test`;
    const sr = await firebaseSignUp(srEmail, password);
    await bypassAllOnboarding(sr.idToken, sr.localId, baseURL!);

    // Sanity: DB matches what we seeded.
    const afterSeed = await loadTradeProMode(tp.localId);
    expect(afterSeed).not.toBeNull();
    expect(afterSeed!.primaryZip).toBe(PRIMARY_ZIP);
    expect(new Set(afterSeed!.additionalZips)).toEqual(new Set(SEED_ZIPS));

    // Sign in via UI — Provider/Auth state is required by the profile screen.
    await signInViaUI(page, tpEmail, password);
    // Wait for the post-sign-in shell. The trade-pro home tab shows an
    // "Open profile" affordance in its header; use that as a stable signal
    // that auth + profile loading completed.
    await expect(page.getByLabel("Open profile").first()).toBeVisible({
      timeout: 60_000,
    });

    const intakeChosen = SEED_ZIPS;

    // Helper: open Edit Profile → Service Area editor from the profile tab.
    async function openServiceAreaEditor(): Promise<void> {
      await page.goto("/profile");
      const editIdentity = page.getByLabel("Edit company identity");
      await editIdentity.waitFor({ state: "visible", timeout: 30_000 });
      await editIdentity.dispatchEvent("click");
      const serviceAreaRow = page.getByLabel("Edit service area ZIPs");
      await serviceAreaRow.waitFor({ state: "visible", timeout: 15_000 });
      await serviceAreaRow.dispatchEvent("click");
      // Wait for the editor's Save header control to appear.
      const title = page.getByText("Service area", { exact: true }).first();
      await title.waitFor({ state: "visible", timeout: 10_000 });
    }

    // Helper: tap the editor's Save button (header), scoped to avoid the
    // sibling EditProfile modal's Save.
    async function tapEditorSave(): Promise<void> {
      const title = page.getByText("Service area", { exact: true }).first();
      const save = title
        .locator("xpath=ancestor::*[.//*[normalize-space()='Save']][1]")
        .getByText("Save", { exact: true })
        .first();
      await save.dispatchEvent("click");
    }

    // -----------------------------------------------------------------------
    // Scenario A: Remove a chip, force a `useListMyModes` refetch, then Save.
    // The removal MUST persist — the bug was that the refetch overwrote local
    // state and Save then wrote the un-edited list back.
    // -----------------------------------------------------------------------
    const removedZip = intakeChosen[0];
    await openServiceAreaEditor();

    const removeChipA = page.getByLabel(`Remove ZIP ${removedZip}`).first();
    await removeChipA.waitFor({ state: "visible", timeout: 10_000 });
    await removeChipA.dispatchEvent("click");
    await expect(page.getByLabel(`Remove ZIP ${removedZip}`)).toHaveCount(0);

    // Force React Query's window-focus refetch. The default `focusManager`
    // listens for `visibilitychange` on `window`; firing one with the
    // document already visible triggers `onFocus()` → refetch of every
    // active query, including `/api/users/me/modes`.
    await page.evaluate(() => {
      window.dispatchEvent(new Event("visibilitychange"));
    });
    // Give the refetch a beat to land. If the bug is back, the chip would
    // re-appear in the editor here; assert it stays gone.
    await page.waitForTimeout(750);
    await expect(page.getByLabel(`Remove ZIP ${removedZip}`)).toHaveCount(0);

    await tapEditorSave();

    await expect
      .poll(
        async () => {
          const m = await loadTradeProMode(tp.localId);
          return m?.additionalZips.includes(removedZip) ?? true;
        },
        { timeout: 15_000, intervals: [500, 1_000, 1_500] },
      )
      .toBe(false);

    const afterScenarioA = await loadTradeProMode(tp.localId);
    const expectedAfterA = intakeChosen.filter((z) => z !== removedZip);
    expect(new Set(afterScenarioA!.additionalZips)).toEqual(new Set(expectedAfterA));

    // -----------------------------------------------------------------------
    // Scenario B: Add a brand-new manual ZIP via the editor's input + Add.
    // 73301 (Round Rock area) is in 733xx so it never appears as a nearby
    // suggestion for primary 78701, forcing the manual-add code path.
    // -----------------------------------------------------------------------
    const MANUAL_ZIP_B = "73301";
    expect(expectedAfterA).not.toContain(MANUAL_ZIP_B);

    await openServiceAreaEditor();
    const manualInputB = page.getByPlaceholder("ZIP", { exact: true });
    await manualInputB.waitFor({ state: "visible", timeout: 10_000 });
    await manualInputB.fill(MANUAL_ZIP_B);
    await manualInputB.press("Enter");
    // The newly-added ZIP should immediately appear as a removable chip.
    await expect(page.getByLabel(`Remove ZIP ${MANUAL_ZIP_B}`)).toHaveCount(1);

    await tapEditorSave();

    await expect
      .poll(
        async () => {
          const m = await loadTradeProMode(tp.localId);
          return m?.additionalZips.includes(MANUAL_ZIP_B) ?? false;
        },
        { timeout: 15_000, intervals: [500, 1_000, 1_500] },
      )
      .toBe(true);

    const afterScenarioB = await loadTradeProMode(tp.localId);
    expect(new Set(afterScenarioB!.additionalZips)).toEqual(
      new Set([...expectedAfterA, MANUAL_ZIP_B]),
    );

    // The trade pro must now be discoverable for the manual ZIP via the
    // public /businesses/search endpoint.
    async function searchByZip(zip: string): Promise<string[]> {
      const r = await fetch(
        new URL(
          `/api/businesses/search?zip=${encodeURIComponent(zip)}`,
          baseURL!,
        ).toString(),
        { headers: { Authorization: `Bearer ${sr.idToken}` } },
      );
      if (!r.ok) {
        throw new Error(`search ${zip} failed: ${r.status} ${await r.text()}`);
      }
      const j = (await r.json()) as {
        businesses: { companyName: string | null }[];
      };
      return j.businesses
        .map((b) => b.companyName ?? "")
        .filter((n) => n.length > 0);
    }
    const manualHits = await searchByZip(MANUAL_ZIP_B);
    expect(manualHits).toContain(companyName);

    // -----------------------------------------------------------------------
    // Scenario C: Toggle the same nearby suggestion on then off (net no-op),
    // Save, and confirm the final DB state matches what's on screen.
    // Pick a suggestion that is NOT currently selected so we get a clean
    // on→off cycle without disturbing existing chips.
    // -----------------------------------------------------------------------
    const expectedBeforeC = new Set(afterScenarioB!.additionalZips);

    await openServiceAreaEditor();

    // Find an "Add ZIP …" suggestion (i.e. not currently selected) whose
    // ZIP is also not the manual ZIP. The on/off toggle uses the same
    // suggestion button; after the on-tap its label flips to "Remove ZIP …"
    // and we tap it again to flip back to "Add ZIP …".
    const addSuggestions = await page.getByLabel(/^Add ZIP \d{5}$/).all();
    let toggleZip: string | null = null;
    for (const loc of addSuggestions) {
      const aria = (await loc.getAttribute("aria-label")) ?? "";
      const m = aria.match(/Add ZIP (\d{5})/);
      if (!m) continue;
      const z = m[1];
      if (expectedBeforeC.has(z)) continue;
      toggleZip = z;
      break;
    }
    expect(toggleZip).not.toBeNull();

    // Toggle ON — by aria-label "Add ZIP <zip>". After the on-tap the
    // ZIP appears in BOTH the chips row (removable chip) AND the
    // suggestion grid (the same button now flips its label to
    // "Remove ZIP …" because it tracks selectedSet). So we expect 2
    // elements with that label — assert >= 1 to stay forward-compatible.
    const toggleOn = page.getByLabel(`Add ZIP ${toggleZip}`).first();
    await toggleOn.dispatchEvent("click");
    await expect
      .poll(async () => page.getByLabel(`Remove ZIP ${toggleZip}`).count(), {
        timeout: 5_000,
      })
      .toBeGreaterThanOrEqual(1);
    // And the original "Add ZIP …" suggestion label should be gone since
    // the only matching button has flipped to the "Remove" label.
    await expect(page.getByLabel(`Add ZIP ${toggleZip}`)).toHaveCount(0);

    // Toggle OFF — click any "Remove ZIP <zip>" element (either the chip
    // or the now-selected suggestion button toggles back to deselected).
    const toggleOff = page.getByLabel(`Remove ZIP ${toggleZip}`).first();
    await toggleOff.dispatchEvent("click");
    await expect(page.getByLabel(`Remove ZIP ${toggleZip}`)).toHaveCount(0);
    // The suggestion should be back as an "Add ZIP …" entry in the grid.
    await expect(page.getByLabel(`Add ZIP ${toggleZip}`)).toHaveCount(1);

    await tapEditorSave();

    // After Save, the DB additionalZips must match exactly what was on
    // screen — the toggle pair was a no-op, so it should equal scenario B's
    // post-state. Poll briefly to allow the write + refetch to land.
    await expect
      .poll(
        async () => {
          const m = await loadTradeProMode(tp.localId);
          if (!m) return null;
          return [...m.additionalZips].sort().join(",");
        },
        { timeout: 15_000, intervals: [500, 1_000, 1_500] },
      )
      .toBe([...expectedBeforeC].sort().join(","));

    const afterScenarioC = await loadTradeProMode(tp.localId);
    expect(new Set(afterScenarioC!.additionalZips)).toEqual(expectedBeforeC);
    // And specifically: the toggled ZIP must NOT be in the saved list.
    expect(afterScenarioC!.additionalZips).not.toContain(toggleZip!);
  });
});

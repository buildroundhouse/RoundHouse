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

// React-native-web's <Image> only paints the resolved URL into the
// element's inline `background-image` style *after* a successful
// preload — it never emits the URL into the DOM if the image 404s.
// That means our DOM assertion ("the active account's avatar URL
// shows up on the page") only succeeds when the URLs we seed actually
// resolve to a real image. We therefore use placehold.co, which
// reliably serves a tiny PNG for arbitrary paths and lets us encode a
// unique-per-run fragment so we can grep for it in the DOM.
const PLACEHOLDER_HOST = "https://placehold.co";
function userAvatarUrl(tag: string): string {
  return `${PLACEHOLDER_HOST}/40x40/000000/FFFFFF.png?text=user-${tag}`;
}
function accountAvatarUrl(tag: string): string {
  return `${PLACEHOLDER_HOST}/40x40/0000FF/FFFFFF.png?text=ava-${tag}`;
}
function accountBannerUrl(tag: string): string {
  return `${PLACEHOLDER_HOST}/40x40/00AA00/FFFFFF.png?text=ban-${tag}`;
}

async function bypassOnboarding(
  idToken: string,
  clerkId: string,
  baseURL: string,
  userAvatarUrlForClerk: string,
): Promise<void> {
  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
  // Touching /api/users/me kicks off the auto-create-user path AND lazily
  // seeds the user's first outward account via the
  // withActiveOutwardAccount middleware. After this call the user has
  // exactly one outward account.
  const meRes = await fetch(new URL("/api/users/me", baseURL).toString(), {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!meRes.ok) throw new Error(`GET /api/users/me failed: ${meRes.status} ${await meRes.text()}`);

  const pg = new Client({ connectionString: DATABASE_URL });
  await pg.connect();
  try {
    await pg.query(
      `UPDATE users
         SET avatar_url = $2,
             identity_completed_at = NOW()
         WHERE clerk_id = $1`,
      [clerkId, userAvatarUrlForClerk],
    );
    const modeRow = await pg.query<{ id: number }>(
      `INSERT INTO user_modes (user_clerk_id, kind, intake_data, intake_completed_at)
         VALUES ($1, 'home', '{}'::jsonb, NOW())
         RETURNING id`,
      [clerkId],
    );
    const modeId = modeRow.rows[0].id;
    await pg.query(`UPDATE users SET last_active_mode_id = $1 WHERE clerk_id = $2`, [modeId, clerkId]);
  } finally {
    await pg.end();
  }
}

type CreateOpts = {
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  makeActive?: boolean;
};

async function createOutwardAccount(
  idToken: string,
  baseURL: string,
  title: string,
  opts: CreateOpts = {},
): Promise<{ id: number; title: string }> {
  const r = await fetch(new URL("/api/outward-accounts", baseURL).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      kind: "home",
      title,
      displayName: title,
      avatarUrl: opts.avatarUrl ?? null,
      bannerUrl: opts.bannerUrl ?? null,
      makeActive: opts.makeActive ?? false,
    }),
  });
  if (!r.ok) {
    throw new Error(`POST /api/outward-accounts failed: ${r.status} ${await r.text()}`);
  }
  return (await r.json()) as { id: number; title: string };
}

async function setActiveOutwardAccount(
  idToken: string,
  baseURL: string,
  id: number,
): Promise<void> {
  const r = await fetch(
    new URL(`/api/outward-accounts/${id}/switch`, baseURL).toString(),
    {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}` },
    },
  );
  if (!r.ok) {
    throw new Error(`POST switch failed: ${r.status} ${await r.text()}`);
  }
}

async function signInUI(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/");
  await page.getByPlaceholder(/you@example\.com/i).fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByText("Sign in", { exact: true }).last().click();
  // Wait until the tab bar is rendered.
  await page
    .getByText("Profile", { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
}

// Screens that render the active outward account's avatar in their top
// bar (TopBarAvatar) plus the Profile screen which renders the same
// fallback chain via IdentityHero. Home (the index tab) is intentionally
// excluded — task #410 covers TopBarAvatar consumers and Profile, and
// the home header has its own dedicated avatar test elsewhere.
const SCREENS = [
  "/properties",
  "/clients",
  "/invoices",
  "/notifications",
  "/my-jobs",
  "/profile",
] as const;

async function gotoAndSettle(page: Page, path: string): Promise<void> {
  await page.goto(path);
  // Let the screen render and the profile query resolve. We don't wait
  // for full network idle because Expo's dev client keeps long-poll
  // sockets open which would time out networkidle.
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(400);
}

// Scope the avatar assertions to the actual avatar elements rather
// than scanning the entire document — this protects against false
// positives if the same URL ever leaked into an unrelated part of
// the DOM (e.g., a debug log, a list of all accounts in a switcher,
// etc.). For TopBarAvatar consumers we scope to the labelled
// Pressable. For the Profile screen the avatar lives in
// IdentityHero's `avatarWrap` (an unlabeled <View>); we identify it
// by its rounded-square sibling-of-banner shape via a CSS selector
// that walks down from the IdentityHero root container, which is
// reliably the top-most child of the screen with class
// "css-view-g5y9jx" and a visible avatar wrapper sized to 96px.
// In practice, scoping to the top-most "Open profile" sibling region
// (the screen's main scroll container) is sufficient and far more
// stable than depending on private style hashes — so we widen to the
// page's main content area when on /profile.
async function avatarOuterHTML(page: Page, path: string): Promise<string> {
  if (path === "/profile") {
    // IdentityHero's avatar is an unlabeled <View>. The labelled
    // "Settings" Pressable lives in the same hero container, so we
    // walk up from it to the closest ancestor that also wraps the
    // avatar. In the current IdentityHero structure the hero root is
    // the deepest ancestor <div> that owns both the banner and the
    // edit/settings action row — empirically this is the 4th-closest
    // ancestor <div> from the Settings button. Using ancestor-or-self
    // with a positional bound keeps the scope tight to the hero
    // (avoiding false positives from anywhere else on the page) while
    // staying robust to small structural tweaks.
    const settings = page.getByLabel("Settings").first();
    await settings.waitFor({ state: "visible", timeout: 15_000 });
    return await settings.evaluate((el) => {
      let node: HTMLElement | null = el as HTMLElement;
      for (let i = 0; i < 6 && node?.parentElement; i++) {
        node = node.parentElement;
      }
      return node?.outerHTML ?? "";
    });
  }
  const topbar = page.locator('[aria-label="Open profile"]').first();
  await topbar.waitFor({ state: "visible", timeout: 15_000 });
  return (await topbar.evaluate((el) => (el as HTMLElement).outerHTML)) ?? "";
}

async function expectVisibleAvatarMatching(
  page: Page,
  path: string,
  fragment: string,
): Promise<void> {
  // react-native-web's <Image> paints the resolved storage URL onto an
  // inner `<div style="background-image: url(...)">` after a successful
  // preload — older versions emitted an <img>. Either form lands the
  // URL inside the avatar's outerHTML.
  await expect
    .poll(async () => (await avatarOuterHTML(page, path)).includes(fragment), {
      timeout: 15_000,
      intervals: [200, 500, 1000],
    })
    .toBe(true);
}

async function expectNoUrlInAvatar(
  page: Page,
  path: string,
  fragment: string,
): Promise<void> {
  await expect
    .poll(async () => (await avatarOuterHTML(page, path)).includes(fragment), {
      timeout: 5_000,
      intervals: [200, 500],
    })
    .toBe(false);
}

test.describe("TopBarAvatar updates when switching outward accounts", () => {
  test.skip(
    !FIREBASE_API_KEY || !DATABASE_URL,
    "Requires EXPO_PUBLIC_FIREBASE_API_KEY and DATABASE_URL",
  );

  test("avatar src follows the active account across every top-bar-bearing screen and obeys the avatar -> banner -> user-avatar fallback chain", async ({
    page,
    baseURL,
  }) => {
    const tag = uid(8);
    const email = `topbar-avatar-${tag}@example.test`;
    const password = "Pass1234!";

    const { idToken, localId: clerkId } = await firebaseSignUp(email, password);
    const userFallbackAvatar = userAvatarUrl(tag);
    await bypassOnboarding(idToken, clerkId, baseURL!, userFallbackAvatar);

    // Three accounts that exercise each rung of the fallback chain.
    // Use unique-per-run placeholder URLs so cross-test data can never
    // accidentally satisfy our DOM assertion.
    const avatarA = accountAvatarUrl(tag);
    const bannerB = accountBannerUrl(tag);

    const accountA = await createOutwardAccount(idToken, baseURL!, `A-${tag}`, {
      avatarUrl: avatarA,
      makeActive: true,
    });
    const accountB = await createOutwardAccount(idToken, baseURL!, `B-${tag}`, {
      bannerUrl: bannerB,
    });
    const accountC = await createOutwardAccount(idToken, baseURL!, `C-${tag}`, {
      // No avatar, no banner — falls through to user.avatarUrl.
    });

    await signInUI(page, email, password);

    // --- Step 1: account A is active. Avatar URL should win on every screen.
    for (const path of SCREENS) {
      await gotoAndSettle(page, path);
      await expectVisibleAvatarMatching(page, path, `ava-${tag}`);
    }

    // --- Step 2: switch to account B (banner-only). Banner URL should be
    // used as the avatar fallback on every screen.
    await setActiveOutwardAccount(idToken, baseURL!, accountB.id);
    await page.reload();
    await page
      .getByText("Profile", { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    for (const path of SCREENS) {
      await gotoAndSettle(page, path);
      await expectVisibleAvatarMatching(page, path, `ban-${tag}`);
      // And critically, the previous account's avatar must no longer
      // appear in the avatar slot — assert no stale URL lingers.
      await expectNoUrlInAvatar(page, path, `ava-${tag}`);
    }

    // --- Step 3: switch to account C (no media). Should fall back to the
    // user's profile avatar on every screen.
    await setActiveOutwardAccount(idToken, baseURL!, accountC.id);
    await page.reload();
    await page
      .getByText("Profile", { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    for (const path of SCREENS) {
      await gotoAndSettle(page, path);
      await expectVisibleAvatarMatching(page, path, `user-${tag}`);
      await expectNoUrlInAvatar(page, path, `ban-${tag}`);
    }

    // Note on the "no media at all" leg of the fallback chain in
    // task #410: production code gates `useActiveAccountAvatarUrl`'s
    // user-profile-avatar fallback behind the identity-onboarding
    // requirement that `users.avatar_url` always be a non-empty
    // string (see `lib/profile.tsx` — a falsy `profile.avatarUrl`
    // forces the app back into the `needs-identity` onboarding
    // screen). That makes the "every rung of the chain returned
    // null" case unreachable through any UI path, so this spec
    // exhausts the meaningful states (account-avatar / banner-only /
    // user-avatar fallback) and stops there.
    void accountA;
  });
});

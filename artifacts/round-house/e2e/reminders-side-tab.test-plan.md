# Reminders side-tab — signed-in end-to-end test plan

Use with the project's UI testing tool (Playwright-driven). Run against the
Roundhouse Expo web preview.

> **Single-context plan.** Drives only one Playwright browser context
> (the signed-in homeowner). The dual-context screenshot helper at
> `./dual-context-screenshots.md` intentionally does not apply here;
> no sibling `*.results.md` template ships alongside this plan.

This plan complements `reminders.test-plan.md`. The main reminders plan
exercises `/reminders` directly because the Timeline is gated behind Firebase sign-in.
This plan covers the gap: it signs in as a seeded Firebase test user, lands
on the Timeline tab, and taps the right-side `Reminders` bookmark tab to catch
regressions to the side-tab wiring (icon, label, route).

## Context

- Sign-in route: `/(auth)/sign-in` (renders `app/(auth)/sign-in.tsx`).
  - Email field: `placeholder="you@example.com"`, `autoComplete="email"`.
  - Password field: `placeholder="Password"`, `autoComplete="current-password"`.
  - Submit button label: `Sign in` (becomes `Signing in...` while pending).
  - On success, the screen calls `router.replace("/(tabs)")`.
- Timeline route after sign-in: `/(tabs)` (renders `app/(tabs)/index.tsx`).
  - The tab layout in `app/(tabs)/_layout.tsx` redirects to onboarding if the
    profile is incomplete (`needs-identity`, `needs-mode-picker`,
    `needs-intake`). The seeded test user **must** have already completed
    onboarding so it lands directly on Timeline.
- Side-tab stack: `SideTabStack` in `app/(tabs)/index.tsx`. Each tab is a
  `Pressable` with `accessibilityRole="button"` and
  `accessibilityLabel="Open <label-lowercased>"`. The Reminders entry has:
  - `key: "reminders"`, `label: "Reminders"`, `icon: "bell"` (Feather).
  - `onPress: goReminders` → `router.push("/reminders")`.
  - Resulting accessibility label: **`Open reminders`**.
- Reminders route: `/reminders` (renders `app/reminders.tsx`). Header text
  reads `Reminders`; empty state reads `No reminders yet`.

## Reusable signed-in test fixture

The fixture is a **seeded Firebase test account** that has finished onboarding
so the app lands on Timeline immediately after sign-in. This avoids brittle
walk-throughs of identity / mode-picker / intake on every run.

### One-time seeding

1. In the Replit shell, open the Roundhouse web preview and visit
   `/(auth)/sign-up`.
2. Create an account with throwaway credentials, e.g. `e2e-reminders@roundhouse.test` / a strong test password.
3. Complete the onboarding flow (`identity` → `mode-picker` → `intake`) until
   the bottom-tab Timeline screen appears.
4. Sign out.
5. Save the credentials as Replit Secrets so the test runner can pick them up:
   - `E2E_FIREBASE_EMAIL` — the seeded account email.
   - `E2E_FIREBASE_PASSWORD` — the seeded account password.

The same account is reused across runs. The reminders the test creates live
in `localStorage` (web) under `rh.reminders.v1`, which the plan clears at the
start so prior runs don't bleed in.

> If the secrets aren't present, the test should report `unable` rather than
> falling through to a broken sign-in, and the operator should re-seed.

## Plan

1. [New Context] Create a new browser context. Install a global
   `page.on('dialog')` handler that accepts (`dialog.accept()`) any dialogs.
2. [Browser] Navigate to `/(auth)/sign-in`.
3. [Verify] The page renders the `Sign in` heading and an email + password
   form with a `Sign in` submit button.
4. [Browser] Type the value of the `E2E_FIREBASE_EMAIL` secret into the email
   field and the value of `E2E_FIREBASE_PASSWORD` into the password field,
   then tap `Sign in`. Wait for navigation away from `/(auth)/sign-in`.
5. [Verify] The URL settles on `/(tabs)` (or `/`, the Timeline tab path) — **not**
   `/(onboarding)/identity`, `/(onboarding)/mode-picker`, or
   `/(onboarding)/intake`. If onboarding shows, the seeded fixture is stale;
   stop and report `unable` with that detail.
6. [Browser] Run `localStorage.removeItem("rh.reminders.v1")` so the
   Reminders screen starts empty when we land on it.
7. [Verify] Timeline is rendered. The right edge shows a vertical stack of
   bookmark-style side tabs. One of them has accessible name `Open reminders`.
8. [Browser] Tap the side tab with accessible name `Open reminders`.
9. [Verify]
   - The URL becomes `/reminders`.
   - The screen header reads `Reminders`.
   - The empty state `No reminders yet` is visible (because we cleared the
     storage key in step 6), confirming the Reminders screen actually
     mounted — not a blank route.
10. [Browser] Use the in-app back affordance (browser back) to return to
    Timeline, then tap the `Open reminders` side tab a second time.
11. [Verify] URL is `/reminders` again and the screen re-renders without
    error, confirming the side-tab route is repeatable (not a one-shot).

## Notes for native (iOS / Android) runs

- Sign in via the same email/password screen on device. Programmatic
  Firebase sign-in helpers don't bypass the navigation flow; tap through the
  UI like the web run.
- The side tab is the same `Pressable` with `accessibilityLabel="Open reminders"` — drivers that match by accessibility label work without
  changes.

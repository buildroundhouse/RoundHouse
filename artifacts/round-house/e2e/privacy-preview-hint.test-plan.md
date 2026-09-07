# Self-profile privacy preview hint — end-to-end test plan

Use with the project's UI testing tool (Playwright-driven). Run against
the Roundhouse Expo web preview.

> **Single-context plan.** Drives only one Playwright browser context
> (the user previewing their own profile). The dual-context screenshot
> helper at `./dual-context-screenshots.md` intentionally does not
> apply here; no sibling `*.results.md` template ships alongside this
> plan.

This plan covers task #694. Task #673 made the user's own
`FullProfileModal` mirror the per-skin "show last initial only"
privacy toggle by rendering their name as `First L.` so they could
preview what others see. Without context that read like the app had
dropped the user's last name, so #694 added a discreet inline hint
beneath the rendered name explaining the privacy state and
deep-linking to the toggle on the active outward-account editor.
This plan exercises that hint end-to-end: flip the per-skin flag on,
open `FullProfileModal`, assert the hint is visible alongside the
shortened name, tap it, and confirm the navigation lands on the
outward-account editor's privacy row. The negative case (flag off →
hint absent) is also covered.

## Context

- Source under test:
  - `artifacts/round-house/components/FullProfileModal.tsx` — owns the
    "Profile" preview screen for the signed-in user. Renders
    `formatOwnerNameForSkin(profile.name, activeOutwardAccount.lastInitialOnly)`
    inside the `<Text testID="full-profile-display-name">` row. When
    `shouldShowSelfPrivacyHint(activeOutwardAccount.lastInitialOnly)`
    is `true`, renders a `<Pressable testID="full-profile-privacy-hint">`
    immediately below it with a Feather `lock` icon, the literal copy
    `Privacy: last initial only · Change`,
    `accessibilityRole="link"`, and
    `accessibilityLabel="Privacy: last initial only. Open privacy settings."`.
    Tapping the pressable calls `onClose()` then
    `router.push('/account/edit/${activeOutwardAccount.id}')`.
  - `artifacts/round-house/lib/ownerNameDisplay.ts` —
    `shouldShowSelfPrivacyHint(flag)` returns `flag === true` (false
    for `false`/`null`/`undefined`), so the hint is suppressed in
    every other state.
  - `artifacts/round-house/components/OutwardAccountForm.tsx` — the
    deep-link target. The privacy toggle is a `Pressable` with
    `accessibilityRole="button"`,
    `accessibilityLabel="Show only my last initial on this account"`,
    and `accessibilityState.checked` reflecting the current
    `lastInitialOnly` value. Visible row label text is
    `Show only my last initial on this account`.
  - `artifacts/round-house/app/account/edit/[id].tsx` — renders
    `OutwardAccountForm` with `lockKind` for the OA whose id is in
    the route, hydrating `lastInitialOnly` from `GET /api/outward-accounts/:id`
    and persisting changes via `PATCH /api/outward-accounts/:id`
    (`useUpdateOutwardAccount`).

- API endpoints exercised:
  - `GET   /api/users/me`
  - `GET   /api/outward-accounts/:id`
  - `PATCH /api/outward-accounts/:id`

## Precondition: FullProfileModal must be reachable from the running app

`FullProfileModal` is exported from `components/FullProfileModal.tsx`
but, at the time this plan was written, **no surface in
`app/(tabs)/...` mounts it**. The hint flow cannot be exercised end
to end until a trigger is wired up (the natural place is the
Profile tab — e.g. tapping the avatar / display-name area in
`app/(tabs)/profile.tsx` opens it as a self-preview).

The first concrete step below is therefore a guard: if the runner
cannot find a way to open the modal from the running app, it must
report `unable` rather than synthesizing a deep-link or shimming the
component into the page. The remainder of the plan assumes the
modal opens once that trigger is reachable.

## Reusable signed-in fixture

This plan reuses the Standard pre-onboarded Firebase fixture
documented in `e2e/README.md`:

| Env var pair | Role |
| --- | --- |
| `E2E_FIREBASE_EMAIL` / `E2E_FIREBASE_PASSWORD` | Pre-onboarded user with one `home` outward account titled `Standard E2E Home` set as `users.activeOutwardAccountId`. Lands on `/(tabs)` after sign-in. The OA's `lastInitialOnly` defaults to `false` (the seeder does not set the flag). |

Recreate / refresh the fixture with:

```sh
pnpm --filter @workspace/scripts run seed:standard-fixture
```

If `E2E_FIREBASE_EMAIL` or `E2E_FIREBASE_PASSWORD` is missing from
the environment, report `unable` instead of attempting a broken
sign-in.

This plan flips `lastInitialOnly` ON in step 4 and OFF again in
step 16 so the fixture is left in the same state it started in
(`false`). No counterpart accounts are needed — the hint flow is
purely about the signed-in user previewing their own profile.

## Plan

### A. Sign in and open the active outward-account editor

1. [New Context] Create a fresh browser context. Install a global
   `page.on('dialog')` handler that accepts every dialog
   (`dialog.accept()`).
2. [Browser] Navigate to `/(auth)/sign-in`. Sign in as
   `E2E_FIREBASE_*`. Wait for navigation to leave `/(auth)/sign-in`.
   If the URL settles on `/(onboarding)/...`, stop and report
   `unable` (the seeder did not set `identityCompletedAt`).
3. [Browser] Navigate to `/(tabs)/profile`. Wait for the identity
   hero to render (the user's display name is visible).
4. [Browser] Capture the user's full display name as it appears in
   the identity hero into a local variable `fullName`. Strip any
   trailing role-label suffix (e.g. " · Homeowner") so `fullName`
   contains just the human name. Compute `expectedShortName` from
   `fullName` using the same rule the renderer applies
   (`formatOwnerNameForSkin`):
   - Split on whitespace; trim and drop empty tokens.
   - If there is only one token, `expectedShortName = fullName` (no
     change).
   - Otherwise, take the last non-empty token, keep its first
     character (uppercased, locale-aware), and rebuild as
     `<all but last token joined by single spaces> <Initial>.`
     (note the trailing period). Example: `Jane Q Public` →
     `Jane Q P.`; `Standard E2E User` → `Standard E2E U.`.
   - If `fullName` is empty/whitespace, stop and report `unable`
     (the rest of the plan needs a non-empty name to assert against).

### B. Flip the per-skin "last initial only" toggle ON

5. [Browser] Navigate to `/account` (the account hub) and tap the
   row that opens the active outward account's editor (the row
   labeled `Standard E2E Home`). The route should land on
   `/account/edit/{activeOutwardAccountId}` with the form populated.
   If the hub does not expose a row for the active OA, navigate
   directly to `/account/edit/{id}` using the id read from
   `GET /api/users/me` → `activeOutwardAccountId`.
6. [Verify] The `Show only my last initial on this account` row is
   visible. Read its `accessibilityState.checked` (or the visual
   checkmark inside the leading checkbox). If it is already
   `true`, skip the next tap; otherwise tap the row to toggle it
   ON. The local `lastInitialOnly` form value flips immediately;
   the row's accessibility state should update to `checked: true`
   and the leading checkbox should fill with the primary color and
   show a check icon.
7. [Browser] Submit the form: tap `Save changes`. Wait for the
   `PATCH /api/outward-accounts/:id` request to complete with a
   `2xx` body containing `lastInitialOnly: true`. If the response
   is 4xx/5xx, surface the response body in the test output and
   fail.
8. [Verify] After the save, the editor either closes
   (`router.back()`) or the row remains rendered with
   `accessibilityState.checked: true`. Either way the in-memory
   profile cache picks the change up via the `GET /api/users/me`
   refresh that follows the PATCH (the active OA's
   `lastInitialOnly` is now `true`).

### C. Open FullProfileModal and assert the hint is visible (positive case)

9. [Browser] Navigate back to the Profile tab (`/(tabs)/profile`) so
   the active outward account just edited is the one
   `FullProfileModal` will read.
10. [Browser] Open `FullProfileModal` from the Profile tab. The
    intended trigger is a tap on the identity-hero avatar / display
    name area; if that surface isn't wired up yet, see the
    Precondition above and stop with `unable` — do **not** synthesize
    a deep-link or shim the component into the page. Wait for the
    modal to render with the header text `Profile` (an `X` close
    button on the left, an `Edit` text button on the right).
11. [Verify — shortened name + hint visible]
    - The element with `testID="full-profile-display-name"` is
      visible and its text starts with `expectedShortName` from
      step 4 (allow an optional ` · <Role>` suffix appended by
      `kindLabelForName`, e.g. `Standard E2E U. · Homeowner`).
      The original `fullName` substring must **not** appear in the
      element's text — the renderer must have shortened it.
    - The element with `testID="full-profile-privacy-hint"` is
      visible.
    - That element's visible text matches the regex
      `Privacy:\s*last initial only\s*·\s*Change` (a single line
      may wrap to two via `numberOfLines={2}`; assert against the
      concatenated text content).
    - The element exposes `accessibilityRole="link"` and
      `accessibilityLabel="Privacy: last initial only. Open privacy settings."`.

### D. Tap the hint and confirm navigation to the privacy toggle row

12. [Browser] Tap the `full-profile-privacy-hint` pressable.
13. [Verify — modal closes and route advances]
    - The `FullProfileModal` is no longer visible (the `Profile`
      header text disappears). The `onPress` handler calls
      `onClose()` synchronously before pushing the route.
    - The browser URL settles on `/account/edit/{activeOutwardAccountId}`
      (the same id resolved in step 5 / read from
      `GET /api/users/me`).
14. [Verify — privacy toggle row is the navigation target]
    - The `OutwardAccountForm` is visible (header / company-name /
      kind fields rendered).
    - The `Pressable` whose `accessibilityLabel` is exactly
      `Show only my last initial on this account` is present and
      has `accessibilityState.checked: true` (the value persisted
      in step 7 hydrated correctly from the server).
    - The visible label text `Show only my last initial on this
      account` is visible inside the same row.
    - (Soft) The leading checkbox glyph inside that row renders
      filled with a Feather `check` icon, mirroring the ON state.
15. [Browser] Navigate back to `/(tabs)/profile` (e.g. tap the form
    header back chevron, then the Profile tab) so the negative
    case starts from a known surface.

### E. Negative case — flag off, hint absent

16. [Browser] Open the OA editor again (`/account/edit/{id}`) and
    tap the `Show only my last initial on this account` row to
    toggle it back OFF. Tap `Save changes` and wait for the
    `PATCH /api/outward-accounts/:id` to return a `2xx` body
    containing `lastInitialOnly: false`. The fixture is now back
    in its original state.
17. [Browser] Navigate to `/(tabs)/profile` and re-open
    `FullProfileModal` via the same trigger used in step 10.
18. [Verify — full name restored + hint absent]
    - The element with `testID="full-profile-display-name"` is
      visible and its text contains the original `fullName` from
      step 4 (again allowing the optional ` · <Role>` suffix). The
      `expectedShortName` form (e.g. `Standard E2E U.`) must
      **not** appear in that element's text — without the trailing
      period the substring still occurs in the full name, so
      assert specifically against the trailing-period form
      (`/<Initial>\.\s*( ·|$)/`).
    - No element with `testID="full-profile-privacy-hint"` is
      present anywhere in the modal (`shouldShowSelfPrivacyHint(false)`
      returns `false`, so the entire `Pressable` is not rendered).
    - There is no `lock`-icon row, no "Privacy: last initial only"
      copy, and no element exposing
      `accessibilityLabel="Privacy: last initial only. Open privacy settings."`.
19. [Browser] Close `FullProfileModal` (tap the `X` in its header).
    Sign out (or close the context) so the next plan starts clean.

### Cleanup

20. The fixture's `lastInitialOnly` is back to `false` after step
    16. No additional cleanup is required. Re-running
    `pnpm --filter @workspace/scripts run seed:standard-fixture`
    is idempotent and will reset any drifted state on a future run.

## Regressions this catches

- `FullProfileModal` stops piping
  `activeOutwardAccount?.lastInitialOnly` into
  `formatOwnerNameForSkin(...)` (e.g. a refactor that drops the
  per-skin flag) → step 11's "shortened name" assertion fails
  because the rendered name is still the full name.
- `shouldShowSelfPrivacyHint` regresses to returning `true` for
  `false`/`null`/`undefined` (e.g. someone changes
  `flag === true` to a truthiness check that flips for missing
  OAs) → step 18's "hint absent" assertion fails.
- `shouldShowSelfPrivacyHint` regresses to returning `false` even
  when the flag is `true` → step 11's hint visibility assertion
  fails.
- The hint's `onPress` stops calling
  `router.push('/account/edit/${activeOutwardAccount.id}')` (e.g.
  loses the `${id}` template, drops the `/account/edit/` prefix,
  or routes elsewhere) → step 13's URL assertion fails.
- The hint's `onPress` stops calling `onClose()` before pushing →
  step 13's "modal no longer visible" assertion fails (the modal
  stacks on top of the editor route).
- `FullProfileModal` removes the
  `testID="full-profile-privacy-hint"` /
  `testID="full-profile-display-name"` testIDs → both visibility
  assertions fail.
- The hint copy / accessibility label drifts (e.g. "last initial
  only" changes to "shortened name") → step 11's regex /
  accessibility-label assertions fail.
- `OutwardAccountForm` renames or removes the
  `accessibilityLabel="Show only my last initial on this account"`
  on the privacy `Pressable` → step 14's deep-link target
  assertion fails, even if the URL itself still resolves.
- `app/account/edit/[id].tsx` stops hydrating the form's
  `lastInitialOnly` from the server response → step 14's
  `accessibilityState.checked: true` assertion fails (the row
  rehydrates to `false`).
- `PATCH /api/outward-accounts/:id` stops persisting
  `lastInitialOnly` (e.g. handler rejects the field, or the
  generated client drops it from the body) → step 7 fails with a
  4xx, or step 14 fails because the reload returns
  `lastInitialOnly: false`.

## Notes for native (iOS / Android) runs

- Sign-in uses the same `app/(auth)/sign-in.tsx` form on native;
  the standard fixture signs in via that screen.
- The `FullProfileModal` renders identically on native — locate
  the hint by `testID="full-profile-privacy-hint"` and the name by
  `testID="full-profile-display-name"`. The privacy toggle row in
  `OutwardAccountForm` is reachable on native by its
  `accessibilityLabel="Show only my last initial on this account"`.
- The `router.push` deep-link uses Expo Router's typed-routes
  string form, which works the same on native (it pushes a screen
  inside the same stack rather than changing a URL bar).

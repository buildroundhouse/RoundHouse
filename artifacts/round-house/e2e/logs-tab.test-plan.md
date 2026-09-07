# Logs tab — signed-in end-to-end test plan

Use with the project's UI testing tool (Playwright-driven). Run against the
Roundhouse Expo web preview.

> **Single-context plan.** Drives only one Playwright browser context
> (the signed-in user opening the Logs tab). The dual-context
> screenshot helper at `./dual-context-screenshots.md` does not apply
> in its full form, but this plan **does** opt in to that helper's
> "Single-context variant" — see the
> "Screenshot capture (single-context)" section below for the section
> labels the runner should produce. No sibling `*.results.md` template
> ships alongside this plan.

Covers the work shipped in task #456: the bottom tab bar's center slot is
now a real `Logs` tab (replacing the old raised camera FAB). The Logs page
hosts a primary `New Log` button, two quick-entry tiles (`Photo` + `Note`),
a search field, and an active-logs list. The `Photo` tile and the Timeline
camera glyph both open a "What log does this go to?" picker before the
photo composer mounts — a photo can never be saved without a destination
log.

## Context

- Sign-in route: `/(auth)/sign-in` (renders `app/(auth)/sign-in.tsx`).
  - Email field: `placeholder="you@example.com"`, `autoComplete="email"`.
  - Password field: `placeholder="Password"`, `autoComplete="current-password"`.
  - Submit button label: `Sign in` (becomes `Signing in...` while pending).
  - On success, the screen calls `router.replace("/(tabs)")`.
- Tab layout: `app/(tabs)/_layout.tsx` (classic web/Android) renders five
  bottom-bar slots in this order: **Timeline · Clients · [center] · My Team ·
  Profile**. The center slot context-switches by the active tab:
  - On **Profile**, it renders a real `Logs` tab (Pressable with
    `accessibilityLabel="Open Logs"`), giving a 5-item bottom bar with
    Logs in the middle. The floating `CaptureFAB` hides itself
    (`hideTrigger={isProfileActive}`) so the two don't collide.
  - On every other tab, the slot is an empty spacer and the floating
    `CaptureFAB` sits over it.

  The Logs screen lives at `app/(tabs)/logs.tsx` (route `name="logs"`,
  hidden via `href: null` from the tab strip itself — it's reached via
  the center-slot button on Profile, the Timeline side-tab "Open logs"
  shortcut, or any deep link to `/logs`).

  On iOS Liquid Glass (`NativeTabLayout`), only the four nav triggers
  are declared (Timeline, Clients, My Team, Profile) and the center
  Logs/FAB swap is not yet wired — exercise on classic Android or web
  for the full bar shape.
- Logs screen: `app/(tabs)/logs.tsx`.
  - Header text: `Logs`.
  - Primary button: `accessibilityLabel="Create a new log"`, visible label
    `New Log` (Feather `plus` icon).
  - Quick-entry tiles: `accessibilityLabel`s `Photo` and `Note`
    (Feather `camera` / `edit-3`).
  - Search input: `placeholder="Search logs"`.
  - Active-log row: `accessibilityLabel="Open log <name>"`. Each row shows
    the log name plus a meta line `<relative-time> · <n> entr(y|ies)`.
    For a freshly-created log the relative-time text is exactly
    `no activity yet` (see `formatRelative` in `logs.tsx`).
  - Sort order: most-recently-active first; logs with `lastActivity === 0`
    (i.e. brand-new with zero entries) sink to the bottom — **except** that
    a log created during this test will be the only one with zero entries
    and surfaces near the bottom; we filter by name to verify regardless
    of sort position.
- Photo destination picker (rendered inline in `logs.tsx` when `Photo` is
  tapped): a bottom sheet titled `What log does this go to?`. Each row is
  a `Pressable` whose first `Text` child renders the log name. There is a
  search field (`placeholder="Search logs"`) inside the sheet.
- Timeline camera glyph: `CameraIconButton` in `app/(tabs)/index.tsx` calls
  `openCapturePhoto()` exported from `components/CaptureFAB.tsx`. That
  helper opens a similar `PhotoLogPicker` modal whose title is also
  `What log does this go to?` — a photo can never be captured without
  picking a log first.
- Add-property modal (`AddPropertyModal`): name input, primary `Create`
  button. Creating a property is what materializes a "log" in this app.

## Reusable signed-in test fixture

Same fixture as `reminders-side-tab.test-plan.md`:

- `E2E_FIREBASE_EMAIL` — the seeded account email.
- `E2E_FIREBASE_PASSWORD` — the seeded account password.

The seeded user must have completed onboarding so sign-in lands directly
on Timeline (`/(tabs)`), not on `/(onboarding)/...`.

> If the secrets aren't present, the test must report `unable` rather than
> falling through to a broken sign-in.

## Screenshot capture (single-context)

This plan opts in to the slim variant of
`./dual-context-screenshots.md`. Configuration:

- **Plan slug** (storage directory): `logs-tab`
- **Short slug** (PNG file-name prefix): `logs-tab`
- **Storage directory**:
  `artifacts/round-house/e2e/screenshots/logs-tab/`
  — recreate empty at the start of every run.
- **Single context**: the signed-in standard fixture (no second
  context, so the file name has no `-<contextName>` suffix).
- **Section labels and what each PNG covers**:
  | Label | Capture point | What it pins down |
  | --- | --- | --- |
  | `tab-bar` | After step 7's `[Verify]` (while still on Profile) | Five-tab bottom bar (`Timeline · Clients · Logs · My Team · Profile`) with no floating capture FAB. The regression this whole plan exists to catch. The 5-tab shape only renders while Profile is the active tab — see the Context section's tab-layout note — so the capture has to happen here, before step 8 navigates away to `/logs`. |
  | `create-and-open` | After step 14's `[Verify]` | Logs list with the just-created `${logName}` row visible and matching the search filter. |
  | `photo-picker` | After step 19's `[Verify]` | Bottom-sheet `What log does this go to?` open with the user's logs listed — proves the Photo tile gates on a destination pick. |
  | `photo-composer` | After step 21's `[Verify]` | Photo composer open with the `WHERE IS THIS FOR?` pill bound to `${logName}`, not the default first-property fallback. |
  | `note-composer` | After step 25's `[Verify]` | Note composer open directly (no `What log does this go to?` sheet between tap and composer). |
  | `timeline-picker` | After step 31's `[Verify]` | Timeline-side `What log does this go to?` sheet open before the photo composer mounts. |
- **`[Verify]` failures**: capture the open context into
  `logs-tab-fail-<sectionLabel>.png` (e.g. `logs-tab-fail-tab-bar.png`)
  before tearing it down.

## Plan

1. [New Context] Create a new browser context. Install a global
   `page.on('dialog')` handler that accepts (`dialog.accept()`) any
   dialogs.
2. [Browser] Navigate to `/(auth)/sign-in`.
3. [Verify] The page renders the `Sign in` heading and an email +
   password form with a `Sign in` submit button.
4. [Browser] Type `E2E_FIREBASE_EMAIL` into the email field and
   `E2E_FIREBASE_PASSWORD` into the password field, then tap `Sign in`.
   Wait for navigation away from `/(auth)/sign-in`.
5. [Verify] The URL settles on `/(tabs)` (or `/`, the Timeline tab path) —
   **not** an `/(onboarding)/...` route. If onboarding shows, stop and
   report `unable` (stale fixture).
6. [Browser] Tap the `Profile` tab. The center-slot Logs shortcut only
   renders while Profile is the active tab (see the Context section's
   tab-layout note), so we have to be on Profile to verify the 5-tab
   shape this plan exists to catch.
7. [Verify] The bottom tab bar exposes exactly **five** tab entries with
   labels `Timeline`, `Clients`, `Logs`, `My Team`, `Profile`, in that order.
   There is **no** floating circular capture button in or above the bar.
   Capture `tab-bar` here (see "Screenshot capture (single-context)" —
   the 5-tab shape disappears the moment we leave Profile).
7a. [Browser] Tap the `Logs` center-slot button (accessible name
    `Open Logs`).
8. [Verify]
   - The URL ends with `/logs` (Expo Router maps `/(tabs)/logs.tsx` to
     `/logs`).
   - The screen header reads `Logs`.
   - A `New Log` button (accessible name `Create a new log`) is visible.
   - Two quick-entry tiles are visible with accessible names `Photo` and
     `Note`.
   - The `Search logs` input is visible.

### Create a log, see it appear, search for it, open it

9. [Browser] Note the current time — we'll use it later if needed. Tap
   the `New Log` button.
10. [Verify] An "Add property" modal is open with a name input.
11. [Browser] Generate a unique log name `${logName}` of the form
    `E2E Logs Tab ${nanoid(6)}`. Type it into the name input and tap the
    primary create button.
12. [Verify] The modal closes and the active-logs list now contains a row
    whose name is exactly `${logName}`. The row's meta line contains the
    text `no activity yet` (case-sensitive — that exact string is what
    `formatRelative` returns when `lastActivity <= 0`) and `0 entries`.
13. [Browser] Type the first 6 characters of `${logName}` into the
    `Search logs` input.
14. [Verify] The `${logName}` row remains visible. The empty-state
    message `No logs match your search` is **not** visible.
15. [Browser] Tap the `${logName}` row (accessible name
    `Open log ${logName}`).
16. [Verify] The URL becomes `/property/<numeric-id>` (the property
    detail screen). The page renders without an error overlay.

### Photo quick-entry routes through the picker

17. [Browser] Use the browser back button to return to the Logs tab.
    Clear the search field if anything is left in it.
18. [Browser] Tap the `Photo` quick-entry tile.
19. [Verify] A bottom-sheet picker opens with the title
    `What log does this go to?`. The sheet contains a `Search logs`
    input and a list of the user's logs. The `${logName}` row created
    above appears in the list.
20. [Browser] Type the first 6 characters of `${logName}` into the
    sheet's search field, then tap the matching row.
21. [Verify] The sheet closes and the photo composer opens (a modal with
    header `Add a photo` and a `Save` action). The `WHERE IS THIS FOR?`
    pill in the composer shows `${logName}` — i.e. the chosen log was
    pre-assigned, not the default first-property fallback.
22. [Browser] Tap the composer's close (X) button to dismiss without
    saving.
23. [Verify] We're back on the Logs tab.

### Note quick-entry opens the note composer directly (no picker)

24. [Browser] Tap the `Note` quick-entry tile.
25. [Verify] The composer opens directly with header `Add a note`. There
    is **no** `What log does this go to?` picker between the tap and the
    composer.
26. [Browser] Tap the composer's close (X) button to dismiss.
27. [Verify] We're back on the Logs tab.

### Timeline camera glyph also goes through the picker

28. [Browser] Tap the `Timeline` tab.
29. [Verify] The Timeline screen renders. The top-left camera glyph button
    (accessible name `Capture a photo`) is visible.
30. [Browser] Tap the `Capture a photo` button.
31. [Verify] A modal/sheet titled `What log does this go to?` opens —
    confirming the Timeline camera entry-point also forces a log selection
    before the photo composer can mount. The composer header
    `Add a photo` is **not** visible yet (the picker gates it).
32. [Browser] Dismiss the picker (tap outside the sheet / press the
    backdrop).
33. [Verify] We're back on Timeline with no composer open.

## Regressions this catches

- The center tab slot regresses to a floating capture FAB instead of a
  real `Logs` tab (step 7 fails — count != 5 or label missing on Profile).
- `app/(tabs)/logs.tsx` stops rendering the New Log / Photo / Note
  controls or the search input (step 8 fails).
- New logs no longer surface in the active list immediately after
  creation, or the `no activity yet` copy regresses (step 12 fails).
- The Logs-tab search filter breaks (step 14 fails).
- The Photo quick-entry skips the destination picker and jumps straight
  to the composer (step 19 fails) — a photo could be saved without a
  log, which the locked design forbids.
- The Photo picker's selection isn't propagated to the composer
  (`openCapturePhotoForLog` regresses) so the composer opens with the
  wrong / first-property log (step 21 fails).
- The Note quick-entry incorrectly shows the picker (step 25 fails) —
  notes are composer-internal and don't pre-assign a log.
- The Timeline camera glyph regresses to opening the composer directly
  without forcing a destination (step 31 fails).

## Notes for native (iOS / Android) runs

- Sign in via the same email/password screen on device.
- Bottom tab bar is the native `expo-router` `NativeTabs` on iOS; the
  five-tab order and labels are identical. Tap the `Logs` label to
  switch tabs.
- The `What log does this go to?` sheet is the same `Pressable`
  hierarchy and accessible-name surface; drivers that match by accessible
  name work without changes.
- The composer close button has `Feather name="x"` — match by tapping
  the top-left header icon (accessible role `button`).

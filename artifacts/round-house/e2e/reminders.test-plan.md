# Reminders screen — end-to-end test plan

Use with the project's UI testing tool (Playwright-driven). Run against the
Roundhouse Expo web preview.

> **Single-context plan.** Drives only one Playwright browser context
> (the user reading their own reminders). The dual-context screenshot
> helper at `./dual-context-screenshots.md` does not apply in its full
> form, but this plan **does** opt in to that helper's
> "Single-context variant" — see the
> "Screenshot capture (single-context)" section below for the section
> labels the runner should produce. No sibling `*.results.md` template
> ships alongside this plan.

## Context

- Route: `/reminders` (registered in the root Stack — reachable directly even
  when not signed in).
- Screen: `app/reminders.tsx`.
- Storage: `AsyncStorage` key `rh.reminders.v1`. On web this is
  `window.localStorage`.
- Side-tab entry point on Timeline (`app/(tabs)/index.tsx`) does
  `router.push("/reminders")`. The Timeline tab is gated behind Firebase sign-in,
  so this plan goes to `/reminders` directly. The signed-in side-tab path is
  covered by the sibling plan `reminders-side-tab.test-plan.md`, which signs
  in as a seeded Firebase test user and taps the `Open reminders` tab.
- Delete confirmation:
  - Web: `window.confirm("Delete reminder?\n\n<title>")`.
  - Native (iOS/Android): `Alert.alert("Delete reminder?", title, [...])`.
- Add modal "Remind me" options: Later today (4h), Tomorrow (24h),
  In 3 days (72h), Next week (168h).
- Snooze options: 1 hour, Tomorrow (24h), Next week (168h).

## Accessibility labels

- Header `+` button: `Add reminder`.
- Upcoming row checkbox: `Mark "<title>" done`.
- Completed row check icon: `Mark "<title>" not done`.
- Snooze button: `Snooze "<title>"`.
- Delete button: `Delete "<title>"`.

## Screenshot capture (single-context)

This plan opts in to the slim variant of
`./dual-context-screenshots.md`. Configuration:

- **Plan slug** (storage directory): `reminders`
- **Short slug** (PNG file-name prefix): `reminders`
- **Storage directory**:
  `artifacts/round-house/e2e/screenshots/reminders/`
  — recreate empty at the start of every run.
- **Single context**: the user reading their own reminders (no
  second context, so the file name has no `-<contextName>` suffix).
- **Section labels and what each PNG covers**:
  | Label | Capture point | What it pins down |
  | --- | --- | --- |
  | `empty` | After step 4's `[Verify]` | Initial empty state with the `Reminders` header, `No reminders yet` body, empty-state `Add reminder` button, and header `+`. |
  | `populated` | After step 8's `[Verify]` | UPCOMING section with both `Pick up keys` and `Buy paint`, with `Pick up keys` sorted first. |
  | `completed` | After step 10's `[Verify]` | COMPLETED section visible with `Pick up keys` dimmed + struck through + filled-check icon. |
  | `snooze-resort` | After step 14's `[Verify]` | UPCOMING re-sorted so `Pick up keys` is now after `Buy paint` (proves snooze rewrote the due time and the list re-sorted client-side). |
  | `final-empty` | After step 18's `[Verify]` | Empty state restored after both rows are deleted (negative guard for stale rows lingering in `localStorage`). |
  | `reminded-again` | After step 31's `[Verify]` | Single `Reminded again` pill rendered next to the due hint inside the `Pick up keys` row, and absent from the `Buy paint` row — the cardinality regression this section is for. |
- **`[Verify]` failures**: capture the open context into
  `reminders-fail-<sectionLabel>.png` (e.g.
  `reminders-fail-reminded-again.png`) before tearing it down.

## Plan

1. [New Context] Create a new browser context. Install a global
   `page.on('dialog')` handler that accepts (`dialog.accept()`) any dialogs.
2. [Browser] Navigate to `/reminders`.
3. [Browser] Run `localStorage.removeItem("rh.reminders.v1")`, then re-navigate
   to `/reminders` to re-mount the screen.
4. [Verify] Header reads "Reminders". Empty state visible: "No reminders yet"
   plus an "Add reminder" button. Header `+` is visible.
5. [Browser] Tap the empty-state "Add reminder" button. Type `Buy paint`,
   tap `Tomorrow`, tap `Add`.
6. [Verify] UPCOMING section appears with a `Buy paint` row showing a due hint
   like `in 24h` / `in 1d`.
7. [Browser] Tap the `+` header button. Type `Pick up keys`, tap `Later today`,
   tap `Add`.
8. [Verify] Both reminders are listed under UPCOMING; `Pick up keys` sorts
   before `Buy paint`.
9. [Browser] Tap the circular checkbox on `Pick up keys`.
10. [Verify] `Pick up keys` moved to a new COMPLETED section, dimmed with a
    strikethrough and filled check icon.
11. [Browser] Tap the filled check icon on the completed row to undo.
12. [Verify] COMPLETED section is gone; `Pick up keys` is back under UPCOMING.
13. [Browser] Tap the snooze (clock) icon on `Pick up keys`. In the sheet,
    tap `Next week`.
14. [Verify] Sheet closes; `Pick up keys` is now sorted after `Buy paint`
    (due hint roughly `in 7d` or a date).
15. [Browser] Tap the trash icon on `Buy paint`; the dialog handler accepts
    the confirm.
16. [Verify] `Buy paint` is removed; only `Pick up keys` remains.
17. [Browser] Tap the trash icon on `Pick up keys`; the dialog handler accepts
    the confirm.
18. [Verify] All reminders gone; empty state is shown again.
19. [Browser] Re-navigate to `/reminders` (in-app, no full reload).
20. [Verify] Empty state still shown — deletes persisted across remount.

## "Reminded again" retry pill

Covers task #441: when the API returns a reminder with `notifyCount > 1` (the
offline-retry from #434 has fired at least once), the reminders list renders a
small pill that reads `Reminded again` next to the due hint. The control case
(a fresh reminder with `notifyCount` 0 or 1) must NOT render the pill.

Because `notifyCount` is server-managed and the PATCH endpoint deliberately
doesn't accept it as input, we seed the elevated count by writing directly to
the `reminders` row in Postgres after creating it through the UI.

### Pill DOM contract

In `app/reminders.tsx`'s `ReminderRow`, the pill is wrapped in a `View` with:

- `accessibilityLabel="Reminded again because the first push didn't reach you"`
  (this maps to `aria-label` on web — match by accessible name).
- A child `Text` whose visible content is exactly `Reminded again`.

It is rendered **only** inside the row whose `notifyCount > 1`, sitting next
to the due-hint text in the same row's meta line.

### Prerequisites

- The signed-in fixture from `reminders-side-tab.test-plan.md` must be in
  place: `E2E_FIREBASE_EMAIL` / `E2E_FIREBASE_PASSWORD` Replit Secrets pointing
  at a seeded Firebase user that has finished onboarding.
- The API server workflow (`artifacts/api-server: API Server`) must be running
  so the round-house Expo client can read/write reminders.
- `DATABASE_URL` must be set in the Replit environment so the seed shell
  command can connect to the same Postgres the API server uses.

### Plan

21. [Shell] Read the test user's Firebase UID once. Run:

    ```
    pnpm --silent --filter @workspace/db exec tsx -e "
      const admin = require('firebase-admin');
      if (!admin.apps.length) {
        admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
      }
      admin.auth().getUserByEmail(process.env.E2E_FIREBASE_EMAIL).then(u => {
        process.stdout.write(u.uid);
      }).catch(e => { console.error(e); process.exit(1); });
    "
    ```

    Capture the printed UID as `$E2E_USER_UID` for the rest of this section.
    If the lookup fails (no admin SDK / no service account in the
    environment), fall back to step 21b instead of failing the run.

21b. [Fallback] If admin SDK isn't available, sign in via the UI (steps 1–4
    of the side-tab plan), then in the browser devtools run
    `localStorage.getItem('firebase:authUser:' + (await firebase.auth().app.options.apiKey) + ':[DEFAULT]')`
    — JSON-parse and read `.uid`. Stash that value as `$E2E_USER_UID`.

22. [Shell] Wipe any prior reminders for this fixture user so the row count
    is deterministic:

    ```
    pnpm --silent --filter @workspace/db exec tsx -e "
      const { db, remindersTable } = require('@workspace/db');
      const { eq } = require('drizzle-orm');
      db.delete(remindersTable)
        .where(eq(remindersTable.userClerkId, process.argv[1]))
        .then(() => process.exit(0));
    " "$E2E_USER_UID"
    ```

23. [Browser] Sign in following steps 2–5 of `reminders-side-tab.test-plan.md`,
    then navigate to `/reminders`. The empty state should be visible.
24. [Browser] Tap the empty-state `Add reminder` button. Type
    `Buy paint` (this is the **control** row), tap `Tomorrow`, tap `Add`.
25. [Browser] Tap the header `+` button. Type `Pick up keys` (this is the
    **retried** row), tap `Tomorrow`, tap `Add`.
26. [Verify] Both rows are listed under UPCOMING. Neither row exposes an
    element with accessible name
    `Reminded again because the first push didn't reach you`. The visible
    text `Reminded again` is absent from the page.
27. [Shell] Bump `notify_count` to `2` for `Pick up keys` only. Use a server
    timestamp for `notified_at` so the row matches what the real retry sweep
    would have produced:

    ```
    pnpm --silent --filter @workspace/db exec tsx -e "
      const { db, remindersTable } = require('@workspace/db');
      const { and, eq } = require('drizzle-orm');
      db.update(remindersTable)
        .set({ notifyCount: 2, notifiedAt: new Date() })
        .where(and(
          eq(remindersTable.userClerkId, process.argv[1]),
          eq(remindersTable.title, 'Pick up keys'),
        ))
        .returning({ id: remindersTable.id, notifyCount: remindersTable.notifyCount })
        .then(rows => {
          if (rows.length !== 1 || rows[0].notifyCount !== 2) {
            console.error('seed failed', rows);
            process.exit(1);
          }
          process.exit(0);
        });
    " "$E2E_USER_UID"
    ```

    The shell command must exit 0; if it doesn't, stop the test and report
    `unable` — without the seed there is nothing to assert.

28. [Browser] Re-navigate to `/reminders` (in-app navigation is fine — the
    list query refetches on focus). Wait for both rows to be visible again.
29. [Verify — retried row]
    - The `Pick up keys` row contains an element with accessible name
      `Reminded again because the first push didn't reach you`.
    - That element's visible text is exactly `Reminded again`.
    - The pill is rendered in the same row container as `Pick up keys`
      (i.e. the locator scoped to the `Pick up keys` row finds it).
30. [Verify — control row]
    - The `Buy paint` row does NOT contain any element with accessible name
      `Reminded again because the first push didn't reach you`.
    - The substring `Reminded again` does not appear inside the `Buy paint`
      row's container.
31. [Verify — page-wide cardinality] Across the whole page, exactly one
    element matches accessible name
    `Reminded again because the first push didn't reach you` (guards
    against the pill leaking into every row when the conditional regresses).
32. [Browser] Delete both reminders via the trash icon (the dialog handler
    from step 1 accepts the confirm). Verify the empty state returns.
33. [Shell] Belt-and-braces: re-run the wipe from step 22 so the fixture
    user has no leftover rows in `reminders` after the test.

### Regressions this catches

- API stops returning `notifyCount` (field undefined → `> 1` is false → step
  29 fails because the pill is missing).
- `notifyCount` is mis-typed as a string in the serializer (`"2" > 1` is
  false → step 29 fails).
- The conditional in `ReminderRow` is inverted or moved, so the pill renders
  on every row → step 30 / 31 fails.
- The accessibility label is dropped or renamed → step 29 fails.

## Notes for native (iOS / Android) runs

- Delete confirmation is `Alert.alert`; tap the destructive `Delete` button in
  the system alert instead of accepting a web `window.confirm`.
- Side-tab navigation from Timeline requires a signed-in test account. Sign in
  with a seeded Firebase test user, then tap the right-side `Reminders` tab
  before running steps 4 onward.
- The "Reminded again" pill section seeds via the same shell command — it is
  device-agnostic because it talks directly to Postgres. After the seed,
  pull-to-refresh the reminders list (or background/foreground the app) to
  force a refetch instead of doing an in-app re-navigation.

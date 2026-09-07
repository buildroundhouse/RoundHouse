# Destructive confirms on web (task #629)

Task #627 routed every destructive `Alert.alert` in the round-house app
through `lib/confirm.ts` so the dialog actually surfaces on
react-native-web (where bare `Alert.alert` is a no-op stub). Only the
intake **Start Over** flow (#626) had end-to-end coverage. This plan
exercises several of the other migrated destructive confirms on the web
build and asserts, for each one, that:

- the confirm dialog actually surfaces on web (a `window.confirm`
  modal — Playwright sees this as a `dialog` event of type `confirm`),
- clicking **Cancel** does NOT run the destructive action (no
  network call, no UI mutation), and
- clicking **Confirm** DOES run it.

If the dialog never fires (e.g. a regression where someone reverts a
call site back to bare `Alert.alert`, or the helper short-circuits to
`false` on web), the cancel branch will pass *and* the confirm branch
will fail — which is the regression signature this plan is built to
catch.

## How `lib/confirm.ts` maps to the browser

`artifacts/round-house/lib/confirm.ts` for `Platform.OS === "web"`
calls `globalThis.confirm(text)`. In Playwright that surfaces as a
`page.on("dialog")` event of type `"confirm"`, where:

- `dialog.accept()` resolves the helper to `true` → destructive action
  runs.
- `dialog.dismiss()` resolves the helper to `false` → destructive
  action is skipped.
- The `text` is `"<title>\n\n<message>"` (or just `<title>` when no
  message is supplied).

The plan installs a single `page.on("dialog")` handler per browser
context that, by default, **dismisses** every dialog and records what
it saw (title text + accept/dismiss decision) into a shared array.
Individual steps flip the policy to `accept` for the confirm-branch
assertions, then flip it back. Tests assert both:

1. The dialog handler actually fired with the expected title (proves
   the call site reached `confirm()` rather than the no-op stub).
2. The follow-on side effect (DELETE request, UI row removal, etc.)
   happened only on the accept path.

## Reusable signed-in fixtures

Several flows below need a signed-in account. They reuse the existing
seeded fixtures already documented in this directory's `README.md`:

| Env var pair | Used by | Context short name |
| --- | --- | --- |
| `E2E_FIREBASE_EMAIL` / `E2E_FIREBASE_PASSWORD` | Standard pre-onboarded Firebase user (lands in `/(tabs)`). Used by **Recurring task delete** (section B) and **Clear due date** (section D). | `standard` |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | A user with `users.is_admin = true`. Used by **Wardrobe avatar delete** (section A). Seeded by `pnpm --filter @workspace/scripts run seed:admin-fixture` — see the "Wardrobe-admin fixture" section in this directory's `README.md`. If unset, the wardrobe section is skipped (`unable`), not failed — the wardrobe screen `router.replace("/(tabs)")`s away from non-admins. | `wardrobe-admin` |
| `E2E_COMPANY_ADMIN_EMAIL` / `E2E_COMPANY_ADMIN_PASSWORD` | Reused from the company-notice fixtures (see this directory's README). Used by **Decline team invite** (section C) — sends the invite the member declines. | `company-admin` |
| `E2E_COMPANY_MEMBER_EMAIL` / `E2E_COMPANY_MEMBER_PASSWORD` | Reused from the company-notice fixtures. Used by **Decline team invite** (section C) — receives and declines the invite. | `company-member` |

API server (`artifacts/api-server: API Server`) and the round-house
Expo workflow (`artifacts/round-house: expo`) must both be running.

The "Context short name" column is the identifier the dual-context
screenshot helper uses when it names the per-step PNG files (see
"Screenshot capture" below).

## Screenshot capture

This plan opts in to the dual-context screenshot helper at
`artifacts/round-house/e2e/dual-context-screenshots.md`. The helper
defines the storage layout, file-name convention, and capture
cadence (failing-step + section-boundary + final-state). The runner
should follow it verbatim; everything below is the
plan-specific configuration.

- **Plan slug** (storage directory): `destructive-confirms`
- **Short slug** (PNG file-name prefix): `destructive-confirms`
- **Storage directory**:
  `artifacts/round-house/e2e/screenshots/destructive-confirms/`
  — recreate empty at the start of every run.
- **Context short names**: `wardrobe-admin` (section A),
  `standard` (sections B and D), `company-admin` and
  `company-member` (section C — both contexts open across the
  cancel and confirm branches). Declared on the fixtures table
  above.
- **Section labels**: `A. Wardrobe delete`, `B. Recurring task
  delete`, `C. Decline team invite`, `D. Clear due date`. Each
  section gets at least one paired snapshot at the section
  boundary; section C captures both the admin-side and the
  member-side context because that section is the only multi-
  context flow in the plan.
- **Sibling results file**:
  `artifacts/round-house/e2e/destructive-confirms.results.md`.
  After a run, fill in its "Per-step screenshots" table and
  "Run summary" table; the file already contains the full set
  of expected file paths so a reviewer can scan it without
  consulting this plan.

The helper requires a snapshot of every open context **on any
[Verify] failure**. For sections A / B / D (single context per
section) that means one PNG per failure. For section C, both the
admin and member contexts are open at the cancel + confirm
branches — capture both on any failure inside that section so the
reviewer can localize whether the regression is on the inviter
side, the responder side, or in the API the two share.

## Section A — Wardrobe: delete demo skin

- **File**: `app/account/wardrobe.tsx` (admin-only).
- **Confirm site**: `remove(p)` → `confirm({ title: "Delete this avatar?", message: "${displayName} (${role}) will be gone for good.", confirmLabel: "Delete", cancelLabel: "Keep", destructive: true })`.
- **Server effect on accept**: `DELETE /api/admin/demo-profiles/:id`.
- **Trash button accessibility label**: `Delete ${displayName}`.

### Steps

1. **[New Context]** Create a browser context. Install a
   `page.on("dialog")` handler that records every dialog and dismisses
   by default. Skip this section with status `unable` if the admin
   creds aren't set.
2. **[Browser]** Sign in as the admin via the UI. Navigate to
   `/account/wardrobe`. Wait for at least one hanger row to render (or
   the empty-state copy "The rack is empty.").
3. **[API]** Seed a fresh demo skin so the delete is non-destructive
   to other tests. `POST /api/admin/demo-profiles` with
   `{ "roleKind": "home", "displayName": "DCT-${nanoid(5)}" }` (pick
   any `roleKind` that is in `availableRoleKinds` from the GET; if
   none are free, just use the first existing skin and re-seed after
   the test). Note the returned `id` and `displayName`. Re-navigate to
   `/account/wardrobe` so the new row mounts.
4. **[Verify]** A hanger row containing the seeded `displayName` is
   visible, and exposes a `Delete ${displayName}` pressable.
5. **[Browser — cancel branch]** Tap the seeded row's
   `Delete ${displayName}` button. The recorded dialog must:
   - have type `"confirm"`,
   - have message text starting with `Delete this avatar?`,
   - and the handler must dismiss it (returns `false`).
6. **[Verify]**
   - No `DELETE /api/admin/demo-profiles/:id` request fired (asserted
     against the `request` log captured by the dialog setup step).
   - The seeded row is still present in the list (re-navigating to
     the screen still shows it).
7. **[Browser — confirm branch]** Flip the dialog handler to
   `accept`, tap the same `Delete ${displayName}` button.
8. **[Verify]**
   - One dialog event was recorded with title `Delete this avatar?`,
     and the handler accepted it.
   - A `DELETE /api/admin/demo-profiles/${seededId}` request fired
     and returned 2xx.
   - The seeded row is no longer present after the list reloads.

[Capture — section A] Per the dual-context screenshot helper
(`./dual-context-screenshots.md`), snapshot the wardrobe-admin
context now (it's the only context open in this section). Save as
`screenshots/destructive-confirms/destructive-confirms-stepA1-wardrobe-admin.png`
for the cancel-branch state (after step 6) and
`destructive-confirms-stepA2-wardrobe-admin.png` for the
confirm-branch state (after step 8). If any verify in this
section already failed, capture immediately at the failing step
instead of at the section boundary.

## Section B — Recurring task delete

- **File**: `components/RecurringTasksManagerModal.tsx`.
- **Confirm site**: `handleDelete(task)` → `confirm({ title: "Delete recurring task", message: "Stop generating \"${title}\"?", confirmLabel: "Delete", cancelLabel: "Cancel", destructive: true })`.
- **Server effect on accept**: the `useDeleteRecurringTask` mutation
  (`DELETE /api/properties/:propertyId/recurring-tasks/:taskId` —
  whatever the codegen emits; assert by URL pattern
  `recurring-tasks/${taskId}`).
- **Trash button**: rendered inline on each task card. The card has
  no explicit `accessibilityLabel`, so locate the trash icon by its
  position inside the row whose visible title equals the seeded
  task's title (the only `Pressable` with the trash glyph in that
  card's `cardHeader`).

### Steps

1. **[New Context + sign-in]** Reuse the standard pre-onboarded
   fixture (`E2E_FIREBASE_EMAIL`). Install the dialog handler in
   dismiss-by-default mode.
2. **[API]** Pick (or seed) a property the fixture user owns. The
   simplest path: `GET /api/properties/me` to read the first property
   id, call it `${propertyId}`. If the user has no property, seed one
   via `POST /api/properties` with a randomly generated name
   `RHE2E-${nanoid(5)}`.
3. **[API]** Seed a recurring task so we always have something to
   delete (and so the test does not destroy pre-existing fixtures):
   `POST /api/properties/${propertyId}/recurring-tasks` with
   `{ "title": "Sweep porch ${nanoid(5)}", "cadence": "weekly", "cadenceValue": 1 }`.
   Capture the returned `id` and `title`.
4. **[Browser]** Navigate to `/property/${propertyId}`, switch to the
   **Work** tab, tap the inline **Recurring** button (text label
   visible next to a `repeat` icon). The Recurring Tasks modal opens
   with a header reading `Recurring Tasks`.
5. **[Verify]** A card whose title equals the seeded task's title is
   visible.
6. **[Browser — cancel branch]** Tap the trash icon inside that
   card's header. The dialog handler dismisses; assert the recorded
   dialog message starts with `Delete recurring task`.
7. **[Verify]**
   - No `DELETE …/recurring-tasks/${seededId}` request was issued.
   - The seeded card is still in the modal.
8. **[Browser — confirm branch]** Flip the handler to accept, tap the
   trash icon again.
9. **[Verify]**
   - The dialog handler recorded one `Delete recurring task` event
     and accepted it.
   - A `DELETE` request matching `recurring-tasks/${seededId}`
     returned 2xx.
   - The seeded card is gone (the modal's list refetches).
10. **[API cleanup]** If the seeded property was created in step 2,
    `DELETE /api/properties/${propertyId}` to keep the fixture user
    clean.

[Capture — section B] Snapshot the standard context now (the only
context open in this section). Save as
`destructive-confirms-stepB1-standard.png` for the cancel-branch
state (after step 7) and `destructive-confirms-stepB2-standard.png`
for the confirm-branch state (after step 9). On any [Verify]
failure capture immediately at the failing step instead.

## Section C — Decline team invite

- **File**: `components/TeamInvitesBanner.tsx`.
- **Confirm site**: `handleDecline(leadClerkId, name)` → `confirm({ title: "Decline invite?", message: "Decline the team invite from ${name}?", confirmLabel: "Decline", cancelLabel: "Cancel", destructive: true })`.
- **Server effect on accept**: the `useDeclineTeamInvite` mutation
  (assert by URL pattern containing `team-invites` and method DELETE
  or PATCH — match whatever the api-client codegen produces).
- **Decline button accessibility label**: `Decline invite from ${name}`.

### Steps

1. **[New Context + admin sign-in]** Sign in as the company admin
   fixture (`E2E_COMPANY_ADMIN_EMAIL`).
2. **[Browser/API]** Send an invite to the company member fixture.
   The simplest deterministic way is via the API the UI uses (look at
   the codegen for the create-team-invite hook in
   `@workspace/api-client-react`; whatever endpoint it hits, call it
   from `[API]` with the same body the UI sends:
   `{ "username": "${memberUsername}", "role": "employee" }`). If
   the API path is uncertain, use the UI: open the team management
   sheet (`my-team` tab), invite the member by username, send.
3. **[Browser]** Sign out of the admin context. Open a fresh context
   and sign in as the **member** (`E2E_COMPANY_MEMBER_EMAIL`).
   Re-install the dialog handler (dismiss-by-default).
4. **[Browser]** Navigate to wherever `TeamInvitesBanner` mounts. It
   is shown on the profile / my-team area; in this codebase the
   banner renders on `(tabs)/profile.tsx` (and a couple of other
   spots). Navigate to `/(tabs)/profile`.
5. **[Verify]** The `TEAM INVITES` label is visible. A row showing
   the admin fixture's display name is present, with both
   `Decline invite from ${adminName}` and
   `Accept invite from ${adminName}` pressables.
6. **[Browser — cancel branch]** Tap `Decline invite from ${adminName}`.
   Dialog handler dismisses; assert the message starts with
   `Decline invite?`.
7. **[Verify]**
   - No decline request was issued (no API call matching
     `team-invites` with a destructive verb in the request log
     between the click and now).
   - The invite row is still present.
8. **[Browser — confirm branch]** Flip handler to accept; tap the
   decline button again.
9. **[Verify]**
   - One `Decline invite?` dialog was recorded and accepted.
   - The decline API call fired and returned 2xx.
   - The invite row is gone (the list refetches and either an
     updated `TEAM INVITES` count appears or the whole banner
     unmounts when invite count drops to zero).
10. **[API cleanup]** If anything else needs to be reset (e.g. the
    seat row), do it here. Declining is itself a cleanup.

[Capture — section C] This is the only multi-context section in the
plan. Snapshot **both** the company-admin and company-member
contexts at the section boundary so the reviewer can localize a
regression to the inviter side, the responder side, or the API
between them. Save as
`destructive-confirms-stepC1-company-admin.png` /
`destructive-confirms-stepC1-company-member.png` for the
cancel-branch state (after step 7) and
`destructive-confirms-stepC2-company-admin.png` /
`destructive-confirms-stepC2-company-member.png` for the
confirm-branch state (after step 9). On any [Verify] failure
capture both contexts immediately at the failing step.

## Section D — Clear due date

- **File**: `components/DueDatePickerModal.tsx`.
- **Confirm site**: the `Clear due date` `TouchableOpacity` →
  `confirm({ title: "Clear due date?", message: "Remove the due date for this job?", confirmLabel: "Clear", cancelLabel: "Cancel", destructive: true })`. The button only renders when both `onClear` is wired AND `initialDate` is non-null.
- **Side effect on accept**: the parent's `onClear()` runs, the modal
  closes, and the parent commits the cleared date (in CaptureFAB the
  picked due date is stored in local state until Submit; in
  WorkOrderEditorModal it is applied to the editor draft). The
  observable web symptom on accept is therefore: the modal closes and
  the field that previously displayed the date now shows the
  unset/no-date placeholder.

### Steps

1. **[New Context + sign-in]** Reuse the pre-onboarded Firebase
   fixture. Install the dialog handler.
2. **[Browser]** Open the `CaptureFAB` flow (the floating capture
   button on `/(tabs)`). Pick the **work order** path so the due-date
   picker is reachable. Choose any property/scope as needed to get to
   the form that exposes the **Set due date** affordance.
3. **[Browser]** Open the date picker, set a date a few days in the
   future, tap **Set due date**. The chosen date should now display
   on the form (this primes `initialDate` so the next open shows the
   `Clear due date` button).
4. **[Browser]** Re-open the date picker.
5. **[Verify]** A red-bordered `Clear due date` button is visible at
   the bottom of the modal.
6. **[Browser — cancel branch]** Tap `Clear due date`; dialog handler
   dismisses. Assert the recorded dialog message starts with
   `Clear due date?`.
7. **[Verify]** The modal is still open and the date input still
   reads the previously-set date (parent `onClear` did not run, modal
   did not close).
8. **[Browser — confirm branch]** Flip handler to accept; tap
   `Clear due date` again.
9. **[Verify]**
   - One `Clear due date?` dialog was recorded and accepted.
   - The modal closed.
   - Re-opening the picker now shows the field empty / placeholder
     start date and the `Clear due date` button is no longer
     rendered (because `initialDate` is null).
10. **[Browser cleanup]** Tap **Cancel** to close the picker. Discard
    the in-progress capture so no work order is actually submitted.

[Capture — section D / final state] Snapshot the standard context
now. Save as `destructive-confirms-stepD1-standard.png` for the
cancel-branch state (after step 7) and
`destructive-confirms-stepD2-standard.png` for the confirm-branch
state (after step 9). The post-cleanup state from step 10
satisfies the helper's "end-of-run final state" capture
requirement; reuse the stepD2 snapshot for that purpose unless the
cleanup itself changed the visible state.

## What this plan catches (summary)

- A regression that swaps any of the four `confirm()` call sites back
  to bare `Alert.alert` → on web the dialog never fires, so the
  recorded dialog count is 0 and the confirm-branch step fails.
- A regression where `lib/confirm.ts` short-circuits to `false` on
  web (e.g. someone removes the `globalThis.confirm` branch) → the
  confirm-branch DELETE never fires.
- A regression where the destructive action runs *without* awaiting
  the dialog → the cancel-branch step sees a DELETE request and
  fails.
- A regression that drops or renames the visible labels (`Delete
  ${displayName}`, `Decline invite from ${name}`, `Clear due date`)
  → the locator step fails before the dialog assertions even run.

## Latest end-to-end run status (web)

| Section | Last passed | Notes |
| --- | --- | --- |
| A — Wardrobe: delete demo skin | 2026-04-23 (task #633) | Required re-running `pnpm --filter @workspace/scripts run seed:admin-fixture` because the dev-DB admin row had drifted to `is_admin=false`. |
| B — Recurring task delete | 2026-04 (task #629) | — |
| C — Decline team invite | 2026-04-23 (task #633) | — |
| D — Clear due date | 2026-04 (task #629) | — |

Sections A–D are the only sections this plan covers. Earlier task notes
that referred to "Section E (delete work order)" or "Section F (delete
comment)" do not match this plan and were treated as label drift, not
missing content.

## Notes for native (iOS / Android) runs

On native, `Platform.OS !== "web"` so `lib/confirm.ts` falls back to a
real `Alert.alert`. The button-text and decision contracts are the
same — tap **Delete** / **Decline** / **Clear** in the system alert
where the web run accepts the `window.confirm`, and **Keep** /
**Cancel** where the web run dismisses. The "no DELETE on cancel" and
"DELETE on confirm" assertions are identical.

### Section D — Clear due date, native device runs

| Platform | Last run | Result |
| --- | --- | --- |
| iOS (real device) | 2026-04-23 (task #635) | blocked — no physical iOS device available in the agent sandbox. Static pre-flight from #634 still holds (see below); a human on hardware must execute the steps below and overwrite this row with `pass` / `fail`. |
| Android (real device) | 2026-04-23 (task #635) | blocked — no physical Android device available in the agent sandbox. Same as above: needs a human on hardware. |

**Static pre-flight check (task #634, re-confirmed task #635 2026-04-23):** the relevant code
paths were re-read end-to-end and look correct for native:

- `lib/confirm.ts` uses `Alert.alert` on `Platform.OS !== "web"` with
  two buttons — `cancelLabel` mapped to `style: "cancel"` (resolves
  `false`), `confirmLabel` mapped to `style: destructive ? "destructive" : "default"`
  (resolves `true`) — plus an `onDismiss` that resolves `false`. No
  typos in the style strings (`"cancel"` and `"destructive"` are the
  only values React Native accepts; anything else throws on iOS).
- `components/DueDatePickerModal.tsx` calls `confirm({ title: "Clear due date?",
  message: "Remove the due date for this job?", confirmLabel: "Clear",
  cancelLabel: "Cancel", destructive: true })` and only invokes
  `onClear()` + `onClose()` when the helper resolves `true`.
- `Clear due date` is only rendered when both `onClear` is wired and
  `initialDate` is non-null, matching what the web plan exercises.

A device run is still required to confirm the Alert actually surfaces
(the failure mode this task is meant to catch — e.g. a future Alert
plumbing or RN-version regression — is invisible from static reads).
Steps for the human running it:

1. On a real iOS device, open the app, hit the floating capture
   button on `/(tabs)`, pick the **work order** path, open the date
   picker, set a date a few days out, tap **Set due date**.
2. Re-open the date picker. The red-bordered `Clear due date` button
   must be visible.
3. Tap `Clear due date`. The system alert must appear with title
   `Clear due date?`, message `Remove the due date for this job?`,
   and two buttons labelled `Cancel` and `Clear` (the latter
   rendered red as the iOS "destructive" style).
4. Tap **Cancel**. The modal must stay open and the date field must
   still show the previously-set date.
5. Tap `Clear due date` again, then **Clear**. The modal must close
   and re-opening the picker must show the placeholder/no-date state
   with no `Clear due date` button rendered.
6. Repeat the entire flow on a real Android device. The buttons
   should read `Cancel` and `Clear` (Android does not visually style
   destructive buttons differently, but the text and behaviour must
   match).
7. Fill in the table above with the run date and `pass` / `fail`. If
   the alert never appears, the wrong button text is shown, or
   tapping `Cancel` clears the date anyway, file a code-fix task and
   link it from the failing row.

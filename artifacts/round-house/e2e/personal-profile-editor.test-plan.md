# Personal Profile editor (task #567)

> **Single-context plan.** Drives only one Playwright browser context
> (the editor signed in to their own account). The dual-context
> screenshot helper at `./dual-context-screenshots.md` does not apply
> in its full form, but this plan **does** opt in to that helper's
> "Single-context variant" — see the
> "Screenshot capture (single-context)" section below for the section
> labels the runner should produce. No sibling `*.results.md` template
> ships alongside this plan.

The Personal Profile screen at `app/account/personal.tsx` must edit the raw
user-table fields (name / email / phone) — never the active outward account's
overlay — and must surface the server's email-format validation error when
the user enters something malformed.

The companion API route is `PUT /api/users/me/personal` in
`artifacts/api-server/src/routes/users.ts`. Its behaviour is already covered
by API-level tests; what was missing is a UI-driven check that the screen:

1. reads from `/users/me/personal` (the non-hydrated endpoint) rather than
   `/users/me` (which overlays the active account's intake_data);
2. writes back to `/users/me/personal` and the change persists across a
   relaunch; and
3. shows the `Invalid email address` message when the email regex fails,
   without mutating the DB.

## Automated coverage

`tests/e2e/personal-profile-editor.spec.ts` walks the full flow on web:

- **Setup.** Sign up a fresh Firebase user, seed the users row with raw
  name / email / phone, then create two outward accounts:
  - `home` (fallback for the cross-account check).
  - `trade_pro`, with `intake.phone` and `intake.contactEmail` set to
    *different* values from the raw row. This is the active account.
- **A. Reads raw values.** Open `/account/personal`. Assert the displayed
  Full name, Email, and Phone match the raw users row. Assert the
  trade_pro overlay's `phone` and `contactEmail` values do NOT appear.
- **B. Edit + Save persists.** Tap "Edit personal info", fill new
  name / email / phone, tap Save, wait for the `PUT /users/me/personal`
  to return 200. Assert the editor closes, the new values render, and
  the DB row reflects them.
- **C. Hard reload.** Reload the page (relaunch proxy) and re-open
  `/account/personal`. Assert the new values still render.
- **D. Cross-account.** Flip `users.last_active_mode_id` /
  `active_outward_account_id` to the `home` outward account, re-open the
  screen. Assert the same persisted values still render — proves the
  screen is not coupled to the active outward account.
- **E. Negative — malformed email.** Re-enter edit mode, type
  `not-an-email`, tap Save. Assert:
  - the API returns `400 { error: "Invalid email address" }`;
  - the editor stays open (Save button still rendered);
  - the users row's `name` / `email` / `phone` are unchanged from step B;
  - if `Alert.alert` was routed through `window.alert` and captured by
    the dialog handler, its message contains `Invalid email`. (RNW does
    not always route through `window.alert`, so this is best-effort.
    The hard guarantees above already prove the negative path.)

## Screenshot capture (single-context)

This plan opts in to the slim variant of
`./dual-context-screenshots.md`. Sections are already lettered A–E in
"Automated coverage" above, so the slim variant uses those letters
directly.

- **Plan slug** (storage directory): `personal-profile-editor`
- **Short slug** (PNG file-name prefix): `personal-profile-editor`
- **Storage directory**:
  `artifacts/round-house/e2e/screenshots/personal-profile-editor/`
  — recreate empty at the start of every run.
- **Single context**: the signed-in editor (no second context, so
  the file name has no `-<contextName>` suffix).
- **Section labels and what each PNG covers**:
  | Label | Capture point | What it pins down |
  | --- | --- | --- |
  | `A-reads-raw` | After section A's assertions | `/account/personal` rendering the raw `users` row values, with the trade_pro overlay's phone / contactEmail conspicuously absent. |
  | `B-edited` | After section B's `PUT /users/me/personal` returns 200 | Editor closed, the new name / email / phone visible on the read view. |
  | `C-after-reload` | After section C re-opens the screen post-reload | Same persisted values still rendering after a hard reload (proves the change wasn't only in client state). |
  | `D-cross-account` | After section D switches the active outward account to `home` | Same persisted values still rendering — proves the screen reads `/users/me/personal`, not the active overlay. |
  | `E-error` | After section E's malformed-email Save | Editor still open, `Invalid email address` error surfaced, raw row unchanged. |
- **`[Verify]` failures**: capture the open context into
  `personal-profile-editor-fail-<sectionLabel>.png` (e.g.
  `personal-profile-editor-fail-E-error.png`) before tearing it down.
  The cross-account leg (D) is especially failure-prone because a
  regression there silently couples the screen back to the overlay,
  and the failure PNG makes "which account is active" obvious from
  the rendered fields.

## Manual / device follow-up

Out of scope for this automated spec, but worth a quick smoke on a real
phone after release: the iOS/Android `Alert.alert` modal renders natively,
not as a `window.alert`. The web run asserts the alert's *message text*;
on device the same code path should show a native alert with `Save failed`
as the title and `Invalid email address` as the body.

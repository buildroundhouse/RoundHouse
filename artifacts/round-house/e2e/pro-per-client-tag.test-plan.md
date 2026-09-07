# Pro per-client tag — end-to-end test plan

Use with the project's UI testing tool (Playwright-driven). Run against the
Roundhouse Expo web preview.

This plan covers task #524: a Trade Pro signs in, opens the Clients tab,
taps the **Tag** affordance on a client row, picks a service title and an
on-site identity inside `ConnectionTagModal` (mode `pro-self-tag`), saves,
and the row's inline `You show up as: <Service · Identity>` preview
appears, persists across a refresh, and can be edited (including the free
text "Other…" branch).

## Context

- Sign-in route: `/(auth)/sign-in` (renders `app/(auth)/sign-in.tsx`).
  Form selectors: `placeholder="you@example.com"` for email,
  `placeholder="Password"` for password, submit button text `Sign in`.
- Clients tab route: `/(tabs)/clients` (renders `app/(tabs)/clients.tsx`).
  The bottom-tab label is `Clients` and the tab is registered in
  `app/(tabs)/_layout.tsx`. The pro fixture lands on Timeline directly
  after sign-in (onboarding is pre-completed in Postgres by the seed) so
  the tab strip is visible immediately.
- Modal: `ConnectionTagModal` (`components/ConnectionTagModal.tsx`) —
  opened in `mode="pro-self-tag"`. Header reads `How do you show up?`.
  Save button text is `Save`. Sections: `Service title` (chips drawn
  from `users.services[].name`) and `On-site identity` (chips:
  `Contractor`, `Handyman`, `Specialist`, `Technician`, `Vendor`,
  `Other…`). Picking `Other…` reveals a `Describe…` text input.
- API: `PATCH /users/me/connections/:id` (in
  `artifacts/api-server/src/routes/users.ts`) writes `serviceTitle`,
  `onSiteIdentity`, and `onSiteIdentityOther` to the to-side row of the
  matching `user_connections` row. The Clients list refetches via
  `queryClient.invalidateQueries({ queryKey: ["/api/users/me/relationships"] })`
  after the modal calls `onSaved`.

## Accessibility / DOM contract

- Tag affordance on each Client row in `clients.tsx`:
  - Visible text alternates between `Tag` (no current self-tag) and
    `Edit tag` (preview line is non-empty).
  - `accessibilityRole="button"`, `accessibilityLabel` is either
    `Tag yourself for <client name>` or
    `Change how you show up for <client name>`.
- Preview line (only rendered when at least one of `serviceTitle` /
  `onSiteIdentity` resolves to non-empty text):
  - Visible text starts with literal `You show up as: ` followed by the
    composed `Service · Identity` line. (`composeLabelChipLine` joins
    them with ` · ` when both are present and falls back to whichever
    is set otherwise.)

## Reusable signed-in test fixture

This plan needs **two** Firebase users, but it only ever drives a
SINGLE browser context (the pro signs in; the client is DB-only and
never opens a Playwright context). The dual-context screenshot
helper still applies — it just records every per-section PNG with
the same context short name `pro` and reports the missing client
context as `(n/a)` in the sibling results file.

- A pro fixture (`E2E_PRO_TAG_PRO_*`, context short name `pro`)
  whose `users` row is fully onboarded, has two service entries
  (`Plumbing` and `HVAC`) on `users.services`, owns one
  `outward_accounts` row of `kind=trade_pro`, and has
  `lastActiveModeId` / `activeOutwardAccountId` pointed at that
  trade-pro account so sign-in lands directly on Timeline.
- A "client" fixture (`E2E_PRO_TAG_CLIENT_*`, no browser context —
  DB-only) with a `users` row and one `outward_accounts` row of
  `kind=home`. The home user does not need to be onboarded — it
  only exists as the to-side of the connection.

Both fixtures plus the connecting `user_connections` row (status
`accepted`, `kind=client`, all self-tag fields cleared) are produced
idempotently by `pnpm --filter @workspace/scripts run seed:pro-tag-fixture`.
The seed prints the email/password pairs at the end and uses defaults
when the corresponding env vars are absent. Defaults used by this plan:

- `E2E_PRO_TAG_PRO_EMAIL=e2e-pro-tag-pro@roundhouse-e2e.test`
- `E2E_PRO_TAG_PRO_PASSWORD=ProTagE2E!Pro-2026`
- `E2E_PRO_TAG_CLIENT_EMAIL=e2e-pro-tag-client@roundhouse-e2e.test`
- `E2E_PRO_TAG_CLIENT_PASSWORD=ProTagE2E!Client-2026`

The client fixture's `users.name` is `Pro Tag E2E Client` — that is the
exact string used to locate the row in the Clients list and to compose
accessibility labels like `Tag yourself for Pro Tag E2E Client`.

## Screenshot capture

This plan opts in to the dual-context screenshot helper at
`./dual-context-screenshots.md`. Read the helper first; this
section only pins the per-plan specifics:

- **Plan slug** (storage directory): `pro-per-client-tag`
- **Short slug** (PNG file-name prefix): `pro-per-client-tag`
- **Storage directory.**
  `artifacts/round-house/e2e/screenshots/pro-per-client-tag/`
  (recreated empty at the start of every run by the helper).
- **File-name convention.**
  `pro-per-client-tag-step<Letter>-<context>.png`, where `<Letter>`
  is the section letter the capture sits at the boundary of (`A`,
  `B`, `C`, `D`) and `<context>` is the short name pinned in the
  fixtures bullets above. Example:
  `pro-per-client-tag-stepA-pro.png`. Only the `pro` context is
  ever opened in a browser; the client fixture exists DB-side
  only, so every section's `<no second context>` slot is
  reported as `(n/a)` in the sibling results file (we still keep
  the dual-context-style header so the file structure matches
  the rest of the suite).
- **Capture cadence.** Per the helper:
  1. on each in-section failed assertion before any retry,
  2. at every section boundary marked below with
     `[Capture — section X]`, and
  3. at the very end of the run regardless of pass / fail.

## Plan

### A. Sign-in and base "no tag yet" state

1. [Shell] Run the seed so both Firebase users exist, the pro is fully
   onboarded with two services, an `outward_accounts` row + the
   `user_connections` row are in place, and any prior self-tag fields
   are cleared so the test starts in the "no tag yet" state:

   ```
   pnpm --filter @workspace/scripts run seed:pro-tag-fixture
   ```

   The command must exit 0. If it doesn't, stop and report `unable` —
   the test cannot proceed without the fixture.

2. [New Context] Create a fresh browser context. Install a global
   `page.on('dialog')` handler that accepts every dialog
   (`dialog.accept()`).

3. [Browser] Navigate to `/(auth)/sign-in`. Fill the email field with
   `e2e-pro-tag-pro@roundhouse-e2e.test` (or the value of
   `E2E_PRO_TAG_PRO_EMAIL` if set in the env) and the password field
   with `ProTagE2E!Pro-2026` (or `E2E_PRO_TAG_PRO_PASSWORD`). Tap
   `Sign in` and wait for navigation away from `/(auth)/sign-in`.

4. [Verify] The URL settles outside `/(auth)/sign-in` and outside any
   `/(onboarding)/...` route. If onboarding shows, the seed didn't
   land — stop and report `unable`.

5. [Browser] Navigate to `/(tabs)/clients` (or tap the bottom tab
   labelled `Clients`). Wait for the list to render.

6. [Verify] A row with the visible name `Pro Tag E2E Client` is
   rendered under the `CLIENTS` group header. The row exposes a
   button with accessible name `Tag yourself for Pro Tag E2E Client`
   whose visible text is `Tag`. The row does NOT contain the literal
   text `You show up as:` (no preview before the first save).

   `[Capture — section A]` — `pro-per-client-tag-stepA-pro.png`.
   The single context (`pro`) sits on `/(tabs)/clients` with the
   `Pro Tag E2E Client` row showing the bare `Tag` affordance and no
   `You show up as:` preview. The client fixture is DB-only and is
   reported as `(n/a)` in the sibling results file.

### B. Open modal and save the first per-client tag

7. [Browser] Tap the `Tag yourself for Pro Tag E2E Client` button.

8. [Verify] The `How do you show up?` modal is visible. Both `Plumbing`
   and `HVAC` chips are rendered under `Service title`. All six
   `On-site identity` chips are visible (`Contractor`, `Handyman`,
   `Specialist`, `Technician`, `Vendor`, `Other…`). No `Describe…`
   input is shown yet (because `Other…` isn't selected).

9. [Browser] Tap the `Plumbing` chip, then the `Specialist` chip, then
   tap `Save`. Wait for the modal to close.

10. [Verify] The modal is gone. The `Pro Tag E2E Client` row now shows
    the literal preview text `You show up as: Plumbing · Specialist`.
    The Tag button's visible text changed to `Edit tag` and its
    accessible name changed to
    `Change how you show up for Pro Tag E2E Client`.

    `[Capture — section B]` — `pro-per-client-tag-stepB-pro.png`. The
    Clients list re-renders with the new `You show up as: Plumbing ·
    Specialist` preview line and the `Edit tag` affordance. Client
    context is `(n/a)` in the sibling results file.

### C. Reload to prove server persistence

11. [Browser] Reload the page (full reload, not in-app navigation).
    Re-sign-in if the reload bounced back to `/(auth)/sign-in`, then
    navigate to `/(tabs)/clients`.

12. [Verify] The `Pro Tag E2E Client` row still shows
    `You show up as: Plumbing · Specialist` and still exposes
    `Edit tag` / `Change how you show up for Pro Tag E2E Client`.
    This proves the PATCH persisted to the server, not just to local
    component state.

    `[Capture — section C]` — `pro-per-client-tag-stepC-pro.png`. Same
    Clients list as section B but captured AFTER the full page reload,
    so the screenshot is the durable proof that the row was hydrated
    from the server (not just from in-memory state). Client context is
    `(n/a)` in the sibling results file.

### D. Edit tag, switch service, exercise the `Other…` free-text branch

13. [Browser] Tap the `Edit tag` (a.k.a.
    `Change how you show up for Pro Tag E2E Client`) button to reopen
    the modal.

14. [Verify] The modal is open. The `Plumbing` chip and the
    `Specialist` chip are pre-selected (visually distinct from the
    other chips — they pull the primary border + filled background in
    `ChipPill`).

15. [Browser] Tap the `HVAC` chip (changing the service), tap the
    `Other…` chip under `On-site identity`, type `Lead inspector` into
    the revealed `Describe…` input, then tap `Save`. Wait for the
    modal to close.

16. [Verify] The `Pro Tag E2E Client` row now shows
    `You show up as: HVAC · Lead inspector`.

17. [Browser] Reload the page once more. Navigate to
    `/(tabs)/clients` if needed.

18. [Verify] The row still shows
    `You show up as: HVAC · Lead inspector` after the reload — the
    free-text `Other…` branch persisted too.

    `[Capture — section D]` — `pro-per-client-tag-stepD-pro.png`. The
    Clients list shows the updated `You show up as: HVAC · Lead
    inspector` preview after the reload, proving the `Other…`
    free-text branch wrote `onSiteIdentityOther` to the server. This
    is also the helper's "end-of-run final state" capture for the
    `pro` context. Client context is `(n/a)` in the sibling results
    file.

## Cleanup

19. [Shell] Re-run the seed so the connection's tag fields are cleared
    again, leaving the fixture in its baseline state for the next run:

    ```
    pnpm --filter @workspace/scripts run seed:pro-tag-fixture
    ```

## Regressions this catches

- The Tag affordance disappears or stops opening `ConnectionTagModal`
  in `pro-self-tag` mode (steps 6–9 fail).
- The PATCH endpoint stops accepting `serviceTitle` / `onSiteIdentity` /
  `onSiteIdentityOther` from the to-side caller (step 9 errors, step
  10 preview missing).
- `composeLabelChipLine` regresses on the curated identity chips so the
  preview no longer renders `Plumbing · Specialist` (step 10 fails).
- The `relationships` query stops invalidating after the save, so the
  preview only updates on full reload but not in-flight (step 10 fails
  even though step 12 still passes).
- The `Other…` branch stops writing `onSiteIdentityOther` to the
  database — the preview after step 15 falls back to `Other` instead of
  the typed `Lead inspector` and step 16 / step 18 fail.

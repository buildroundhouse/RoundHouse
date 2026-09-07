# Blocked banner kind picker — e2e (#645)

## Why this exists

#643 introduced the inbox blocked-banner Team-up CTA, but it hard-coded
`kind: "collaborator"` when firing the team-up request. The public
profile modal already shows a sheet that lets the viewer classify the
relationship (Client / Core / Collaborator) before sending. #645
extracts that chooser into a shared component (`ConnectionKindChooser`)
and surfaces it from the inbox banner so power users get the same
fidelity. Collaborator stays the recommended/default pick so the common
one-tap path is unchanged.

## Setup

1. Sign in as `userA`.
2. Ensure `userC` exists with a profile but **no** accepted connection
   to/from `userA` in either direction (so the banner will appear after
   a failed send).

## Reusable signed-in fixtures

The 2026-04-24 validation log below ran this plan against the
existing seeded teammate-chip fixtures, which are the canonical
seeded pair for this directory:

| Env var pair | Role | Context short name |
| --- | --- | --- |
| `E2E_TEAM_CHIP_VISITOR_EMAIL` / `E2E_TEAM_CHIP_VISITOR_PASSWORD` | **Visitor** (`userA`) — homeowner skin. Opens the public profile modal / inbox blocked banner and fires the team-up request. | `visitor` |
| `E2E_TEAM_CHIP_ADMIN_EMAIL` / `E2E_TEAM_CHIP_ADMIN_PASSWORD` | **Admin / recipient** (`userC`) — `trade_pro` skin (`Team Chip E2E Co`). Receives the team-up request on `/invites`. | `admin` |

Both accounts are pre-onboarded; if either secret is missing,
report `unable` instead of attempting a broken sign-in. The
"Context short name" column is the identifier the dual-context
screenshot helper uses when it names the per-step PNG files (see
"Screenshot capture" below).

## Screenshot capture

This plan opts in to the dual-context screenshot helper at
`artifacts/round-house/e2e/dual-context-screenshots.md`. The helper
defines the storage layout, file-name convention, and capture
cadence (failing-step + section-boundary + final-state). The runner
should follow it verbatim; everything below is the
plan-specific configuration.

- **Plan slug** (storage directory): `blocked-banner-kind-picker`
- **Short slug** (PNG file-name prefix): `blocked-banner`
- **Storage directory**:
  `artifacts/round-house/e2e/screenshots/blocked-banner-kind-picker/`
  — recreate empty at the start of every run.
- **Context short names**: `visitor` and `admin` (declared on the
  fixtures table above). Both contexts stay open across the four
  sections so a regression on either side can be triaged from the
  same paired snapshot.
- **Section labels**: `A. Picker opens with Collaborator
  highlighted, fires connect with picked kind`,
  `B. Collaborator path remains the quick default`,
  `C. Picker dismiss leaves no side-effects`,
  `D. Public profile modal chooser is unchanged`.
- **Sibling results file**:
  `artifacts/round-house/e2e/blocked-banner-kind-picker.results.md`.
  After a run, fill in its "Per-step screenshots" table and
  "Run summary" table; the file already contains the full set of
  expected file paths so a reviewer can scan it without consulting
  this plan.

The visitor and admin contexts are open simultaneously throughout
all four sections (the validation log records that the admin
`/invites` screen is consulted after each section to confirm the
recipient-side row state). Capture both contexts at every section
boundary so the reviewer can localize a regression to the
visitor-side picker, the admin-side invites screen, or the
`/connect` API the two share.

## Section A — picker opens with Collaborator highlighted, fires connect with picked kind

1. As `userA`, open the public profile modal for `userC` and tap
   `Message`.
2. In the inbox composer, type any draft and tap Send.
3. **Expect**: the send fails and the inline banner with `testID`
   `team-up-blocked-banner` appears with the `Team up` CTA
   (`testID` `team-up-cta`).
4. Tap `Team up`.
5. **Expect**: a bottom sheet (`testID` `team-up-kind-chooser`) slides
   up with three rows — Add as Collaborator, Add as Client, Add as
   Core — in that order. The `Add as Collaborator` row has a
   `Recommended` badge next to its title.
6. Tap `Add as Client` (`testID` `connection-kind-client`).
7. **Expect**: the sheet closes, the CTA shows a spinner then becomes
   `Requested`/disabled, and a team-up request is posted to the server
   with `kind: "client"`. (Verify by signing in as `userC` and
   checking the pending team-up surface — the request should display
   as a `Client` classification.)

[Capture — section A] Per the dual-context screenshot helper
(`./dual-context-screenshots.md`), snapshot both contexts now.
Save as `screenshots/blocked-banner-kind-picker/blocked-banner-stepA-visitor.png`
(visitor's inbox banner with the CTA settled on `Requested`) and
`blocked-banner-stepA-admin.png` (admin's `/invites` showing the
new pending row classified as Client). On any [Verify] failure,
capture both immediately at the failing step instead.

## Section B — Collaborator path remains the quick default

1. Repeat steps 1–4 from Case 1 with a fresh test user pair.
2. In the picker, tap `Add as Collaborator`
   (`testID` `connection-kind-collaborator`) — the first row.
3. **Expect**: the sheet closes and the team-up request is posted
   with `kind: "collaborator"`, matching the previous one-tap
   behavior. The CTA becomes `Requested`/disabled. No regression.

[Capture — section B] Snapshot both contexts now. Save as
`blocked-banner-stepB-visitor.png` (visitor inbox CTA settled on
`Requested`) and `blocked-banner-stepB-admin.png` (admin
`/invites` row, classified as Collaborator). On any [Verify]
failure capture both immediately at the failing step.

## Section C — picker dismiss leaves no side-effects

1. Open the inbox blocked banner (steps 1–3 from Case 1).
2. Tap `Team up` to open the picker.
3. Tap the backdrop (outside the sheet) or hit the system back button
   to dismiss.
4. **Expect**: the sheet closes, no network request is fired, the CTA
   stays enabled and labelled `Team up`, and the banner remains
   visible. Tapping `Team up` again re-opens the picker.

[Capture — section C] Snapshot both contexts now. Save as
`blocked-banner-stepC-visitor.png` (visitor inbox banner — picker
dismissed, CTA still enabled and labelled `Team up`) and
`blocked-banner-stepC-admin.png` (admin `/invites` showing **no**
new row from this dismiss — the side-effect-free invariant). On
any [Verify] failure capture both immediately at the failing step.

## Section D — public profile modal chooser is unchanged

1. Open the public profile modal for `userC` (or any non-connected
   user).
2. Tap `Connect`.
3. **Expect**: the same chooser sheet appears with the original copy
   (`Why are you connecting?` / `Choose the relationship that best
   fits.`) and **no** `Recommended` badge — the public-profile flow
   intentionally does not pre-recommend a kind.
4. Pick any kind and confirm the connection is created. (Regression
   guard: the chooser was extracted, not behaviorally changed, on this
   surface.)

[Capture — section D / final state] Snapshot both contexts now.
Save as `blocked-banner-stepD-visitor.png` (visitor's public
profile modal closed after a successful Connect — connection
created) and `blocked-banner-stepD-admin.png` (admin `/invites`
row freshly inserted with the picked kind). This satisfies the
helper's "end-of-run final state" capture requirement.

## Notes / non-goals

- The chooser is the same React component
  (`components/ConnectionKindChooser.tsx`) on both surfaces. Visual
  parity should be exact aside from the `Recommended` badge and
  contextual title/subtitle on the inbox surface.
- Selecting a kind dismisses the sheet first, then fires
  `connectToUser`. The banner's spinner/`Requested` states come from
  the same `useConnectToUser` mutation as before.
- The `selectedKind` (check-mark) prop is only used by the public
  profile modal's "Change relationship" path, where the user is
  already connected — the inbox banner only ever shows when no
  accepted connection exists, so no row should ever have a check.

## Validation log

- 2026-04-24 — Cases 1–4 executed end-to-end via the project's
  Playwright-based UI testing tool against the Expo web preview
  (`react-native-web`), in two side-by-side browser contexts (one
  signed in as the visitor `userA`, one signed in as the recipient
  trade pro `userC` / `Team Chip E2E Co`). Fixtures used the seeded
  `E2E_TEAM_CHIP_VISITOR_*` / `E2E_TEAM_CHIP_ADMIN_*` accounts.
  Per #644 the inbox renders the blocked banner pre-emptively from
  `canMessage: false`, so the visitor just deep-links to
  `/inbox/<adminClerkId>?compose=1` and the banner is already visible
  with the read-only composer; no message-send is required to
  trigger it. All four cases passed:
  - **Case 1 — Client.** Chooser opened with Collaborator pinned to
    the top with the `Recommended` badge; Client and Core listed
    below without the badge. Picking Client closed the sheet, the
    CTA spun and settled on `Requested`, exactly one
    `user_connections` row landed with `kind='client'` /
    `status='pending'`, and the recipient's `/invites` screen
    (admin context) showed a row in the `Team-up requests` section
    for the visitor with the standard `Accept request from …` /
    `Decline request from …` / `Ignore request from …` action labels.
  - **Case 2 — Collaborator (default path).** Same flow, picked the
    recommended Collaborator row. Exactly one
    `user_connections` row landed with `kind='collaborator'` /
    `status='pending'` and the request again surfaced on the admin
    `/invites` screen.
  - **Case 3 — Backdrop dismiss.** Chooser opened, dismissed via the
    backdrop / Escape key. Banner stayed visible, CTA stayed
    `Team up` (not `Requested`), `user_connections` between the pair
    was empty (`n=0`), and the admin `/invites` screen showed no row
    for the visitor — confirming the dismiss path is fully
    side-effect free.
  - **Case 4 — Public profile modal regression guard.** Visitor
    searched `Team Chip E2E Co` from `/find`, opened the public
    profile modal, tapped Connect. The chooser used the default
    `Why are you connecting?` title and `Choose the relationship
    that best fits.` subtitle, kept its static `KIND_OPTIONS` order
    (Client / Core / Collaborator), and rendered no `Recommended`
    badge or check marks. Picking Core landed exactly one
    `user_connections` row with `kind='core'` / `status='pending'`
    and the request surfaced on the admin `/invites` screen — proving
    the public-profile-modal entry point still routes through the
    same `POST /users/:userId/connect` plumbing.

  Recipient kind classification (Client / Core / Collaborator) was
  asserted via the `user_connections.kind` column rather than the
  recipient row UI, because the current `TeamUpRow` in
  `app/invites.tsx` does not render the kind label as visible text
  (the kind is only on the underlying `TeamUpRequest` API payload).
  Surfacing the kind in the row UX is a separate UX gap.

  **Mobile-target caveat.** The project's testing tool drives a web
  browser only; the Expo native build pipeline documented in
  `NATIVE_BUILDS.md` is not yet validated in this environment
  (tracked separately as #510). The Expo web preview exercises the
  same React Native component code (`Modal`, `Pressable`, `Text`,
  `View`, the chooser, the inbox screen) compiled through
  `react-native-web`, so the picker logic under test is identical;
  only the underlying renderer differs. A real iOS / Android
  device pass therefore remains valuable and is filed as
  follow-up #653.

- 2026-04-24 — **#653 native device pass: pending manual hardware
  run.** The agent environment assigned to #653 has no iOS
  Simulator, no Android emulator, no `adb` / `xcrun` access, and
  no EAS / Apple Developer / Play Console credentials, so it
  cannot produce or install the `development`-profile builds
  described in `NATIVE_BUILDS.md`. Per the task owner's direction
  the native pass will be executed by-hand by a tester with the
  right hardware; this entry exists so the gap is not silently
  lost. When the manual run completes, append a dated entry below
  for each platform with: build profile (e.g. `development` /
  `development-device`), device or simulator model + OS version,
  and a short pass/fail note for each of Cases 1–4 — paying
  particular attention to:
  - Case 3's Android system-back dismiss path (the chooser uses
    `Modal`'s `onRequestClose`, which only fires on Android).
  - Case 1/2's bottom-sheet safe-area inset on a notched iPhone
    (the sheet pads its bottom by `insets.bottom + 16`).
  - The "Recommended" pill in Case 1 rendering on the same row
    as `Add as Collaborator` on a small phone width without
    truncating the title.

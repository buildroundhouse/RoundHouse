# Finder → operator-skin Connect flow — end-to-end test plan

Use with the project's UI testing tool (Playwright-driven). Run against
the Roundhouse Expo web preview.

> **Single-context plan.** Drives only one Playwright browser context
> (the visitor running the Find flow). The dual-context screenshot
> helper at `./dual-context-screenshots.md` intentionally does not
> apply here; no sibling `*.results.md` template ships alongside this
> plan.

This plan covers task #680. Tasks #636 and #671 wired the picked
outward-account skin from a Finder row through `PublicProfileModal`:

- #636 — `GET /api/users/search` now returns one result row per
  non-collab outward account ("skin"). Each row carries the skin's own
  `outwardAccountId`, public face (`companyName ?? title ??
  displayName ?? @username`), and `activeModeKind` so the Finder UI
  renders one row per skin and sets the modal's `openTarget` to
  `{ clerkId, outwardAccountId }` when tapped.
- #671 — `GET /api/users/:clerkId?outwardAccountId=N` returns the
  picked skin's `counterpartOutwardAccount` (id / kind / title /
  displayName / companyName), and `PublicProfileModal` keys its
  React-Query cache by that OA id so two skins of the same person
  don't share an entry. The modal renders a header chip identifying
  the picked skin's company / role at the very top of the hero.

Unit coverage already exists for the API legs:

- `artifacts/api-server/src/routes/__tests__/users-search-operator-skins.test.ts`
- `artifacts/api-server/src/routes/__tests__/users-search-skin-only-and-initial.test.ts`

This plan exercises the end-to-end path that those unit tests can't:
the Finder search row → `openTarget` state → modal `queryKey` → header
chip render. A regression in any of those wires would silently break
which company the visitor thinks they're connecting to.

## Drift from the original task description

The task's second done criterion ("tap Connect → land on /invites with
the correct OA targeted") cannot be exercised end-to-end against the
current codebase:

- **`POST /api/users/:userId/connect` is now a 410 Gone stub** (see
  `artifacts/api-server/src/routes/users.ts` lines 606–655 — Task
  #663 retired the avatar-to-avatar `user_connections` paradigm in
  favor of entity membership at `/entities/:id/members`).
- **`PublicProfileModal` no longer renders a Connect button** — when
  the viewer has no `connection`/`myReverseConnection` row (which is
  always the case post-#663), the modal renders an
  entity-onboarding panel reading "Want to work with this person?
  People don't connect to people in Round House. Open one of your
  homes, facilities, or businesses and add them there."
  (`artifacts/round-house/components/PublicProfileModal.tsx` lines
  609–654).

So this plan covers the testable surface of #636 + #671 — the search
row → modal-header chip wiring — and asserts the absence of any legacy
`Connect` affordance so a regression that re-introduced it (and the
broken 410 round-trip) would be caught immediately. Re-introducing an
end-to-end Connect leg would require a separate task that either
restores `/users/:userId/connect` or wires a new
"add-this-skin-to-an-entity" CTA into the modal hero.

## Context

- Visitor entry point: `/find` (`artifacts/round-house/app/find.tsx`).
  Typing into the "Find people" bar (debounced 250ms via
  `useDebounced`) hits `GET /api/users/search?q=…` via
  `useSearchUsers`. Each result row keys on
  `${p.id}:${p.outwardAccountId ?? "none"}`, so multi-skin owners
  surface as separate rows. Tapping a row calls
  `setOpenTarget({ clerkId: p.clerkId, outwardAccountId: p.outwardAccountId ?? null })`.
- `PublicProfileModal` consumes `openClerkId` (visible/hidden gate)
  and `counterpartOutwardAccountId` (forwarded as the
  `?outwardAccountId=` query param). It calls
  `useGetUserById(clerkId, { outwardAccountId }, { queryKey: [`/api/users/${clerkId}`, counterpartOutwardAccountId ?? "self"] })`.
  The cache key is intentionally per-(clerk, OA) so a second pick
  for the same person but a different skin re-fetches and rebuilds
  the header chip from scratch.
- The header chip block (`PublicProfileModal.tsx` lines 327–367)
  reads `profile.counterpartOutwardAccount.companyName ?? title ??
  displayName` for the `name` half and
  `MODE_LABELS[counterpartOA.kind]` for the `role` half. It is
  positioned at the very top of the hero block, above the avatar
  image, so visitors see "which company am I about to deal with?"
  before anything else.
- API endpoints exercised:
  - `GET /api/users/me`
  - `GET /api/users/search?q=…`
  - `GET /api/users/:clerkId?outwardAccountId=…`

## Accessibility / DOM contract

- The "Find people" search input is the first input on `/find`,
  placeholder text begins with `Name or @username`. The input is
  reachable by `placeholder` substring on web.
- People search rows render the skin's public name as the primary
  text and a `Trade Pro` / `Facility Management` / etc. role tag
  pill on the same line (`PersonRow` in `app/find.tsx` lines
  606–667). Two rows owned by the same human render two separate
  `Pressable`s; the test selects each row by its visible company
  name.
- `PublicProfileModal`'s skin header chip renders a single
  horizontal pill at the top of the hero. Its `accessibilityRole`
  is `header` and its `accessibilityLabel` reads
  `Connecting to <name>, <role>` when both halves are present, or
  `Connecting to <name|role>` when one is missing
  (`PublicProfileModal.tsx` lines 337–342). The pill's visible text
  is `<companyName> · <roleLabel>` separated by a middle-dot when
  both are present.
- The modal header `X` (close) button is the first pressable inside
  the modal; tapping it fires `onClose` → `setOpenTarget(null)`.
- The modal's no-connection panel renders the heading text "Want to
  work with this person?" and the explanatory copy "People don't
  connect to people in Round House." There is **no** button labelled
  `Connect` anywhere inside the visitor view of the modal — this
  plan asserts that absence.

## Reusable signed-in fixtures

This plan uses two seeded Firebase accounts:

| Env var pair | Role |
| --- | --- |
| `E2E_FIREBASE_EMAIL` / `E2E_FIREBASE_PASSWORD` | Standard pre-onboarded homeowner (`E2E_FIREBASE_*`). The visitor side. Reuses the standard fixture seeded by `pnpm --filter @workspace/scripts run seed:standard-fixture` — see `artifacts/round-house/e2e/README.md`. |
| `E2E_OPERATOR_SKIN_OWNER_EMAIL` / `E2E_OPERATOR_SKIN_OWNER_PASSWORD` | Operator with two non-collab outward accounts: `Operator E2E Game Room` (`facilities`) and `Operator E2E Workshop` (`trade_pro`). Owner display name `Operator E2E Owner`, username `operator_e2e_owner`. Seeded by `pnpm --filter @workspace/scripts run seed:operator-skin-fixture`. |

Both accounts are pre-onboarded (`users.identity_completed_at` is set
and `avatarUrl` is non-empty) so the sign-in flow lands on `/(tabs)`
rather than `/(onboarding)/...`.

If either fixture's secret is missing, report `unable` instead of
attempting a broken sign-in.

The visitor account does **not** sign in as the operator at any point
— only `E2E_FIREBASE_*` actually authenticates. The operator account
must exist on Firebase + Postgres (via the seed script) so the
search/profile endpoints resolve their public face, but no plan step
signs in as them.

### Recreating the fixture

Run the idempotent seed script from the repo root:

```sh
pnpm --filter @workspace/scripts run seed:operator-skin-fixture
```

What the script does (see `scripts/src/seed-operator-skin-fixture.ts`):

1. Calls Firebase Auth REST `accounts:signUp` with the public
   `EXPO_PUBLIC_FIREBASE_API_KEY`. If `EMAIL_EXISTS`, falls back to
   `accounts:signInWithPassword` to recover the existing uid.
2. Upserts a `users` row keyed on the Firebase uid with
   `identityCompletedAt` set, a placeholder `avatarUrl`, and
   `visibility.team = true` so future plan extensions can fetch the
   public team list.
3. Upserts one `user_modes` + `outward_accounts` pair per skin
   (`facilities` → "Operator E2E Game Room" and `trade_pro` →
   "Operator E2E Workshop"). Both OAs carry
   `capability_state = "expanded"`.
4. Pins `users.activeOutwardAccountId` + `users.lastActiveModeId`
   at the facilities skin so the operator has a deterministic
   primary if they ever sign in (they don't in this plan).
5. Prints the email/password pair the test runner needs.

The script only PRINTS the credentials at the end — it does not
write them into the project environment. Copy the printed
`E2E_OPERATOR_SKIN_OWNER_EMAIL` / `E2E_OPERATOR_SKIN_OWNER_PASSWORD`
pair into the project's shared env vars (or secrets) yourself.

## Plan

### Setup

1. [Setup] Confirm `E2E_FIREBASE_EMAIL`,
   `E2E_FIREBASE_PASSWORD`, `E2E_OPERATOR_SKIN_OWNER_EMAIL`, and
   `E2E_OPERATOR_SKIN_OWNER_PASSWORD` are all set on `process.env`.
   If any is missing, report `unable` and exit — the seeder must be
   run and its credentials copied into env vars before this plan
   can execute.

### A. Visitor signs in and searches Finder

2. [New Context — Visitor] Create a fresh browser context. Install
   a global `page.on('dialog')` handler that accepts every dialog
   (`dialog.accept()`).
3. [Browser] Navigate to `/(auth)/sign-in`. Sign in with email +
   password using `E2E_FIREBASE_*`. Wait for navigation to leave
   `/(auth)/sign-in`. If the URL settles on `/(onboarding)/...`,
   stop and report `unable` — the standard fixture is not
   onboarded.
4. [Browser] Navigate to `/find`. Wait for the page heading
   `Find` to be visible.
5. [Browser] Type `Operator E2E` into the "Find people" input
   (placeholder begins with `Name or @username`). Wait at least
   400ms for the 250ms debounce + the `useSearchUsers` request to
   resolve.
6. [Verify — multi-skin operator surfaces as two distinct rows]
   - At least one row whose visible primary text contains
     `Operator E2E Game Room` is rendered under the people
     results, with a `Facility Management` role tag pill on the
     same row.
   - At least one row whose visible primary text contains
     `Operator E2E Workshop` is rendered under the people
     results, with a `Trade Pro` role tag pill on the same row.
   - Both rows share the same handle `@operator_e2e_owner` in
     their subtitle line. (If only one row appears, #636's
     skin-per-row JOIN regressed; if both rows show the owner's
     private name `Operator E2E Owner` instead of the company
     names, the public-face fallback regressed — fail.)

### B. Tapping the Workshop row surfaces the trade_pro header chip

7. [Browser] Tap the row whose primary text matches
   `Operator E2E Workshop`. Wait for `PublicProfileModal` to open
   — confirmed by the modal title `Profile` becoming visible at
   the top of the screen.
8. [Verify — Workshop header chip]
   - A header chip pill is visible at the top of the hero block,
     above the avatar image. Its visible text matches the regex
     `Operator E2E Workshop\s*·\s*Trade Pro`.
   - The pill's `accessibilityLabel` (or its first text node, on
     web) reads `Connecting to Operator E2E Workshop, Trade Pro`.
   - The hero `name` text below the avatar reads
     `Operator E2E Workshop` (the skin's public face is hoisted
     into `users.name` by the `/api/users/:clerkId` overlay).
   - **No** pressable whose visible text equals `Connect`,
     `Send team-up request`, or `Connect as ...` is rendered
     anywhere in the modal. The "Want to work with this person?"
     panel is visible instead, with copy beginning
     `People don't connect to people in Round House.`
9. [Verify — network] The most recent
   `GET /api/users/{operatorClerkId}` request carried an
   `outwardAccountId` query param matching the OA id of the
   Workshop skin (i.e. the request URL contains
   `?outwardAccountId=<workshopOAId>`). If the request fired
   without `outwardAccountId`, the Finder → `openTarget` →
   modal-prop wiring regressed — fail. (The clerkId/OA id can be
   recovered by sniffing the `/api/users/search` response in step
   5 and matching on `name === "Operator E2E Workshop"`.)
10. [Browser] Close the modal (tap the `X` in the modal header).
    Wait for the modal to disappear.

### C. Tapping the Game Room row surfaces the facilities header chip

11. [Browser] Tap the row whose primary text matches
    `Operator E2E Game Room`. Wait for `PublicProfileModal` to
    open.
12. [Verify — Game Room header chip]
    - A header chip pill is visible at the top of the hero block.
      Its visible text matches the regex
      `Operator E2E Game Room\s*·\s*Facility Management`.
    - The pill's `accessibilityLabel` (or its first text node, on
      web) reads
      `Connecting to Operator E2E Game Room, Facility Management`.
    - The hero `name` text below the avatar reads
      `Operator E2E Game Room`.
    - The chip text from the previous open (step 8) is **not**
      visible anywhere in the modal — proving the modal's
      per-OA cache key (`[`/api/users/${clerkId}`, outwardAccountId]`)
      isn't reusing a stale entry.
13. [Verify — network] The most recent
    `GET /api/users/{operatorClerkId}` request carried an
    `outwardAccountId` query param matching the OA id of the Game
    Room skin (i.e. the request URL contains
    `?outwardAccountId=<gameRoomOAId>`, distinct from the value
    asserted in step 9).
14. [Browser] Close the modal (tap the `X` in the modal header).

### Cleanup

15. Optional. Re-running the seed script is a no-op for the
    operator's outward accounts (idempotent on
    `(ownerClerkId, kind, sourceUserModeId)`), so no explicit
    cleanup is required between runs.

## Regressions this catches

- `PersonRow.onPress` stops setting `outwardAccountId` on
  `openTarget` (e.g. dropping back to `setOpenClerkId(p.clerkId)`)
  → step 9's `?outwardAccountId=` assertion fails because
  `PublicProfileModal` would call the bare `/api/users/:clerkId`.
- `PublicProfileModal` stops keying its query by
  `counterpartOutwardAccountId` (e.g. `queryKey: ["/api/users/...",
  "self"]` regardless) → tapping a different skin row second would
  hit a stale cache and step 12's chip text would still read
  `Operator E2E Workshop`.
- `GET /api/users/:clerkId` stops returning
  `counterpartOutwardAccount` for the supplied `outwardAccountId`
  → both header chips disappear; steps 8 and 12 fail on the
  visible-pill assertion.
- The header chip's display name fallback regresses to using
  `users.name` (the owner's private display name) instead of
  `companyName ?? title ?? displayName` → step 8 / step 12's chip
  text match fails because the regex pins the company name.
- `MODE_LABELS[kind]` mapping breaks for `trade_pro` or
  `facilities` → the role half of the chip becomes empty or wrong
  and the regex match fails.
- A regression that re-introduces the legacy `Connect` button into
  the visitor view of `PublicProfileModal` would be caught by
  step 8's "no `Connect` pressable" assertion. Re-introducing the
  button without restoring `POST /api/users/:userId/connect` would
  hand visitors a button that 410s on every tap.

## Notes for native (iOS / Android) runs

- Sign-in uses the same `app/(auth)/sign-in.tsx` form on native;
  `E2E_FIREBASE_*` signs in via that screen.
- `PublicProfileModal`'s header chip uses the same accessibility
  label on native, so locate it via accessibility identifiers
  scoped to the modal hero.
- Network-level assertions (steps 9 / 13) are best skipped on
  native runs — fall back to relying on the visible chip text and
  the absence/presence of cached values from prior opens.

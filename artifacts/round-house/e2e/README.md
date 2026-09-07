# Roundhouse end-to-end test plans

This directory holds the markdown test plans driven by the project's
Playwright-based UI testing tool. Each plan is self-contained and
references the seeded fixtures it needs in its own "Reusable signed-in
fixtures" section.

## Auto-seeded fixtures + post-merge CI gate

`scripts/post-merge.sh` (configured under `[postMerge]` in `.replit`)
is the project's only every-merge CI surface — there is no GitHub
Actions workflow. It runs after every task merge and is split into a
baseline phase (always) plus a `PublicProfileModal` phase that is
**path-conditional**: the seeds + e2e gate only fire when the merge
touches one of the modal's surfaces.

### When the modal CI gate fires

The gate triggers when `git diff --name-only HEAD~1 HEAD` matches any
of:

- `artifacts/round-house/**`            — the screens that mount `PublicProfileModal`
- `artifacts/api-server/**`             — the `GET /users/:id?outwardAccountId=…` route the modal reads
- `scripts/src/seed-picked-skin-banner-fixtures.ts`
- `scripts/src/seed-teammate-chip-fixtures.ts`
- `scripts/src/seed-pro-tag-fixtures.ts`
- `tests/e2e/*.spec.ts` / `tests/e2e/README.md` — the Playwright specs themselves
- `artifacts/round-house/e2e/**`        — the markdown test plans

If none of those paths change, the seeds and gate are skipped and the
hook exits in seconds. If `HEAD~1` can't be resolved (very first
commit), the gate runs as a safe default.

### What the gate does

1. Runs the three seeds below so every fixture the modal's regression
   suite depends on is in lockstep.
2. Runs `pnpm exec playwright test --list` over the matching specs —
   this compiles each spec, validates fixture imports + test
   registration, and exits non-zero on any regression that breaks
   discovery (broken imports, syntax errors, duplicate test ids,
   etc.). Full headed browser runs continue to happen via the
   project's testing tool against the same specs.
3. Runs `pnpm typecheck` on `@workspace/scripts` so the gate catches
   type regressions in the seed scripts the specs depend on. We
   deliberately do not typecheck `@workspace/round-house` or
   `@workspace/api-server` here — both currently carry pre-existing
   type errors outside the scope of #713 and adding them now would
   block every merge on unrelated tech debt; the Playwright `--list`
   step still compiles the spec files themselves and any types they
   import from the modal / API.

Specs the gate currently covers:

- `tests/e2e/teammate-chip-public-profile.spec.ts`
- `tests/e2e/per-client-pro-tag.spec.ts` / `pro-per-client-tag.spec.ts`
- `tests/e2e/public-profile-skin-avatar-swap.spec.ts`
- `tests/e2e/picked-skin-banner-swap.spec.ts` *(lands with follow-up
  task #714; the gate picks it up automatically the moment the file
  appears, no further script edits needed)*

### Seeded fixtures

| Seed | Plan(s) covered | Credential prefix |
| --- | --- | --- |
| `seed:teammate-chip-fixtures`       | `teammate-chip-public-profile.test-plan.md` (plus the `invites-open-chat` / `blocked-banner-kind-picker` plans that reuse the same accounts) | `E2E_TEAM_CHIP_*` |
| `seed:picked-skin-banner-fixtures`  | `picked-skin-banner-swap.test-plan.md` (task #699) | `E2E_PICKED_SKIN_*` |
| `seed:pro-tag-fixtures`             | `per-client-pro-tag.test-plan.md` / `pro-per-client-tag.test-plan.md` | `E2E_PRO_TAG_*` |

The `E2E_TEAM_CHIP_*` and `E2E_PICKED_SKIN_*` credential pairs are
stored under `[userenv.shared]` in `.replit` so they're available
everywhere the post-merge hook runs. The pro-tag seed prints
`E2E_PRO_TAG_*` for the test runner to pick up locally — wire them in
the same way if a future plan needs them in `[userenv.shared]`. Rotate
any of them by re-running the relevant seed locally and updating
`.replit` if the Firebase password changes — see the per-fixture
sections below.

## Standard pre-onboarded fixture

Several plans share a single "standard pre-onboarded Firebase user"
account that lands on `/(tabs)` after sign-in (i.e. `users.identityCompletedAt`
is set) and owns at least one property so plans that need a property
scope have something to operate on. Plans currently using it include:

- `reminders-side-tab.test-plan.md`
- `reminders.test-plan.md`
- `concierge-send-draft.test-plan.md` (sender)
- `ignore-team-up-request.test-plan.md`
- `cadence-toggle.test-plan.md`
- `logs-tab.test-plan.md`
- `destructive-confirms.test-plan.md` (Sections B and D)

| Env var pair | Role |
| --- | --- |
| `E2E_FIREBASE_EMAIL` / `E2E_FIREBASE_PASSWORD` | Pre-onboarded Firebase user with one `home` outward account ("Standard E2E Home", set as `users.activeOutwardAccountId`) and one property named "Standard E2E House". |
| `E2E_FIREBASE_TRADE_PRO_EMAIL` / `E2E_FIREBASE_TRADE_PRO_PASSWORD` | Trade Pro counterpart that the standard fixture has an accepted `kind="core"` connection to (Trade Pros bucket on the homeowner My Team tab). |
| `E2E_FIREBASE_FRIEND_EMAIL` / `E2E_FIREBASE_FRIEND_PASSWORD` | Friend / collaborator counterpart that the standard fixture has an accepted `kind="collaborator"` connection to (Friends & Collaborators bucket). |
| `E2E_FIREBASE_RETIRED_PRO_EMAIL` / `E2E_FIREBASE_RETIRED_PRO_PASSWORD` | Trade Pro counterpart whose primary outward account has been archived after the connection was created — surfaces as the muted "No longer active" / retired-counterpart row covered by `my-team-tab-message.test-plan.md` Case 2. |

Only the standard fixture actually signs in for the My Team plan;
the counterpart accounts only need to exist so the relationships
endpoint can resolve the to-side back to a real person record.

### Recreating the fixture

Run the idempotent seed script from the repo root:

```sh
pnpm --filter @workspace/scripts run seed:standard-fixture
```

What the script does (see `scripts/src/seed-standard-fixture.ts`):

1. Calls Firebase Auth REST `accounts:signUp` for the fixture email
   with the public `EXPO_PUBLIC_FIREBASE_API_KEY`. If `EMAIL_EXISTS`,
   falls back to `accounts:signInWithPassword` to recover the existing
   uid.
2. Upserts a `users` row keyed on the Firebase uid with
   `identityCompletedAt` set so router guards land sign-in on
   `/(tabs)` rather than `/(onboarding)/...`.
3. Ensures one `outward_accounts` row of kind `home` titled
   "Standard E2E Home" exists for the user, with
   `capability_state = "expanded"` so paid-capability gates
   (`requirePaidCapability`) pass for actions like creating recurring
   tasks, work orders, and structured logs. Points
   `users.activeOutwardAccountId` at it.
4. Ensures one `user_modes` row exists for the home outward account
   with `intakeCompletedAt` set, and points
   `users.lastActiveModeId` at it (router treats the mode intake as
   complete).
5. Ensures one `properties` row named "Standard E2E House" exists,
   owned by the user and scoped to that home outward account, and
   inserts an `owner` `property_members` row for the user (the
   property listing endpoint scopes by membership, so without this
   the property is invisible to its own owner).
6. Prints the email/password pair the test runner needs.

The script only PRINTS the credentials at the end — it does not write
them into the project environment. Copy the printed `E2E_FIREBASE_EMAIL` /
`E2E_FIREBASE_PASSWORD` pair into the project's shared env vars (or
secrets) yourself.

### Rotating the password

This script does not change passwords on existing Firebase users. To
rotate: reset (or delete) the user from the Firebase Console, export
the new `E2E_FIREBASE_PASSWORD` value, then re-run the script —
`signUp` will pick up the new password on the next run.

## Company-notice Nudge fixtures

The following plans share three Firebase Auth users seated on the same
`trade_pro` company outward account:

- `company-notices.test-plan.md`
- `company-notice-read-receipts.test-plan.md`
- `company-notice-read-receipts-sheet.test-plan.md`
- `company-notice-nudge.test-plan.md`

| Env var pair | Role on the company |
| --- | --- |
| `E2E_COMPANY_ADMIN_EMAIL` / `E2E_COMPANY_ADMIN_PASSWORD` | Owner of the `Nudge E2E Company` `trade_pro` outward account (implicit super-admin). Has `lastActiveModeId` + `activeOutwardAccountId` pinned to the trade_pro mode/OA so My Team renders the trade_pro layout (`companyKind === "trade_pro"`). |
| `E2E_COMPANY_MEMBER_EMAIL` / `E2E_COMPANY_MEMBER_PASSWORD` | Accepted, non-removed `team_seats` row with `isAdmin=false` and no `manageTeam`. Also seated on `user_team_members` (lead = admin, status `accepted`, role `employee`) so the My Team tab renders the row with a Message pill. |
| `E2E_COMPANY_ADMIN_2_EMAIL` / `E2E_COMPANY_ADMIN_2_PASSWORD` | Accepted `team_seats` row with `isAdmin=true` and `manageTeam=true`. Optional — the nudge plan's step E uses this for the cross-admin 24h rate-limit assertion. |
| `E2E_COMPANY_PENDING_EMAIL` / `E2E_COMPANY_PENDING_PASSWORD` | Pending teammate on the admin's `user_team_members` row (`status = "pending"`, role `manager`). Surfaces under **Trade Pro Teammates** with the `· Pending` suffix and **no** Message pill (covers `my-team-tab-message.test-plan.md` Case 3 trade-pro branch). |
| `E2E_COMPANY_CLIENT_EMAIL` / `E2E_COMPANY_CLIENT_PASSWORD` | Homeowner counterpart with one `home` outward account. To-side of an accepted `kind="client"` connection from the admin's trade_pro OA so they appear in the **Clients** bucket. |
| `E2E_COMPANY_SERVICE_EMAIL` / `E2E_COMPANY_SERVICE_PASSWORD` | Trade Pro counterpart with one `trade_pro` outward account. To-side of an accepted `kind="core"` connection with `classification="outside_service_provider"` so they appear in the **Outside Services** bucket. |
| `E2E_COMPANY_FRIEND_EMAIL` / `E2E_COMPANY_FRIEND_PASSWORD` | Friend / collaborator counterpart with one `collab` outward account. To-side of an accepted `kind="collaborator"` connection so they appear in the **Friends & Collaborators** bucket. |

Only the admin and member actually sign in for the existing nudge
plans; the pending / client / service / friend accounts only need
to exist so the relationships and team endpoints include them.

All accounts above are pre-onboarded (`users.identity_completed_at`
is set) so the sign-in flow lands on `/(tabs)` rather than
`/(onboarding)/...`.

### Recreating the fixtures

Run the idempotent seed script from the repo root:

```sh
pnpm --filter @workspace/scripts run seed:nudge-fixtures
```

What the script does (see `scripts/src/seed-nudge-fixtures.ts`):

1. For each fixture, calls Firebase Auth REST `accounts:signUp` with
   the public `EXPO_PUBLIC_FIREBASE_API_KEY`. If `EMAIL_EXISTS`, falls
   back to `accounts:signInWithPassword` to recover the existing uid.
2. Upserts a `users` row keyed on the Firebase uid, marking
   onboarding complete.
3. Ensures the admin owns one `outward_accounts` row of kind
   `trade_pro` with `company_name = "Nudge E2E Company"`.
4. Upserts `team_seats` for the member (non-admin) and admin 2
   (`isAdmin=true`, full permissions), both `accepted` and not removed.
5. Prints the email/password pairs the test runner needs.

The script only PRINTS the credentials at the end — it does not write
them into the project environment. Copy the printed `*_EMAIL` /
`*_PASSWORD` pairs into the project's shared env vars (or secrets)
yourself. The current values are already stored on this Repl; re-run
the script only if you rotate passwords or wipe the DB / Firebase
project.

## Wardrobe-admin fixture (destructive-confirms Section A)

`destructive-confirms.test-plan.md` Section A (delete a demo skin from
the admin Wardrobe screen) needs a signed-in user with
`users.is_admin = true`. None of the other fixtures have that flag set
(flipping it on the company-admin fixture would route them to the Admin
Hub instead of `/(tabs)` and break the company-notice plans), so this
plan uses its own dedicated fixture:

| Env var pair | Role |
| --- | --- |
| `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` | Firebase user whose `users` row has `is_admin=true`, `identityCompletedAt` set, and a non-empty `avatarUrl` so the root layout doesn't punt them into identity onboarding before they can navigate to `/account/wardrobe`. |

Recreate it with the matching idempotent seed script:

```sh
pnpm --filter @workspace/scripts run seed:admin-fixture
```

What the script does (see `scripts/src/seed-admin-fixture.ts`):

1. Calls Firebase Auth REST `accounts:signUp` with the public
   `EXPO_PUBLIC_FIREBASE_API_KEY`. If `EMAIL_EXISTS`, falls back to
   `accounts:signInWithPassword` to recover the existing uid.
2. Upserts the `users` row keyed on the Firebase uid with
   `isAdmin=true`, `identityCompletedAt=now()`, a placeholder
   `avatarUrl`, and the seeded `name`/`username`/`email`.
3. Prints the email/password pair the test runner needs.

The script only PRINTS the credentials — it does not write them into
the project environment. Copy the printed `E2E_ADMIN_EMAIL` /
`E2E_ADMIN_PASSWORD` into the project's shared env vars yourself. The
current values are already stored on this Repl; re-run the script only
if you rotate the password or wipe the DB / Firebase project.

## Facility Manager fixture (My Team tab facilities skin)

`my-team-tab-message.test-plan.md` covers three skins: homeowner,
trade pro, and facility manager. The homeowner and trade-pro skins
reuse the standard / Nudge fixtures above; the facilities branch has
its own dedicated fixture so the `companyKind === "facilities"` layout
of `app/(tabs)/my-team.tsx` can be exercised end to end without
flagging the case as deferred.

| Env var pair | Role |
| --- | --- |
| `E2E_FACILITIES_ADMIN_EMAIL` / `E2E_FACILITIES_ADMIN_PASSWORD` | Facility Manager. Owns the `Facilities E2E Operations` `facilities` outward account (set as `users.activeOutwardAccountId`, `capability_state = "expanded"`). |
| `E2E_FACILITIES_TEAMMATE_EMAIL` / `E2E_FACILITIES_TEAMMATE_PASSWORD` | Accepted teammate on the admin's `user_team_members` row (`status = "accepted"`, role `employee`). Surfaces under **Facility Teammates** with a Message pill. |
| `E2E_FACILITIES_PENDING_EMAIL` / `E2E_FACILITIES_PENDING_PASSWORD` | Pending teammate on the admin's `user_team_members` row (`status = "pending"`, role `employee`). Surfaces under **Facility Teammates** with the `· Pending` suffix and **no** Message pill. |
| `E2E_FACILITIES_FRIEND_EMAIL` / `E2E_FACILITIES_FRIEND_PASSWORD` | Owns one `collab` outward account and is the to-side of an accepted `kind = "collaborator"` `user_connections` row from the admin's facilities outward account, so they appear in the admin's **Friends & Collaborators** bucket. |

Only the admin actually signs in for the My Team plan; the teammate
/ pending / friend accounts only need to exist in `users` /
`user_team_members` / `user_connections` so the relevant API
responses include them. Their credentials are still printed for
completeness in case a future plan wants to drive either side.

### Recreating the fixture

Run the idempotent seed script from the repo root:

```sh
pnpm --filter @workspace/scripts run seed:facilities-fixture
```

What the script does (see `scripts/src/seed-facilities-fixture.ts`):

1. For each fixture, calls Firebase Auth REST `accounts:signUp` with
   the public `EXPO_PUBLIC_FIREBASE_API_KEY`. If `EMAIL_EXISTS`,
   falls back to `accounts:signInWithPassword` to recover the
   existing uid.
2. Upserts a `users` row keyed on the Firebase uid with
   `identityCompletedAt` set and a placeholder `avatarUrl` so router
   guards land sign-in on `/(tabs)` rather than `/(onboarding)/...`.
3. For the admin: upserts a `user_modes` row of kind `facilities`
   (with the operationKind / maintenanceGoals / teamSize fields the
   facilities intake schema declares) plus a matching
   `outward_accounts` row of kind `facilities` named
   "Facilities E2E Operations", and points
   `users.activeOutwardAccountId` + `users.lastActiveModeId` at
   them. Sets `capability_state = "expanded"` so paid-capability
   gates pass.
4. For the friend: upserts a `user_modes` + `outward_accounts` row
   of kind `collab` so the relationships endpoint can resolve the
   connection's to-side back to a real person record.
5. Upserts two `user_team_members` rows with the admin as lead — one
   accepted (role `employee`), one pending — pointing at the
   teammate / pending fixtures respectively.
6. Upserts one `user_connections` row from the admin's facilities
   outward account → the friend's collab outward account
   (kind `collaborator`, status `accepted`, classification null so
   it routes into Friends & Collaborators rather than Outside
   Services).
7. Prints the email/password pairs the test runner needs.

The script only PRINTS the credentials at the end — it does not
write them into the project environment. Copy the printed
`E2E_FACILITIES_*_EMAIL` / `E2E_FACILITIES_*_PASSWORD` pairs into
the project's shared env vars (or secrets) yourself.

### Rotating passwords

This script does not change passwords on existing Firebase users.
To rotate: reset (or delete) the user from the Firebase Console,
export the new value as the corresponding `*_PASSWORD` env var, then
re-run the script — `signUp` will pick up the new password on the
next run.

## Picked-skin banner swap fixtures

`picked-skin-banner-swap.test-plan.md` (task #699) needs one Trade
Pro owner with TWO `outward_accounts` skins (one with a `bannerUrl`,
one without) plus an `intake.headerImageUrl` set as the legacy
fallback banner on the underlying `user_modes` row, and one homeowner
visitor that opens the owner's public profile from a separate signed-in
context.

| Env var pair | Role |
| --- | --- |
| `E2E_PICKED_SKIN_OWNER_EMAIL` / `E2E_PICKED_SKIN_OWNER_PASSWORD` | Trade Pro owner. Has ONE `user_modes` row of kind `trade_pro` whose `intakeData.headerImageUrl = "/objects/uploads/picked-skin-e2e-owner-intake-banner"` (the legacy "owner intake banner"), and TWO `outward_accounts` rows: `Picked Skin BannerCo E2E` (`bannerUrl = "/objects/uploads/picked-skin-e2e-skin1-banner"`) and `Picked Skin NoBannerCo E2E` (`bannerUrl = NULL`). `users.activeOutwardAccountId` is pinned to the BannerCo skin and `users.lastActiveModeId` to the trade_pro mode so the legacy `/users/:userId` path (no `outwardAccountId` query param) resolves to the same intake banner. |
| `E2E_PICKED_SKIN_VISITOR_EMAIL` / `E2E_PICKED_SKIN_VISITOR_PASSWORD` | Homeowner visitor. The only fixture that actually signs in for this plan — opens the owner's public profile from a fresh signed-in context via the Find tab. |

Both accounts are pre-onboarded (`users.identity_completed_at` is
set) so the sign-in flow lands on `/(tabs)` rather than
`/(onboarding)/...`.

The seeded paths are NOT real uploads — they're synthetic
`/objects/uploads/picked-skin-e2e-*` tokens. The plan asserts those
substrings inside the rendered hero `<img src>` attribute (the
`<Image>` element carries `testID="public-profile-hero-banner"`), so
the underlying storage bytes never need to load for the test to pass.

### Recreating the fixtures

Run the idempotent seed script from the repo root:

```sh
pnpm --filter @workspace/scripts run seed:picked-skin-banner-fixtures
```

What the script does (see
`scripts/src/seed-picked-skin-banner-fixtures.ts`):

1. For each fixture, calls Firebase Auth REST `accounts:signUp` with
   the public `EXPO_PUBLIC_FIREBASE_API_KEY`. If `EMAIL_EXISTS`,
   falls back to `accounts:signInWithPassword` to recover the
   existing uid.
2. Upserts a `users` row keyed on the Firebase uid, marking
   onboarding complete and seeding a placeholder `avatarUrl` so
   router guards land sign-in on `/(tabs)`.
3. For the owner: upserts ONE `user_modes` row of kind `trade_pro`
   whose `intakeData` includes `headerImageUrl =
   "/objects/uploads/picked-skin-e2e-owner-intake-banner"` plus the
   minimum trade-pro intake fields (`companyName`, `trade`,
   `region`, `primaryZip`, `services`).
4. For the owner: upserts TWO `outward_accounts` rows of kind
   `trade_pro`, both keyed off the trade_pro mode via
   `sourceUserModeId`:
   - `Picked Skin BannerCo E2E` with
     `bannerUrl = "/objects/uploads/picked-skin-e2e-skin1-banner"`.
   - `Picked Skin NoBannerCo E2E` with `bannerUrl = NULL` (cleared
     on every re-run so the OA-without-banner case stays known-empty).
5. Pins the owner's `activeOutwardAccountId` at the BannerCo skin
   and `lastActiveModeId` at the trade_pro mode so the legacy
   `/users/:userId` snapshot path (used by case C, the
   business-row tap) reads the same intake banner.
6. Prints the email/password pairs the test runner needs.

The script only PRINTS the credentials at the end — it does not
write them into the project environment. Copy the printed
`E2E_PICKED_SKIN_*_EMAIL` / `E2E_PICKED_SKIN_*_PASSWORD` pairs into
the project's shared env vars (or secrets) yourself.

### Rotating passwords

This script does not change passwords on existing Firebase users.
To rotate: reset (or delete) the user from the Firebase Console,
export the new value as the corresponding `*_PASSWORD` env var,
then re-run the script — `signUp` will pick up the new password on
the next run.

## Per-client pro-tag fixtures

`per-client-pro-tag.test-plan.md` uses its own pair of seeded Firebase
users:

| Env var pair | Role |
| --- | --- |
| `E2E_PRO_TAG_PRO_EMAIL` / `E2E_PRO_TAG_PRO_PASSWORD` | Trade Pro that owns `Pro Tag E2E Co` and has a `Plumbing` service. |
| `E2E_PRO_TAG_CLIENT_EMAIL` / `E2E_PRO_TAG_CLIENT_PASSWORD` | Homeowner with a `home` outward account, pre-connected to the pro. |

Recreate them with the matching idempotent seed script:

```sh
pnpm --filter @workspace/scripts run seed:pro-tag-fixtures
```

The script also (re-)creates the `client → pro` (kind=core) and
`pro → client` (kind=client) `user_connections` rows in `accepted`
state with all tag fields cleared, so the test starts from a known
empty per-client tag.

### Rotating passwords

This script does not change passwords on existing Firebase users.
To rotate:

1. Reset (or delete) the user from the Firebase Console.
2. Export the new value as the corresponding `*_PASSWORD` env var.
3. Re-run the script — `signUp` will pick up the new password on the
   next run, then update the project env var to match.

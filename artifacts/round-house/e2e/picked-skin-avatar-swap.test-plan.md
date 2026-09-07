# Picked-skin avatar swap on the public profile — end-to-end test plan

Use with the project's UI testing tool (Playwright-driven). Run against the
Roundhouse Expo web preview.

> **Single-context plan.** Drives only one Playwright browser context
> (the visitor signed in to view the owner's public profile). The
> dual-context screenshot helper at `./dual-context-screenshots.md`
> intentionally does not apply here; no sibling `*.results.md`
> template ships alongside this plan.

This plan covers task #712. Task #678 introduced the picked-skin AVATAR
precedence in `PublicProfileModal`; #686 added partial coverage and #699
added the parallel BANNER coverage. This plan rounds out the AVATAR leg
with the same three-case shape used by the banner plan, so a regression
on either side of the contract is caught symmetrically.

The contract under test (avatar precedence, ~lines 194–197 of
`PublicProfileModal.tsx`):

```ts
const counterpartOA = profile?.counterpartOutwardAccount ?? null;
const avatarUri = counterpartOA?.avatarUrl
  ? resolveStorageUrl(counterpartOA.avatarUrl, null)
  : resolveStorageUrl(user?.avatarUrl ?? null, user?.updatedAt ?? null);
```

Three cases:

1. **Skin with avatar uploaded.** Modal opens with
   `counterpartOutwardAccountId` of an OA whose `avatarUrl` is set →
   the rendered hero `<img>` MUST carry the OA's `avatarUrl` path
   token (NOT the owner's `users.avatarUrl` token).
2. **Skin without avatar uploaded.** Modal opens with
   `counterpartOutwardAccountId` of an OA whose `avatarUrl` is NULL →
   the rendered hero `<img>` MUST fall back to the owner's
   `users.avatarUrl` token.
3. **Legacy / no skin passed.** Modal opens via a caller that does
   NOT pass `counterpartOutwardAccountId` (Find tab → "Find a trade
   pro" → tap a business row → `setOpenClerkId(b.clerkId)` → modal
   receives `counterpartOutwardAccountId={null}`) → the rendered hero
   `<img>` MUST be the owner's `users.avatarUrl` token, the same as
   case 2.

## Context

- The `/find` route renders three search bars. The picked-skin
  precedence is driven by the **first** bar (Find people) which fans
  out to one row per `outward_accounts` skin — tapping a row sets
  `openTarget = { clerkId, outwardAccountId }`, and the modal
  receives `counterpartOutwardAccountId={openTarget.outwardAccountId}`.
- The **second** bar (Find a trade pro) goes through
  `useSearchBusinesses` and renders one row per trade-pro user — the
  row's tap handler calls `setOpenClerkId(b.clerkId)` which sets
  `outwardAccountId: null`. That's the legacy path.
- `GET /api/users/:userId?outwardAccountId=<id>` returns
  `counterpartOutwardAccount.avatarUrl` (and `bannerUrl`,
  `companyName`, `title`, `kind`) only when the OA is owned by the
  target user and not archived. When omitted, `counterpartOutwardAccount`
  is `null` and the modal's `avatarUri` falls back to
  `user.avatarUrl` from the user row.
- The hero `<Image>` carries `testID="public-profile-hero-avatar"`
  on BOTH layouts the modal can render: the with-banner overlap
  layout (avatar bottom-overlapping the banner) AND the no-banner
  inline layout (centered avatar inside `heroBlock`). React Native
  Web emits this as `<img data-testid="public-profile-hero-avatar"
  data-uri="…" src="…">`. The `data-uri` attribute carries the
  modal-chosen `avatarUri` string verbatim and is what the
  assertions read; `src` is not used because RN Web's `<Image>`
  preloads the URL and only sets `src` when the preload succeeds —
  the e2e seed uses synthetic storage tokens that 401, so `src`
  ends up null. The `data-uri` attribute always reflects the
  modal's choice regardless of the network response.
- This plan deliberately seeds an owner with NO banner (no
  `headerImageUrl` / `bannerUrl` / `coverPhotoUrl` on the trade_pro
  intake), so the modal renders the no-banner avatar layout for
  every case here. That keeps the `getByTestId("public-profile-hero-avatar")`
  lookup unambiguous (the with-banner layout would also render the
  same testID, but pinning to one layout removes any "which testID
  resolves first?" flakiness across runs).
- The seeded paths are NOT real uploads. They're synthetic
  `/objects/uploads/picked-skin-e2e-avatar-*` tokens — distinct from
  the banner seed's `picked-skin-e2e-*-banner` tokens so the two
  plans can be re-seeded independently without colliding.
  `resolveStorageUrl` wraps them into a
  `${EXPO_PUBLIC_DOMAIN}/api/storage/objects/uploads/...` URL even
  when the path 401/404s — the test asserts the URL TOKEN inside
  the `data-uri` attribute, not that the image bytes load. The
  `<img>` element itself is always rendered when `avatarUri` is
  truthy, so the assertions are robust regardless of the eventual
  network response.
- API endpoints exercised:
  - `GET /api/users/me`
  - `GET /api/users/search?q=…`         (people, fans out per OA)
  - `GET /api/businesses/search?name=…` (one row per trade_pro user)
  - `GET /api/users/:clerkId`           (no outwardAccountId — case 3)
  - `GET /api/users/:clerkId?outwardAccountId=<id>` (cases 1 & 2)

## Accessibility / DOM contract

- The hero avatar inside `PublicProfileModal` is reachable as
  `getByTestId("public-profile-hero-avatar")`. Read its `data-uri`
  attribute (`getAttribute("data-uri")`) for the resolved storage
  URL — that's the modal-chosen `avatarUri` (with optional
  `?v=<bust>` query string when falling back to the user
  `avatarUrl`). Do NOT read `src`: RN Web's `<Image>` preloads the
  URL and only sets `src` if the preload succeeds, but the e2e seed
  uses synthetic storage tokens that 401, so `src` will be null.
- The "Find people" search input has placeholder text starting with
  `Name or @username`. The "Find a trade pro" input has placeholder
  text starting with `Business name or owner name`.
- People-search rows render the skin's display title (e.g.
  `Picked Skin AvatarCo E2E`) as the primary text; tap the row to
  open the modal. Business-search rows render the company name
  (`Picked Skin Avatar Owner Co E2E`) as the primary text.
- Modal close: tap the close `x` icon in the modal header
  (`accessibilityLabel="Close profile"`).

## Reusable signed-in fixtures

This plan uses two seeded Firebase accounts created by the script
`scripts/src/seed-picked-skin-avatar-fixtures.ts`. Re-create / refresh
them with:

```sh
pnpm --filter @workspace/scripts run seed:picked-skin-avatar-fixtures
```

| Env var pair | Role |
| --- | --- |
| `E2E_PICKED_SKIN_AVATAR_OWNER_EMAIL` / `E2E_PICKED_SKIN_AVATAR_OWNER_PASSWORD` | Trade Pro owner. Has ONE `user_modes` row of kind `trade_pro` whose `intakeData` deliberately carries NO banner fields (so the modal renders the no-banner avatar layout). `users.avatarUrl = "/objects/uploads/picked-skin-e2e-avatar-owner-intake-avatar"` (the legacy owner avatar). TWO `outward_accounts` rows: `Picked Skin AvatarCo E2E` (`avatarUrl = "/objects/uploads/picked-skin-e2e-avatar-skin1-avatar"`) and `Picked Skin NoAvatarCo E2E` (`avatarUrl = NULL`). `users.activeOutwardAccountId` pinned to the AvatarCo skin; `users.lastActiveModeId` pinned to the trade_pro mode (so the legacy `/users/:userId` snapshot path resolves to the same intake). |
| `E2E_PICKED_SKIN_AVATAR_VISITOR_EMAIL` / `E2E_PICKED_SKIN_AVATAR_VISITOR_PASSWORD` | Homeowner visitor. The only fixture that actually signs in for this plan — opens the owner's public profile from a fresh signed-in context via the Find tab. |

Both accounts are pre-onboarded (`users.identity_completed_at` is
set, `users.avatar_url` is non-empty) so the sign-in flow lands on
`/(tabs)` rather than `/(onboarding)/...`.

If either fixture's secret is missing, report `unable` instead of
attempting a broken sign-in.

## Avatar-token cheat sheet

The test asserts these substrings inside the `data-uri` attribute
returned by `getByTestId("public-profile-hero-avatar")`:

| Case | `counterpartOutwardAccountId` passed to modal | Expected `data-uri` substring |
| --- | --- | --- |
| A. Skin WITH avatar    | OA1 id (`Picked Skin AvatarCo E2E`)   | `picked-skin-e2e-avatar-skin1-avatar` |
| B. Skin WITHOUT avatar | OA2 id (`Picked Skin NoAvatarCo E2E`) | `picked-skin-e2e-avatar-owner-intake-avatar` |
| C. Legacy / no OA      | null                                  | `picked-skin-e2e-avatar-owner-intake-avatar` |

The cross-case invariant: case A's `data-uri` MUST NOT contain the
owner-intake token (`picked-skin-e2e-avatar-owner-intake-avatar`),
and cases B and C's `data-uri` MUST NOT contain the skin1 token
(`picked-skin-e2e-avatar-skin1-avatar`). These mutual-exclusion
checks catch a regression where the modal silently renders both the
skin avatar and the owner avatar under the same testID, or wires
the fallback to the wrong source.

## Plan

### Setup

1. [New Context — Visitor] Create a fresh browser context. Install a
   global `page.on('dialog')` handler that accepts every dialog
   (`dialog.accept()`).
2. [Browser] Navigate to `/(auth)/sign-in`. Sign in as
   `E2E_PICKED_SKIN_AVATAR_VISITOR_*`. Wait for navigation to leave
   `/(auth)/sign-in`. If the URL settles on `/(onboarding)/...`,
   stop and report `unable` (the visitor seed never completed
   onboarding).
3. [Browser] Navigate to `/find`. Wait for the "Find people" search
   input (placeholder starts with `Name or @username`) to be
   visible.

### Case A — Skin WITH avatar uploaded

4. [Browser] Type `Picked Skin AvatarCo E2E` into the "Find people"
   search input. Wait for the people search results to populate
   (the input debounces via `useSearchUsers`, ~250ms).
5. [Verify] Exactly one row whose primary text contains
   `Picked Skin AvatarCo E2E` is rendered under the people results.
   If no row appears, the seeded skin is missing or the
   `outwardAccountsTable.title` ILIKE branch in `/users/search`
   regressed — fail.
6. [Browser] Tap that result row. Wait for `PublicProfileModal` to
   open and for `getByTestId("public-profile-hero-avatar")` to
   resolve to a visible `<img>` element.
7. [Verify — case A assertions]
   - The `data-uri` attribute of `getByTestId("public-profile-hero-avatar")`
     (read via `getAttribute("data-uri")`) contains the substring
     `picked-skin-e2e-avatar-skin1-avatar`.
   - That same `data-uri` attribute does NOT contain the substring
     `picked-skin-e2e-avatar-owner-intake-avatar` (mutual exclusion
     — the modal must not be silently rendering both).
8. [Browser] Close `PublicProfileModal` (tap the close `x` button
   in the modal header).
9. [Browser] Clear the "Find people" search input
   (tap the `x-circle` clear affordance, or select-all + delete).

### Case B — Skin WITHOUT avatar uploaded

10. [Browser] Type `Picked Skin NoAvatarCo E2E` into the "Find
    people" search input. Wait for the people search results to
    populate.
11. [Verify] Exactly one row whose primary text contains
    `Picked Skin NoAvatarCo E2E` is rendered under the people
    results.
12. [Browser] Tap that result row. Wait for `PublicProfileModal`
    to open and for `getByTestId("public-profile-hero-avatar")` to
    resolve to a visible `<img>` element.
13. [Verify — case B assertions]
    - The `data-uri` attribute of
      `getByTestId("public-profile-hero-avatar")` (read via
      `getAttribute("data-uri")`) contains the substring
      `picked-skin-e2e-avatar-owner-intake-avatar` (the owner's
      `users.avatarUrl` fallback).
    - That same `data-uri` attribute does NOT contain the substring
      `picked-skin-e2e-avatar-skin1-avatar` (mutual exclusion — the
      modal must not be leaking the other skin's avatar here).
14. [Browser] Close `PublicProfileModal` (tap the close `x`).
15. [Browser] Clear the "Find people" search input.

### Case C — Legacy path (no `counterpartOutwardAccountId`)

16. [Browser] Scroll to the second search bar ("Find a trade pro",
    placeholder starts with `Business name or owner name`). Type
    `Picked Skin Avatar Owner Co E2E` into it. Wait for the
    business search results to populate (`useSearchBusinesses`
    debounce).
17. [Verify] Exactly one business row whose primary text contains
    `Picked Skin Avatar Owner Co E2E` is rendered under the
    business results. If no row appears, the seeded
    `intake.companyName` is wrong or `/businesses/search?name=…`
    regressed — fail.
18. [Browser] Tap that business row. Wait for
    `PublicProfileModal` to open and for
    `getByTestId("public-profile-hero-avatar")` to resolve to a
    visible `<img>` element.
    - This caller goes through `setOpenClerkId(b.clerkId)`, which
      sets `outwardAccountId: null` — so the modal calls
      `GET /api/users/:userId` WITHOUT the `outwardAccountId` query
      param. Server returns `counterpartOutwardAccount: null`,
      modal falls through to `resolveStorageUrl(user.avatarUrl, …)`.
19. [Verify — case C assertions]
    - The `data-uri` attribute of
      `getByTestId("public-profile-hero-avatar")` (read via
      `getAttribute("data-uri")`) contains the substring
      `picked-skin-e2e-avatar-owner-intake-avatar`.
    - That same `data-uri` attribute does NOT contain the substring
      `picked-skin-e2e-avatar-skin1-avatar` (mutual exclusion — the
      modal must not be defaulting to the active skin's avatar
      when no OA was passed).
20. [Browser] Close `PublicProfileModal` (tap the close `x`).

### Cleanup

21. No explicit cleanup is required. The seed script is idempotent —
    re-running it resets `avatarUrl` on each OA back to its declared
    state and leaves the visitor's homeowner shape untouched.

## Regressions this catches

- `PublicProfileModal` stops preferring `counterpartOA?.avatarUrl`
  over `user?.avatarUrl` (e.g. the OR is inverted, or the
  `counterpartOA` field is dropped from the response wiring) →
  case A's `data-uri` no longer contains
  `picked-skin-e2e-avatar-skin1-avatar`.
- `GET /users/:userId?outwardAccountId=<id>` stops returning
  `counterpartOutwardAccount.avatarUrl` (e.g. the OA select drops
  the column, or the route's authz / archived gate becomes too
  strict and silently returns `null` for valid skins) → case A's
  assertion fails because `avatarUri` falls back to the owner
  avatar.
- The legacy caller path (modal opened with
  `counterpartOutwardAccountId={null}`) regresses to forcing the
  active skin's avatar into the hero (e.g. the route auto-resolves
  an OA when the query param is absent) → case C's mutual-exclusion
  check fires because `picked-skin-e2e-avatar-skin1-avatar` would
  leak in.
- The `data-uri` DOM hook is dropped from one of the two avatar
  `<Image>` render sites (with-banner overlap layout vs. no-banner
  inline layout) → if the modal ever switches layouts under this
  fixture, the assertion would silently lose its observability.
  Keeping `dataSet={{ uri }}` on BOTH render sites keeps the
  contract uniform; this plan exercises the no-banner site, and
  the parallel banner plan (#699) exercises the with-banner site.
- `outward_accounts.avatar_url` column is renamed/dropped or the
  search route stops fanning out per-OA (so the visitor can't
  address a specific skin from `/find`) → cases A and B's row taps
  can't surface the right `counterpartOutwardAccountId`, and the
  avatar assertions fail.

## Notes for native (iOS / Android) runs

- Sign-in uses the same `app/(auth)/sign-in.tsx` form on native;
  the visitor account signs in through that screen.
- React Native Image carries the same `testID` on native, so
  `getByTestId("public-profile-hero-avatar")` resolves identically.
  On native runners that can't read the underlying `src` attribute
  directly, fall back to inspecting the React tree's
  `props.source.uri` for the same testID and apply the substring
  assertions to that string instead. (`dataSet` is a web-only
  prop; native runners ignore it and read `source.uri` directly.)
- The Find tab's two relevant search bars (`Find people`,
  `Find a trade pro`) render with the same placeholder text on
  native, so locate them by placeholder.

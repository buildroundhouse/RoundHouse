# Picked-skin banner swap on the public profile — end-to-end test plan

Use with the project's UI testing tool (Playwright-driven). Run against the
Roundhouse Expo web preview.

> **Single-context plan.** Drives only one Playwright browser context
> (the visitor signed in to view the owner's public profile). The
> dual-context screenshot helper at `./dual-context-screenshots.md`
> intentionally does not apply here; no sibling `*.results.md`
> template ships alongside this plan.

This plan covers task #699. Tasks #678 (avatar swap) and #685 (banner
swap) changed `PublicProfileModal` so that when it's opened against a
specific operator skin, the hero shows that skin's avatar and banner
instead of the underlying owner's personal ones. #686 already added
e2e coverage for the avatar leg; this plan covers the banner leg.

The contract under test (banner precedence, ~lines 207–214 of
`PublicProfileModal.tsx`):

```ts
const ownerBannerPath =
  (typeof intake.headerImageUrl === "string" && intake.headerImageUrl) ||
  (typeof intake.bannerUrl === "string" && intake.bannerUrl) ||
  (typeof intake.coverPhotoUrl === "string" && intake.coverPhotoUrl) ||
  null;
const bannerUri = counterpartOA?.bannerUrl
  ? resolveStorageUrl(counterpartOA.bannerUrl, null)
  : resolveStorageUrl(ownerBannerPath, user?.updatedAt ?? null);
```

Three cases:

1. **Skin with banner uploaded.** Modal opens with
   `counterpartOutwardAccountId` of an OA whose `bannerUrl` is set →
   the rendered hero `<img src>` MUST contain the OA's `bannerUrl`
   path token (NOT the owner's intake banner token).
2. **Skin without banner uploaded.** Modal opens with
   `counterpartOutwardAccountId` of an OA whose `bannerUrl` is NULL →
   the rendered hero `<img src>` MUST fall back to the owner's
   `intake.headerImageUrl` token.
3. **Legacy / no skin passed.** Modal opens via a caller that does
   NOT pass `counterpartOutwardAccountId` (Find tab → "Find a trade
   pro" → tap a business row → `setOpenClerkId(b.clerkId)` → modal
   receives `counterpartOutwardAccountId={null}`) → the rendered hero
   `<img src>` MUST be the owner's `intake.headerImageUrl` token, the
   same as case 2.

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
  `counterpartOutwardAccount.bannerUrl` (and `avatarUrl`,
  `companyName`, `title`, `kind`) only when the OA is owned by the
  target user and not archived. When omitted, `counterpartOutwardAccount`
  is `null` and the modal's `bannerUri` falls back to
  `intake.headerImageUrl` from the snapshot mode.
- The hero `<Image>` carries `testID="public-profile-hero-banner"`
  (added alongside this plan, mirroring the existing
  `public-profile-hero-avatar` testID from #686). React Native Web
  emits this as `<img data-testid="public-profile-hero-banner"
  data-uri="…" src="…">`. The `data-uri` attribute carries the
  modal-chosen `bannerUri` string verbatim and is what the
  assertions read; `src` is not used because RN Web's `<Image>`
  preloads the URL and only sets `src` when the preload succeeds —
  the e2e seed uses synthetic storage tokens that 401, so `src`
  ends up null. The `data-uri` attribute always reflects the
  modal's choice regardless of the network response.
- The seeded paths are NOT real uploads. They're synthetic
  `/objects/uploads/picked-skin-e2e-*` tokens. `resolveStorageUrl`
  wraps them into a `${EXPO_PUBLIC_DOMAIN}/api/storage/objects/uploads/...`
  URL even when the path 401/404s — the test asserts the URL TOKEN
  inside the `data-uri` attribute, not that the image bytes load.
  The `<img>` element itself is always rendered when `bannerUri`
  is truthy, so the assertions are robust regardless of the
  eventual network response.
- API endpoints exercised:
  - `GET /api/users/me`
  - `GET /api/users/search?q=…`         (people, fans out per OA)
  - `GET /api/businesses/search?name=…` (one row per trade_pro user)
  - `GET /api/users/:clerkId`           (no outwardAccountId — case 3)
  - `GET /api/users/:clerkId?outwardAccountId=<id>` (cases 1 & 2)

## Accessibility / DOM contract

- The hero banner inside `PublicProfileModal` is reachable as
  `getByTestId("public-profile-hero-banner")`. Read its `data-uri`
  attribute (`getAttribute("data-uri")`) for the resolved storage
  URL — that's the modal-chosen `bannerUri` (with optional
  `?v=<bust>` query string when falling back to the owner path).
  Do NOT read `src`: RN Web's `<Image>` preloads the URL and only
  sets `src` if the preload succeeds, but the e2e seed uses
  synthetic storage tokens that 401, so `src` will be null.
- The "Find people" search input has placeholder text starting with
  `Name or @username`. The "Find a trade pro" input has placeholder
  text starting with `Business name or owner name`.
- People-search rows render the skin's display title (e.g.
  `Picked Skin BannerCo E2E`) as the primary text; tap the row to
  open the modal. Business-search rows render the company name
  (`Picked Skin Owner Co E2E`) as the primary text.
- Modal close: tap the `Close` `X` icon in the modal header
  (`accessibilityLabel="Close"`).

## Reusable signed-in fixtures

This plan uses two seeded Firebase accounts created by the script
`scripts/src/seed-picked-skin-banner-fixtures.ts`. Re-create / refresh
them with:

```sh
pnpm --filter @workspace/scripts run seed:picked-skin-banner-fixtures
```

| Env var pair | Role |
| --- | --- |
| `E2E_PICKED_SKIN_OWNER_EMAIL` / `E2E_PICKED_SKIN_OWNER_PASSWORD` | Trade Pro owner. Has ONE `user_modes` row of kind `trade_pro` whose `intakeData.headerImageUrl = "/objects/uploads/picked-skin-e2e-owner-intake-banner"` (the legacy intake banner), and TWO `outward_accounts` rows: `Picked Skin BannerCo E2E` (`bannerUrl = "/objects/uploads/picked-skin-e2e-skin1-banner"`) and `Picked Skin NoBannerCo E2E` (`bannerUrl = NULL`). `users.activeOutwardAccountId` pinned to the BannerCo skin; `users.lastActiveModeId` pinned to the trade_pro mode (so the legacy `/users/:userId` snapshot path resolves to the same intake data). |
| `E2E_PICKED_SKIN_VISITOR_EMAIL` / `E2E_PICKED_SKIN_VISITOR_PASSWORD` | Homeowner visitor. The only fixture that actually signs in for this plan — opens the owner's public profile from a fresh signed-in context via the Find tab. |

Both accounts are pre-onboarded (`users.identity_completed_at` is
set) so the sign-in flow lands on `/(tabs)` rather than
`/(onboarding)/...`.

If either fixture's secret is missing, report `unable` instead of
attempting a broken sign-in.

## Banner-token cheat sheet

The test asserts these substrings inside the `data-uri` attribute
returned by `getByTestId("public-profile-hero-banner")`:

| Case | `counterpartOutwardAccountId` passed to modal | Expected `data-uri` substring |
| --- | --- | --- |
| A. Skin WITH banner    | OA1 id (`Picked Skin BannerCo E2E`)   | `picked-skin-e2e-skin1-banner` |
| B. Skin WITHOUT banner | OA2 id (`Picked Skin NoBannerCo E2E`) | `picked-skin-e2e-owner-intake-banner` |
| C. Legacy / no OA      | null                                  | `picked-skin-e2e-owner-intake-banner` |

The cross-case invariant: case A's `src` MUST NOT contain the
owner-intake token (`picked-skin-e2e-owner-intake-banner`), and
cases B and C's `src` MUST NOT contain the skin1 token
(`picked-skin-e2e-skin1-banner`). These mutual-exclusion checks
catch a regression where the modal silently renders both the skin
banner and the owner banner under the same testID, or wires the
fallback to the wrong source.

## Plan

### Setup

1. [New Context — Visitor] Create a fresh browser context. Install a
   global `page.on('dialog')` handler that accepts every dialog
   (`dialog.accept()`).
2. [Browser] Navigate to `/(auth)/sign-in`. Sign in as
   `E2E_PICKED_SKIN_VISITOR_*`. Wait for navigation to leave
   `/(auth)/sign-in`. If the URL settles on `/(onboarding)/...`,
   stop and report `unable` (the visitor seed never completed
   onboarding).
3. [Browser] Navigate to `/find`. Wait for the "Find people" search
   input (placeholder starts with `Name or @username`) to be
   visible.

### Case A — Skin WITH banner uploaded

4. [Browser] Type `Picked Skin BannerCo E2E` into the "Find people"
   search input. Wait for the people search results to populate
   (the input debounces via `useSearchUsers`, ~250ms).
5. [Verify] Exactly one row whose primary text contains
   `Picked Skin BannerCo E2E` is rendered under the people results.
   If no row appears, the seeded skin is missing or the
   `outwardAccountsTable.title` ILIKE branch in `/users/search`
   regressed — fail.
6. [Browser] Tap that result row. Wait for `PublicProfileModal` to
   open and for `getByTestId("public-profile-hero-banner")` to
   resolve to a visible `<img>` element.
7. [Verify — case A assertions]
   - The `data-uri` attribute of `getByTestId("public-profile-hero-banner")`
     (read via `getAttribute("data-uri")`) contains the substring
     `picked-skin-e2e-skin1-banner`.
   - That same `data-uri` attribute does NOT contain the substring
     `picked-skin-e2e-owner-intake-banner` (mutual exclusion — the
     modal must not be silently rendering both).
8. [Browser] Close `PublicProfileModal` (tap the `X` close button
   in the modal header).
9. [Browser] Clear the "Find people" search input
   (tap the `x-circle` clear affordance, or select-all + delete).

### Case B — Skin WITHOUT banner uploaded

10. [Browser] Type `Picked Skin NoBannerCo E2E` into the "Find
    people" search input. Wait for the people search results to
    populate.
11. [Verify] Exactly one row whose primary text contains
    `Picked Skin NoBannerCo E2E` is rendered under the people
    results.
12. [Browser] Tap that result row. Wait for `PublicProfileModal`
    to open and for `getByTestId("public-profile-hero-banner")` to
    resolve to a visible `<img>` element.
13. [Verify — case B assertions]
    - The `data-uri` attribute of
      `getByTestId("public-profile-hero-banner")` (read via
      `getAttribute("data-uri")`) contains the substring
      `picked-skin-e2e-owner-intake-banner` (the owner's
      `intake.headerImageUrl` fallback).
    - That same `data-uri` attribute does NOT contain the substring
      `picked-skin-e2e-skin1-banner` (mutual exclusion — the
      modal must not be leaking the other skin's banner here).
14. [Browser] Close `PublicProfileModal` (tap the `X`).
15. [Browser] Clear the "Find people" search input.

### Case C — Legacy path (no `counterpartOutwardAccountId`)

16. [Browser] Scroll to the second search bar ("Find a trade pro",
    placeholder starts with `Business name or owner name`). Type
    `Picked Skin Owner Co E2E` into it. Wait for the business
    search results to populate (`useSearchBusinesses` debounce).
17. [Verify] Exactly one business row whose primary text contains
    `Picked Skin Owner Co E2E` is rendered under the business
    results. If no row appears, the seeded
    `intake.companyName` is wrong or `/businesses/search?name=…`
    regressed — fail.
18. [Browser] Tap that business row. Wait for
    `PublicProfileModal` to open and for
    `getByTestId("public-profile-hero-banner")` to resolve to a
    visible `<img>` element.
    - This caller goes through `setOpenClerkId(b.clerkId)`, which
      sets `outwardAccountId: null` — so the modal calls
      `GET /api/users/:userId` WITHOUT the `outwardAccountId` query
      param. Server returns `counterpartOutwardAccount: null`,
      modal falls through to `resolveStorageUrl(ownerBannerPath, …)`.
19. [Verify — case C assertions]
    - The `data-uri` attribute of
      `getByTestId("public-profile-hero-banner")` (read via
      `getAttribute("data-uri")`) contains the substring
      `picked-skin-e2e-owner-intake-banner`.
    - That same `data-uri` attribute does NOT contain the substring
      `picked-skin-e2e-skin1-banner` (mutual exclusion — the
      modal must not be defaulting to the active skin's banner
      when no OA was passed).
20. [Browser] Close `PublicProfileModal` (tap the `X`).

### Cleanup

21. No explicit cleanup is required. The seed script is idempotent —
    re-running it resets `bannerUrl` on each OA back to its declared
    state and leaves the visitor's homeowner shape untouched.

## Regressions this catches

- `PublicProfileModal` stops preferring `counterpartOA?.bannerUrl`
  over `ownerBannerPath` (e.g. the OR is inverted, or the
  `counterpartOA` field is dropped from the response wiring) →
  case A's `src` no longer contains `picked-skin-e2e-skin1-banner`.
- `GET /users/:userId?outwardAccountId=<id>` stops returning
  `counterpartOutwardAccount.bannerUrl` (e.g. the OA select drops
  the column, or the route's authz / archived gate becomes too
  strict and silently returns `null` for valid skins) → case A's
  assertion fails because `bannerUri` falls back to the owner
  banner.
- The fallback chain `headerImageUrl → bannerUrl → coverPhotoUrl`
  is broken on the modal side (e.g. the OR-chain is rewritten to
  pick the wrong field, or `intake` is no longer hydrated from the
  snapshot mode) → cases B and C lose the
  `picked-skin-e2e-owner-intake-banner` substring.
- The legacy caller path (modal opened with
  `counterpartOutwardAccountId={null}`) regresses to forcing the
  active skin's banner into the hero (e.g. the route auto-resolves
  an OA when the query param is absent) → case C's mutual-exclusion
  check fires because `picked-skin-e2e-skin1-banner` would leak in.
- `outward_accounts.banner_url` column is renamed/dropped or the
  search route stops fanning out per-OA (so the visitor can't
  address a specific skin from `/find`) → cases A and B's row taps
  can't surface the right `counterpartOutwardAccountId`, and the
  banner assertions fail.

## Notes for native (iOS / Android) runs

- Sign-in uses the same `app/(auth)/sign-in.tsx` form on native;
  the visitor account signs in through that screen.
- React Native Image carries the same `testID` on native, so
  `getByTestId("public-profile-hero-banner")` resolves identically.
  On native runners that can't read the underlying `src` attribute
  directly, fall back to inspecting the React tree's
  `props.source.uri` for the same testID and apply the substring
  assertions to that string instead.
- The Find tab's two relevant search bars (`Find people`,
  `Find a trade pro`) render with the same placeholder text on
  native, so locate them by placeholder.

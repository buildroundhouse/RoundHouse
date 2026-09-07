# Per-client pro tag — end-to-end test plan

Use with the project's UI testing tool (Playwright-driven). Run against the
Roundhouse Expo web preview.

This plan covers tasks #520 (the Pro picks Service · Identity per client
on the Clients tab) and #523 (the picked tag renders under the Pro's
name in `PublicProfileModal` for the connected client). It exercises
both the populated and the empty (fallback to the generic role pill)
states.

## Context

- Pro Clients tab route: `/clients` (renders `app/(tabs)/clients.tsx`).
- Homeowner My Team tab route: `/my-team` (renders
  `app/(tabs)/my-team.tsx`). Tapping a connected pro on this screen
  opens `PublicProfileModal` for that pro's clerkId.
- `PublicProfileModal` (`artifacts/round-house/components/PublicProfileModal.tsx`)
  derives the per-client tag block from the `connection` field on
  `GET /api/users/:clerkId`. That `connection` is the row where
  `from = viewer's outward account` and `to = profile owner's outward
  account`. The pro's per-client tag fields (`serviceTitle`,
  `onSiteIdentity`) live on this same row and are owned by the
  to-side (the pro). When `composeLabelChipLine` produces a non-null
  `label` or `chip`, the per-client tag row renders. When neither is
  present, the modal falls back to the generic `role` pill (e.g.
  "Trade Pro" / "Plumber").
- The pro tags themselves via the Tag affordance on each Client row in
  the Clients tab. The `ConnectionTagModal` opens in `pro-self-tag`
  mode and PATCHes `/api/users/me/connections/:id` with
  `{ serviceTitle, onSiteIdentity }`. The Pro's own profile must
  carry at least one entry in `users.services` so the modal's
  service chip row is populated; the seed sets one up.
- API endpoints exercised:
  - `GET  /api/users/me`
  - `GET  /api/users/me/relationships`
  - `GET  /api/users/:clerkId`
  - `PATCH /api/users/me/connections/:id`

## Accessibility / DOM contract

The composed line in `PublicProfileModal` renders inside
`styles.perClientTagRow` directly under the pro's name and `@username`.
On web Expo, the label is rendered as a plain `Text` with the value of
`composeLabelChipLine().label` (e.g. `Plumbing`) and the chip as a
`Text` inside a small bordered View whose value is
`composeLabelChipLine().chip` (e.g. `Specialist`). When both are
present they are joined by a separator `Text` containing ` · `.

The fallback state renders a `View` (`styles.rolePill`) with a single
`Text` containing the pro's role string (`role` derives from `trade` →
`TRADE_LABELS["plumber"]` = `"Plumber"`, so the seeded pro renders as
`Plumber` when no per-client tag is set).

The Tag affordance on the Clients tab row is a `Pressable` with
`accessibilityLabel` of either:

- `Tag yourself for ${client.name}` (no tag set), or
- `Change how you show up for ${client.name}` (tag already set).

The pro's "you show up as" preview directly under the row reads
`You show up as: <Service> · <Identity>` once a tag has been saved.

## Reusable signed-in fixtures

This plan uses two seeded Firebase accounts created by the script
`scripts/src/seed-pro-tag-fixtures.ts`. Re-create / refresh them with:

```sh
pnpm --filter @workspace/scripts run seed:pro-tag-fixtures
```

| Env var pair | Role | Context short name |
| --- | --- | --- |
| `E2E_PRO_TAG_PRO_EMAIL` / `E2E_PRO_TAG_PRO_PASSWORD` | Trade Pro. Owns `Pro Tag E2E Co` (`trade_pro` outward account). `users.services` includes a single `Plumbing` entry. | `pro` |
| `E2E_PRO_TAG_CLIENT_EMAIL` / `E2E_PRO_TAG_CLIENT_PASSWORD` | Homeowner client. Owns a `home` outward account. | `client` |

The "Context short name" column is the identifier the dual-context
screenshot helper uses when it names the per-step PNG files (see
"Screenshot capture" below); pin it here so the file names are
predictable from reading the plan alone.

Both are pre-onboarded (`users.identity_completed_at` is set) so the
sign-in flow lands on `/(tabs)` rather than `/(onboarding)/...`.

The seeder also pre-creates the connection edges so the test starts
from a known-empty tag state:

- `client → pro` (`kind=core`, `status=accepted`, all tag fields
  NULL) — the row that backs `PublicProfileModal.connection` when the
  homeowner views the pro, and the row the pro PATCHes from
  `pro-self-tag`. The pro is the to-side here, which is what the
  PATCH authz requires for `serviceTitle` / `onSiteIdentity`.
- `pro → client` (`kind=client`, `status=accepted`) — the row the
  pro's relationships endpoint returns so the homeowner appears on
  the Clients tab and the Tag affordance can be reached.

If either fixture's secret is missing, report `unable` instead of
attempting a broken sign-in.

## Screenshot capture

This plan drives two concurrent Playwright contexts (`client` and
`pro`), so it opts in to the dual-context screenshot helper at
`./dual-context-screenshots.md`. Read the helper first; this
section only pins the per-plan specifics:

- **Plan slug** (storage directory): `per-client-pro-tag`
- **Short slug** (PNG file-name prefix): `per-client-pro-tag`
- **Storage directory.**
  `artifacts/round-house/e2e/screenshots/per-client-pro-tag/`. The
  helper deletes and re-creates this directory at the start of
  every run so stale PNGs from previous runs cannot mislead a
  reviewer.
- **File-name convention.**
  `per-client-pro-tag-step<Letter>-<context>.png`, where `<Letter>`
  is the section letter the capture sits at the boundary of (`A`,
  `B`, `C`) and `<context>` is the short name pinned in the
  fixtures table (`client`, `pro`). Example:
  `per-client-pro-tag-stepA-client.png`. When a section is captured
  before the second context exists, only the in-scope context's
  PNG is written and the missing one is reported as `(n/a)` in
  the sibling `per-client-pro-tag.results.md`.
- **Capture cadence.** Per the helper:
  1. on each in-section failed assertion before any retry,
  2. at every section boundary marked below with
     `[Capture — section X]`, and
  3. at the very end of the run regardless of pass / fail.
- **Per-context expectations.** The `client` context drives
  `/my-team` + `PublicProfileModal`; the `pro` context drives
  `/clients` + `ConnectionTagModal`. When a section's narrative
  only changes one of the two contexts, capture both anyway so
  the sibling results file shows the unchanged context as
  evidence that the cross-context handoff didn't disturb it.

## Plan

### A. Fallback first: client sees the generic role pill

1. [New Context — Client] Create a fresh browser context. Install a
   global `page.on('dialog')` handler that accepts every dialog
   (`dialog.accept()`).
2. [Browser] Navigate to `/(auth)/sign-in`. Sign in as
   `E2E_PRO_TAG_CLIENT_*`. Wait for navigation to leave
   `/(auth)/sign-in`. If the URL settles on `/(onboarding)/...`,
   stop and report `unable`.
3. [Browser] Navigate to `/my-team`.
4. [Verify] A row for `Pro Tag E2E Pro` is visible in the team list.
   If not, the seeder did not run or the connection rows were wiped —
   stop and report `unable`.
5. [Browser] Tap the `Pro Tag E2E Pro` row to open
   `PublicProfileModal`. Wait for the modal title `Profile` to be
   visible.
6. [Verify — fallback role pill]
   - The pro's display name `Pro Tag E2E Pro` is visible.
   - The handle `@pro_tag_e2e_pro` is visible.
   - The generic role pill is visible and reads exactly `Plumber`
     (resolved from `intake.trade = "plumber"` via
     `TRADE_LABELS["plumber"]`).
   - There is NO text matching the seeded service `Plumbing` and NO
     text matching any of the on-site identities (`Contractor`,
     `Handyman`, `Specialist`, `Technician`, `Vendor`) inside the
     hero block (the `View` containing the avatar through the role
     pill). The presence of either would mean the per-client tag row
     rendered when it shouldn't.
7. [Browser] Close the modal (tap the `X` close button in the modal
   header).

[Capture — section A] Per `./dual-context-screenshots.md`, snapshot
the `client` context at the section boundary. The
`PublicProfileModal` is still open from step 5–6 (the close in
step 7 is part of section A's tail; capture BEFORE the close so
the fallback `Plumber` pill is on screen for the snapshot). Save
as `per-client-pro-tag-stepA-client.png`. The `pro` context
hasn't been opened yet (step 8 creates it), so the
`-pro.png` slot for this section is `(n/a)` in the sibling
results file.

### B. Pro tags themselves for this client

8. [New Context — Pro] Open a second, isolated browser context.
   Install the same dialog handler.
9. [Browser] Navigate to `/(auth)/sign-in`. Sign in as
   `E2E_PRO_TAG_PRO_*`. Verify it lands outside `/(auth)/sign-in` and
   outside `/(onboarding)/...`.
10. [Browser] Navigate to `/clients`. Wait for the `Clients` section
    header to be visible.
11. [Verify] A row for `Pro Tag E2E Client` is visible under the
    `Clients` section. The Tag affordance on that row exposes
    `accessibilityLabel = "Tag yourself for Pro Tag E2E Client"`
    (no tag set yet, so it should not say `Change how you show up`).
    There is NO `You show up as:` preview text under the row.
12. [Browser] Tap the Tag affordance on the `Pro Tag E2E Client` row.
    Wait for the `ConnectionTagModal` to open with the title
    `How do you show up?` and the subject line `For Pro Tag E2E Client`.
13. [Verify] The `Service title` chip group includes a `Plumbing`
    chip (sourced from `useGetMe().services`). If it shows the
    "You need at least one Service…" error instead, the seeder didn't
    populate `users.services` correctly — fail.
14. [Browser] Tap the `Plumbing` chip. Tap the `Specialist` chip
    under `On-site identity`.
15. [Browser] Tap the `Save` button in the modal header. Wait for the
    modal to close (PATCH `/api/users/me/connections/:id` returns
    `{ ok: true }`). If the request returns 4xx, surface the response
    body in the test output and fail (this catches authz regressions
    on the to-side check).
16. [Verify] Back on the Clients tab, the `Pro Tag E2E Client` row
    now shows `You show up as: Plumbing · Specialist`. The Tag
    affordance now exposes
    `accessibilityLabel = "Change how you show up for Pro Tag E2E Client"`.

[Capture — section B] Snapshot BOTH contexts at the section
boundary. The `pro` context is on `/clients` after step 16's
post-save verify, with the `You show up as: Plumbing · Specialist`
preview line and the `Change how you show up for …` Tag
affordance label visible. The `client` context is unchanged from
section A's tail (parked on `/my-team` after the modal close in
step 7) — capture it anyway as evidence the cross-context tag
write didn't disturb it. Save as
`per-client-pro-tag-stepB-pro.png` and
`per-client-pro-tag-stepB-client.png`. The pro PNG is the
headline triage piece for section B: if step 15's PATCH 4xx'd or
step 16's preview-line / accessibilityLabel assertions failed,
the snapshot shows whether the modal stuck open or the row
re-rendered with stale text.

### C. Client sees the composed per-client tag

17. [Browser — Client context from step 1] Switch back to the client
    context and re-navigate to `/my-team`. (In-app navigation is
    fine; the relationships query refetches on focus.)
18. [Browser] Tap the `Pro Tag E2E Pro` row again to re-open
    `PublicProfileModal`.
19. [Verify — composed tag]
    - The pro's name `Pro Tag E2E Pro` and handle `@pro_tag_e2e_pro`
      are visible in the hero block.
    - Inside the hero block, exactly one text matches `Plumbing`
      (the label) and exactly one text matches `Specialist` (the
      chip), in that visual order.
    - The two are joined by a separator text containing ` · `.
    - The generic `Plumber` role pill from step 6 is NOT rendered
      anywhere in the hero block. Per
      `PublicProfileModal.tsx` the `hasPerClientTag ? … : role …`
      branch is mutually exclusive — either the per-client tag row
      OR the role pill renders, never both.
20. [Soft visual check] The composed line sits directly under the
    `@username` row, with the chip rendered inside a small bordered
    pill (matches `styles.perClientTagChip`) and the label rendered
    as plain text to its left.

[Capture — section C] Snapshot BOTH contexts at the section
boundary. The `client` context now has `PublicProfileModal` open
again (re-opened in step 18) showing the composed
`Plumbing · Specialist` line in the hero block, with NO generic
`Plumber` pill — this is the headline triage piece for the whole
plan since it is the only place the cross-context handoff is
visible to the consumer. The `pro` context is unchanged from
section B's tail (still parked on `/clients`) — capture it anyway
to prove the consumer-side re-fetch didn't trigger a regression
on the producer side. Save as
`per-client-pro-tag-stepC-client.png` and
`per-client-pro-tag-stepC-pro.png`. These also serve as the
helper's mandatory "end of run" final-state captures unless the
optional cleanup in step 21 produces a meaningfully different
visible state, in which case capture once more after step 21
under the same file names.

### Cleanup

21. [Browser — Pro] In the pro context, navigate back to `/clients`,
    open the Tag affordance on the `Pro Tag E2E Client` row, and pick
    a different `Service title` chip then immediately tap `Save` only
    if the seeder is expected to be re-run; otherwise leave the tag
    in place. The next seed re-run resets all tag fields to NULL, so
    cleanup is optional.

## Regressions this catches

- PATCH `/api/users/me/connections/:id` rejects the pro's
  `serviceTitle` / `onSiteIdentity` updates (e.g. authz check
  inverted, or the `to-only` allowlist no longer includes these
  fields) → step 15 fails with a 4xx.
- `GET /api/users/:clerkId` stops returning the `connection` field
  with the pro's tag fields populated (e.g. the row-direction lookup
  drifts), so the per-client tag block can't render → step 19's
  `Plumbing` / `Specialist` assertions fail.
- `composeLabelChipLine` regresses to returning the chip as the label
  (or vice-versa), so the visible order on the modal flips → step 19's
  ordered match fails.
- `PublicProfileModal` stops short-circuiting the role pill when the
  per-client tag is set, so both render → step 19's "no `Plumber`
  pill" assertion fails.
- The Tag affordance's `accessibilityLabel` stops switching between
  `Tag yourself for …` and `Change how you show up for …` →
  steps 11 and 16 fail.
- `useGetMe().services` stops feeding the pro-self-tag chip group →
  step 13 fails.

## Notes for native (iOS / Android) runs

- Sign-in uses the same `app/(auth)/sign-in.tsx` form as the parent
  fixtures; drive both accounts through that screen.
- The per-client tag row and the role pill render identically on
  native — locate them by visible text scoped to the modal's hero
  block.
- The Tag affordance on the Clients tab exposes the same
  `accessibilityLabel` on native, so the same matchers work.

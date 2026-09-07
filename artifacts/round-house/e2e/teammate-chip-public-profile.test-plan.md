# Teammate chip on public profile — end-to-end test plan

Use with the project's UI testing tool (Playwright-driven). Run against the
Roundhouse Expo web preview.

This plan covers task #558. Task #557 added `chip` / `chipOther` to the
`PublicTeamMember` shape returned by `GET /users/:userId/team`, and the
public profile renders that line via `TeamSection`. The unit-level
coverage exercises the admin-side flow only; this plan exercises the
end-to-end visitor path: an admin sets a teammate's chip from
`ManageTeamModal`, then a different signed-in visitor opens the
admin's `PublicProfileModal` and sees the chip rendered next to that
teammate.

## Context

- Admin's manage-team route: `/my-team` (renders
  `app/(tabs)/my-team.tsx`). On a `trade_pro` skin the page renders
  the "Trade Pro Teammates" section with a "Manage" affordance that
  opens `ManageTeamModal` (`onManage={() => setManageOpen(true)}`).
- Inside `ManageTeamModal`, accepted teammates render through
  `TeamSection` and a separate "TEAMMATE CHIPS" group lists each
  member with a "Change chip" pressable that opens
  `ChangeChipSheet`. Saving from that sheet PATCHes
  `/api/users/me/team/:memberClerkId/chip` with
  `{ chip, chipOther, companyKind }`.
- Visitor opens the admin's public profile via the Find tab
  (`/find`): typing in the search box hits
  `GET /api/users/search?q=…`, the result list renders one row per
  outward-account skin (`p.kind`/`p.title`), and tapping a row sets
  `openClerkId = p.clerkId` which opens `PublicProfileModal` for the
  admin.
- `PublicProfileModal` fetches `GET /api/users/:clerkId/team` via
  `useGetUserTeam` and renders the result through the same
  `TeamSection` component the admin sees, mapping `chip` /
  `chipOther` straight through. The `companyKind` prop is derived
  from `profile?.activeModeKind` of the *viewer*, not the lead — the
  visitor seeded by this plan uses a `home` skin, so `companyKind`
  passed to `TeamSection` is `null`. With `companyKind=null`,
  `teammateChipLabel(null, "plumbing", null)` falls through to
  returning the raw value (`"plumbing"`). The chip we choose for
  this plan is therefore `Other…` with a free-text override
  (`"Lead Plumber"`) so the rendered label is identical regardless
  of `companyKind`, making the visitor-side assertion robust.
- The route `GET /users/:userId/team` honors the lead's
  `users.visibility.team` flag — when the viewer is not the lead and
  `!visibility.team`, the route returns `{ members: [] }` and the
  TeamSection block in `PublicProfileModal` does not render at all.
  The seeder sets `visibility.team = true` on the admin so the
  visitor receives the seeded teammate.
- API endpoints exercised:
  - `GET   /api/users/me`
  - `GET   /api/users/me/team`
  - `PATCH /api/users/me/team/:memberClerkId/chip`
  - `GET   /api/users/search?q=…`
  - `GET   /api/users/:clerkId`
  - `GET   /api/users/:clerkId/team`

## Accessibility / DOM contract

- The "Manage" pressable inside the Trade Pro Teammates section is
  visible text `Manage` next to a `user-plus` icon and opens the
  modal.
- `ManageTeamModal`'s "TEAMMATE CHIPS" section renders one row per
  member with the member's name as the leading text and a trailing
  `Change chip` text label. Tap that row to open `ChangeChipSheet`.
- Inside `ChangeChipSheet`, chip values render as bordered pill
  pressables. The `Other…` pill reveals a `TextInput` with
  placeholder `Describe…`. The header `Save` text submits.
- In `PublicProfileModal`, the team line for each member renders as
  `@username · <Role> · <Chip>` inside `TeamSection`'s subtitle
  `Text` (a single line, `numberOfLines={1}`). The chip portion is
  appended after `· ` only when `teammateChipLabel(...)` returns a
  non-null string.

## Reusable signed-in fixtures

This plan uses three seeded Firebase accounts created by the script
`scripts/src/seed-teammate-chip-fixtures.ts`. Re-create / refresh
them with:

```sh
pnpm --filter @workspace/scripts run seed:teammate-chip-fixtures
```

| Env var pair | Role | Context short name |
| --- | --- | --- |
| `E2E_TEAM_CHIP_ADMIN_EMAIL` / `E2E_TEAM_CHIP_ADMIN_PASSWORD` | Trade Pro lead. Owns `Team Chip E2E Co` (`trade_pro` outward account). `users.visibility.team = true` so non-owner viewers receive the team list. | `admin` |
| `E2E_TEAM_CHIP_MEMBER_EMAIL` / `E2E_TEAM_CHIP_MEMBER_PASSWORD` | Accepted `user_team_members` row on the admin's team (status `accepted`, role `employee`, chip + chipOther NULL). Display name `Team Chip E2E Mate`, username `team_chip_e2e_mate`. **Not signed in by this plan** — only the seeded membership row is exercised. | _(seed only — not signed in)_ |
| `E2E_TEAM_CHIP_VISITOR_EMAIL` / `E2E_TEAM_CHIP_VISITOR_PASSWORD` | Homeowner visitor used to open the admin's public profile from a fresh context. | `visitor` |

All three accounts are pre-onboarded (`users.identity_completed_at`
is set) so the sign-in flow lands on `/(tabs)` rather than
`/(onboarding)/...`.

If any fixture's secret is missing, report `unable` instead of
attempting a broken sign-in.

The "Context short name" column is the identifier the dual-context
screenshot helper uses when it names the per-step PNG files (see
"Screenshot capture" below). The member fixture is only used to
provision the `user_team_members` row — no member browser context
is opened by this plan.

## Screenshot capture

This plan opts in to the dual-context screenshot helper at
`artifacts/round-house/e2e/dual-context-screenshots.md`. The helper
defines the storage layout, file-name convention, and capture
cadence (failing-step + section-boundary + final-state). The runner
should follow it verbatim; everything below is the
plan-specific configuration.

- **Plan slug** (storage directory): `teammate-chip-public-profile`
- **Short slug** (PNG file-name prefix): `team-chip-profile`
- **Storage directory**:
  `artifacts/round-house/e2e/screenshots/teammate-chip-public-profile/`
  — recreate empty at the start of every run.
- **Context short names**: `admin` and `visitor` (declared on the
  fixtures table above). The seeded member account is not given a
  short name because no browser context is opened for it.
- **Section labels**: `A. Admin sets the chip from ManageTeamModal`
  and `B. Visitor sees the chip on PublicProfileModal`.
- **Sibling results file**:
  `artifacts/round-house/e2e/teammate-chip-public-profile.results.md`.
  After a run, fill in its "Per-step screenshots" table and
  "Run summary" table; the file already contains the full set of
  expected file paths so a reviewer can scan it without consulting
  this plan.

The admin and visitor contexts are opened sequentially in the plan
(visitor opens at step 12 while the admin context from step 1
remains signed in). The paired snapshot at the section-B boundary
is the headline triage piece — it pins the admin's saved chip
against the chip the visitor reads back from the public profile.

## Plan

### A. Admin sets the teammate chip from ManageTeamModal

1. [New Context — Admin] Create a fresh browser context. Install a
   global `page.on('dialog')` handler that accepts every dialog
   (`dialog.accept()`).
2. [Browser] Navigate to `/(auth)/sign-in`. Sign in as
   `E2E_TEAM_CHIP_ADMIN_*`. Wait for navigation to leave
   `/(auth)/sign-in`. If the URL settles on `/(onboarding)/...`,
   stop and report `unable`.
3. [Browser] Navigate to `/my-team`. Wait for the section header
   `Trade Pro Teammates` to be visible. If the page renders
   "Connect with trade pros and friends…" instead, the seeder did
   not run with a `trade_pro` skin set active — stop and report
   `unable`.
4. [Verify] A team row for `Team Chip E2E Mate` is visible under the
   Trade Pro Teammates section, subtitle reads
   `@team_chip_e2e_mate · Employee` (no chip yet).
5. [Browser] Tap the `Manage` pressable next to the section header.
   Wait for `ManageTeamModal` to open with the title `Manage team`.
6. [Verify] Inside the modal, the `TEAMMATE CHIPS` section is
   visible and contains a row for `Team Chip E2E Mate · No chip`
   with a trailing `Change chip` label. (If the section is missing,
   the admin's active outward account is not `trade_pro` /
   `facilities` — fail.)
7. [Browser] Tap the `Change chip` row for `Team Chip E2E Mate`.
   Wait for the `Change chip` sheet to open with the subject line
   `For Team Chip E2E Mate`.
8. [Browser] Tap the `Other…` pill. The `Describe…` text input
   appears underneath; type `Lead Plumber` into it.
9. [Browser] Tap the `Save` text in the sheet header. Wait for the
   sheet to close. The PATCH `/api/users/me/team/:memberClerkId/chip`
   should return `{ ok: true, chip: "other", chipOther: "Lead Plumber" }`.
   If the response is 4xx, surface the response body in the test
   output and fail.
10. [Verify] Back in `ManageTeamModal`, the row in `TEAMMATE CHIPS`
    now reads `Team Chip E2E Mate · Lead Plumber`. The accepted row
    inside the embedded `TeamSection` updates its subtitle to
    `@team_chip_e2e_mate · Employee · Lead Plumber`.
11. [Browser] Close `ManageTeamModal` (tap the `X` in its header).

[Capture — section A] Per the dual-context screenshot helper
(`./dual-context-screenshots.md`), snapshot every open context now.
Only the admin context exists at this point, so capture
`screenshots/teammate-chip-public-profile/team-chip-profile-stepA-admin.png`
(the admin's `/my-team` view with the saved chip rendered on the
team row's subtitle). The visitor context opens in section B; its
absence in the section-A pair is intentional. If any [Verify]
step in this section already failed, capture immediately at the
failing step instead of at the section boundary.

### B. Visitor opens the admin's public profile and sees the chip

12. [New Context — Visitor] Open a second, isolated browser context.
    Install the same dialog handler.
13. [Browser] Navigate to `/(auth)/sign-in`. Sign in as
    `E2E_TEAM_CHIP_VISITOR_*`. Verify it lands outside
    `/(auth)/sign-in` and outside `/(onboarding)/...`.
14. [Browser] Navigate to `/find`.
15. [Browser] Type `Team Chip E2E Lead` into the search input. Wait
    for the people search results to populate (the input debounces
    via `useSearchUsers`).
16. [Verify] At least one result row whose visible text contains
    `Team Chip E2E Lead` (or the company title `Team Chip E2E Co`)
    is rendered under the people results. If no row appears, the
    seeded admin row is missing or `searchUsers` regressed — fail.
17. [Browser] Tap that result row to open `PublicProfileModal`.
    Wait for the modal to render with the lead's display name
    `Team Chip E2E Lead` visible in the hero.
18. [Verify — team chip on public profile]
    - The `TEAM` section header is visible inside the modal. (If it
      isn't, either `users.visibility.team` is false on the admin
      or `useGetUserTeam` returned an empty list — fail with the
      response body printed.)
    - Under the `EMPLOYEES` group, exactly one row whose primary
      text matches `Team Chip E2E Mate` is visible.
    - That row's subtitle text matches the regex
      `@team_chip_e2e_mate\s*·\s*Employee\s*·\s*Lead Plumber` —
      i.e. the chip `Lead Plumber` is appended after the role.
19. [Browser] Close `PublicProfileModal` (tap the `X`).

[Capture — section B / final state] Snapshot both contexts now.
Save as `team-chip-profile-stepB-admin.png` (admin's `/my-team`,
unchanged from section A — the cross-context invariant) and
`team-chip-profile-stepB-visitor.png` (visitor's `/find` results
with the closed `PublicProfileModal` reachable from the previous
tap). The visitor PNG is the headline triage piece — it should
show the chip text the admin saved at step 9 mirrored back through
the public profile API.

### Cleanup

20. Optional. Re-running the seed script clears chip + chipOther
    back to NULL on the team membership row, so the next run starts
    from a known-empty state. No explicit cleanup is required.

## Regressions this catches

- `GET /users/:userId/team` stops returning `chip` / `chipOther`
  (e.g. the column projection drops them again) → step 18's chip
  assertion fails because `TeamSection` only renders chip text when
  `teammateChipLabel(...)` returns a non-null value.
- `PublicProfileModal` stops piping `m.chip` / `m.chipOther` through
  to `TeamSection` (e.g. shape mismatch after a refactor) → step 18
  fails for the same reason.
- The route's visibility gate inverts and returns the team list to
  visitors even when `visibility.team` is false — would still pass
  this test, but a sibling test (not in scope here) should catch
  that. Conversely, if the gate becomes too strict and returns `[]`
  even when `visibility.team` is true, the `TEAM` section header
  vanishes → step 18's first assertion fails.
- `PATCH /users/me/team/:memberClerkId/chip` rejects the admin's
  update (e.g. authz inverted, or `parseTeammateChipFields` regresses
  to rejecting the `other` + free-text combo) → step 9 fails with a
  4xx.
- `teammateChipLabel(null, "other", "Lead Plumber")` regresses to
  returning `null` or the raw `"other"` instead of the trimmed
  free-text override → step 18's subtitle regex fails.
- The `Manage` button or the `Change chip` row stops being a
  reachable pressable on `/my-team` for `trade_pro` skins → steps
  5 and 7 fail.

## Notes for native (iOS / Android) runs

- Sign-in uses the same `app/(auth)/sign-in.tsx` form on native; the
  three accounts above sign in via that screen.
- `ManageTeamModal` and `ChangeChipSheet` render with the same
  visible text on native, so locate the "Manage", "Change chip",
  "Other…", "Describe…", and "Save" affordances by visible text.
- `PublicProfileModal`'s `TeamSection` row exposes the same single
  `Text` subtitle (`@username · Role · Chip`) on native; match by
  visible text scoped to the modal.

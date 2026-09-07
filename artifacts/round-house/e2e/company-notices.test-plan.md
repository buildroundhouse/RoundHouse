# Company notices — end-to-end test plan

Use with the project's UI testing tool (Playwright-driven). Run against the
Roundhouse Expo web preview.

This plan covers task #476: a company-skin admin posts a notice and a plain
team member of the same skin sees and dismisses it from the
**Company Reminders** section of the Reminders hub.

## Context

- Reminders route: `/reminders` (renders `app/reminders.tsx`).
- The `CompanyRemindersSection` component (in the same file) renders one
  `CompanyNoticeRow` per active notice. Active = not yet acknowledged by the
  signed-in user.
- API endpoints exercised under the hood (already covered by
  `artifacts/api-server/src/routes/__tests__/company-notices.test.ts`):
  - `POST /outward-accounts/:companyId/company-notices` (admin-only)
  - `GET  /company-notices`
  - `POST /company-notices/:noticeId/acknowledge`
  - `DELETE /company-notices/:noticeId`
- Both test users sign in via `app/(auth)/sign-in.tsx` (see
  `reminders-side-tab.test-plan.md` for the form selectors).
- Section header / titles in the Reminders hub:
  - Section title: `Company Reminders`.
  - Empty state inside the section:
    `No company-wide notices right now. New ones from the business will land here.`
  - Composer button label (visible only to users with at least one postable
    company): `Post a company notice`.
  - Composer modal title: `New company notice`.
  - Composer submit label: `Post notice` (changes to `Posting…` while pending).

## Accessibility labels (used by the test driver)

- Acknowledge button on a notice row: `Acknowledge <title>`.
- Delete button on a notice row (only visible if `canDelete`): `Delete <title>`.

## Reusable signed-in test fixtures

This plan needs **two** seeded Firebase accounts that both have completed
onboarding:

| Env var pair | Role | Context short name |
| --- | --- | --- |
| `E2E_COMPANY_ADMIN_EMAIL` / `E2E_COMPANY_ADMIN_PASSWORD` | **Admin** — Firebase user whose Roundhouse profile owns (or has a `manageTeam` / `isAdmin` team seat on) at least one `trade_pro` company outward account. | `admin` |
| `E2E_COMPANY_MEMBER_EMAIL` / `E2E_COMPANY_MEMBER_PASSWORD` | **Member** — different Firebase user whose Roundhouse profile holds an accepted, non-removed team seat on the **same** company skin used by the admin, **without** `manageTeam` / `isAdmin` (so the composer button should not appear and `canDelete` is `false`). | `member` |

Save credentials as Replit Secrets so the runner can read them. The
"Context short name" column is the identifier the dual-context
screenshot helper uses when it names the per-step PNG files (see
"Screenshot capture" below).

If the secrets are missing, the test should report `unable` instead of
attempting a broken sign-in.

## Screenshot capture

This plan opts in to the dual-context screenshot helper at
`artifacts/round-house/e2e/dual-context-screenshots.md`. The helper
defines the storage layout, file-name convention, and capture
cadence (failing-step + section-boundary + final-state). The runner
should follow it verbatim; everything below is the
plan-specific configuration.

- **Plan slug** (storage directory): `company-notices`
- **Short slug** (PNG file-name prefix): `company-notices`
- **Storage directory**:
  `artifacts/round-house/e2e/screenshots/company-notices/`
  — recreate empty at the start of every run.
- **Context short names**: `admin` and `member` (declared on the
  fixtures table above).
- **Section labels**: `A. Admin posts the notice`,
  `B. Member sees and acknowledges`, `Cleanup`. Sections A and B
  each map to a single section letter; the Cleanup section captures
  as `stepC`.
- **Sibling results file**:
  `artifacts/round-house/e2e/company-notices.results.md`. After a
  run, fill in its "Per-step screenshots" table and "Run summary"
  table; the file already contains the full set of expected file
  paths so a reviewer can scan it without consulting this plan.

The admin and member contexts are open simultaneously (the member
context opens at step 9 while the admin context from step 1 stays
signed in), so paired snapshots are the only way to localize a
flake to the producer side (admin) vs the consumer side (member).

## Plan

### A. Admin posts the notice

1. [New Context — Admin] Create a fresh browser context. Install a global
   `page.on('dialog')` handler that accepts every dialog (`dialog.accept()`).
2. [Browser] Navigate to `/(auth)/sign-in` and sign in as the
   `E2E_COMPANY_ADMIN_*` account. Wait for navigation to leave
   `/(auth)/sign-in`. If the URL settles on any `/(onboarding)/...` route,
   the fixture is stale — stop and report `unable`.
3. [Browser] Navigate to `/reminders`.
4. [Verify] The screen header reads `Reminders`. The `Company Reminders`
   section title is visible.
5. [Verify] A `Post a company notice` button is rendered inside the
   `Company Reminders` section. (If it isn't, the admin fixture isn't
   actually an admin of any postable company — report `unable`.)
6. [Browser] Tap `Post a company notice`. The `New company notice` modal
   opens. Fill in:
   - Title: `E2E notice <timestamp>` — capture the exact string as
     `noticeTitle` for later assertions.
   - Body: `Posted by the e2e test on <ISO timestamp>`.
   - If the modal shows a company picker (multiple postable companies),
     pick the first option.
7. [Browser] Tap `Post notice`. Wait for the modal to close.
8. [Verify] A `CompanyNoticeRow` whose visible title equals `noticeTitle`
   appears in the `Company Reminders` section. The row has both an
   `Acknowledge <noticeTitle>` button and a `Delete <noticeTitle>` button
   (the admin authored it, so `canDelete` is true).

[Capture — section A] Per the dual-context screenshot helper
(`./dual-context-screenshots.md`), snapshot every open context now.
Only the admin context exists at this point, so capture
`screenshots/company-notices/company-notices-stepA-admin.png` (the
admin's `/reminders` view with the seeded notice row visible). The
member context is captured starting in section B; its absence in the
section-A pair is intentional and expected. If any verify in this
section already failed, capture immediately at the failing step
instead of at the section boundary.

### B. Member sees and acknowledges

9. [New Context — Member] Open a second, isolated browser context (so the
   admin session stays signed in). Install the same dialog handler.
10. [Browser] Navigate to `/(auth)/sign-in` and sign in as the
    `E2E_COMPANY_MEMBER_*` account. Verify it lands outside
    `/(auth)/sign-in` and outside `/(onboarding)/...`.
11. [Browser] Navigate to `/reminders`.
12. [Verify] The `Company Reminders` section is rendered and contains a
    `CompanyNoticeRow` whose visible title equals the `noticeTitle`
    captured in step 6.
13. [Verify] The member's row shows an `Acknowledge <noticeTitle>` button
    but does **not** show a `Delete <noticeTitle>` button (members cannot
    take down notices they did not author).
14. [Verify] The `Post a company notice` button is **not** rendered for
    this member (they aren't a postable-company admin).
15. [Browser] Tap the `Acknowledge <noticeTitle>` button. Wait for the
    network request to settle.
16. [Verify] The `CompanyNoticeRow` for `noticeTitle` is no longer visible
    in the `Company Reminders` section. If this was the only active
    notice, the section now shows the empty-state copy
    `No company-wide notices right now. New ones from the business will land here.`
17. [Browser] Reload `/reminders` and re-verify step 16 — the dismissal
    persists across reloads, confirming it was written to the server, not
    just to local UI state.

[Capture — section B] Snapshot both contexts. The admin context is
parked on `/reminders` (untouched since section A); the member
context just reloaded `/reminders` after acknowledging. Save as
`company-notices-stepB-admin.png` and `company-notices-stepB-member.png`.
The member PNG is the headline triage piece — it must show the
notice removed from the member's section and either the empty-state
copy or the next active notice.

### C. Cleanup

18. [Browser — Admin context from step 1] Switch back to the admin context,
    refresh `/reminders`, locate the `CompanyNoticeRow` for `noticeTitle`,
    and tap `Delete <noticeTitle>`. Accept the confirmation dialog.
19. [Verify] The row is gone from the admin's view too, restoring the
    company's notices to the pre-test state so re-runs start clean.

[Capture — section C / final state] Snapshot both contexts after
cleanup so the run record shows the post-test state. Save as
`company-notices-stepC-admin.png` (admin's section now empty of the
seeded notice) and `company-notices-stepC-member.png` (member's
section unchanged from B). These two PNGs satisfy the helper's
"end-of-run final state" capture requirement.

## Notes for native (iOS / Android) runs

- Sign-in goes through the same `app/(auth)/sign-in.tsx` form on device.
  Drive both fixtures through that screen rather than calling Firebase
  programmatically.
- The acknowledge / delete buttons use the same
  `accessibilityLabel="Acknowledge <title>"` and
  `accessibilityLabel="Delete <title>"`, so device drivers that match by
  accessibility label work without changes.
- Native delete confirmation is `Alert.alert("Delete <title>?", ...)`
  rather than `window.confirm`; tap the destructive option.

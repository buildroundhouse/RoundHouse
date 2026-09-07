# Company notice read receipts — end-to-end test plan

Use with the project's UI testing tool (Playwright-driven). Run against the
Roundhouse Expo web preview.

This plan covers task #485: when an admin posts a company notice, the
`NoticeReadByRow` under each `CompanyNoticeRow` in the **Company Reminders**
section should show an `Acknowledged by X of N` summary plus the
acknowledgers' avatars / names. Non-admin recipients of the same notice
must NOT see that read-by row at all.

## Context

- Reminders route: `/reminders` (renders `app/reminders.tsx`).
- `CompanyNoticeRow` renders a `NoticeReadByRow` only when `notice.acks` is
  truthy. The API returns `acks` only for the notice's sender or for users
  with `manageTeam` / `isAdmin` on the company; everyone else gets
  `acks: null` and therefore no row.
  - Server: `artifacts/api-server/src/routes/companyNotices.ts`,
    `GET /company-notices`, lines around the `acks: isAdmin || isSender ? noticeAcks : null` branch.
  - Client: `artifacts/round-house/app/reminders.tsx`,
    `CompanyNoticeRow` → `NoticeReadByRow`.
- `recipientCount` = the company's owner clerk id plus every accepted,
  non-removed seat (deduped). `ackCount` = number of rows in
  `company_notice_acks` for the notice.
- Summary text rendered by `NoticeReadByRow`:
  - `Acknowledged by ${ackCount} of ${total}` where
    `total = max(recipientCount, ackCount)`.
  - Falls back to `Acknowledged by ${ackCount}` only if `total` is 0
    (shouldn't happen for a healthy company; treat as a regression).
- Names line below the summary: up to 3 acknowledger display names joined
  by `, `, with ` +N` appended if there are more than 3.
- API endpoints exercised:
  - `POST /outward-accounts/:companyId/company-notices` (admin posts)
  - `GET  /company-notices` (returns `ackCount`, `recipientCount`, `acks`)
  - `POST /company-notices/:noticeId/acknowledge` (member acks)
  - `DELETE /company-notices/:noticeId` (cleanup)

## Accessibility / DOM contract

`NoticeReadByRow` does not currently expose its own `accessibilityLabel`;
match by visible text scoped to the row that contains `noticeTitle`:

- Summary text: `Acknowledged by` (substring) + the exact `${ackCount} of ${total}`.
- Names text: the acknowledger's display name (member's `users.name`,
  or `@username`, or `Team member` if neither).

Other selectors reused from `company-notices.test-plan.md`:

- Composer button: `Post a company notice`.
- Composer modal title: `New company notice`.
- Composer submit: `Post notice`.
- Acknowledge button on a row: `Acknowledge <title>`.
- Delete button on a row: `Delete <title>`.

## Reusable signed-in fixtures

Reuses the two seeded Firebase accounts described in
`company-notices.test-plan.md`:

- **Admin** — `E2E_COMPANY_ADMIN_EMAIL` / `E2E_COMPANY_ADMIN_PASSWORD`
  (context short name `admin`): owner or `manageTeam` / `isAdmin` seat
  on at least one `trade_pro` company outward account.
- **Member** — `E2E_COMPANY_MEMBER_EMAIL` / `E2E_COMPANY_MEMBER_PASSWORD`
  (context short name `member`): accepted, non-removed, NON-admin seat
  on the same company.

Both must already have completed onboarding. If either secret is missing,
report `unable` instead of attempting a broken sign-in.

The two "context short name" tags are the identifiers the dual-context
screenshot helper uses when it names the per-step PNG files (see
"Screenshot capture" below); pin them here so the file names are
predictable from reading the plan alone.

This test additionally needs to know `recipientCount` for assertion
strings. Capture it dynamically from the admin's first render of the
notice (see step 8) so the test stays correct as seats are added or
removed from the seeded company.

## Screenshot capture

This plan opts in to the dual-context screenshot helper at
`artifacts/round-house/e2e/dual-context-screenshots.md`. The helper
defines the storage layout, file-name convention, and capture
cadence (failing-step + section-boundary + final-state). The runner
should follow it verbatim; everything below is the plan-specific
configuration.

- **Plan slug** (storage directory): `company-notice-read-receipts`
- **Short slug** (PNG file-name prefix): `company-notice-read-receipts`
- **Storage directory**:
  `artifacts/round-house/e2e/screenshots/company-notice-read-receipts/`
  — recreate empty at the start of every run so re-runs do not mix
  evidence with a previous run.
- **Context short names**: `admin` (the notice author) and `member`
  (the non-admin recipient). Pinned on the fixtures bullets above.
- **Section labels**: this plan groups its steps into sections A–C
  (`### A. Admin posts a notice`, `### B. Non-admin member sees no
  read-by row`, `### C. Admin sees the count + acknowledger update`).
  The helper uses those letters directly in the PNG name (e.g.
  `company-notice-read-receipts-stepA-admin.png`). The member context
  is not opened until step 9 (start of section B), so the section A
  capture only writes the `-admin.png`; the `-member.png` slot for
  section A is `(n/a)` in the sibling results file.
- **Sibling results file**:
  `artifacts/round-house/e2e/company-notice-read-receipts.results.md`.
  After a run, fill in its "Per-step screenshots" table (one row
  per section) and its "Run summary" table; the file already contains
  the full set of expected file paths so a reviewer can scan it
  without consulting this plan.

The helper requires a snapshot of every open context **on any
[Verify] failure**. For this plan that's a hard requirement, not a
nice-to-have: section B's negative-guard verify (no `Acknowledged by`
row for the member) and section C's post-ack count verify both read
state the *other* context produced (admin posted the notice; member
acknowledged it), so a paired snapshot is the only way to localize
the regression to the right side of the wire on a flaky run.

## Plan

### A. Admin posts a notice

1. [New Context — Admin] Create a fresh browser context. Install a global
   `page.on('dialog')` handler that accepts every dialog (`dialog.accept()`).
2. [Browser] Navigate to `/(auth)/sign-in`. Sign in as
   `E2E_COMPANY_ADMIN_*`. Wait for navigation to leave `/(auth)/sign-in`.
   If the URL settles on `/(onboarding)/...`, stop and report `unable`.
3. [Browser] Navigate to `/reminders`.
4. [Verify] The `Company Reminders` section is visible. The
   `Post a company notice` button is rendered (otherwise the admin
   fixture isn't actually admin of any postable company — report
   `unable`).
5. [Browser] Tap `Post a company notice`. In the `New company notice`
   modal, fill in:
   - Title: `E2E read-receipts <timestamp>` — capture as `noticeTitle`.
   - Body: `Posted by the read-receipts e2e at <ISO timestamp>`.
   - If the modal shows a company picker, pick the first option and
     remember its label as `companyLabel` for diagnostics.
6. [Browser] Tap `Post notice`. Wait for the modal to close.
7. [Verify] A `CompanyNoticeRow` whose visible title equals `noticeTitle`
   appears in `Company Reminders`. The row exposes both
   `Acknowledge <noticeTitle>` and `Delete <noticeTitle>` (admin authored
   it, so `canDelete` is true).
8. [Verify — read-by row, pre-ack]
   - Inside the `noticeTitle` row, locate the `NoticeReadByRow` by
     finding the visible text starting with `Acknowledged by`.
   - Assert the visible summary matches the regex
     `^Acknowledged by 0 of (\d+)$`. Capture the `\d+` group as
     `recipientCount` (an integer ≥ 1; if it's 0, that's a server
     regression — fail the test).
   - Assert there is NO names line below the summary (no acknowledgers
     yet, so the names `Text` should not be rendered).
   - Soft visual check: a single fallback avatar bubble (people glyph)
     is shown, not a stack of three.

[Capture — section A] Per the dual-context screenshot helper
(`./dual-context-screenshots.md`), snapshot the admin context now —
it is parked on `/reminders` after the post-notice modal closed
in step 6 and step 8 just verified the pre-ack `Acknowledged by 0
of N` row. Save as
`screenshots/company-notice-read-receipts/company-notice-read-receipts-stepA-admin.png`.
The member context is not yet open (it gets created in step 9), so
the `-member.png` slot for this section is `(n/a)` and the
sibling results file records it as such. If any verify in this
section already failed, capture immediately at the failing step
instead of at the section boundary — the helper requires a
snapshot of every open context **on any [Verify] failure**, before
moving on.

### B. Non-admin member sees no read-by row

9. [New Context — Member] Open a second, isolated browser context.
   Install the same dialog handler.
10. [Browser] Navigate to `/(auth)/sign-in`. Sign in as
    `E2E_COMPANY_MEMBER_*`. Verify it lands outside `/(auth)/sign-in`
    and outside `/(onboarding)/...`.
11. [Browser] Navigate to `/reminders`.
12. [Verify] A `CompanyNoticeRow` with title `noticeTitle` is visible in
    `Company Reminders`, with an `Acknowledge <noticeTitle>` button and
    NO `Delete <noticeTitle>` button (covered for completeness).
13. [Verify — read-by row hidden for non-admin]
    - Scoped to the `noticeTitle` row, assert there is NO visible text
      starting with `Acknowledged by`. Across the whole
      `Company Reminders` section, no `Acknowledged by` substring may
      appear inside the `noticeTitle` row container.
    - The `Post a company notice` button is also NOT rendered for this
      member (sanity that the fixture is non-admin).
14. [Browser] Tap `Acknowledge <noticeTitle>`. Wait for the network
    request to settle (POST `/company-notices/:id/acknowledge`).
15. [Verify] The `noticeTitle` row is no longer in the section (member's
    own ack hides it from their list).

[Capture — section B] Snapshot both contexts. The admin context is
still parked on `/reminders` from section A and has NOT been
re-navigated yet (intentional — capturing it here proves the admin
side has not yet refetched, so any change visible on the admin
side at this moment is a stale-cache regression, not a missing
ack). The member context is on `/reminders` after the row
disappeared post-ack. Save as
`company-notice-read-receipts-stepB-admin.png` and
`company-notice-read-receipts-stepB-member.png`. The member PNG is
the headline triage piece for the negative-guard verify in step
13 — if a future regression makes the read-by row appear for
non-admins, the member snapshot shows exactly which strings were
rendered.

### C. Admin sees the count + acknowledger update

16. [Browser — Admin context from step 1] Switch back to the admin
    context and re-navigate to `/reminders` (in-app navigation; the
    list refetches on focus). Wait for the `noticeTitle` row to be
    visible again.
17. [Verify — read-by row, post-ack]
    - Inside the `noticeTitle` row, the `Acknowledged by` summary now
      reads exactly `Acknowledged by 1 of ${recipientCount}` (use the
      integer captured in step 8).
    - The names line below the summary is now rendered and contains
      the member's display name. Acceptable matchers, in priority
      order:
        1. The exact `users.name` value seeded for the member fixture
           (preferred — set `E2E_COMPANY_MEMBER_DISPLAY_NAME` if the
           seed knows it).
        2. `@<username>` for the seeded member username.
        3. The literal fallback `Team member` (only if neither name nor
           username is on the seed — flag as a soft warning, the
           admin UI should normally show a real label).
    - At most one name is listed (no stray `, ` separator, no `+N`
      overflow suffix, since `acks.length === 1`).
    - Soft visual check: the avatar stack now shows the member's
      avatar — either an `Image` (if `avatarUrl` is set on the seeded
      user) or a single `noticeAvatarFallback` bubble whose initial
      matches `ackInitial(member)` (first letter of the display name,
      uppercased). It is not the empty `users` glyph from step 8.

[Capture — section C] Snapshot both contexts. The admin context is
on the refetched `/reminders` (the surface under test for section
C's verifies — the post-ack count and acknowledger name). The
member context is unchanged from section B (still parked on
`/reminders` after the own-ack hid the row). Save as
`company-notice-read-receipts-stepC-admin.png` and
`company-notice-read-receipts-stepC-member.png`. The admin PNG is
the headline piece of triage evidence — if step 17's `Acknowledged
by 1 of N` or the names-line assertion fails, the admin snapshot
shows exactly which strings were rendered, while the member
snapshot proves the member's own-ack-hid-row state still holds
(rules out "the member retracted the ack between B and C").

[Capture — final state, always-run] Per the helper's "end of the
run regardless of pass/fail" rule, the section C captures double
as the run's final-state snapshots. Section A's admin capture is
also retained as the pre-ack baseline. The cleanup steps below
delete the seeded notice, so no extra captures are needed after
section C unless an earlier section already failed (in which case
the runner has captured per-failure snapshots at the failing step
already).

### Cleanup

18. [Browser — Admin] In the admin context, locate the `noticeTitle`
    row, tap `Delete <noticeTitle>`, and let the dialog handler accept
    the confirmation.
19. [Verify] The `noticeTitle` row is gone from the admin's view,
    restoring the company's notices to their pre-test state so re-runs
    start clean. Member-side cleanup is implicit — they already
    acknowledged in step 14, so the row was already absent for them.

## Regressions this catches

- Server stops differentiating admin vs. non-admin and starts returning
  `acks` to everyone → step 13 fails (member sees the read-by row).
- Server stops returning `acks` to admins / senders → step 8 or step 17
  fails (admin can't see the row at all).
- `ackCount` isn't incremented after the member acks (e.g. the ack route
  doesn't insert a row, or the GET handler doesn't recount) → step 17's
  `Acknowledged by 1 of N` assertion fails.
- `recipientCount` regresses to 0 (e.g. the seats query is dropped or
  filtered incorrectly) → step 8's regex extraction fails.
- The avatar stack stops rendering acknowledger avatars after at least
  one ack → step 17's avatar visual check fails.
- The names line under the summary stops rendering when `acks.length > 0`
  → step 17's "names line is now rendered" assertion fails.

## Notes for native (iOS / Android) runs

- Sign-in uses the same `app/(auth)/sign-in.tsx` form as the parent
  company-notices plan. Drive both fixtures through that screen.
- The `NoticeReadByRow` is rendered identically on native; locate it
  by the visible `Acknowledged by` text scoped to the notice card,
  same as on web.
- Native delete confirmation uses `Alert.alert("Delete <title>?", …)`
  rather than `window.confirm`; tap the destructive option in the
  system alert during step 18.

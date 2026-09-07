# Company notice read receipts SHEET — end-to-end test plan

Use with the project's UI testing tool (Playwright-driven). Run against
the Roundhouse Expo web preview.

This plan covers task #497: tapping the "Acknowledged by …" row on a
`CompanyNoticeRow` opens a `NoticeReadReceiptsSheet` modal that lists
acknowledgers under "Read by" and (for admins) the still-pending
recipients under "Still waiting on". A non-admin recipient must not be
able to open the sheet at all (the row is not rendered for them, since
the API returns `acks: null`).

This complements `company-notice-read-receipts.test-plan.md` (which only
asserts the inline summary row) and `company-notices.test-plan.md`
(which only covers post / acknowledge / delete).

## Context

- Reminders route: `/reminders` (renders `app/reminders.tsx`).
- Components under test (same file):
  - `NoticeReadByRow` — the inline summary that the user taps.
  - `NoticeReadReceiptsSheet` — the modal that opens with the two
    sections.
- Server gate, `artifacts/api-server/src/routes/companyNotices.ts`:
  - `acks: isAdmin || isSender ? noticeAcks : null`
  - `pendingMembers` populated only when `isAdmin` is true.
- The sheet is rendered as an RN `Modal` with `transparent` backdrop;
  on web Expo, the modal content is portalled into the DOM and the
  backdrop is a `Pressable` that closes the sheet via `onClose`.

## Selectors / accessibility contract

- Inline summary row (the tap target):
  - `accessibilityRole="button"`
  - `accessibilityLabel`: `See everyone who has read <noticeTitle>. <summary>.`
    where `<summary>` is `Acknowledged by N of M` (or `Acknowledged by N`
    when total is 0). Match by the `See everyone who has read` prefix
    plus the literal `noticeTitle`.
- Sheet header text: `Read receipts`.
- Sheet subtitle: `<noticeTitle> · N of M acknowledged` (or `N
  acknowledged` when total is 0).
- Section headings inside the sheet:
  - `Read by (<acks.length>)`
  - `Still waiting on (<pendingMembers.length>)` (admin only)
- Per-row content inside `Read by`: the acknowledger's display name
  (`users.name` or `@username` or the fallback `Team member`) and a
  meta line `Read <relative time>` (e.g. `Read just now`,
  `Read 2 minutes ago`).
- Close button: `accessibilityLabel="Close read receipts"`.
- Composer / acknowledge / delete labels reused from
  `company-notices.test-plan.md`.

## Reusable signed-in fixtures

Same two seeded Firebase accounts as
`company-notice-read-receipts.test-plan.md`:

- **Admin** — `E2E_COMPANY_ADMIN_EMAIL` / `E2E_COMPANY_ADMIN_PASSWORD`
  (context short name `admin`): owner or `manageTeam` / `isAdmin` seat
  on at least one `trade_pro` company outward account.
- **Member** — `E2E_COMPANY_MEMBER_EMAIL` / `E2E_COMPANY_MEMBER_PASSWORD`
  (context short name `member`): accepted, non-removed, NON-admin seat
  on the same company.

Both must already have completed onboarding. If either secret is
missing, report `unable` instead of attempting a broken sign-in.

The two "context short name" tags are the identifiers the dual-context
screenshot helper uses when it names the per-step PNG files (see
"Screenshot capture" below); pin them here so the file names are
predictable from reading the plan alone.

## Screenshot capture

This plan opts in to the dual-context screenshot helper at
`artifacts/round-house/e2e/dual-context-screenshots.md`. The helper
defines the storage layout, file-name convention, and capture
cadence (failing-step + section-boundary + final-state). The runner
should follow it verbatim; everything below is the plan-specific
configuration.

- **Plan slug** (storage directory): `company-notice-read-receipts-sheet`
- **Short slug** (PNG file-name prefix): `company-notice-receipts-sheet`
- **Storage directory**:
  `artifacts/round-house/e2e/screenshots/company-notice-read-receipts-sheet/`
  — recreate empty at the start of every run so re-runs do not mix
  evidence with a previous run.
- **Context short names**: `admin` (the notice author who opens the
  sheet) and `member` (the non-admin recipient who must NOT be able
  to open the sheet at all). Pinned on the fixtures bullets above.
- **Section labels**: this plan groups its steps into sections A–C
  (`### A. Admin posts a notice`, `### B. Member acknowledges so the
  sheet has both sections`, `### C. Admin opens the sheet and sees
  both sections`). The helper uses those letters directly in the PNG
  name (e.g. `company-notice-receipts-sheet-stepA-admin.png`).
  Section C captures twice — once after the close-button dismissal
  (`stepC1`) and once after the backdrop dismissal (`stepC2`) —
  since each is a distinct dismissal contract step 20 / step 22
  guards independently. The member context is not opened until
  step 8 (start of section B), so the section A capture only writes
  the `-admin.png`; the `-member.png` slot for section A is `(n/a)`
  in the sibling results file.
- **Sibling results file**:
  `artifacts/round-house/e2e/company-notice-read-receipts-sheet.results.md`.
  After a run, fill in its "Per-step screenshots" table (one row
  per section) and its "Run summary" table; the file already contains
  the full set of expected file paths so a reviewer can scan it
  without consulting this plan.

The helper requires a snapshot of every open context **on any
[Verify] failure**. For this plan that's a hard requirement, not a
nice-to-have: section B's negative-guard verify (no `Acknowledged by`
row and no openable sheet for the member) and section C's `Read by`
+ `Still waiting on` verifies both depend on the *other* context's
state (admin posted; member acknowledged), so a paired snapshot is
the only way to localize the regression to the right side of the
wire on a flaky run.

## Plan

### A. Admin posts a notice

1. [New Context — Admin] Create a fresh browser context. Install a
   global `page.on('dialog')` handler that accepts every dialog
   (`dialog.accept()`).
2. [Browser] Navigate to `/(auth)/sign-in`. Sign in as
   `E2E_COMPANY_ADMIN_*`. Wait for navigation to leave
   `/(auth)/sign-in`. If the URL settles on `/(onboarding)/...`, stop
   and report `unable`.
3. [Browser] Navigate to `/reminders`.
4. [Verify] The `Company Reminders` section is visible. The
   `Post a company notice` button is rendered (otherwise the admin
   fixture isn't actually admin of any postable company — report
   `unable`).
5. [Browser] Tap `Post a company notice`. In the `New company notice`
   modal, fill in:
   - Title: `E2E sheet <timestamp>` — capture as `noticeTitle`.
   - Body: `Posted by the read-receipts-sheet e2e at <ISO timestamp>`.
   - If the modal shows a company picker, pick the first option.
6. [Browser] Tap `Post notice`. Wait for the modal to close.
7. [Verify] A `CompanyNoticeRow` whose visible title equals
   `noticeTitle` appears in `Company Reminders`. The inline read-by
   row inside it shows summary text matching
   `^Acknowledged by 0 of (\d+)$`. Capture the integer as
   `recipientCount`.

[Capture — section A] Per the dual-context screenshot helper
(`./dual-context-screenshots.md`), snapshot the admin context now —
it is parked on `/reminders` after the post-notice modal closed in
step 6 and step 7 just verified the new row plus the `Acknowledged
by 0 of N` summary. Save as
`screenshots/company-notice-read-receipts-sheet/company-notice-receipts-sheet-stepA-admin.png`.
The member context is not yet open (it gets created in step 8), so
the `-member.png` slot for this section is `(n/a)` in the sibling
results file. If any verify in this section already failed,
capture immediately at the failing step instead of at the section
boundary — the helper requires a snapshot of every open context
**on any [Verify] failure**, before moving on.

### B. Member acknowledges so the sheet has both sections

8. [New Context — Member] Open a second isolated browser context.
   Install the same dialog handler.
9. [Browser] Navigate to `/(auth)/sign-in`. Sign in as
   `E2E_COMPANY_MEMBER_*`. Verify it lands outside `/(auth)/sign-in`
   and outside `/(onboarding)/...`.
10. [Browser] Navigate to `/reminders`.
11. [Verify — sheet is unavailable to a non-admin recipient]
    - The `noticeTitle` row is visible inside `Company Reminders`.
    - Inside that row, there is NO visible text starting with
      `Acknowledged by` (the `NoticeReadByRow` is not rendered because
      `notice.acks` is `null` on the API response for this user).
    - Confirm by attempting to find an element whose
      `accessibilityLabel` starts with `See everyone who has read
      <noticeTitle>` — it must not exist.
    - As a stronger negative check: even if a future regression makes
      the row appear, tapping anywhere inside the `noticeTitle` row
      area must NOT open a `Read receipts` modal. Assert that the
      heading text `Read receipts` is not visible after a 500 ms wait.
12. [Browser] Tap `Acknowledge <noticeTitle>` and wait for the network
    request to settle. The row disappears from this member's list
    (own-ack hides it).

[Capture — section B] Snapshot both contexts. The admin context is
unchanged from section A — still parked on `/reminders` and not
yet refetched (intentional; capturing here proves the producer
side has not yet seen the ack). The member context is on
`/reminders` after the row disappeared post-ack; step 11's
negative-guard verify (`Read receipts` heading must NOT be
visible) is the headline assertion this snapshot supports. Save as
`company-notice-receipts-sheet-stepB-admin.png` and
`company-notice-receipts-sheet-stepB-member.png`. The member PNG
is the headline triage piece — a `Read receipts` heading appearing
inside the member's DOM here would mean the negative-guard
regressed.

### C. Admin opens the sheet and sees both sections

13. [Browser — Admin context from step 1] Switch back to the admin
    context and re-navigate to `/reminders` to refetch. Wait for the
    `noticeTitle` row to be visible again.
14. [Verify — inline row updated] Inside the `noticeTitle` row, the
    summary now reads `Acknowledged by 1 of ${recipientCount}`. The
    names line below contains the acknowledging member's display name
    (preferred `users.name`; otherwise `@username`; flag `Team member`
    as a soft warning).
15. [Browser] Tap the `NoticeReadByRow` summary row inside the
    `noticeTitle` card. Match it by the
    `accessibilityLabel="See everyone who has read <noticeTitle>. …"`
    selector defined above.
16. [Verify — sheet header]
    - The heading `Read receipts` is visible.
    - The subtitle line under it contains both `noticeTitle` and
      `1 of ${recipientCount} acknowledged`.
    - The `Close read receipts` button is visible.
17. [Verify — Read by section]
    - A section heading `Read by (1)` is visible.
    - Exactly one acknowledger row is rendered under it. Its name
      matches the member fixture's display name (priority order from
      step 14).
    - The row's meta line starts with the literal `Read ` (e.g.
      `Read just now`, `Read 1 minute ago`). The exact relative-time
      string is environment-dependent — assert the prefix only.
    - Soft visual check: an avatar (image or initial bubble) is
      rendered to the left of the name.
18. [Verify — Still waiting on section]
    - A section heading `Still waiting on (N)` is visible where `N`
      equals `recipientCount - 2` (recipients minus the sender minus
      the one acknowledger). `N` must be ≥ 0; if `N === 0` the section
      heading must NOT be rendered (the component only renders the
      header when `pendingMembers.length > 0`).
    - When `N > 0`, at least one pending row is rendered with a
      visible display name. Neither the admin sender's name nor the
      acknowledging member's name appears in this section.
19. [Browser] Click the `Close read receipts` button.
20. [Verify — close returns to reminders cleanly]
    - The `Read receipts` heading is no longer visible.
    - The `Reminders` screen is still mounted: the `Company
      Reminders` section header and the `noticeTitle` row are both
      still visible at their pre-open positions.
    - The inline summary still reads `Acknowledged by 1 of
      ${recipientCount}` (the close did not mutate state).

[Capture — section C1] Snapshot both contexts immediately after step
20's close-button verify. Admin is back on `/reminders` with the
sheet dismissed via the close button; member is unchanged from
section B (still on `/reminders` after the own-ack). Save as
`company-notice-receipts-sheet-stepC1-admin.png` and
`company-notice-receipts-sheet-stepC1-member.png`. The admin PNG
is the headline triage piece for steps 16–20: it captures the
sheet-just-closed state and proves the close button restored the
inline summary to `Acknowledged by 1 of N`.

21. [Browser] Re-open the sheet by tapping the inline row again, then
    dismiss it by tapping the backdrop (anywhere outside the white
    sheet body, e.g. near the top of the viewport).
22. [Verify] The `Read receipts` heading is no longer visible — the
    backdrop press also closes the sheet — and the reminders list is
    intact (same assertions as step 20).

[Capture — section C2] Snapshot both contexts immediately after step
22's backdrop-dismissal verify. Admin is back on `/reminders` with
the sheet dismissed via the backdrop; member is unchanged from
section B. Save as `company-notice-receipts-sheet-stepC2-admin.png`
and `company-notice-receipts-sheet-stepC2-member.png`. The admin
PNG is the headline triage piece for the backdrop-dismissal
contract — if step 22 fails, this snapshot shows whether the
sheet stayed mounted (modal still in DOM) or whether the
underlying reminders list got disturbed.

[Capture — final state, always-run] Per the helper's "end of the
run regardless of pass/fail" rule, the section C2 captures double
as the run's final-state snapshots. Section A's admin capture and
section B's pair are also retained as the pre-ack baseline and
the negative-guard moment. The cleanup steps below delete the
seeded notice, so no extra captures are needed after section C2
unless an earlier section already failed (in which case the
runner has captured per-failure snapshots at the failing step
already).

### Cleanup

23. [Browser — Admin] Locate the `noticeTitle` row, tap
    `Delete <noticeTitle>`, and let the dialog handler accept the
    confirmation.
24. [Verify] The `noticeTitle` row is gone from the admin's view.
    Member-side cleanup is implicit — they already acknowledged in
    step 12.

## Regressions this catches

- Sheet stops opening when the row is tapped → step 16 fails.
- "Read by" section omits an acknowledger or shows the wrong name /
  relative time → step 17 fails.
- "Still waiting on" leaks to non-admins (e.g. server starts
  populating `pendingMembers` for plain members) → step 11's negative
  check fails (the row would render and the sheet would open with a
  pending list).
- Sender accidentally re-appears in `pendingMembers` → step 18's "no
  sender / no acknowledger in pending" assertion fails.
- Closing the sheet leaves the modal mounted or navigates away from
  reminders → step 20 fails.
- Backdrop press stops dismissing the sheet → step 22 fails.

## Notes for native (iOS / Android) runs

- The sheet is the same RN `Modal`; locate it on device by the
  `Read receipts` heading scoped to the modal layer.
- The close button keeps its `accessibilityLabel="Close read
  receipts"`, so accessibility-driven device drivers work without
  changes.
- Backdrop dismissal works the same (tap outside the sheet body).

# Company notice NUDGE button — end-to-end test plan

Use with the project's UI testing tool (Playwright-driven). Run against
the Roundhouse Expo web preview.

This plan covers task #499: the per-member **Nudge** button rendered
inside `NoticeReadReceiptsSheet` (`artifacts/round-house/app/reminders.tsx`)
under the **Still waiting on** section. The button is admin-only,
disables itself once a nudge is in flight, and switches to a disabled
**Sent** pill once the server confirms. A second tap (or a second admin
within the 24h rate-limit window) must surface an `Already nudged`
alert without firing another network request beyond the one rejected
with HTTP 429.

This complements:
- `company-notice-read-receipts.test-plan.md` — inline "Acknowledged
  by N of M" summary row.
- `company-notice-read-receipts-sheet.test-plan.md` — the sheet itself
  (header, Read by, Still waiting on, close + backdrop dismissal).

## Context

- Reminders route: `/reminders` (renders `app/reminders.tsx`).
- Components under test (same file):
  - `NoticeReadReceiptsSheet` — the modal opened by tapping the inline
    `NoticeReadByRow` summary on a `CompanyNoticeRow`.
  - The per-row Nudge `TouchableOpacity` rendered for every entry under
    the **Still waiting on** section. Driven by local `nudgeState`
    (`"pending" | "sent"` keyed by `memberClerkId`) and the
    `useNudgeCompanyNoticeMember()` mutation.
- Server endpoint:
  `POST /company-notices/:noticeId/nudge`
  (`artifacts/api-server/src/routes/companyNotices.ts`).
  - `403` — caller isn't an admin / `manageTeam` of the notice's
    company.
  - `400` — recipient is the sender, or has already acknowledged.
  - `404` — recipient isn't a current accepted seat / owner.
  - `429` — same `(notice, member)` pair was nudged inside the
    `NUDGE_RATE_LIMIT_MS` (24h) window. Body includes
    `nextEligibleAt`.
  - `200` — returns `{ noticeId, memberClerkId, nudgedAt,
    nextEligibleAt }`. Side effect: a `company_notice_nudge` row is
    inserted into `notifications` for the recipient (push is
    best-effort).
- Client transitions, per `handleNudge` in `NoticeReadReceiptsSheet`:
  - Idle → tap → `pending` (button shows spinner, `disabled=true`).
  - `pending` → 200 OK → `sent` (button label `Sent`, check icon,
    `disabled=true`).
  - `pending` → 429 → `sent` AND a native alert
    `Alert.alert("Already nudged", "<name> was reminded recently. Try
    again tomorrow.")`.
  - `pending` → any other error → state cleared (button returns to
    `Nudge`) AND a native alert
    `Alert.alert("Couldn't send reminder", "Please try again.")`.
  - Tapping the button while `pending` or `sent` is a no-op (early
    return; no network request).
- The `nudgeState` map is reset whenever the sheet is closed (`useEffect`
  on `visible`). Re-opening the sheet shows whatever the server
  currently reports — `Sent` does NOT persist across opens unless the
  server has actually rate-limited the next attempt.

## Selectors / accessibility contract

- Inline summary row (tap target that opens the sheet):
  `accessibilityRole="button"`, `accessibilityLabel` starts with
  `See everyone who has read <noticeTitle>.`
- Sheet header: visible text `Read receipts`.
- Sheet close button: `accessibilityLabel="Close read receipts"`.
- Section heading: `Still waiting on (<N>)`.
- Per-pending-member Nudge button:
  `accessibilityRole="button"` and either of these
  `accessibilityLabel`s, depending on state:
  - Idle / pending: `Send reminder to <displayName>`.
  - Sent (after 200 or after observing 429): `Reminder sent to
    <displayName>`.
  - `accessibilityState.disabled` is `true` while pending or sent.
  - Visible label text: `Nudge` (idle), spinner only (pending — no
    text), `Sent` (after success / 429).
- Native alerts surfaced via `Alert.alert(...)`:
  - On 429: title `Already nudged`, body
    `<displayName> was reminded recently. Try again tomorrow.`
  - On other errors: title `Couldn't send reminder`, body
    `Please try again.`
  - On Expo web these render through the Expo `Alert` polyfill which
    delegates to `window.alert` / `window.confirm`. Capture them via the
    standard `page.on('dialog')` handler that accepts every dialog.

## Reusable signed-in fixtures

Same two seeded Firebase accounts as the read-receipts plans:

- **Admin** — `E2E_COMPANY_ADMIN_EMAIL` / `E2E_COMPANY_ADMIN_PASSWORD`
  (context short name `admin`): owner or `manageTeam` / `isAdmin`
  seat on at least one `trade_pro` company outward account.
- **Member** — `E2E_COMPANY_MEMBER_EMAIL` / `E2E_COMPANY_MEMBER_PASSWORD`
  (no browser context — DB-only fixture in this plan): accepted,
  non-removed, NON-admin seat on the same company. Must NOT
  acknowledge the test notice during this run (the nudge button only
  appears for un-acknowledged members, so an ack would empty the
  Still waiting on list).

Both must already have completed onboarding. If either secret is
missing, report `unable` instead of attempting a broken sign-in.

A second admin fixture is OPTIONAL:

- **Admin 2** — `E2E_COMPANY_ADMIN_2_EMAIL` /
  `E2E_COMPANY_ADMIN_2_PASSWORD` (context short name `admin2`): a
  different owner / `isAdmin` / `manageTeam` seat on the SAME company
  as the primary admin. Used by step E to prove the 24h server rate
  limit applies across admins, not just within a single client
  session. If this fixture is missing, SKIP step E and report it as
  `skipped` (don't fail the run) — the in-session "second tap is a
  no-op" check from step D still proves the disabled state holds
  for the local admin.

The "context short name" tags are the identifiers the dual-context
screenshot helper uses when it names the per-step PNG files (see
"Screenshot capture" below); pin them here so the file names are
predictable from reading the plan alone. The member fixture has no
browser context in this plan — it only exists as a DB seat the
admin can nudge — so it never produces a per-context screenshot.

## Screenshot capture

This plan opts in to the dual-context screenshot helper at
`artifacts/round-house/e2e/dual-context-screenshots.md`. The helper
defines the storage layout, file-name convention, and capture
cadence (failing-step + section-boundary + final-state). The runner
should follow it verbatim; everything below is the plan-specific
configuration.

- **Plan slug** (storage directory): `company-notice-nudge`
- **Short slug** (PNG file-name prefix): `company-notice-nudge`
- **Storage directory**:
  `artifacts/round-house/e2e/screenshots/company-notice-nudge/`
  — recreate empty at the start of every run so re-runs do not mix
  evidence with a previous run.
- **Context short names**: `admin` (always present — primary admin
  who posts the notice and drives sections A–D and F) and `admin2`
  (optional — second admin used only by section E to exercise the
  cross-admin 24h server rate limit). Pinned on the fixtures
  bullets above.
- **Section labels**: this plan groups its steps into sections A–F
  (`### A. Admin posts a notice ...`, `### B. Admin opens the
  read-receipts sheet ...`, `### C. First nudge transitions ...`,
  `### D. Second tap inside the same sheet is a client-side no-op`,
  `### E. (Optional) Second admin within 24h gets the 429 ...`,
  `### F. In-session repeat after re-opening the sheet ...`). The
  helper uses those letters directly in the PNG name (e.g.
  `company-notice-nudge-stepA-admin.png`). Section E's `-admin2.png`
  files are only written when the optional `admin2` fixture is
  set; if that fixture is missing, section E is skipped and the
  `-admin2.png` slots for sections A–F are all `(n/a)` in the
  sibling results file.
- **Sibling results file**:
  `artifacts/round-house/e2e/company-notice-nudge.results.md`.
  After a run, fill in its "Per-step screenshots" table (one row
  per section) and its "Run summary" table; the file already
  contains the full set of expected file paths so a reviewer can
  scan it without consulting this plan.

The helper requires a snapshot of every open context **on any
[Verify] failure**. For this plan that's a hard requirement, not a
nice-to-have: section C and F's "Sent" transitions, section D's
no-op-second-tap guard, and section E's 429 → `Already nudged`
alert all read state that lives partly on the server (the rate-
limit row inserted by the first 200) and partly on each client's
local `nudgeState` map, so a paired snapshot when both admin
contexts are open is the only way to localize a flake to the
right side of the wire.

## Plan

### A. Admin posts a notice with at least one pending member

1. [New Context — Admin] Create a fresh browser context. Install a
   global `page.on('dialog')` handler that records the most recent
   dialog's `message` and `type`, then calls `dialog.accept()`. Tests
   below assert on the recorded message.
2. [Browser] Navigate to `/(auth)/sign-in`. Sign in as
   `E2E_COMPANY_ADMIN_*`. Wait for navigation to leave
   `/(auth)/sign-in`. If the URL settles on `/(onboarding)/...`, stop
   and report `unable`.
3. [Browser] Navigate to `/reminders`.
4. [Verify] The `Company Reminders` section is visible and the
   `Post a company notice` button is rendered. If not, the admin
   fixture isn't actually admin of any postable company — report
   `unable`.
5. [Browser] Tap `Post a company notice`. In the `New company notice`
   modal, fill in:
   - Title: `E2E nudge <timestamp>` — capture as `noticeTitle`.
   - Body: `Posted by the nudge e2e at <ISO timestamp>`.
   - If the modal shows a company picker, pick the first option
     (must be the same company the member fixture is seated on).
6. [Browser] Tap `Post notice`. Wait for the modal to close.
7. [Verify] A `CompanyNoticeRow` whose visible title equals
   `noticeTitle` appears in `Company Reminders`. The inline summary
   row reads `Acknowledged by 0 of (\d+)` — capture the integer as
   `recipientCount`. If `recipientCount < 2` (admin sender plus at
   least one other recipient) the company doesn't have a pending
   teammate to nudge; report `unable`.

[Capture — section A] Per the dual-context screenshot helper
(`./dual-context-screenshots.md`), snapshot the admin context now
— it is parked on `/reminders` after the post-notice modal closed
in step 6 and step 7 just verified the new row plus the pre-ack
`Acknowledged by 0 of N` summary. Save as
`screenshots/company-notice-nudge/company-notice-nudge-stepA-admin.png`.
The optional `admin2` context is not yet open (it gets created in
step 15 inside section E if at all), so the `-admin2.png` slot
for this section is `(n/a)` in the sibling results file.

### B. Admin opens the read-receipts sheet and locates the Nudge button

8. [Browser] Tap the inline read-by row (selector
   `accessibilityLabel` prefix `See everyone who has read
   <noticeTitle>.`). Wait for the `Read receipts` heading to render.
9. [Verify — sheet is in pre-nudge state]
   - Heading `Read receipts` is visible.
   - `Read by (0)` section is rendered with the empty-state text
     `No one has acknowledged this notice yet.` (no one has acked
     yet).
   - `Still waiting on (M)` section is rendered with `M ===
     recipientCount - 1` (sender excluded). `M` must be ≥ 1.
   - At least one row in `Still waiting on` exposes an
     `accessibilityLabel` matching `Send reminder to <displayName>`.
     Capture the FIRST such row's `displayName` as `targetName` and
     its accessibilityLabel target as `targetLocator`. Prefer a row
     whose `displayName` corresponds to the `E2E_COMPANY_MEMBER_*`
     fixture (preferred matchers, in priority order: exact
     `users.name`, then `@username`, then any non-`Team member`
     label) so step C can later confirm the recipient observed the
     nudge if needed; otherwise just take the first row.
   - The chosen row's `accessibilityState.disabled` is `false`.
   - The chosen row's visible label text is `Nudge` (NOT `Sent`,
     and no spinner).

[Capture — section B] Snapshot the admin context immediately after
step 9's pre-nudge sheet verifies. The `Read receipts` modal is
open over `/reminders`, the `Read by (0)` empty state is visible,
and the `Still waiting on (M)` section shows `Nudge` buttons in
their idle state — `targetName` and `targetLocator` were just
captured. Save as `company-notice-nudge-stepB-admin.png`. The
`-admin2.png` slot is `(n/a)` (admin2 not yet open).

### C. First nudge transitions Nudge → pending → Sent

10. [Browser] Tap `targetLocator` (the Nudge button for `targetName`).
    Immediately — before the network request resolves — assert at
    least one of:
    - `accessibilityState.disabled` is `true`, OR
    - the button's visible content is a spinner / `ActivityIndicator`
      and the literal text `Nudge` is no longer rendered inside it.
    (This is the `pending` state. On a fast localhost it may resolve
    quickly; if both observations miss the `pending` window that's a
    soft warning, not a failure, as long as step 11 passes.)
11. [Verify — post-success "Sent" state, after network settles]
    - The same row's button now has
      `accessibilityLabel="Reminder sent to <targetName>"`.
    - Its `accessibilityState.disabled` is `true`.
    - Its visible label text is `Sent` (the `Nudge` text is gone).
    - A `check` icon is rendered (Feather `check`); the `bell` icon
      from the idle state is gone. Assert via the rendered icon name
      attribute when reachable, or as a soft visual check otherwise.
    - No `Already nudged` or `Couldn't send reminder` dialog was
      observed by the dialog handler installed in step 1.
12. [Verify — server actually received the nudge]
    - The Network tab / request log records exactly one
      `POST /company-notices/<id>/nudge` since step 10, with status
      `200` and a JSON body containing `memberClerkId` matching the
      tapped row.
    - (Optional, only if a request inspector exposes payloads:) the
      response body includes `nudgedAt` and `nextEligibleAt` ISO
      strings, with `nextEligibleAt > nudgedAt`.

[Capture — section C] Snapshot the admin context immediately after
step 11's post-success "Sent" verify. The `Read receipts` modal is
still open; the `targetName` row now reads `Sent` with a check
icon and `accessibilityState.disabled === true`. Save as
`company-notice-nudge-stepC-admin.png`. This is the headline
triage piece for the Idle → pending → Sent transition; if step
11 fails, the snapshot shows whether the row stuck on the
spinner, reverted to `Nudge`, or rendered the wrong icon. The
`-admin2.png` slot is `(n/a)`.

### D. Second tap inside the same sheet is a client-side no-op

13. [Browser] Tap the same Nudge button (`targetLocator`) a second
    time. Wait 500 ms.
14. [Verify — no network, no state change]
    - The button still reads `Sent` and is still
      `accessibilityState.disabled === true`.
    - NO additional `POST /company-notices/<id>/nudge` request was
      issued (request count for this URL since step 10 is still
      exactly 1).
    - NO new dialog was raised by the dialog handler.
    - Other rows in `Still waiting on` are unaffected (their
      buttons still expose the idle `Send reminder to …` label and
      are still enabled).

[Capture — section D] Snapshot the admin context immediately after
step 14's "no network, no state change" verify. The `Read
receipts` modal is still open; the `targetName` row is still in
the `Sent` disabled state and the request count for `POST
/company-notices/<id>/nudge` is still exactly one. Save as
`company-notice-nudge-stepD-admin.png`. The PNG is the headline
triage piece for the disabled-state guard — if step 14's request-
count assertion fails, the snapshot lets a reviewer see whether
the button visually flipped back to `Nudge`/spinner before
re-firing or whether it stayed `Sent` while the network leaked
anyway. The `-admin2.png` slot is `(n/a)`.

### E. (Optional) Second admin within 24h gets the 429 → `Already nudged` alert

Run only if the optional `E2E_COMPANY_ADMIN_2_*` fixture is set and
seats the admin on the SAME company. Otherwise mark as `skipped` and
continue to the in-session repeat described in step F.

15. [New Context — Admin 2] Open a third isolated browser context.
    Install the same dialog-recording handler from step 1.
16. [Browser] Sign in as `E2E_COMPANY_ADMIN_2_*`. Navigate to
    `/reminders`.
17. [Verify] The `noticeTitle` row is visible in `Company Reminders`
    (proves admin 2 is on the same company); the inline summary
    still reads `Acknowledged by 0 of ${recipientCount}` (no acks
    yet).
18. [Browser] Tap the inline read-by row to open the sheet. Wait for
    `Read receipts` heading. In the `Still waiting on` section,
    locate the row for `targetName` (same display-name match as in
    step 9). The button should be in the IDLE state for admin 2:
    label `Nudge`, `accessibilityLabel="Send reminder to
    <targetName>"`, `disabled === false` — the `nudgeState` map is
    per-client, so admin 2 has no local memory of admin 1's nudge.
19. [Browser] Tap that Nudge button.
20. [Verify — 429 surfaces the "Already nudged" alert]
    - Exactly one `POST /company-notices/<id>/nudge` request was
      issued; its response status is `429`.
    - The recorded dialog's `message` matches
      `^${targetName} was reminded recently\. Try again tomorrow\.$`
      (Expo web flattens the `Alert.alert` title + message into a
      single dialog string; matching the message body is sufficient,
      and an additional check that the captured string CONTAINS
      `Already nudged` is acceptable as an OR).
    - After the dialog is dismissed, the button transitions to the
      `Sent` state for admin 2 as well: visible label `Sent`,
      `accessibilityLabel="Reminder sent to <targetName>"`,
      `disabled === true`. (Per `handleNudge`, 429 is treated as
      "already sent" client-side.)

[Capture — section E] Only when the optional `admin2` fixture is
set and section E ran. Snapshot BOTH admin contexts immediately
after step 20's post-dialog verify. Admin 1 is unchanged from
section D (still on the open `Read receipts` modal with the
`targetName` row in the `Sent` state). Admin 2 just observed the
429 and the dialog acceptance flipped its row to the same
`Sent` state. Save as `company-notice-nudge-stepE-admin.png` and
`company-notice-nudge-stepE-admin2.png`. The admin2 PNG is the
headline triage piece — if step 20's dialog-message regex or the
post-dialog `Sent` transition fails, the snapshot shows whether
the wrong alert text rendered or whether the button stuck on
`Nudge`. If the optional fixture is absent and section E is
skipped, both PNG slots for this section are `(n/a)` in the
sibling results file.

### F. In-session repeat after re-opening the sheet (run regardless of E)

21. [Browser — Admin 1 context from step 1] Close the sheet by
    tapping `Close read receipts`. Wait for the `Read receipts`
    heading to disappear.
22. [Browser] Re-open the sheet by tapping the inline read-by row on
    the same `noticeTitle` notice again.
23. [Verify — server-truth re-render after sheet reset]
    - The `Still waiting on (M)` section is rendered. The row for
      `targetName` is STILL visible (the recipient has not
      acknowledged), with one of the following observed states (both
      acceptable):
      a. The button is back in the IDLE state (`Nudge` label, idle
         `accessibilityLabel`, `disabled === false`) because the
         local `nudgeState` map was reset on close. This is the
         documented behaviour.
      b. The row is hidden because the server now reports the
         recipient as having acknowledged — only acceptable if the
         member fixture independently acked between steps; flag as a
         soft skip.
    - In case (a), tap the Nudge button once more. Verify the
      request returns `429`, the `Already nudged` dialog matching
      `<targetName> was reminded recently. Try again tomorrow.`
      fires, and the row settles back to the `Sent` disabled state
      (same assertions as step 20). Verify there is no
      `Couldn't send reminder` dialog (would indicate a non-429
      error path was hit by mistake).

[Capture — section F] Snapshot the admin context immediately after
step 23's post-re-open verifies. The `Read receipts` modal is
open again on admin 1; depending on the observed branch, the
`targetName` row reads either `Nudge` (case a, before the second
tap), `Sent` (case a, after the second tap + 429 dialog
dismissed), or is hidden (case b, soft-skip — recipient acked).
Save as `company-notice-nudge-stepF-admin.png`. The PNG is the
headline triage piece for the "nudgeState resets on close" guard:
if case (a) regresses, the row would still read `Sent` immediately
after re-open without going through the second-tap 429
round-trip. If the optional `admin2` context is still open from
section E, also save `company-notice-nudge-stepF-admin2.png`;
otherwise the `-admin2.png` slot is `(n/a)`.

[Capture — final state, always-run] Per the helper's "end of the
run regardless of pass/fail" rule, the section F captures double
as the run's final-state snapshots. Earlier section captures are
also retained as evidence of each transition. The cleanup steps
below delete the seeded notice; no extra captures are needed
after section F unless an earlier section already failed (in
which case the runner has captured per-failure snapshots at the
failing step already).

### Cleanup

24. [Browser — Admin 1] Close the sheet (`Close read receipts`).
    Locate the `noticeTitle` row in `Company Reminders`, tap
    `Delete <noticeTitle>`, and let the dialog handler accept the
    confirmation.
25. [Verify] The `noticeTitle` row is gone from the admin's view.
26. [Cleanup notes] The `company_notice_nudge` notification rows
    inserted in steps 11 and (optionally) 20/23 will remain in the
    recipient's inbox; they reference the deleted `noticeId` via
    `relatedId` and don't block re-runs (each run posts a new
    notice, so the rate-limit key `(memberClerkId, noticeId)` is
    fresh). No teardown SQL is required.

## Regressions this catches

- Nudge button stops appearing for admins (e.g. the `Still waiting on`
  section is gated behind a wrong flag) → step 9 fails to find a
  `Send reminder to …` row.
- Nudge button leaks to non-admins (e.g. server starts populating
  `pendingMembers` for plain members) → would be caught by
  `company-notice-read-receipts-sheet.test-plan.md` step 11; this
  plan additionally proves the button is wired to the admin sheet.
- Successful 200 response no longer flips the row to `Sent` /
  disabled (e.g. `setNudgeState((s) => ({ ...s, [id]: "sent" }))`
  is dropped) → step 11 fails.
- Disabled state regresses and the second tap re-fires the request
  → step 14's "request count is still 1" assertion fails.
- 429 is surfaced as the generic `Couldn't send reminder` alert
  instead of `Already nudged` (e.g. the `status === 429` branch is
  removed) → step 20 / step 23 dialog-message assertion fails.
- 429 stops flipping the row to `Sent` (e.g. only the alert fires)
  → step 20's post-dialog state check fails.
- A non-429 error path silently swallows the failure with no alert
  → step 23's "no `Couldn't send reminder` dialog" assertion would
  not catch it directly, but the `Sent` transition assertion would
  (button would stay on `Nudge`).
- `nudgeState` stops resetting on sheet close (e.g. the `useEffect`
  on `visible` is dropped) → step 23 case (a) would observe the
  button still saying `Sent` after re-open, causing the follow-up
  tap and 429 round-trip to be skipped.

## Notes for native (iOS / Android) runs

- The Nudge button is the same RN `TouchableOpacity`; locate it by the
  `Send reminder to <displayName>` / `Reminder sent to <displayName>`
  `accessibilityLabel`s, which work on both web and native a11y trees.
- `Alert.alert` on native pops a real system alert rather than going
  through `window.alert`. The `Already nudged` and `Couldn't send
  reminder` titles are rendered as the alert title (not flattened into
  the body the way Expo web does it); assert on the title field
  directly when the device driver exposes it, otherwise on the
  combined alert text.
- Push notifications fired by the server (`sendPushToUsers`) are
  out of scope for this plan — they're best-effort and the in-app
  notification row is the source of truth for the rate-limit window.

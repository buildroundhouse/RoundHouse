# Company notice read receipts SHEET — e2e run results (Task #497 plan + #702 helper)

**Plan:** `artifacts/round-house/e2e/company-notice-read-receipts-sheet.test-plan.md`
**Helper:** `artifacts/round-house/e2e/dual-context-screenshots.md`
**Run:** _fill in YYYY-MM-DD when this file is updated against a real run_
**Skins covered:** Company admin (`E2E_COMPANY_ADMIN_*`) ↔ non-admin
member seat (`E2E_COMPANY_MEMBER_*`).

This file is checked in **as a template** so subsequent runs have a
ready-to-fill scaffold — the per-section screenshot table, the
run-summary table, and the regression-evidence layout. Drop
run-specific notes inline, keep the layout, and replace the
`(pending)` placeholders with the actual PASS / FAIL / `(missing)`
values once the run completes.

## Run summary

| Section | Driver context | Surface under test | Status |
| --- | --- | --- | --- |
| A admin posts | admin | New `CompanyNoticeRow` shows `Acknowledged by 0 of N` (capture `recipientCount`) | (pending) |
| B member sees no openable sheet | member | `noticeTitle` row renders for the member with NO `Acknowledged by` text and NO openable `Read receipts` sheet; member acks and the row disappears | (pending) |
| C admin opens sheet, sees both sections, dismisses | admin | Sheet header + subtitle + `Read by (1)` + `Still waiting on (N-2)` + close-button + backdrop-dismiss all behave per contract | (pending) |

## Per-step screenshots

Storage: `artifacts/round-house/e2e/screenshots/company-notice-read-receipts-sheet/`
(recreated empty at the start of every run — see the helper).

| Section | Admin context | Member context | Notes |
| --- | --- | --- | --- |
| A admin posts | [stepA-admin](./screenshots/company-notice-read-receipts-sheet/company-notice-receipts-sheet-stepA-admin.png) | (n/a — member context not yet open) | Admin parked on `/reminders` after the post-notice modal closed in step 6; step 7 verified the new row plus the pre-ack `Acknowledged by 0 of N` summary. The member context is created in step 8 (start of section B). |
| B member sees no openable sheet | [stepB-admin](./screenshots/company-notice-read-receipts-sheet/company-notice-receipts-sheet-stepB-admin.png) | [stepB-member](./screenshots/company-notice-read-receipts-sheet/company-notice-receipts-sheet-stepB-member.png) | Admin unchanged from A (not yet refetched). Member snapshot is the negative-guard headline: a `Read receipts` heading or `Acknowledged by` substring inside the `noticeTitle` row container here is the regression. |
| C1 admin closes via close button | [stepC1-admin](./screenshots/company-notice-read-receipts-sheet/company-notice-receipts-sheet-stepC1-admin.png) | [stepC1-member](./screenshots/company-notice-read-receipts-sheet/company-notice-receipts-sheet-stepC1-member.png) | Admin snapshot captures the sheet-just-dismissed state via the close button; the inline summary should still read `Acknowledged by 1 of N` (the close did not mutate state). Member is unchanged from B. |
| C2 admin closes via backdrop | [stepC2-admin](./screenshots/company-notice-read-receipts-sheet/company-notice-receipts-sheet-stepC2-admin.png) | [stepC2-member](./screenshots/company-notice-read-receipts-sheet/company-notice-receipts-sheet-stepC2-member.png) | Admin snapshot captures the sheet-just-dismissed state via the backdrop; same inline-summary expectation. Member is unchanged. Same two PNGs satisfy the helper's "end-of-run final state" capture. |

If any row above shows `(missing)` instead of a clickable link, the
helper failed to write that PNG (disk error or context already
closed). Treat the absence as triage signal — note the cause in the
"Browser-driven evidence" section below rather than retrying just to
make the table green.

## Browser-driven evidence

Per-section narrative — fill in with the runner's findings on each
real run. The structure mirrors `my-team-tab-message.results.md` so
reviewers reading both files do not need to context-switch.

### Admin context (the notice author — `E2E_COMPANY_ADMIN_*`)

- _(pending — describe the producer-side observations: did the post
  modal save cleanly, did the inline read-by row open the sheet
  when tapped, did the sheet show the correct header / subtitle /
  `Read by (1)` row + meta line / `Still waiting on (N-2)` rows,
  and did both the close button and backdrop dismiss it cleanly
  with the inline summary unchanged.)_

### Member context (the non-admin recipient — `E2E_COMPANY_MEMBER_*`)

- _(pending — describe the consumer-side observations: was the
  `noticeTitle` row visible without any `Acknowledged by` text
  (the negative-guard verify), was the `See everyone who has read`
  selector absent, and did a 500ms wait after a row-area tap
  confirm the `Read receipts` heading never appeared.)_

## Regressions filed during the run

_(pending — list any regressions that surface during a run, using
the same "Symptom / Root cause / Fix / Filed for tracking" structure
as `my-team-tab-message.results.md`. The screenshots referenced
above should be sufficient evidence for the symptom section even
without re-running the plan.)_

## Repo changes that produced this result

| Path | Change |
| --- | --- |
| `artifacts/round-house/e2e/dual-context-screenshots.md` | Helper convention introduced by Task #702 — defines storage layout, file-name convention, and capture cadence for any e2e plan that drives more than one Playwright context. |
| `artifacts/round-house/e2e/company-notice-read-receipts-sheet.test-plan.md` | Opted in to the helper: added a "Screenshot capture" section, pinned the per-context short names on the fixtures bullets, and added `[Capture — section X]` annotations at the end of every plan section (with section C double-captured as C1 / C2 to cover both dismissal paths) so the runner has explicit, named capture points and a final-state capture. |
| `artifacts/round-house/e2e/company-notice-read-receipts-sheet.results.md` | New sibling results-file template — pre-populated with the full per-section screenshot table, the run-summary table, and placeholders for browser-driven evidence and regressions. |

## Follow-ups that remained open after this run

_(pending — list any follow-up tasks here. Do not duplicate items
already tracked elsewhere in the project's task list.)_

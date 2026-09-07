# Company notice read receipts — e2e run results (Task #485 plan + #702 helper)

**Plan:** `artifacts/round-house/e2e/company-notice-read-receipts.test-plan.md`
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
| A admin posts | admin | `Post a company notice` modal saves; the new `CompanyNoticeRow` shows `Acknowledged by 0 of N` (capture `recipientCount`) | (pending) |
| B member sees no read-by row | member | The `noticeTitle` row renders for the member with NO `Acknowledged by` text inside it; member acks and the row disappears from their list | (pending) |
| C admin sees count + acknowledger | admin | After refetch, the inline summary reads `Acknowledged by 1 of recipientCount` and the names line shows the member's display name | (pending) |

## Per-step screenshots

Storage: `artifacts/round-house/e2e/screenshots/company-notice-read-receipts/`
(recreated empty at the start of every run — see the helper).

| Section | Admin context | Member context | Notes |
| --- | --- | --- | --- |
| A admin posts | [stepA-admin](./screenshots/company-notice-read-receipts/company-notice-read-receipts-stepA-admin.png) | (n/a — member context not yet open) | Admin parked on `/reminders` after the post-notice modal closed in step 6; step 8 just verified the pre-ack `Acknowledged by 0 of N` row. The member context is created in step 9 (start of section B), so the `-member.png` slot for this section is intentionally absent. |
| B member sees no read-by row | [stepB-admin](./screenshots/company-notice-read-receipts/company-notice-read-receipts-stepB-admin.png) | [stepB-member](./screenshots/company-notice-read-receipts/company-notice-read-receipts-stepB-member.png) | Admin is unchanged from A (no re-navigation between B's start and end — captures the not-yet-refetched producer side). Member snapshot is the headline triage piece for the negative-guard verify in step 13: a `Acknowledged by` substring appearing inside the `noticeTitle` row container here is the regression. |
| C admin sees count + acknowledger | [stepC-admin](./screenshots/company-notice-read-receipts/company-notice-read-receipts-stepC-admin.png) | [stepC-member](./screenshots/company-notice-read-receipts/company-notice-read-receipts-stepC-member.png) | Admin snapshot is the headline triage piece — `Acknowledged by 1 of recipientCount` plus the member's display name on the names line. Member snapshot proves the row still hidden post-ack (rules out "member retracted the ack between B and C"). Same two PNGs satisfy the helper's "end-of-run final state" capture. |

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

- _(pending — describe the producer-side observations: did the
  `Post a company notice` button render, did the post modal save
  cleanly, did the inline summary go from `0 of N` → `1 of N` after
  the member acked in section B, and did the names line show the
  member's display name in section C.)_

### Member context (the non-admin recipient — `E2E_COMPANY_MEMBER_*`)

- _(pending — describe the consumer-side observations: was the
  `noticeTitle` row visible without any `Acknowledged by` text in
  section B (the negative-guard verify), did the `Acknowledge`
  button POST and clear the row from the list, and did the
  `Post a company notice` button stay hidden for this fixture.)_

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
| `artifacts/round-house/e2e/company-notice-read-receipts.test-plan.md` | Opted in to the helper: added a "Screenshot capture" section, pinned the per-context short names on the fixtures bullets, and added a `[Capture — section X]` annotation at the end of every plan section so the runner has explicit, named capture points and a final-state capture. |
| `artifacts/round-house/e2e/company-notice-read-receipts.results.md` | New sibling results-file template — pre-populated with the full per-section screenshot table, the run-summary table, and placeholders for browser-driven evidence and regressions. |

## Follow-ups that remained open after this run

_(pending — list any follow-up tasks here. Do not duplicate items
already tracked elsewhere in the project's task list.)_

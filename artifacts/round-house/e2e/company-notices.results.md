# Company notices — e2e run results (Task #476 plan + #702 helper)

**Plan:** `artifacts/round-house/e2e/company-notices.test-plan.md`
**Helper:** `artifacts/round-house/e2e/dual-context-screenshots.md`
**Run:** _fill in YYYY-MM-DD when this file is updated against a real run_
**Skins covered:** Trade Pro company admin (`E2E_COMPANY_ADMIN_*`) ↔
plain accepted member of the same skin (`E2E_COMPANY_MEMBER_*`).

This file is checked in **as a template** so subsequent runs have a
ready-to-fill scaffold — the per-section screenshot table, the run-
summary table, and the regression-evidence layout. Drop run-specific
notes inline, keep the layout, and replace the `(pending)`
placeholders with the actual PASS / FAIL / `(missing)` values once
the run completes.

## Run summary

| Section | Driver context | Surface under test | Status |
| --- | --- | --- | --- |
| A admin posts the notice | admin | `Reminders` hub `/reminders` → `Post a company notice` modal → `POST /outward-accounts/:companyId/company-notices` 200 → row visible with `Acknowledge` + `Delete` controls | (pending) |
| B member sees and acknowledges | member | `Reminders` hub `/reminders` → row visible with `Acknowledge` only (no `Delete`) → `POST /company-notices/:id/acknowledge` 200 → row removed → reload persists removal | (pending) |
| Cleanup | admin | `DELETE /company-notices/:id` 200 → row removed from admin's view too | (pending) |

## Per-step screenshots

Storage: `artifacts/round-house/e2e/screenshots/company-notices/`
(recreated empty at the start of every run — see the helper).

| Section | Admin context | Member context | Notes |
| --- | --- | --- | --- |
| A admin posts the notice | [stepA-admin](./screenshots/company-notices/company-notices-stepA-admin.png) | _(absent — member context not yet open)_ | Admin parked on `/reminders` after step 8 with the seeded `CompanyNoticeRow` visible carrying both `Acknowledge` and `Delete` controls. The member context is intentionally not captured here because section A runs entirely before the member context is created at step 9. |
| B member sees and acknowledges | [stepB-admin](./screenshots/company-notices/company-notices-stepB-admin.png) | [stepB-member](./screenshots/company-notices/company-notices-stepB-member.png) | Member is the headline triage piece — the notice should be removed from the member's section and either the empty-state copy or the next active notice should render. Admin snapshot is the cross-context invariant: untouched since section A, the `noticeTitle` row should still be visible with the `Delete` control. |
| Cleanup (final state) | [stepC-admin](./screenshots/company-notices/company-notices-stepC-admin.png) | [stepC-member](./screenshots/company-notices/company-notices-stepC-member.png) | Final state. Admin's section now empty of the seeded notice (delete persisted); member's section unchanged from B. Same two PNGs satisfy the helper's "end-of-run final state" capture. |

If any row above shows `(missing)` instead of a clickable link, the
helper failed to write that PNG (disk error or context already
closed). Treat the absence as triage signal — note the cause in the
"Browser-driven evidence" section below rather than retrying just to
make the table green.

## Browser-driven evidence

Per-section narrative — fill in with the runner's findings on each
real run. The structure mirrors `my-team-tab-message.results.md` so
reviewers reading both files do not need to context-switch.

### Admin context (`E2E_COMPANY_ADMIN_*`)

- _(pending — describe the admin-side observations: was the `Post a
  company notice` button visible inside the `Company Reminders`
  section, did the modal accept the title + body, did the POST
  return 200, did the row mount with both `Acknowledge` and
  `Delete` controls (because `canDelete` is true for the author),
  and did the cleanup `DELETE` succeed.)_

### Member context (`E2E_COMPANY_MEMBER_*`)

- _(pending — describe the member-side observations: was the row
  rendered with the `Acknowledge` control but **without** the
  `Delete` control, was the `Post a company notice` button
  correctly hidden, did the acknowledge POST return 200, did the
  row disappear immediately, and did a reload preserve the
  removed-from-active-list state.)_

## Regressions filed during the run

_(pending — list any regressions that surface during a run, using
the same "Symptom / Root cause / Fix / Filed for tracking" structure
as `my-team-tab-message.results.md`. The screenshots referenced
above should be sufficient evidence for the symptom section even
without re-running the plan.)_

## Repo changes that produced this result

| Path | Change |
| --- | --- |
| `artifacts/round-house/e2e/dual-context-screenshots.md` | Helper convention (Task #702) — defines storage layout, file-name convention, and capture cadence for any e2e plan that drives more than one Playwright context. |
| `artifacts/round-house/e2e/company-notices.test-plan.md` | Opted in to the helper: added a "Screenshot capture" section near the top (plan slug + short slug + storage dir + context short names + section-letter labels), pinned the per-context short names on the fixtures table, and added a `[Capture — section X]` annotation at the end of every plan section so the runner has explicit, named capture points and a final-state capture. |
| `artifacts/round-house/e2e/company-notices.results.md` | New sibling results-file template — pre-populated with the full per-section screenshot table, the run-summary table, and placeholders for browser-driven evidence and regressions. |

## Follow-ups that remained open after this run

_(pending — list any follow-up tasks here. Do not duplicate items
already tracked elsewhere in the project's task list.)_

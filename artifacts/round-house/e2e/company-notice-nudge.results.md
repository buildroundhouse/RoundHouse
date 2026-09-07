# Company notice NUDGE button — e2e run results (Task #499 plan + #702 helper)

**Plan:** `artifacts/round-house/e2e/company-notice-nudge.test-plan.md`
**Helper:** `artifacts/round-house/e2e/dual-context-screenshots.md`
**Run:** _fill in YYYY-MM-DD when this file is updated against a real run_
**Skins covered:** Primary admin (`E2E_COMPANY_ADMIN_*`) and optional
second admin (`E2E_COMPANY_ADMIN_2_*`). The member fixture
(`E2E_COMPANY_MEMBER_*`) is DB-only in this plan and never opens a
browser context.

This file is checked in **as a template** so subsequent runs have a
ready-to-fill scaffold — the per-section screenshot table, the
run-summary table, and the regression-evidence layout. Drop
run-specific notes inline, keep the layout, and replace the
`(pending)` placeholders with the actual PASS / FAIL / `(missing)`
values once the run completes.

## Run summary

| Section | Driver context | Surface under test | Status |
| --- | --- | --- | --- |
| A admin posts | admin | New `CompanyNoticeRow` shows `Acknowledged by 0 of N` (capture `recipientCount`, must be ≥ 2) | (pending) |
| B admin opens sheet | admin | `Read by (0)` empty state and `Still waiting on (M)` section render; capture `targetName` + `targetLocator`; chosen row idle | (pending) |
| C first nudge transitions Idle → pending → Sent | admin | Row flips to `Sent` + check icon + disabled; exactly one POST returned 200 | (pending) |
| D second tap is a client-side no-op | admin | Button stays `Sent` + disabled; request count for nudge URL still exactly 1; no extra dialogs | (pending) |
| E (optional) admin 2 within 24h gets 429 | admin2 | New context's row starts idle, tap returns 429, dialog matches `Already nudged ... Try again tomorrow.`, row flips to `Sent` | (pending or skipped) |
| F in-session repeat after re-opening sheet | admin | nudgeState reset on close → row idle on re-open, second tap returns 429 + alert, settles back to `Sent` | (pending) |

## Per-step screenshots

Storage: `artifacts/round-house/e2e/screenshots/company-notice-nudge/`
(recreated empty at the start of every run — see the helper).

| Section | Admin context | Admin 2 context | Notes |
| --- | --- | --- | --- |
| A admin posts | [stepA-admin](./screenshots/company-notice-nudge/company-notice-nudge-stepA-admin.png) | (n/a — admin2 context not yet open) | Admin parked on `/reminders` after the post-notice modal closed in step 6; step 7 verified the new row plus the pre-ack `Acknowledged by 0 of N` summary. |
| B admin opens sheet | [stepB-admin](./screenshots/company-notice-nudge/company-notice-nudge-stepB-admin.png) | (n/a) | `Read receipts` modal open over `/reminders`; the `Still waiting on (M)` section shows idle Nudge buttons. |
| C first nudge → Sent | [stepC-admin](./screenshots/company-notice-nudge/company-notice-nudge-stepC-admin.png) | (n/a) | Headline triage piece: `targetName` row should read `Sent` with check icon and disabled state after step 11's post-network verify. |
| D second tap no-op | [stepD-admin](./screenshots/company-notice-nudge/company-notice-nudge-stepD-admin.png) | (n/a) | Same row still `Sent` + disabled; no additional POST issued (request count still 1) and no extra dialogs raised. |
| E (optional) admin 2 within 24h | [stepE-admin](./screenshots/company-notice-nudge/company-notice-nudge-stepE-admin.png) | [stepE-admin2](./screenshots/company-notice-nudge/company-notice-nudge-stepE-admin2.png) | Only when the `admin2` fixture is present and section E ran. Otherwise BOTH slots show `(n/a)`. Admin 2 PNG is the headline triage piece for the cross-admin 429 + `Already nudged` flow. |
| F in-session repeat | [stepF-admin](./screenshots/company-notice-nudge/company-notice-nudge-stepF-admin.png) | [stepF-admin2](./screenshots/company-notice-nudge/company-notice-nudge-stepF-admin2.png) | Admin PNG captures the post-re-open state (`Nudge` idle in case a, `Sent` after the in-section second tap, or hidden in case b). Admin 2 PNG is `(n/a)` if section E was skipped. Same PNGs satisfy the helper's "end-of-run final state" capture. |

If any row above shows `(missing)` instead of a clickable link, the
helper failed to write that PNG (disk error or context already
closed). Treat the absence as triage signal — note the cause in the
"Browser-driven evidence" section below rather than retrying just to
make the table green.

## Browser-driven evidence

Per-section narrative — fill in with the runner's findings on each
real run. The structure mirrors `my-team-tab-message.results.md` so
reviewers reading both files do not need to context-switch.

### Admin context (the primary admin — `E2E_COMPANY_ADMIN_*`)

- _(pending — describe the producer-side observations: did the
  post modal save cleanly, did the inline read-by row open the
  sheet, did the Nudge button transition Idle → pending → Sent on
  step 11, did the second tap stay a no-op (no extra request, no
  dialog) on step 14, and after the in-section close + re-open
  did the `nudgeState` reset to idle so step 23 case (a) could
  drive the second-tap 429 round-trip.)_

### Admin 2 context (the optional second admin — `E2E_COMPANY_ADMIN_2_*`)

- _(pending — fill in only if section E ran. Describe whether the
  fixture's row started idle on the second context, whether the
  POST returned 429, whether the captured dialog message matched
  `<targetName> was reminded recently. Try again tomorrow.`, and
  whether the row settled into the `Sent` disabled state after
  the dialog was dismissed. Mark as `skipped` otherwise.)_

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
| `artifacts/round-house/e2e/company-notice-nudge.test-plan.md` | Opted in to the helper: added a "Screenshot capture" section, pinned the per-context short names (`admin`, optional `admin2`) on the fixtures bullets, and added a `[Capture — section X]` annotation at the end of every plan section so the runner has explicit, named capture points and a final-state capture. The member fixture is intentionally left without a context name because this plan never opens it in a browser. |
| `artifacts/round-house/e2e/company-notice-nudge.results.md` | New sibling results-file template — pre-populated with the full per-section screenshot table, the run-summary table, and placeholders for browser-driven evidence and regressions. |

## Follow-ups that remained open after this run

_(pending — list any follow-up tasks here. Do not duplicate items
already tracked elsewhere in the project's task list.)_

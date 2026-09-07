# Per-client pro tag — e2e run results

**Plan:** `artifacts/round-house/e2e/per-client-pro-tag.test-plan.md`
**Helper:** `artifacts/round-house/e2e/dual-context-screenshots.md`
**Run:** _fill in YYYY-MM-DD when this file is updated against a real run_
**Skins covered:** `client` (`E2E_PRO_TAG_CLIENT_*`) and `pro`
(`E2E_PRO_TAG_PRO_*`). Both contexts run in parallel via Playwright.

This file is checked in **as a template** so subsequent runs have a
ready-to-fill scaffold — the per-section screenshot table, the
run-summary table, and the regression-evidence layout. Drop
run-specific notes inline, keep the layout, and replace the
`(pending)` placeholders with the actual PASS / FAIL / `(missing)`
values once the run completes.

## Run summary

| Section | Driver context | Surface under test | Status |
| --- | --- | --- | --- |
| A fallback first | client | `PublicProfileModal` shows generic `Plumber` role pill, NO per-client tag, NO seeded service or on-site identity strings inside hero block | (pending) |
| B pro tags client | pro | `ConnectionTagModal` saves `Plumbing` + `Specialist`, PATCH returns 200, row preview reads `You show up as: Plumbing · Specialist`, accessibilityLabel becomes `Change how you show up for …` | (pending) |
| C client sees composed tag | client | Re-opened `PublicProfileModal` shows hero `Plumbing · Specialist` composed line, NO generic role pill (mutually exclusive branch) | (pending) |

## Per-step screenshots

Storage: `artifacts/round-house/e2e/screenshots/per-client-pro-tag/`
(recreated empty at the start of every run — see the helper).

| Section | Client context | Pro context | Notes |
| --- | --- | --- | --- |
| A fallback first | [stepA-client](./screenshots/per-client-pro-tag/per-client-pro-tag-stepA-client.png) | (n/a — pro context not yet open, gets created in step 8) | Captured BEFORE the modal close in step 7 so the fallback `Plumber` pill is on screen. |
| B pro tags client | [stepB-client](./screenshots/per-client-pro-tag/per-client-pro-tag-stepB-client.png) | [stepB-pro](./screenshots/per-client-pro-tag/per-client-pro-tag-stepB-pro.png) | Pro PNG is the headline triage piece for the producer-side flow. Client PNG is the unchanged-from-A snapshot proving the cross-context write didn't disturb the consumer. |
| C client sees composed tag | [stepC-client](./screenshots/per-client-pro-tag/per-client-pro-tag-stepC-client.png) | [stepC-pro](./screenshots/per-client-pro-tag/per-client-pro-tag-stepC-pro.png) | Client PNG is the headline triage piece for the whole plan: composed `Plumbing · Specialist` in the hero block with no generic role pill. Pro PNG is the unchanged-from-B snapshot proving the consumer-side re-fetch didn't regress the producer view. Same PNGs satisfy the helper's "end-of-run final state" capture. |

If any row above shows `(missing)` instead of a clickable link, the
helper failed to write that PNG (disk error or context already
closed). Treat the absence as triage signal — note the cause in the
"Browser-driven evidence" section below rather than retrying just to
make the table green.

## Browser-driven evidence

Per-context narrative — fill in with the runner's findings on each
real run.

### Client context (`E2E_PRO_TAG_CLIENT_*`)

- _(pending — describe the consumer-side observations: did the
  pre-tag `PublicProfileModal` show the fallback `Plumber` pill
  with no service / on-site-identity strings inside the hero
  block (section A), and after the pro saved the per-client tag
  in section B, did the re-opened modal in section C show the
  composed `Plumbing · Specialist` line directly under the handle
  with no generic `Plumber` pill rendered alongside it.)_

### Pro context (`E2E_PRO_TAG_PRO_*`)

- _(pending — describe the producer-side observations: did the
  Tag affordance on the `Pro Tag E2E Client` row open
  `ConnectionTagModal` cleanly, did the `Service title` chip
  group render the seeded `Plumbing` chip (and not the
  no-services error), did the PATCH on save return 200 with
  `{ ok: true }`, and did the row re-render with the
  `You show up as: Plumbing · Specialist` preview and the
  `Change how you show up for …` accessibilityLabel.)_

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
| `artifacts/round-house/e2e/per-client-pro-tag.test-plan.md` | Opted in to the helper: added a "Screenshot capture" section, pinned the per-context short names (`client`, `pro`) on the fixtures table as a new column, and added a `[Capture — section X]` annotation at the end of every plan section so the runner has explicit, named capture points and a final-state capture. |
| `artifacts/round-house/e2e/per-client-pro-tag.results.md` | New sibling results-file template — pre-populated with the full per-section screenshot table, the run-summary table, and placeholders for browser-driven evidence and regressions. |

## Follow-ups that remained open after this run

_(pending — list any follow-up tasks here. Do not duplicate items
already tracked elsewhere in the project's task list.)_

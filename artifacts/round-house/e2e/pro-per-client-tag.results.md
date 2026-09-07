# Pro per-client tag — e2e run results

**Plan:** `artifacts/round-house/e2e/pro-per-client-tag.test-plan.md`
**Helper:** `artifacts/round-house/e2e/dual-context-screenshots.md`
**Run:** _fill in YYYY-MM-DD when this file is updated against a real run_
**Skins covered:** `pro` (`E2E_PRO_TAG_PRO_*`) only — Playwright drives
a SINGLE browser context. The `client` fixture (`E2E_PRO_TAG_CLIENT_*`)
is DB-only and never opens a Playwright context, so every section's
client slot below is reported as `(n/a)`. The dual-context-style
header is preserved on purpose so this file's structure matches
sibling plans like `per-client-pro-tag.results.md` and
`privacy-toggle-end-to-end.results.md`.

This file is checked in **as a template** so subsequent runs have a
ready-to-fill scaffold — the per-section screenshot table, the
run-summary table, and the regression-evidence layout. Drop
run-specific notes inline, keep the layout, and replace the
`(pending)` placeholders with the actual PASS / FAIL / `(missing)`
values once the run completes.

## Run summary

| Section | Driver context | Surface under test | Status |
| --- | --- | --- | --- |
| A sign-in + base "no tag yet" state | pro | `/(tabs)/clients` shows the `Pro Tag E2E Client` row with the bare `Tag` affordance, accessible name `Tag yourself for Pro Tag E2E Client`, and NO `You show up as:` preview | (pending) |
| B open modal + save first tag | pro | `ConnectionTagModal` (`pro-self-tag` mode) renders `Plumbing` / `HVAC` chips + six identity chips, save returns 200, row preview reads `You show up as: Plumbing · Specialist`, accessibility label flips to `Change how you show up for Pro Tag E2E Client` | (pending) |
| C reload + persistence proof | pro | After a full page reload + re-sign-in the row still reads `You show up as: Plumbing · Specialist` and still exposes `Edit tag`, proving the PATCH was server-side, not just local state | (pending) |
| D edit tag + `Other…` free-text branch | pro | Re-opening the modal pre-selects `Plumbing` / `Specialist`, switching service to `HVAC` and identity to `Other…` + `Lead inspector` saves and renders `You show up as: HVAC · Lead inspector`, surviving another full reload (proves `onSiteIdentityOther` persisted) | (pending) |

## Per-step screenshots

Storage: `artifacts/round-house/e2e/screenshots/pro-per-client-tag/`
(recreated empty at the start of every run — see the helper).

| Section | Pro context | Client context | Notes |
| --- | --- | --- | --- |
| A sign-in + base "no tag yet" state | [stepA-pro](./screenshots/pro-per-client-tag/pro-per-client-tag-stepA-pro.png) | (n/a — client fixture is DB-only) | Pro lands on `/(tabs)/clients`; the row's `Tag` button is the headline triage piece — confirms baseline before any save. |
| B open modal + save first tag | [stepB-pro](./screenshots/pro-per-client-tag/pro-per-client-tag-stepB-pro.png) | (n/a — client fixture is DB-only) | Captured AFTER the modal closes so the row preview line + `Edit tag` affordance are both on screen. |
| C reload + persistence proof | [stepC-pro](./screenshots/pro-per-client-tag/pro-per-client-tag-stepC-pro.png) | (n/a — client fixture is DB-only) | Same composition as section B but POST full reload — the standalone proof that the PATCH persisted server-side. |
| D edit tag + `Other…` free-text branch | [stepD-pro](./screenshots/pro-per-client-tag/pro-per-client-tag-stepD-pro.png) | (n/a — client fixture is DB-only) | Headline triage piece for the `Other…` branch — preview reads `You show up as: HVAC · Lead inspector` after the reload. Same PNG satisfies the helper's "end-of-run final state" capture. |

If any row above shows `(missing)` instead of a clickable link, the
helper failed to write that PNG (disk error or context already
closed). Treat the absence as triage signal — note the cause in the
"Browser-driven evidence" section below rather than retrying just to
make the table green.

## Browser-driven evidence

Per-context narrative — fill in with the runner's findings on each
real run.

### Pro context (`E2E_PRO_TAG_PRO_*`)

- _(pending — describe the producer-side observations: did the
  Clients tab render the `Pro Tag E2E Client` row with the bare
  `Tag` affordance and no `You show up as:` preview at section A;
  did `ConnectionTagModal` open in `pro-self-tag` mode with both
  seeded `Plumbing` and `HVAC` chips and all six identity chips
  visible at section B; did the row re-render with `You show up
  as: Plumbing · Specialist` after Save and survive a full reload
  at section C; did the `Other…` branch reveal the `Describe…`
  input, accept `Lead inspector`, and persist as `You show up as:
  HVAC · Lead inspector` after another reload at section D.)_

### Client context (`E2E_PRO_TAG_CLIENT_*`)

- (n/a — this plan does not open a second Playwright context. The
  client fixture exists only as the to-side of the seeded
  `user_connections` row so the `Pro Tag E2E Client` name surfaces
  in the pro's Clients list. There is no consumer-side UI to
  observe in this plan; the per-client-pro-tag plan covers that
  branch.)

## Regressions filed during the run

_(pending — list any regressions that surface during a run, using
the same "Symptom / Root cause / Fix / Filed for tracking" structure
as `my-team-tab-message.results.md`. The screenshots referenced
above should be sufficient evidence for the symptom section even
without re-running the plan.)_

## Repo changes that produced this result

| Path | Change |
| --- | --- |
| `artifacts/round-house/e2e/dual-context-screenshots.md` | Helper convention introduced by Task #702 — defines storage layout, file-name convention, and capture cadence for any e2e plan that opts in. |
| `artifacts/round-house/e2e/pro-per-client-tag.test-plan.md` | Opted in to the helper: pinned the per-context short name (`pro`) on the fixtures bullets, added a "Screenshot capture" section, injected explicit `### A` / `### B` / `### C` / `### D` section headers around the existing eighteen numbered steps, and added a `[Capture — section X]` marker at the end of each section so the runner has explicit, named capture points and a final-state capture. |
| `artifacts/round-house/e2e/pro-per-client-tag.results.md` | New sibling results-file template — pre-populated with the full per-section screenshot table, the run-summary table, and placeholders for browser-driven evidence and regressions. |

## Follow-ups that remained open after this run

_(pending — list any follow-up tasks here. Do not duplicate items
already tracked elsewhere in the project's task list.)_

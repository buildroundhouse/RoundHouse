# Blocked-banner kind picker — e2e run results (Task #645 plan + #702 helper)

**Plan:** `artifacts/round-house/e2e/blocked-banner-kind-picker.test-plan.md`
**Helper:** `artifacts/round-house/e2e/dual-context-screenshots.md`
**Run:** _fill in YYYY-MM-DD when this file is updated against a real run_
**Skins covered:** Homeowner visitor (`E2E_TEAM_CHIP_VISITOR_*`,
`userA`) ↔ Trade Pro recipient (`E2E_TEAM_CHIP_ADMIN_*`,
`Team Chip E2E Co` / `userC`).

This file is checked in **as a template** so subsequent runs have a
ready-to-fill scaffold — the per-section screenshot table, the run-
summary table, and the regression-evidence layout. Drop run-specific
notes inline, keep the layout, and replace the `(pending)`
placeholders with the actual PASS / FAIL / `(missing)` values once
the run completes.

The plan's existing **Validation log** captures the
2026-04-24 manual run; this file is the canonical place to record
future re-runs and to attach the per-section PNGs the helper
produces.

## Run summary

| Section | Driver context(s) | Surface under test | Status |
| --- | --- | --- | --- |
| A picker opens with Collaborator highlighted, fires connect with picked kind | visitor + admin | Inbox blocked banner → `Team up` CTA → `team-up-kind-chooser` sheet → pick `Add as Client` → CTA settles `Requested` → admin `/invites` shows new pending row classified `client` | (pending) |
| B Collaborator path remains the quick default | visitor + admin | Same flow, picked `Add as Collaborator` (the recommended row) → admin `/invites` shows row classified `collaborator` | (pending) |
| C picker dismiss leaves no side-effects | visitor + admin | Sheet dismissed via backdrop / Escape → CTA stays `Team up` → no `user_connections` row → admin `/invites` shows no row | (pending) |
| D public profile modal chooser is unchanged | visitor + admin | `/find` → `PublicProfileModal` → `Connect` → chooser uses default copy + no `Recommended` badge → pick a kind → connection created → admin `/invites` shows the row | (pending) |

## Per-step screenshots

Storage: `artifacts/round-house/e2e/screenshots/blocked-banner-kind-picker/`
(recreated empty at the start of every run — see the helper). Both
contexts are open simultaneously across all four sections, so every
boundary captures a paired PNG.

| Section | Visitor context | Admin context | Notes |
| --- | --- | --- | --- |
| A picker → Client | [stepA-visitor](./screenshots/blocked-banner-kind-picker/blocked-banner-stepA-visitor.png) | [stepA-admin](./screenshots/blocked-banner-kind-picker/blocked-banner-stepA-admin.png) | After step 7 — visitor inbox banner CTA settled on `Requested`/disabled; admin `/invites` shows the new pending row in the `Team-up requests` section, `kind='client'` per `user_connections`. |
| B picker → Collaborator | [stepB-visitor](./screenshots/blocked-banner-kind-picker/blocked-banner-stepB-visitor.png) | [stepB-admin](./screenshots/blocked-banner-kind-picker/blocked-banner-stepB-admin.png) | After step 3 — same flow with the recommended row picked; admin `/invites` row, `kind='collaborator'`. |
| C picker dismissed | [stepC-visitor](./screenshots/blocked-banner-kind-picker/blocked-banner-stepC-visitor.png) | [stepC-admin](./screenshots/blocked-banner-kind-picker/blocked-banner-stepC-admin.png) | After step 4 — sheet dismissed, banner still visible, CTA still labelled `Team up` and enabled. Admin `/invites` shows **no** new row from this dismiss. The admin PNG is the side-effect-free invariant. |
| D public profile modal Connect (final state) | [stepD-visitor](./screenshots/blocked-banner-kind-picker/blocked-banner-stepD-visitor.png) | [stepD-admin](./screenshots/blocked-banner-kind-picker/blocked-banner-stepD-admin.png) | After step 4 — `PublicProfileModal` closed after a successful Connect; admin `/invites` row freshly inserted with the picked kind. Same two PNGs satisfy the helper's "end-of-run final state" capture. |

If any row above shows `(missing)` instead of a clickable link, the
helper failed to write that PNG (disk error or context already
closed). Treat the absence as triage signal — note the cause in the
"Browser-driven evidence" section below rather than retrying just to
make the table green.

## Browser-driven evidence

Per-section narrative — fill in with the runner's findings on each
real run.

### Visitor context (`E2E_TEAM_CHIP_VISITOR_*` — `userA`)

- _(pending — describe what the picker rendered: ordering of the
  three `Add as …` rows, which row had the `Recommended` badge,
  whether dismissing the sheet really did leave the CTA enabled
  on the still-visible banner, and whether the public-profile
  modal chooser used the default copy (Section D regression
  guard).)_

### Admin context (`E2E_TEAM_CHIP_ADMIN_*` — `userC`)

- _(pending — describe what the admin's `/invites` screen showed
  at each section boundary: row counts, row classifications
  (Client / Collaborator / Core), and any rows that should be
  absent (Section C dismiss path)._

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
| `artifacts/round-house/e2e/blocked-banner-kind-picker.test-plan.md` | Opted in to the helper: added a "Reusable signed-in fixtures" section, a "Screenshot capture" section (plan slug + short slug + storage dir + context short names + section-letter labels), converted the four `Case N` headers to `Section A` / `B` / `C` / `D`, and added a `[Capture — section X]` annotation at the end of every section so the runner has explicit, named capture points and a final-state capture. |
| `artifacts/round-house/e2e/blocked-banner-kind-picker.results.md` | New sibling results-file template — pre-populated with the full per-section screenshot table, the run-summary table, and placeholders for browser-driven evidence and regressions. |

## Follow-ups that remained open after this run

_(pending — list any follow-up tasks here. Do not duplicate items
already tracked elsewhere in the project's task list. Note: the
existing `#653` native-device pass remains tracked separately and
is not duplicated here.)_

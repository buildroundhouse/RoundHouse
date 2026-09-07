# Teammate chip on public profile — e2e run results (Task #558 plan + #702 helper)

**Plan:** `artifacts/round-house/e2e/teammate-chip-public-profile.test-plan.md`
**Helper:** `artifacts/round-house/e2e/dual-context-screenshots.md`
**Run:** _fill in YYYY-MM-DD when this file is updated against a real run_
**Skins covered:** Trade Pro lead admin (`E2E_TEAM_CHIP_ADMIN_*`,
`Team Chip E2E Co`) ↔ homeowner visitor (`E2E_TEAM_CHIP_VISITOR_*`).
The seeded member account `E2E_TEAM_CHIP_MEMBER_*` is exercised only
as a `user_team_members` row — no member browser context is opened.

This file is checked in **as a template** so subsequent runs have a
ready-to-fill scaffold — the per-section screenshot table, the run-
summary table, and the regression-evidence layout. Drop run-specific
notes inline, keep the layout, and replace the `(pending)`
placeholders with the actual PASS / FAIL / `(missing)` values once
the run completes.

## Run summary

| Section | Driver context | Surface under test | Status |
| --- | --- | --- | --- |
| A admin sets chip from ManageTeamModal | admin | `/my-team` → `ManageTeamModal` → `TEAMMATE CHIPS` row → `ChangeChipSheet` → `Other…` + `Lead Plumber` → `Save` → `PATCH /api/users/me/team/:memberClerkId/chip` 200 → row subtitle updates inline | (pending) |
| B visitor sees chip on PublicProfileModal | visitor | `/find` → search `Team Chip E2E Lead` → result row → `PublicProfileModal` → `TEAM` section visible → row subtitle matches `@team_chip_e2e_mate · Employee · Lead Plumber` | (pending) |

## Per-step screenshots

Storage: `artifacts/round-house/e2e/screenshots/teammate-chip-public-profile/`
(recreated empty at the start of every run — see the helper).

| Section | Admin context | Visitor context | Notes |
| --- | --- | --- | --- |
| A admin sets the chip | [stepA-admin](./screenshots/teammate-chip-public-profile/team-chip-profile-stepA-admin.png) | _(absent — visitor context not yet open)_ | Admin parked on `/my-team` after step 11 with the saved chip rendered on the embedded team row's subtitle (`@team_chip_e2e_mate · Employee · Lead Plumber`). The visitor context is intentionally not captured here because section A runs entirely before the visitor context is created at step 12. |
| B visitor sees the chip (final state) | [stepB-admin](./screenshots/teammate-chip-public-profile/team-chip-profile-stepB-admin.png) | [stepB-visitor](./screenshots/teammate-chip-public-profile/team-chip-profile-stepB-visitor.png) | Visitor is the headline triage piece — `PublicProfileModal` should mirror back the chip the admin saved (`Lead Plumber` appended to the subtitle line). Admin snapshot is the cross-context invariant: untouched since section A. Same two PNGs satisfy the helper's "end-of-run final state" capture. |

If any row above shows `(missing)` instead of a clickable link, the
helper failed to write that PNG (disk error or context already
closed). Treat the absence as triage signal — note the cause in the
"Browser-driven evidence" section below rather than retrying just to
make the table green.

## Browser-driven evidence

Per-section narrative — fill in with the runner's findings on each
real run.

### Admin context (`E2E_TEAM_CHIP_ADMIN_*`)

- _(pending — describe the producer-side observations: did
  `ManageTeamModal` render the `TEAMMATE CHIPS` group with the
  member row carrying `No chip`, did `ChangeChipSheet` open with
  the `Other…` pill + `Describe…` text input, did the PATCH
  return 200 with `{ chip: "other", chipOther: "Lead Plumber" }`,
  and did the embedded team row subtitle update to
  `@team_chip_e2e_mate · Employee · Lead Plumber` immediately.)_

### Visitor context (`E2E_TEAM_CHIP_VISITOR_*`)

- _(pending — describe the consumer-side observations: did
  `useGetUserTeam` return the team list (proving
  `users.visibility.team = true` is honored on the admin), did
  the `EMPLOYEES` group render exactly one row for the seeded
  member, and did the row subtitle match the regex
  `@team_chip_e2e_mate\s*·\s*Employee\s*·\s*Lead Plumber`.)_

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
| `artifacts/round-house/e2e/teammate-chip-public-profile.test-plan.md` | Opted in to the helper: added a "Screenshot capture" section near the top (plan slug + short slug + storage dir + context short names + section-letter labels), pinned the per-context short names on the fixtures table, and added a `[Capture — section X]` annotation at the end of every plan section so the runner has explicit, named capture points and a final-state capture. |
| `artifacts/round-house/e2e/teammate-chip-public-profile.results.md` | New sibling results-file template — pre-populated with the full per-section screenshot table, the run-summary table, and placeholders for browser-driven evidence and regressions. |

## Follow-ups that remained open after this run

_(pending — list any follow-up tasks here. Do not duplicate items
already tracked elsewhere in the project's task list.)_

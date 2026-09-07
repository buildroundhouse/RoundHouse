# Destructive confirms on web — e2e run results (Task #629 plan + #702 helper)

**Plan:** `artifacts/round-house/e2e/destructive-confirms.test-plan.md`
**Helper:** `artifacts/round-house/e2e/dual-context-screenshots.md`
**Run:** _fill in YYYY-MM-DD when this file is updated against a real run_
**Skins covered:** Wardrobe admin (`E2E_ADMIN_*`), standard pre-onboarded
user (`E2E_FIREBASE_*`), and the company admin / member pair
(`E2E_COMPANY_ADMIN_*` / `E2E_COMPANY_MEMBER_*`) for the section-C
team-invite decline.

This file is checked in **as a template** so subsequent runs have a
ready-to-fill scaffold — the per-section screenshot table, the run-
summary table, and the regression-evidence layout. Drop run-specific
notes inline, keep the layout, and replace the `(pending)`
placeholders with the actual PASS / FAIL / `(missing)` values once
the run completes.

## Run summary

| Section | Driver context(s) | Surface under test | Status |
| --- | --- | --- | --- |
| A wardrobe delete | wardrobe-admin | `/account/wardrobe` → `Delete <displayName>` → `confirm()` dialog → cancel = no DELETE / row stays; confirm = `DELETE /api/admin/demo-profiles/:id` + row removed | (pending) |
| B recurring task delete | standard | Property `/work` tab → `Recurring` modal → trash icon → `confirm()` dialog → cancel = no DELETE / card stays; confirm = `DELETE …/recurring-tasks/:id` + card removed | (pending) |
| C decline team invite | company-admin (sender) + company-member (decliner) | `TeamInvitesBanner` on `/(tabs)/profile` → `Decline invite from <name>` → `confirm()` dialog → cancel = no decline / row stays; confirm = decline API call + row removed | (pending) |
| D clear due date | standard | `CaptureFAB` work-order date picker → `Clear due date` → `confirm()` dialog → cancel = modal stays open with date intact; confirm = modal closes + date cleared + button no longer rendered | (pending) |

## Per-step screenshots

Storage: `artifacts/round-house/e2e/screenshots/destructive-confirms/`
(recreated empty at the start of every run — see the helper). Sections
A / B / D drive a single context per section so only one column per
PNG row is populated; section C is the only multi-context flow and
populates both columns.

| Section + branch | Wardrobe-admin | Standard | Company-admin | Company-member | Notes |
| --- | --- | --- | --- | --- | --- |
| A1 cancel | [stepA1-wardrobe-admin](./screenshots/destructive-confirms/destructive-confirms-stepA1-wardrobe-admin.png) | — | — | — | After step 6 — dialog dismissed, seeded row still present in `/account/wardrobe`, no `DELETE` request was issued. |
| A2 confirm | [stepA2-wardrobe-admin](./screenshots/destructive-confirms/destructive-confirms-stepA2-wardrobe-admin.png) | — | — | — | After step 8 — dialog accepted, seeded row gone, `DELETE /api/admin/demo-profiles/${seededId}` returned 2xx. |
| B1 cancel | — | [stepB1-standard](./screenshots/destructive-confirms/destructive-confirms-stepB1-standard.png) | — | — | After step 7 — dialog dismissed, seeded card still in the Recurring Tasks modal, no `DELETE …/recurring-tasks/${seededId}` request fired. |
| B2 confirm | — | [stepB2-standard](./screenshots/destructive-confirms/destructive-confirms-stepB2-standard.png) | — | — | After step 9 — dialog accepted, seeded card removed, `DELETE …/recurring-tasks/${seededId}` returned 2xx. |
| C1 cancel | — | — | [stepC1-company-admin](./screenshots/destructive-confirms/destructive-confirms-stepC1-company-admin.png) | [stepC1-company-member](./screenshots/destructive-confirms/destructive-confirms-stepC1-company-member.png) | After step 7 — dialog dismissed on the member side, no decline request issued, invite row still rendered in `TeamInvitesBanner`. Admin snapshot is the cross-context invariant: the seat the admin invited is still pending. |
| C2 confirm | — | — | [stepC2-company-admin](./screenshots/destructive-confirms/destructive-confirms-stepC2-company-admin.png) | [stepC2-company-member](./screenshots/destructive-confirms/destructive-confirms-stepC2-company-member.png) | After step 9 — dialog accepted, decline API call returned 2xx, invite row removed (`TEAM INVITES` count decremented or banner unmounts when zero). Admin snapshot should reflect the removed pending invite (next admin-side refresh of any team-management surface should show no pending row for the member). |
| D1 cancel | — | [stepD1-standard](./screenshots/destructive-confirms/destructive-confirms-stepD1-standard.png) | — | — | After step 7 — dialog dismissed, modal still open with the previously-set date intact. |
| D2 confirm (final state) | — | [stepD2-standard](./screenshots/destructive-confirms/destructive-confirms-stepD2-standard.png) | — | — | After step 9 — dialog accepted, modal closed; re-opening the picker shows the placeholder/no-date state with the `Clear due date` button no longer rendered. Same PNG satisfies the helper's "end-of-run final state" capture for this section. |

If any row above shows `(missing)` instead of a clickable link, the
helper failed to write that PNG (disk error or context already
closed). Treat the absence as triage signal — note the cause in the
"Browser-driven evidence" section below rather than retrying just to
make the table green.

## Browser-driven evidence

Per-section narrative — fill in with the runner's findings on each
real run.

### Section A — wardrobe delete (`E2E_ADMIN_*`)

- _(pending — describe the dialog text on the cancel + confirm
  branches, whether the recorded dialog count was 0/1/2 across the
  two branches, and whether the `DELETE /api/admin/demo-profiles/:id`
  network log matched expectations.)_

### Section B — recurring task delete (`E2E_FIREBASE_*`)

- _(pending — describe the dialog message text and the
  `recurring-tasks/${taskId}` URL pattern observed on the confirm
  branch.)_

### Section C — decline team invite (`E2E_COMPANY_ADMIN_*` + `E2E_COMPANY_MEMBER_*`)

- _(pending — describe both sides: did the admin's invite land on
  the member's `TeamInvitesBanner`, did the cancel branch leave
  the row intact, and did the confirm branch fire the decline
  API call exactly once with no orphan retries.)_

### Section D — clear due date (`E2E_FIREBASE_*`)

- _(pending — describe the modal-open/close behavior on each
  branch and whether re-opening the picker hid the
  `Clear due date` button after the confirm branch.)_

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
| `artifacts/round-house/e2e/destructive-confirms.test-plan.md` | Opted in to the helper: added a "Screenshot capture" section near the top (plan slug + short slug + storage dir + context short names + section-letter labels), pinned the per-context short names on the fixtures table, and added a `[Capture — section X]` annotation at the end of every plan section so the runner has explicit, named capture points and a final-state capture. |
| `artifacts/round-house/e2e/destructive-confirms.results.md` | New sibling results-file template — pre-populated with the full per-section + per-branch screenshot table, the run-summary table, and placeholders for browser-driven evidence and regressions. |

## Follow-ups that remained open after this run

_(pending — list any follow-up tasks here. Do not duplicate items
already tracked elsewhere in the project's task list.)_

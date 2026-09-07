# Friends-list "Message" affordance — e2e run results (Task #643 plan + #702 helper)

**Plan:** `artifacts/round-house/e2e/friends-list-message.test-plan.md`
**Helper:** `artifacts/round-house/e2e/dual-context-screenshots.md`
**Run:** _fill in YYYY-MM-DD when this file is updated against a real run_
**Skins covered:** Driver `userA` (signed in across sections A and C,
signs out at section B for the team-up accept and signs back in)
and `userC` (signs in once during section B to accept the team-up
request). Seeded counterparts `userB` and `userD` are exercised
only as relationship rows; no browser context is opened for them.

This file is checked in **as a template** so subsequent runs have a
ready-to-fill scaffold — the per-section screenshot table, the run-
summary table, and the regression-evidence layout. Drop run-specific
notes inline, keep the layout, and replace the `(pending)`
placeholders with the actual PASS / FAIL / `(missing)` values once
the run completes.

## Run summary

| Section | Driver context | Surface under test | Status |
| --- | --- | --- | --- |
| A happy path: send a message from a friend row | userA | People sheet → `Message` pill on `userB`'s row → inbox composer focused → typed message sends → new thread surfaces at top of inbox list | (pending) |
| B gated path: blocked banner + team-up CTA | userA → userC → userA | `PublicProfileModal` for `userC` → `Message` pill in header → inbox composer → first send fails → `team-up-blocked-banner` (`testID`) + `Team up` CTA (`testID team-up-cta`) appear → CTA fires team-up → sign out, accept as `userC`, sign back in as `userA` → re-send succeeds → banner gone | (pending) |
| C retired counterpart: Message control suppressed | userA | People sheet → `userD` row renders with the muted "No longer active" tag → no `Message` pill, no row tap-through | (pending) |

## Per-step screenshots

Storage: `artifacts/round-house/e2e/screenshots/friends-list-message/`
(recreated empty at the start of every run — see the helper).

| Section | userA context | userC context | Notes |
| --- | --- | --- | --- |
| A happy path | [stepA-userA](./screenshots/friends-list-message/friends-msg-stepA-userA.png) | _(absent — userC context not yet open)_ | After step 7 — inbox list with the new thread at the top and no blocked banner anywhere. The `userC` context is intentionally not captured here because section A runs entirely before the team-up flow opens it. |
| B gated path | [stepB-userA](./screenshots/friends-list-message/friends-msg-stepB-userA.png) | [stepB-userC](./screenshots/friends-list-message/friends-msg-stepB-userC.png) | `userA` PNG: after step 11, the unblocked inbox thread with `userA` signed back in, banner gone, latest message persisted. `userC` PNG: captured immediately before signing back into `userA` at step 9–10, showing the team-ups screen with the accept action settled. The two together prove the team-up state propagated across both sides of the gate. |
| C retired counterpart (final state) | [stepC-userA](./screenshots/friends-list-message/friends-msg-stepC-userA.png) | _(absent — userC context only existed during section B's interlude)_ | After section C's verifications — People sheet with `userD`'s row rendering "No longer active" and **no** `Message` pill. Same PNG satisfies the helper's "end-of-run final state" capture. |

If any row above shows `(missing)` instead of a clickable link, the
helper failed to write that PNG (disk error or context already
closed). Treat the absence as triage signal — note the cause in the
"Browser-driven evidence" section below rather than retrying just to
make the table green.

## Browser-driven evidence

Per-section narrative — fill in with the runner's findings on each
real run.

### userA context

- _(pending — describe the People-sheet row's `Message` pill
  presence and accessibility label, the deep-link URL the pill
  produced (`/inbox/<id>?compose=1&clerk=<clerkId>`), the
  composer auto-focus behavior, and on the gated path whether the
  `team-up-blocked-banner` rendered exactly between the message
  list and composer with the right copy.)_

### userC context

- _(pending — describe whether the team-up request surfaced
  promptly on `userC`'s notifications/team-ups surface, whether
  the accept action returned 2xx, and whether sign-out cleanly
  released the context for the next `userA` sign-in.)_

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
| `artifacts/round-house/e2e/friends-list-message.test-plan.md` | Opted in to the helper: added a "Reusable signed-in fixtures" table with the per-context short names, a "Screenshot capture" section near the top (plan slug + short slug + storage dir + section-letter labels), converted the three `Case N` headers to `Section A` / `B` / `C`, and added a `[Capture — section X]` annotation at the end of every section so the runner has explicit, named capture points and a final-state capture. |
| `artifacts/round-house/e2e/friends-list-message.results.md` | New sibling results-file template — pre-populated with the full per-section screenshot table, the run-summary table, and placeholders for browser-driven evidence and regressions. |

## Follow-ups that remained open after this run

_(pending — list any follow-up tasks here. Do not duplicate items
already tracked elsewhere in the project's task list.)_

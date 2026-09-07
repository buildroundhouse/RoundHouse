# Concierge — send drafted client note — e2e run results

**Plan:** `artifacts/round-house/e2e/concierge-send-draft.test-plan.md`
**Helper:** `artifacts/round-house/e2e/dual-context-screenshots.md`
**Run:** _fill in YYYY-MM-DD when this file is updated against a real run_
**Roles covered:** `sender` (`E2E_FIREBASE_EMAIL` /
`E2E_FIREBASE_PASSWORD`) and `recipient` (`E2E_FIREBASE_RECIPIENT_EMAIL`
/ `E2E_FIREBASE_RECIPIENT_PASSWORD`). The plan only ever opens a single
Playwright context — the recipient verification happens in-place via a
sign-out / sign-in role swap inside section A. The dual-context-style
PNG layout below preserves a separate column per role so a reviewer can
scan the producer-side and consumer-side evidence without consulting
the plan.

This file is checked in **as a template** so subsequent runs have a
ready-to-fill scaffold — the per-section screenshot table, the
run-summary table, and the regression-evidence layout. Drop
run-specific notes inline, keep the layout, and replace the
`(pending)` placeholders with the actual PASS / FAIL / `(missing)` /
`(unable)` values once the run completes.

## Run summary

| Section | Driver role | Surface under test | Status |
| --- | --- | --- | --- |
| A in-app send + recipient inbox | sender → recipient → sender | `RecipientPicker` opens from `Confirm` on the seeded `draft_client_note` proposal, in-app submit succeeds, durable system note `Sent draft to Hannah Has-Contact via in-app message.` appears in the thread, the `messages` row lands for the recipient, the recipient's `/(tabs)/notifications` lists a `New message` row, and the sender re-opens the sheet to verify the system note survives the sign-out / sign-in cycle | (pending) |
| B SMS with override | sender | `Send via SMS` channel chip swaps the picker into SMS mode, the contact-input enforces the `>= 7` digits-only threshold, an override phone is normalised by the server to `+15555550177`, and the durable system note `Prepared SMS draft for No-Contact Nick (+15555550177).` appears in the thread (no `messages` row written) | (pending) |
| C email with override + validation | sender | `Send via Email` channel chip enforces the email regex (`not-an-email` keeps submit disabled), a valid `nick.${tag}@example.test` enables submit, and the durable system note `Prepared email draft for No-Contact Nick (nick.${tag}@example.test).` (or the `Sent draft to …` SendGrid variant) appears in the thread | (pending) |
| D cancel path (sanity check) | sender | Tapping `Cancel` in the picker closes it WITHOUT marking the proposal card as `Done` (primary button still reads `Confirm`) and WITHOUT appending any `Cancel test` system note or `messages` row | (pending) |

## Per-step screenshots

Storage: `artifacts/round-house/e2e/screenshots/concierge-send-draft/`
(recreated empty at the start of every run — see the helper).

| Section | Sender context | Recipient context | Notes |
| --- | --- | --- | --- |
| A in-app send + recipient inbox | [stepA1-sender](./screenshots/concierge-send-draft/concierge-send-draft-stepA1-sender.png) | [stepA2-recipient](./screenshots/concierge-send-draft/concierge-send-draft-stepA2-recipient.png) | Two PNGs per side of the in-app delivery wire, even though both come from the same Playwright context (the recipient PNG is captured AFTER the in-place sign-out / sign-in role swap). If the recipient Firebase fixture is absent, mark `stepA2-recipient` as `(unable)` — the sub-step is skipped and the run is reported as a partial pass; `stepA1-sender` is still required. |
| B SMS with override | [stepB-sender](./screenshots/concierge-send-draft/concierge-send-draft-stepB-sender.png) | (n/a — recipient context not opened in this section) | Headline triage piece for the SMS override branch — proves the server-normalised phone `+15555550177` made it into the durable system note. |
| C email with override + validation | [stepC-sender](./screenshots/concierge-send-draft/concierge-send-draft-stepC-sender.png) | (n/a — recipient context not opened in this section) | Headline triage piece for the email override branch — proves the email regex gate (`not-an-email` rejected, `nick.${tag}@example.test` accepted) and the durable system note. |
| D cancel path (sanity check) | [stepD-sender](./screenshots/concierge-send-draft/concierge-send-draft-stepD-sender.png) | (n/a — recipient context not opened in this section) | Cancel proof — the `Cancel test` proposal card primary button is still `Confirm` (NOT `Done`) and the thread has no matching system note. Same PNG satisfies the helper's "end-of-run final state" capture. |

If any row above shows `(missing)` instead of a clickable link, the
helper failed to write that PNG (disk error or context already
closed). Treat the absence as triage signal — note the cause in the
"Browser-driven evidence" section below rather than retrying just to
make the table green. `(unable)` specifically means the recipient
fixture was absent so the sub-step was skipped on purpose.

## Browser-driven evidence

Per-role narrative — fill in with the runner's findings on each
real run.

### Sender role (`E2E_FIREBASE_EMAIL`)

- _(pending — describe the producer-side observations: did the
  floating `Open AI concierge` FAB toggle the sheet open with the
  seeded `Here is a quick follow-up note you can send.` assistant
  message + `Confirm` proposal card visible at section A; did the
  `RecipientPicker` open with `Send via In-app` selected by default,
  Hannah and Nick listed, and the submit button enabling only after
  Hannah was picked; did each subsequent section's submit produce
  the documented system note in the thread (`Sent draft …` for A,
  `Prepared SMS draft …` for B, `Prepared email draft …` /
  `Sent draft …` for C); did the cancel path in D leave the card
  primary button at `Confirm` and the thread free of any
  `Cancel test` note.)_

### Recipient role (`E2E_FIREBASE_RECIPIENT_EMAIL`)

- _(pending — describe the consumer-side observations: after the
  in-place sign-out / sign-in role swap inside section A, did
  `/(tabs)/notifications` list a `New message` row whose body text
  contains `sent you a message.` and whose icon is a Feather
  `mail` glyph; if the recipient fixture was absent, note the
  partial-pass + `(unable)` status here so the next runner does
  not re-attempt without re-seeding.)_

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
| `artifacts/round-house/e2e/concierge-send-draft.test-plan.md` | Opted in to the helper: pinned the per-role short names (`sender`, `recipient`) on the fixtures bullets, added a "Screenshot capture" section, renamed the existing `Path A` / `Path B` / `Path C` / `Cancel path` sections to the helper's `### A.` / `### B.` / `### C.` / `### D.` letter convention, and added a `[Capture — section X]` marker at the end of each section (plus a second marker inside section A's recipient role-swap sub-flow) so the runner has explicit, named capture points and a final-state capture. |
| `artifacts/round-house/e2e/concierge-send-draft.results.md` | New sibling results-file template — pre-populated with the full per-section screenshot table, the run-summary table, and placeholders for browser-driven evidence and regressions. |

## Follow-ups that remained open after this run

_(pending — list any follow-up tasks here. Do not duplicate items
already tracked elsewhere in the project's task list.)_

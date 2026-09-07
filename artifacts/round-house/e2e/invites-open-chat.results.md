# Invites — Open chat shortcut after accepting — e2e run results (Task #600 plan + #702 helper)

**Plan:** `artifacts/round-house/e2e/invites-open-chat.test-plan.md`
**Helper:** `artifacts/round-house/e2e/dual-context-screenshots.md`
**Run:** _fill in YYYY-MM-DD when this file is updated against a real run_
**Skins covered:** Recipient (`E2E_TEAM_CHIP_ADMIN_*`,
`Team Chip E2E Co`) and requester (`E2E_TEAM_CHIP_VISITOR_*`,
homeowner). The same browser context drives both — the recipient
runs sections A and B, then signs out at step 23 so the requester
signs into the same context for section C.

This file is checked in **as a template** so subsequent runs have a
ready-to-fill scaffold — the per-section screenshot table, the run-
summary table, and the regression-evidence layout. Drop run-specific
notes inline, keep the layout, and replace the `(pending)`
placeholders with the actual PASS / FAIL / `(missing)` values once
the run completes.

## Run summary

| Section | Driver context | Surface under test | Status |
| --- | --- | --- | --- |
| A decline does NOT show Open chat | recipient | `/invites` → `Decline` on the seeded request → success banner shows `Declined the request` and **no** `Open chat` pressable → `user_connections` row flips to `status='declined'` with no reciprocal row | (pending) |
| B accept shows Open chat → deep-links to thread → message round-trips | recipient | `/invites` → `Accept` → success banner with `Open chat` → `/inbox` shows the synthetic empty conversation row (#604) → tap `Open chat` → `/inbox/${visitorAcctId}` thread → composer renders → typed message sends and persists in `messages` | (pending) |
| C requester sees the message on next fetch | requester | Sign out recipient → sign in requester → `/inbox` shows row for the recipient → tap row → message-thread screen renders with the recipient's body text visible | (pending) |

## Per-step screenshots

Storage: `artifacts/round-house/e2e/screenshots/invites-open-chat/`
(recreated empty at the start of every run — see the helper). The
recipient and requester occupy the same browser context
sequentially, so each section captures whichever account is signed
in at the time.

| Section | Recipient context | Requester context | Notes |
| --- | --- | --- | --- |
| A decline path | [stepA-recipient](./screenshots/invites-open-chat/invites-open-chat-stepA-recipient.png) | _(absent — requester does not sign in until section C)_ | After step 11 — the `/invites` screen shows the team-up request row gone after the decline, and the success banner does NOT contain `Open chat`. |
| B accept path | [stepB-recipient](./screenshots/invites-open-chat/invites-open-chat-stepB-recipient.png) | _(absent — requester does not sign in until section C)_ | After step 22 — `/inbox/${visitorAcctId}` thread with the new outgoing message bubble visible. The `Open chat` pressable existed momentarily on the success banner; the screenshot captures the post-deep-link state. |
| C requester sees the message (final state) | _(absent — recipient signed out at step 23)_ | [stepC-requester](./screenshots/invites-open-chat/invites-open-chat-stepC-requester.png) | After step 28 — requester's inbox thread with the recipient's message body visible. Same PNG satisfies the helper's "end-of-run final state" capture. |

If any row above shows `(missing)` instead of a clickable link, the
helper failed to write that PNG (disk error or context already
closed). Treat the absence as triage signal — note the cause in the
"Browser-driven evidence" section below rather than retrying just to
make the table green.

## Browser-driven evidence

Per-section narrative — fill in with the runner's findings on each
real run.

### Recipient context (`E2E_TEAM_CHIP_ADMIN_*`)

- _(pending — describe the recipient-side observations: did the
  decline branch (section A) leave any reciprocal `user_connections`
  row, did the accept branch (section B) write both directions to
  `accepted` and surface the synthetic empty conversation row in
  `/inbox` before the first message, did the `Open chat` pressable
  deep-link to `/inbox/${visitorAcctId}` (the outward-account id,
  NOT the clerk id), and did the typed message persist in
  `messages` with the right sender/recipient pair.)_

### Requester context (`E2E_TEAM_CHIP_VISITOR_*`)

- _(pending — describe the requester-side observations after
  signing into the same context: did `/inbox` immediately show the
  thread, did tapping the row render the recipient's message body,
  and was the unread state reasonable (the unread dot is optional
  per the plan).)_

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
| `artifacts/round-house/e2e/invites-open-chat.test-plan.md` | Opted in to the helper: added a "Screenshot capture" section near the top (plan slug + short slug + storage dir + context short names + section-letter labels), pinned the per-context short names on the fixtures table, and added a `[Capture — section X]` annotation at the end of every plan section so the runner has explicit, named capture points and a final-state capture. |
| `artifacts/round-house/e2e/invites-open-chat.results.md` | New sibling results-file template — pre-populated with the full per-section screenshot table, the run-summary table, and placeholders for browser-driven evidence and regressions. |

## Follow-ups that remained open after this run

_(pending — list any follow-up tasks here. Do not duplicate items
already tracked elsewhere in the project's task list.)_

# Friends-list "Message" affordance — e2e (#643)

## Why this exists

Previously the only paths to a one-to-one thread were either an inbox row
(after a message had already been exchanged) or a job-thread side trip.
The friends list (People sheet, the My-Team groups embedded inside it,
and the public profile modal) showed people but offered no way to start
a conversation. #643 adds a clearly-labeled `Message` button on every
messageable row plus the public-profile header, navigates to the inbox
thread with the composer focused, and renders an inline blocked banner
with a team-up CTA when the recipient hasn't accepted yet.

The three cases below cover the happy path, the gated path, and the
"profile no longer active" suppression.

## Setup

1. Sign in as `userA` (an outward account that has at least one accepted
   connection of each grouping: a client, a core, and a collaborator).
2. Ensure `userB` is in `userA`'s relationships list as an accepted
   collaborator with no archived counterpart skin (active happy path).
3. Ensure `userC` exists with a profile but **no** accepted connection
   to/from `userA` in either direction. (The blocked path needs a target
   you can search for from the public-profile modal.)
4. Ensure `userD` is in `userA`'s relationships list but the
   counterpart skin has been retired (`counterpartArchivedAt` set) — the
   suppression path. Easiest seed: have `userD` archive the outward
   account that was paired with `userA`.

## Reusable signed-in fixtures

| Fixture | Role | Context short name |
| --- | --- | --- |
| `userA` | Driver of all three sections. Stays signed in across sections A and C; signs out at section B step 9 so `userC` can sign in to accept the team-up request, then signs back in at section B step 10. | `userA` |
| `userB` | Accepted collaborator counterpart. **Not signed in by this plan** — only the seeded relationship row is exercised. | _(seed only — not signed in)_ |
| `userC` | Non-connected target used by the blocked-banner / team-up path in section B. Signs in once (section B step 9) to accept `userA`'s team-up request, then signs out. | `userC` |
| `userD` | Retired-counterpart relationship row. **Not signed in by this plan** — only the seeded `counterpartArchivedAt` row is exercised. | _(seed only — not signed in)_ |

The "Context short name" column is the identifier the dual-context
screenshot helper uses when it names the per-step PNG files (see
"Screenshot capture" below). `userA` and `userC` share a single
browser context across the run — the plan signs out of one
account and signs into the other in the same context — so paired
snapshots in section B capture the pre-sign-out state under
`userA` and the post-sign-in state under `userC`.

## Screenshot capture

This plan opts in to the dual-context screenshot helper at
`artifacts/round-house/e2e/dual-context-screenshots.md`. The helper
defines the storage layout, file-name convention, and capture
cadence (failing-step + section-boundary + final-state). The runner
should follow it verbatim; everything below is the
plan-specific configuration.

- **Plan slug** (storage directory): `friends-list-message`
- **Short slug** (PNG file-name prefix): `friends-msg`
- **Storage directory**:
  `artifacts/round-house/e2e/screenshots/friends-list-message/`
  — recreate empty at the start of every run.
- **Context short names**: `userA` and `userC` (declared on the
  fixtures table above). The seeded `userB` and `userD` accounts
  are not given short names because no browser context is opened
  for them.
- **Section labels**: `A. happy path: send a message from a friend
  row`, `B. gated path: blocked banner + team-up CTA`,
  `C. retired counterpart: Message control suppressed`.
- **Sibling results file**:
  `artifacts/round-house/e2e/friends-list-message.results.md`.
  After a run, fill in its "Per-step screenshots" table and
  "Run summary" table; the file already contains the full set
  of expected file paths so a reviewer can scan it without
  consulting this plan.

## Section A — happy path: send a message from a friend row

1. As `userA`, open the People sheet from the profile tab.
2. Locate `userB` in the appropriate grouping (Core / Clients /
   Collaborators / etc.). Confirm a `Message` pill is visible on that
   row alongside the existing `@username` handle.
3. Tap `Message`.
4. **Expect**: the People sheet closes, the app navigates to
   `/inbox/<userB outwardAccountId or clerkId>?compose=1&clerk=<userB clerkId>`,
   the conversation loads, and the composer text input has focus
   (keyboard up on device, caret blinking on web).
5. Type "hello" and tap Send.
6. **Expect**: the message appears in the thread; no blocked banner is
   ever shown.
7. Refresh the inbox list — the new thread is at the top.

[Capture — section A] Per the dual-context screenshot helper
(`./dual-context-screenshots.md`), snapshot every open context
now. Only the `userA` context exists at this point, so capture
`screenshots/friends-list-message/friends-msg-stepA-userA.png`
(the inbox list with the new thread at the top, no blocked
banner). The `userC` context opens in section B; its absence in
the section-A pair is intentional. If any [Verify] step in this
section already failed, capture immediately at the failing step
instead of at the section boundary.

## Section B — gated path: blocked banner + team-up CTA

1. As `userA`, open the public profile modal for `userC` (search via the
   user-search modal or any deep link).
2. Confirm the modal header now shows a `Message` pill to the right of
   the title (next to the close `x`).
3. Tap `Message`.
4. **Expect**: the modal closes and the app navigates to the inbox
   thread route for `userC` with the composer focused.
5. Type a draft and tap Send.
6. **Expect**: the send fails. An inline banner with `testID`
   `team-up-blocked-banner` appears between the message list and the
   composer, with copy "Team up first to send a message" and a
   `Team up` CTA (`testID` `team-up-cta`).
7. Tap `Team up`.
8. **Expect**: a team-up request is posted (the CTA shows a spinner
   then becomes `Requested`/disabled). No crash, no duplicate banner.
9. Sign out, sign in as `userC`, accept the team-up request from the
   notifications/team-ups surface.
10. Sign back in as `userA`, reopen the same thread, type a message,
    tap Send.
11. **Expect**: the send succeeds, the banner disappears, and the
    message persists.

[Capture — section B] Snapshot every open context now. Save as
`friends-msg-stepB-userA.png` (after step 11 — the unblocked
inbox thread with `userA` signed back in). Capture
`friends-msg-stepB-userC.png` immediately before signing back
into `userA` at step 9–10 — that PNG records `userC`'s
team-ups screen with the accept action settled. The two
together prove the team-up state propagated across both sides
of the gated flow.

## Section C — retired counterpart: Message control suppressed

1. As `userA`, open the People sheet.
2. Locate `userD` (the row with the muted "No longer active" tag).
3. **Expect**: the row renders but no `Message` pill is shown on it
   (the existing tap-through is also disabled, unchanged from #340).
4. Open the public profile modal for `userD` if it is reachable from
   any other surface (e.g. a job thread).
5. **Expect**: depending on which entry point is used, either the
   modal does not open (existing behavior) or, if it does, the
   `Message` pill in the header is suppressed because the helper
   `messageHrefFor` short-circuits to `null` for archived counterparts.

[Capture — section C / final state] Snapshot every open context
now. Only the `userA` context exists at this point (the `userC`
context only existed during the sign-out/sign-in interlude in
section B). Save as `friends-msg-stepC-userA.png` showing the
People sheet with `userD`'s row rendering the "No longer active"
tag and **no** `Message` pill. This satisfies the helper's
"end-of-run final state" capture requirement.

## Notes / non-goals

- The `Message` pill is also added to the `TeamSection` rows that the
  People sheet embeds for trade-pro / facilities teammates. Pending
  invites (`status === "pending"`) intentionally do not show a Message
  pill — there is no accepted account to message yet.
- The blocked banner is intentionally surfaced **on first failed send**,
  not pre-emptively, because the conversation GET does not advertise
  team-up status. This keeps the request flow honest with the server's
  403 `team_up_required` contract.
- The blocked banner copy mirrors the server's 403 error text so what
  the user reads in the banner matches what the API would surface in
  any toast/log: "You can only message [name] after they accept your
  team-up request."
- Self-views (`isSelf === true` in the public profile modal) do not show
  the Message pill.
- When the Message control is tapped from a People-sheet row, the
  inbox route uses the row's `counterpartOutwardAccountId` so the same
  skin pair is targeted. When opened from the public profile modal, the
  modal carries forward the counterpart outward-account id of the
  relationship row that opened it (when known); otherwise it falls back
  to clerkId and the server resolves to the recipient's currently-active
  outward account.

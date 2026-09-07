# Invites — Open chat shortcut after accepting a team-up request

Use with the project's UI testing tool (Playwright-driven). Run against the
Roundhouse Expo web preview.

Covers Task #600 (which exercises Task #597's UX). After a recipient
accepts an incoming team-up request from the **My invites** screen
(`app/invites.tsx`), the success banner shows an **Open chat** action
that:

1. Deep-links into `/inbox/{otherOutwardAccountId}` — the messaging
   thread keyed on the *requester*'s outward-account id (NOT the
   requester's clerk id) so the unlocked skin pair is unambiguous.
2. Lets the recipient send the first message immediately (the
   `/api/messages/{otherTarget}` 403 `team_up_required` gate must
   already have lifted by virtue of the accept).
3. Persists into `messages` so the requester sees it on their next
   inbox/conversation fetch.

The plan also confirms the **Open chat** button does NOT appear when
the recipient *Declines* the request.

## Context

- Recipient screen: `app/invites.tsx`. The success banner is rendered
  when `banner.kind === "success"`; the **Open chat** pressable is
  visible only when `banner.openChatTarget != null` (set during the
  `accept` branch of `handleRespond`).
- The pressable's accessibility label is `Open chat`. Tapping it
  navigates with `router.push("/inbox/${target}" as never)` where
  `target` is the requester's `otherOutwardAccountId`.
- Inbox thread screen: `app/inbox/[otherUserId].tsx`. It uses the
  route param as `otherClerkId` and passes it to
  `useGetConversation` / `useSendMessage`. The server's
  `GET|POST /api/messages/:otherTarget` accepts both a clerk id
  *and* a numeric outward-account id, so the deep-link resolves
  correctly.
- Message composer: `<TextInput placeholder="Message">` and a
  `Pressable` with accessibility label `Send message`.
- Inbox list: `app/inbox.tsx` (path `/inbox`). Each row's pressable
  has accessibility label `Open conversation with <name>`.
- Team-up gate: `POST /api/messages/{otherTarget}` returns
  `403 { code: "team_up_required" }` when no `accepted` non-archived
  `user_connections` row exists between the two outward accounts. The
  accept handler at `POST /api/users/:userId/team-up/respond` writes
  the requester→responder row to `accepted` and inserts the
  reciprocal responder→requester accepted row, so messaging is
  unlocked in both directions afterwards.

## Reusable signed-in fixtures

This plan uses TWO seeded Firebase test accounts (already provisioned
on this Repl, see `.replit` `userenv.shared`):

| Env var pair | Role | Context short name |
| --- | --- | --- |
| `E2E_TEAM_CHIP_VISITOR_EMAIL` / `E2E_TEAM_CHIP_VISITOR_PASSWORD` | **Requester** — homeowner skin. Sends the pending team-up request that the recipient will accept / decline. Signs in for Path C only. | `requester` |
| `E2E_TEAM_CHIP_ADMIN_EMAIL` / `E2E_TEAM_CHIP_ADMIN_PASSWORD` | **Recipient** — `trade_pro` skin (`Team Chip E2E Co`). Lands on the `/invites` screen and accepts. Signed in across Paths A and B. | `recipient` |

Both accounts are pre-onboarded (`users.identity_completed_at` is
set) so sign-in lands on `/(tabs)`. If either secret is missing,
report `unable` instead of attempting a broken sign-in.

The "Context short name" column is the identifier the dual-context
screenshot helper uses when it names the per-step PNG files (see
"Screenshot capture" below).

## Screenshot capture

This plan opts in to the dual-context screenshot helper at
`artifacts/round-house/e2e/dual-context-screenshots.md`. The helper
defines the storage layout, file-name convention, and capture
cadence (failing-step + section-boundary + final-state). The runner
should follow it verbatim; everything below is the
plan-specific configuration.

- **Plan slug** (storage directory): `invites-open-chat`
- **Short slug** (PNG file-name prefix): `invites-open-chat`
- **Storage directory**:
  `artifacts/round-house/e2e/screenshots/invites-open-chat/`
  — recreate empty at the start of every run.
- **Context short names**: `recipient` and `requester` (declared
  on the fixtures table above).
- **Section labels**: `A. Decline does NOT show Open chat`,
  `B. Accept shows Open chat → deep-links to thread → message
  round-trips`, `C. Requester sees the message on next fetch`.
- **Sibling results file**:
  `artifacts/round-house/e2e/invites-open-chat.results.md`. After a
  run, fill in its "Per-step screenshots" table and "Run summary"
  table; the file already contains the full set of expected file
  paths so a reviewer can scan it without consulting this plan.

The recipient and requester are sequenced — the recipient context
runs through Paths A and B, then signs out at step 23 so the
requester signs into the **same** browser context for Path C.
Snapshot both the pre-sign-out recipient state at the section-B
boundary and the post-sign-in requester state at the section-C
boundary so the run record carries full provenance for both sides
of the unlocked thread.

## DB seeding contract

`tag = nanoid(6)` (test-run-scoped). All transient data (e.g. the
message body) embeds `${tag}` so cleanup is precise and parallel runs
do not collide.

### Tables touched

- `user_connections` — pending rows are seeded directly (rather than
  via `POST /api/users/:userId/connect`) so the test does not depend
  on the system-message composer side-effects writing to `messages`.
  Two pending rows are seeded in sequence: one used for the *decline*
  path (no shortcut expected), then a fresh one for the *accept* path.
- `messages` — the test asserts the message sent from the recipient
  via the **Open chat** deep-link lands here, and the requester sees
  it on next fetch.

### Pre-test cleanup (idempotent — runs at the start so re-runs start clean)

```sql
DELETE FROM user_connections
  WHERE (from_outward_account_id = ${visitorAcctId}
         AND to_outward_account_id = ${adminAcctId})
     OR (from_outward_account_id = ${adminAcctId}
         AND to_outward_account_id = ${visitorAcctId});

DELETE FROM messages
  WHERE (sender_clerk_id = '${adminClerkId}'
         AND recipient_clerk_id = '${visitorClerkId}')
     OR (sender_clerk_id = '${visitorClerkId}'
         AND recipient_clerk_id = '${adminClerkId}');
```

## Plan

1. [New Context] Create a new browser context. Install a global
   `page.on('dialog')` handler that accepts every dialog
   (`dialog.accept()`).
2. [Browser] Navigate to `/(auth)/sign-in`. Sign in as the recipient
   (`E2E_TEAM_CHIP_ADMIN_EMAIL` / `E2E_TEAM_CHIP_ADMIN_PASSWORD`).
   Wait for navigation away from `/(auth)/sign-in`. If the URL settles
   on `/(onboarding)/...`, stop and report `unable`.
3. [DB] Resolve recipient identifiers:
   ```sql
   SELECT clerk_id, active_outward_account_id
     FROM users
    WHERE email = '${E2E_TEAM_CHIP_ADMIN_EMAIL}';
   ```
   Capture as `${adminClerkId}` and `${adminAcctId}`. Fail `unable`
   if `active_outward_account_id` is NULL.
4. [DB] Resolve requester identifiers:
   ```sql
   SELECT clerk_id, active_outward_account_id
     FROM users
    WHERE email = '${E2E_TEAM_CHIP_VISITOR_EMAIL}';
   ```
   Capture as `${visitorClerkId}` and `${visitorAcctId}`. Fail
   `unable` if `active_outward_account_id` is NULL.
5. [DB] Run the pre-test cleanup block above (substituting the four
   captured ids) so leftover rows from prior runs do not interfere.

### Path A — Decline does NOT show Open chat

6. [DB] Seed a pending team-up request from the requester to the
   recipient:
   ```sql
   INSERT INTO user_connections
     (from_outward_account_id, to_outward_account_id, kind, status,
      requested_at, invite_message, personal_note)
   VALUES
     (${visitorAcctId}, ${adminAcctId}, 'client', 'pending',
      NOW(),
      'Hi, this is the requester. Let''s team up.',
      'Decline path note ${tag}');
   ```
7. [Browser] Navigate to `/invites`. Wait for the section header
   `Team-up requests` to be visible. The row's visible name should
   come from the requester's `users.name`; assert at least one row is
   present in that section.
8. [Verify] No success banner is visible yet (no element matches the
   accessibility label `Open chat`).
9. [Browser] In the requester's row, tap the `Decline` button.
10. [Verify]
    - Within ~3s a success banner appears whose text contains
      `Declined the request`.
    - The banner does NOT contain a pressable with accessibility
      label `Open chat`.
    - The team-up request row is no longer rendered (the `incoming`
      list refresh removes it).
11. [DB] Confirm the decline persisted:
    ```sql
    SELECT status, responded_at IS NOT NULL AS responded
      FROM user_connections
     WHERE from_outward_account_id = ${visitorAcctId}
       AND to_outward_account_id   = ${adminAcctId};
    ```
    Expect exactly one row with `status='declined'` and
    `responded=true`. Also confirm there is NO row in the reciprocal
    direction (`from_outward_account_id = ${adminAcctId} AND
    to_outward_account_id = ${visitorAcctId}`).

[Capture — section A] Per the dual-context screenshot helper
(`./dual-context-screenshots.md`), snapshot every open context
now. Only the recipient context exists at this point, so capture
`screenshots/invites-open-chat/invites-open-chat-stepA-recipient.png`
(the `/invites` screen after the decline — the row should be gone
and the success banner must NOT contain `Open chat`). The requester
context is opened in section C; its absence in the section-A pair
is intentional. If any [Verify] step in this section already failed,
capture immediately at the failing step instead of at the section
boundary.

### Path B — Accept shows Open chat → deep-links to thread → message round-trips

> Task #604 extension: between accept and the first message we now
> assert that the recipient's `/inbox` shows the new connection
> immediately (the synthetic empty conversation row), so people who
> accept and then close the app still see the unlocked thread waiting
> for them. The test verifies this both before any message is sent
> *and* after, to make sure the synthetic row gets replaced (not
> duplicated) by the real message preview.

12. [DB] Wipe Path A's row and seed a fresh pending request. Path B
    intentionally seeds a NON-EMPTY `personal_note` because that is
    the realistic accept flow — most requesters do leave a personal
    note. The accept handler at `POST /api/users/:userId/team-up/respond`
    (#599) carries any non-empty personal note into the freshly-unlocked
    DM thread as a real `messages` row tagged
    `source = 'team_up_note'` and attributed to the requester. Task #610
    teaches `GET /api/messages` to keep treating the recipient's row
    as "not yet replied" while the only message in the pair is that
    carried-over note, so step 16a still exercises the empty-state
    affordance with a realistic note seeded.
    ```sql
    DELETE FROM user_connections
      WHERE (from_outward_account_id = ${visitorAcctId}
             AND to_outward_account_id = ${adminAcctId})
         OR (from_outward_account_id = ${adminAcctId}
             AND to_outward_account_id = ${visitorAcctId});

    INSERT INTO user_connections
      (from_outward_account_id, to_outward_account_id, kind, status,
       requested_at, invite_message, personal_note)
    VALUES
      (${visitorAcctId}, ${adminAcctId}, 'client', 'pending',
       NOW(),
       'Hi, this is the requester. Let''s team up.',
       'Personal note from the requester ${tag}');
    ```
13. [Browser] Reload `/invites` (or navigate away and back so the
    `useListMyTeamUpRequests` query refetches). Wait for the
    `Team-up requests` section to render the requester's row again.
14. [Browser] In the requester's row, tap the `Accept` button.
15. [Verify]
    - A success banner appears whose text contains `You're now
      connected with`.
    - The banner contains a pressable with accessibility label
      `Open chat` (visible text reads `Open chat`).
16. [DB] Confirm both connection rows are now `accepted`:
    ```sql
    SELECT count(*)::int AS n
      FROM user_connections
     WHERE status = 'accepted'
       AND archived_at IS NULL
       AND (
         (from_outward_account_id = ${visitorAcctId} AND to_outward_account_id = ${adminAcctId})
         OR
         (from_outward_account_id = ${adminAcctId}   AND to_outward_account_id = ${visitorAcctId})
       );
    ```
    Expect `n = 2`.
16a. [Browser] Before tapping `Open chat`, open the inbox in a new
    tab/route and assert the synthetic empty conversation row already
    surfaces (#604 — the inbox must NOT wait for the first message
    before showing the unlocked thread):
    - Navigate to `/inbox` (e.g. open it in a fresh page or via the
      tab bar). Wait for the conversation list to render.
    - [DB] Confirm the only things in `messages` for this pair are
      the two requester→responder rows the accept handler writes —
      the system-authored "now connected" anchor (#603,
      `source = 'system_connected'`) and the carried-over team-up
      note (#599, `source = 'team_up_note'`) — and that the recipient
      has NOT replied yet. The empty-state cue we verify next is
      coming from the messages.ts carry-over special-case (which
      treats both `team_up_note` and `system_connected`
      requester-authored rows as non-content for the empty-state
      decision, see #610), not from a missing message:
      ```sql
      SELECT count(*)::int AS notes
        FROM messages
       WHERE source = 'team_up_note'
         AND sender_clerk_id    = '${visitorClerkId}'
         AND recipient_clerk_id = '${adminClerkId}';
      ```
      Expect `notes = 1`.
      ```sql
      SELECT count(*)::int AS anchors
        FROM messages
       WHERE source = 'system_connected'
         AND sender_clerk_id    = '${visitorClerkId}'
         AND recipient_clerk_id = '${adminClerkId}';
      ```
      Expect `anchors = 1` (the accept handler always inserts this
      anchor — independent of whether a personal note was attached —
      so both sides land in a thread that is never visually blank).
      ```sql
      SELECT count(*)::int AS replies
        FROM messages
       WHERE sender_clerk_id    = '${adminClerkId}'
         AND recipient_clerk_id = '${visitorClerkId}';
      ```
      Expect `replies = 0`.
    - [Verify] A row with accessibility label that starts with
      `Open conversation with <requester name>` is visible. Its
      preview line reads `You're now connected — say hi` (the
      synthetic-row placeholder), and the row also shows the
      empty-state affordance (#606): the visible call-to-action
      text `Tap to start the conversation` appears in the same
      row, and the row's accessibility label additionally contains
      `No messages yet — tap to start the conversation` so screen
      readers announce that no messages have been exchanged yet.
    - Navigate back to `/invites` so the next step's `Open chat`
      banner is still in scope. (The success banner may have already
      timed out — this step is fine either way; the next step taps
      `Open chat` only if it is still visible. If the banner has
      expired, tap the inbox row instead and continue from step 18.)

17. [Browser] Tap the `Open chat` pressable.
18. [Verify] The URL settles on `/inbox/${visitorAcctId}` (the
    pressable deep-links via the requester's *outward-account id*,
    not the clerk id). The message-thread screen renders with a
    composer at the bottom — a `<TextInput placeholder="Message">`
    and a button with accessibility label `Send message`.
19. [Browser] Type `Hello from accept path ${tag}` into the message
    composer.
20. [Browser] Tap the `Send message` button.
21. [Verify] Within ~3s the composer clears and the new message
    bubble is visible in the thread, content
    `Hello from accept path ${tag}`. (The `MessageRow` for an
    outgoing message renders the body text.)
22. [DB] Confirm the message was persisted with the correct sender /
    recipient pair:
    ```sql
    SELECT count(*)::int AS n
      FROM messages
     WHERE sender_clerk_id    = '${adminClerkId}'
       AND recipient_clerk_id = '${visitorClerkId}'
       AND content            = 'Hello from accept path ${tag}';
    ```
    Expect `n = 1`.

[Capture — section B] Snapshot every open context now. Only the
recipient context exists at this point (the same one that ran
through section A — the requester context is opened in section C).
Save as `invites-open-chat-stepB-recipient.png` showing the
`/inbox/${visitorAcctId}` thread with the new message bubble
visible. The requester column for this paired snapshot is
intentionally absent because the requester does not sign in until
section C.

### Path C — Requester (other side) sees the message on next fetch

23. [Browser] Sign out the recipient: navigate to `/(tabs)/profile`
    and tap the `Sign out` button. The global dialog handler from
    step 1 accepts any confirm dialog.
24. [Browser] Navigate to `/(auth)/sign-in`. Sign in as the
    requester (`E2E_TEAM_CHIP_VISITOR_EMAIL` /
    `E2E_TEAM_CHIP_VISITOR_PASSWORD`). Wait for navigation away from
    `/(auth)/sign-in`; the URL must settle on `/(tabs)`.
25. [Browser] Navigate to `/inbox`. Wait for the conversation list
    to render.
26. [Verify] A row with accessibility label
    `Open conversation with <recipient name>` is visible (the
    recipient's display name is `Team Chip E2E Co` or the
    admin user's `users.name` — accept either, the unread dot is
    optional).
27. [Browser] Tap that row.
28. [Verify] The message-thread screen renders with the body text
    `Hello from accept path ${tag}` visible (the most recent
    message in the thread).

[Capture — section C / final state] Snapshot every open context
now. Only the requester context exists at this point (the
recipient context was destroyed by the sign-out at step 23 — it
re-uses the same browser context with a fresh sign-in, so there
is no second open context). Save as
`invites-open-chat-stepC-requester.png` showing the requester's
inbox thread with the recipient's message rendered in the
bubble. This satisfies the helper's "end-of-run final state"
capture requirement.

## Cleanup

Always-run teardown (regardless of pass / fail):

```sql
DELETE FROM messages
  WHERE (sender_clerk_id = '${adminClerkId}'
         AND recipient_clerk_id = '${visitorClerkId}')
     OR (sender_clerk_id = '${visitorClerkId}'
         AND recipient_clerk_id = '${adminClerkId}');

DELETE FROM user_connections
  WHERE (from_outward_account_id = ${visitorAcctId}
         AND to_outward_account_id = ${adminAcctId})
     OR (from_outward_account_id = ${adminAcctId}
         AND to_outward_account_id = ${visitorAcctId});
```

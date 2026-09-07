# Concierge — send drafted client note end-to-end test plan

Use with the project's UI testing tool (Playwright-driven). Run against the
Roundhouse Expo web preview.

Covers task #586: when the concierge proposes a `draft_client_note` and the
user taps **Confirm**, the recipient picker opens and the draft can be sent
via in-app, SMS, or email — including the override field for recipients that
have no phone or email on file. The flow is verified end-to-end:

- The picker validates the phone / email contact field per channel.
- For `in_app`, the recipient's `messages` table receives the row.
- For `sms` / `email`, the picker closes after submit and a system note
  (e.g. `Sent draft to Hannah via in-app message.` /
  `Prepared SMS draft for No-Contact Nick (+15551234567).` /
  `Prepared email draft for No-Contact Nick (nick.${tag}@example.test).`)
  is appended to the concierge thread the user is viewing.

## Context

- Floating concierge entry point: `app/(tabs)/index.tsx` renders a button
  with `accessibilityLabel="Open AI concierge"` that toggles the
  `ConciergeSheet` modal open.
- Sheet component: `components/ConciergeSheet.tsx`.
  - Each proposal is rendered by `ProposedActionCard`. The primary button's
    visible text is `Confirm` (becomes `Done` after success).
  - When a `draft_client_note` confirm is tapped, the recipient picker
    (`RecipientPicker`) opens.
- Picker accessibility labels:
  - Channel chips: `Send via In-app`, `Send via SMS`, `Send via Email`.
  - Recipient rows: `Pick <recipient name>`.
  - Submit button: `Send draft` (visible text reads `Send via In-app` /
    `Send via SMS` / `Send via Email`).
  - Cancel button: visible text `Cancel`; backdrop has accessibility label
    `Dismiss recipient picker`.
- Picker contact-input behaviour (`RecipientPicker.handleSend` +
  surrounding `validContact` logic):
  - `in_app`: no contact field; submit enabled as soon as a recipient is
    picked.
  - `sms`: input visible whenever a recipient is picked. Pre-filled with
    the recipient's phone if any. Submit disabled until the digits-only
    representation is `>= 7` characters.
  - `email`: same, but validated with
    `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`.
- Server route: `POST /api/concierge/send-draft` in
  `artifacts/api-server/src/routes/concierge.ts`.
  - In-app branch: writes a row to `messages` and appends
    `Sent draft to <label> via in-app message.` to the concierge thread.
  - SMS branch: returns an `sms:` `composeUri` and appends
    `Prepared SMS draft for <label> (<phone>).` to the concierge thread.
  - Email branch (no SendGrid configured in dev): returns a `mailto:`
    `composeUri` and appends `Prepared email draft for <label> (<email>).`
    to the concierge thread.
- The system notes are inserted by the server via `appendMessage(conv.id,
  "system", ...)` so they are durable and a refresh of the sheet still
  shows them. The client also appends a transient note via
  `appendSystemNote` in `lib/conciergeSendDraft.ts`, but this plan asserts
  the durable, server-side note (it survives a sheet re-open).
- The browser has no SMS or mail handler. `Linking.openURL` is invoked by
  the client; we don't assert that the OS app launched. We only assert the
  picker closes and the system note appears.

## How this plan is executed

There are no checked-in `*.spec.ts` Playwright files in this repo. Every
plan in `artifacts/round-house/e2e/*.test-plan.md` is consumed by the
project's UI testing tool — the operator (or an agent) calls `runTest`
and pastes the plan's text as the `testPlan` argument. The tool then
drives a real browser through the steps and reports pass / fail. Treat
the plan below as the test asset; the runner is `runTest`.

## Reusable signed-in test fixtures

This plan uses TWO seeded Firebase test accounts so the recipient-side
UI assertion (see Path A's "Recipient inbox UI verification" sub-step)
is real and not just a database read.

- **Sender** — `E2E_FIREBASE_EMAIL` / `E2E_FIREBASE_PASSWORD`, the same
  onboarded user used by `reminders-side-tab.test-plan.md`. Lands on
  `/(tabs)` after sign-in and has a populated
  `users.activeOutwardAccountId`. Context short name: `sender`.
- **Recipient** — `E2E_FIREBASE_RECIPIENT_EMAIL` /
  `E2E_FIREBASE_RECIPIENT_PASSWORD`, a second onboarded Firebase user
  that owns its own outward account (`active_outward_account_id NOT
  NULL`). Used only in Path A to sign in and verify the in-app message
  surfaces in the recipient's notifications inbox. Context short
  name: `recipient`.

Although this plan only ever opens a SINGLE Playwright context (the
recipient verification swaps roles in-place via sign-out / sign-in),
the dual-context screenshot helper still applies — it just records
each per-section PNG with the short name of whichever role is signed
in at that capture point (`sender` for sections A / B / C / D, plus
the swap to `recipient` inside section A's sub-flow).

If `E2E_FIREBASE_EMAIL` / `E2E_FIREBASE_PASSWORD` is missing, report
`unable` and re-seed. If the recipient pair is missing, the test still
runs but the **Recipient inbox UI verification** sub-step is skipped
and reported as a partial pass (the durable DB assertions still fire so
the in-app branch retains a strong signal).

## DB seeding contract

Concierge gating + recipients are seeded directly against the dev Postgres
(the testing tool's `[DB]` step talks to `DATABASE_URL`, the same DB the
Expo client + API server share).

### Tables touched

- `users` — the **Hannah Has-Contact** recipient is the seeded Firebase
  recipient user (looked up by `E2E_FIREBASE_RECIPIENT_EMAIL`); we
  UPDATE the row to set `phone` / `cell_phone` so the picker has a
  real number to pre-fill. We also INSERT one stub recipient owner
  (`No-Contact Nick`, `nick.${tag}@example.test`) and clean it up at
  the end. Nick deliberately has `phone`, `cell_phone`, `office_phone`
  all NULL so the SMS / email override branches are exercised.
  > If the recipient Firebase fixture is unavailable, fall back to
  > inserting a second stub user `hannah.${tag}@example.test` and skip
  > the Recipient inbox UI verification sub-step.
- `outward_accounts` — Hannah's existing outward account is reused
  (looked up via `users.active_outward_account_id`); ensure
  `kind='home'` and `display_name='Hannah Has-Contact'` so the picker
  row is recognisable. One new row is INSERTed for Nick and cleaned
  up at the end.
- `user_connections` — accepted, non-archived rows in BOTH directions
  between the test user's active outward account and each recipient
  outward account, mirroring the team-up accept handler. Required for
  the `in_app` branch's team-up gate AND for `GET /api/concierge/recipients`
  to surface them in the picker.
- `outward_accounts.capabilityState='expanded'` on the test user's active
  outward account so `requirePaidCapability("ai_concierge")` doesn't 402.
- `concierge_conversations` + `concierge_messages` — pre-seed an assistant
  turn with a `draft_client_note` proposal so the test does not depend on
  the (non-deterministic) LLM stream to produce one. The pre-seeded turn:
  ```
  role: 'assistant'
  content: 'Here is a quick follow-up note you can send.'
  proposed_actions: [
    {
      "type": "draft_client_note",
      "label": "Draft: Follow-up",
      "payload": {
        "recipientName": "Hannah Has-Contact",
        "subject": "Follow-up",
        "draft": "Hi! Just checking in on the work we discussed last week."
      }
    }
  ]
  ```

### Identifiers

`tag = nanoid(6)` (test-run-scoped). All seeded rows MUST embed `${tag}` in
their identifying fields so cleanup is precise and parallel runs don't
collide.

## Screenshot capture

This plan opts in to the dual-context screenshot helper at
`artifacts/round-house/e2e/dual-context-screenshots.md`. The helper
defines the storage layout, file-name convention, and capture
cadence (failing-step + section-boundary + final-state). The runner
should follow it verbatim; everything below is the plan-specific
configuration.

- **Plan slug** (storage directory): `concierge-send-draft`
- **Short slug** (PNG file-name prefix): `concierge-send-draft`
- **Storage directory**:
  `artifacts/round-house/e2e/screenshots/concierge-send-draft/`
  — recreate empty at the start of every run so re-runs do not
  mix evidence with a previous run.
- **Context short names**: `sender` and `recipient` (declared on
  the fixtures bullets above). Although the plan only ever opens
  a single Playwright context, the active role swaps in-place
  inside section A's recipient inbox sub-flow, so the helper
  records that swap as a separate per-section PNG with
  `<context>=recipient`.
- **Section labels**: this plan groups its steps into sections
  A–D (`### A. In-app send …`, `### B. SMS with override …`,
  `### C. Email with override + validation`, `### D. Cancel
  path …`). The helper uses those letters directly in the PNG
  name (e.g. `concierge-send-draft-stepA-sender.png`). Section
  A captures twice — once after the in-app send completes
  (`stepA1-sender`) and once after the role-swap inbox check
  while signed in as the recipient (`stepA2-recipient`).
- **Sibling results file**:
  `artifacts/round-house/e2e/concierge-send-draft.results.md`.
  After a run, fill in its "Per-step screenshots" table (one row
  per section) and its "Run summary" table; the file already
  contains the full set of expected file paths so a reviewer can
  scan it without consulting this plan.

## Plan

1. [New Context] Create a new browser context. Install a global
   `page.on('dialog')` handler that accepts (`dialog.accept()`) any dialogs.
2. [Browser] Navigate to `/(auth)/sign-in`. Sign in with the
   `E2E_FIREBASE_EMAIL` / `E2E_FIREBASE_PASSWORD` secrets and wait for
   navigation away from `/(auth)/sign-in`.
3. [Verify] URL settles on `/(tabs)` (or `/`) — not an onboarding route.
   If onboarding shows, the fixture is stale; stop and report `unable`.
4. [DB] Look up the test user's `clerkId` (a.k.a. Firebase uid) and active
   outward account id:
   ```
   SELECT u.clerk_id, u.active_outward_account_id
   FROM users u
   WHERE u.email = '${E2E_FIREBASE_EMAIL}';
   ```
   Capture them as `${userClerkId}` and `${activeAcctId}`. Fail `unable`
   if `active_outward_account_id` is NULL.
5. [DB] Ensure the concierge capability is granted on the user's active
   outward account:
   ```
   UPDATE outward_accounts
   SET capability_state = 'expanded'
   WHERE id = ${activeAcctId};
   ```
6. [DB] Resolve the recipient Firebase user (`Hannah Has-Contact`) into a
   `clerk_id` + `active_outward_account_id`. Capture as `${hannahId}` and
   `${hannahAcctId}`:
   ```
   SELECT u.clerk_id, u.active_outward_account_id
   FROM users u
   WHERE u.email = '${E2E_FIREBASE_RECIPIENT_EMAIL}';
   ```
   If the row is missing, set `${hannahId}` / `${hannahAcctId}` to NULL
   and continue with the **Stub Hannah fallback** (Insert a stub user
   + outward account exactly like Nick below, with phone+email
   populated). Mark the Recipient inbox UI verification sub-step as
   `unable` for the run.
   ```
   -- UPDATE the live Hannah row to give the picker something to
   -- pre-fill. cell_phone is the field the recipients endpoint
   -- prefers via owner.cellPhone || owner.phone || owner.officePhone.
   UPDATE users
     SET phone = '+15555550100',
         cell_phone = '+15555550100',
         name = 'Hannah Has-Contact'
     WHERE clerk_id = '${hannahId}';

   UPDATE outward_accounts
     SET kind = 'home',
         display_name = 'Hannah Has-Contact'
     WHERE id = ${hannahAcctId};
   ```
7. [DB] Insert the stub `No-Contact Nick` recipient user + outward
   account (capture the outward account id as `${nickAcctId}`):
   ```
   INSERT INTO users (clerk_id, email, name, username, phone, cell_phone)
   VALUES ('rcpt-${tag}-nick', 'nick.${tag}@example.test',
           'No-Contact Nick', 'nick_${tag}', NULL, NULL);

   INSERT INTO outward_accounts (owner_clerk_id, kind, display_name)
   VALUES ('rcpt-${tag}-nick', 'home', 'No-Contact Nick')
   RETURNING id;
   ```
8. [DB] Mirror an accepted team-up connection in BOTH directions between
   `${activeAcctId}` and each recipient (the in-app branch's team-up gate
   reads the from→to row, but production always writes both):
   ```
   INSERT INTO user_connections
     (from_outward_account_id, to_outward_account_id, status, accepted_at)
   VALUES
     (${activeAcctId},  ${hannahAcctId}, 'accepted', NOW()),
     (${hannahAcctId},  ${activeAcctId}, 'accepted', NOW()),
     (${activeAcctId},  ${nickAcctId},   'accepted', NOW()),
     (${nickAcctId},    ${activeAcctId}, 'accepted', NOW());
   ```
9. [DB] Pre-seed the concierge conversation + the draft proposal turn so
   the test does not depend on an LLM round-trip. Use
   `ON CONFLICT DO NOTHING` on the conversation (the unique index
   `concierge_conversations_user_acct_unique` may already have a row from
   a prior dev session) and capture the conversation id as `${convId}`:
   ```
   INSERT INTO concierge_conversations (user_clerk_id, outward_account_id)
   VALUES ('${userClerkId}', ${activeAcctId})
   ON CONFLICT (user_clerk_id, outward_account_id) DO UPDATE
     SET updated_at = NOW()
   RETURNING id;

   -- Wipe any stale messages so the test sees ONLY the seeded turn.
   DELETE FROM concierge_messages WHERE conversation_id = ${convId};

   INSERT INTO concierge_messages
     (conversation_id, role, content, proposed_actions)
   VALUES
     (${convId},
      'assistant',
      'Here is a quick follow-up note you can send.',
      '[{"type":"draft_client_note","label":"Draft: Follow-up","payload":{"recipientName":"Hannah Has-Contact","subject":"Follow-up","draft":"Hi! Just checking in on the work we discussed last week."}}]'::jsonb);
   ```
10. [Browser] Tap the floating button with accessibility label
    `Open AI concierge`.
11. [Verify] The concierge sheet is visible. The seeded assistant message
    is rendered (text contains `Here is a quick follow-up note you can
    send.`). A `Confirm` button is visible inside the proposal card.

### A. In-app send + recipient inbox verification

12. [Browser] Tap `Confirm` on the proposal card.
13. [Verify] The recipient picker is visible:
    - Title: `Send draft to…`
    - Channel chips with accessible names `Send via In-app` (active by
      default — the chip shows the primary brand colour),
      `Send via SMS`, `Send via Email`.
    - Both recipients are listed (their visible names contain
      `Hannah Has-Contact` and `No-Contact Nick`).
    - The submit button visible text reads `Send via In-app`. Because no
      recipient is picked yet, it is disabled (its container has
      `aria-disabled="true"` / opacity is reduced — accept either
      indicator).
14. [Browser] Tap the recipient row with accessibility label
    `Pick Hannah Has-Contact`.
15. [Verify]
    - The Hannah row shows a check-circle icon (selected state).
    - No phone/email input field is rendered (in-app channel does not
      need one).
    - The submit button is now enabled.
16. [Browser] Tap the submit button (visible text `Send via In-app`).
17. [Verify]
    - Within ~3s the picker closes (the title `Send draft to…` is no
      longer in the DOM).
    - A new assistant message appears at the bottom of the concierge
      thread whose text contains `Sent draft to Hannah Has-Contact via
      in-app message.`
    - The proposal card's primary button now reads `Done` (the
      `ProposedActionCard` flips `done=true` after a successful send).
18. [DB] Confirm the in-app delivery landed in `messages`:
    ```
    SELECT count(*)::int AS n
    FROM messages
    WHERE sender_clerk_id = '${userClerkId}'
      AND recipient_clerk_id = '${hannahId}'
      AND content = 'Hi! Just checking in on the work we discussed last week.';
    ```
    Expect `n = 1`.
19. [DB] Confirm the durable system note exists in
    `concierge_messages`:
    ```
    SELECT count(*)::int AS n
    FROM concierge_messages
    WHERE conversation_id = ${convId}
      AND role = 'system'
      AND content LIKE 'Sent draft to Hannah Has-Contact via in-app message.%';
    ```
    Expect `n = 1`.

    `[Capture — section A]` — `concierge-send-draft-stepA1-sender.png`.
    The concierge sheet is open on the sender's view with the new
    `Sent draft to Hannah Has-Contact via in-app message.` system
    note rendered at the bottom of the thread and the proposal
    card's primary button reading `Done`. The recipient context is
    captured separately by the role swap below.

#### Recipient inbox UI verification (Path A continued)

Skip this sub-section if `${hannahId}` is NULL (recipient Firebase
fixture absent — the run reports partial pass).

19a. [Browser] Sign out the current user. The Profile tab
     (`/(tabs)/profile`) has a `Sign out` button (label `Sign out`).
     If the app surfaces a confirm dialog, the global handler from
     step 1 accepts it.
19b. [Browser] Navigate to `/(auth)/sign-in`. Type the value of
     `E2E_FIREBASE_RECIPIENT_EMAIL` and `E2E_FIREBASE_RECIPIENT_PASSWORD`
     into the email + password fields, tap `Sign in`, wait for
     navigation away from `/(auth)/sign-in`. The URL must settle on
     `/(tabs)` — onboarding indicates a stale recipient fixture; stop
     and report `unable`.
19c. [Browser] Tap the inbox icon in the Timeline header (accessibility
     label is `Inbox` or `Inbox, <N> unread` — match by name prefix
     `Inbox`). Wait for `/(tabs)/notifications` to render.
19d. [Verify]
     - The list contains a notification row whose visible title is
       `New message`.
     - The same row's body text contains the substring
       `sent you a message.` (the body is `<sender name> sent you a
       message.`; the sender's display name comes from the test user
       fixture so an exact match is fragile — assert the suffix).
     - The row's icon is a `mail` glyph (the `iconForType('message')`
       branch in `notifications.tsx`). Accept any mail-shaped Feather
       icon.
     `[Capture — section A, recipient role]` —
     `concierge-send-draft-stepA2-recipient.png`. The recipient is
     signed in and `/(tabs)/notifications` shows the `New message`
     notification row produced by the in-app branch. This is the
     dual-context counterpart to `stepA1-sender.png` even though
     both PNGs come from the same Playwright context — they cover
     different sides of the in-app delivery wire. If the recipient
     fixture is absent, this PNG is reported as `(unable)` in the
     sibling results file (sub-step is skipped, run is partial pass).

19e. [Browser] Sign out the recipient (Profile → `Sign out`), then sign
     back in as the sender (`E2E_FIREBASE_EMAIL` /
     `E2E_FIREBASE_PASSWORD`) and re-open the concierge sheet via the
     `Open AI concierge` FAB. The thread must still show the durable
     `Sent draft to Hannah Has-Contact via in-app message.` system
     note from step 17 (proves the note survives a sign-out / sign-in
     cycle).

### B. SMS with override

The proposal card now reads `Done` and the picker is closed. Re-open the
picker by re-seeding the proposal as a fresh assistant turn (the card's
post-send state is intentional UX — we simulate a new AI suggestion):

20. [DB] Append a second seeded proposal so the user has another card to
    confirm:
    ```
    INSERT INTO concierge_messages
      (conversation_id, role, content, proposed_actions)
    VALUES
      (${convId},
       'assistant',
       'Another quick follow-up to send.',
       '[{"type":"draft_client_note","label":"Draft: Follow-up #2","payload":{"recipientName":"No-Contact Nick","subject":"Follow-up","draft":"Hey Nick, circling back on our last chat."}}]'::jsonb);
    ```
21. [Browser] Close the concierge sheet (tap `Close`, accessibility label
    `Close`) and re-open it via the `Open AI concierge` button to force a
    fresh history fetch. Wait for the new card with text containing
    `Another quick follow-up to send.` to render.
22. [Browser] Tap `Confirm` on the new card.
23. [Verify] The picker is open again. `Send via In-app` is selected by
    default.
24. [Browser] Tap the channel chip with accessible name `Send via SMS`.
25. [Browser] Tap the recipient row with accessibility label
    `Pick No-Contact Nick`.
26. [Verify]
    - The contact-input field is now visible. Its placeholder reads
      `Phone number`. Because Nick has no stored phone, the input is
      empty.
    - The Nick row's secondary text reads `Add a phone below` (the
      `channelMissing && isSelected` branch).
    - The submit button (visible text `Send via SMS`) is **disabled**
      (no contact entered).
27. [Browser] Type `123` into the phone field.
28. [Verify] The submit button is still disabled — the digits-only length
    (`3`) is below the `>= 7` threshold the picker enforces.
29. [Browser] Clear the field and type `+1 (555) 555-0177`.
30. [Verify] The submit button is now enabled.
31. [Browser] Tap the submit button.
32. [Verify]
    - The picker closes.
    - A new assistant message appears in the concierge thread whose text
      contains `Prepared SMS draft for No-Contact Nick (+15555550177).`
      (the server normalises the phone to `+` plus digits only — match
      that exact normalised value).
33. [DB] Confirm the durable system note in `concierge_messages`:
    ```
    SELECT count(*)::int AS n
    FROM concierge_messages
    WHERE conversation_id = ${convId}
      AND role = 'system'
      AND content = 'Prepared SMS draft for No-Contact Nick (+15555550177).';
    ```
    Expect `n = 1`.
34. [DB] Confirm SMS did NOT touch `messages` (the in-app row from Path A
    is the only one for this test user → recipient pair):
    ```
    SELECT count(*)::int AS n
    FROM messages
    WHERE sender_clerk_id = '${userClerkId}'
      AND recipient_clerk_id = 'rcpt-${tag}-nick';
    ```
    Expect `n = 0`.

    `[Capture — section B]` — `concierge-send-draft-stepB-sender.png`.
    The concierge sheet is open on the sender's view with the new
    `Prepared SMS draft for No-Contact Nick (+15555550177).` system
    note rendered at the bottom of the thread, the SMS proposal
    card flipped to `Done`, and the picker closed. Recipient
    context not opened in this section — `(n/a)` in the sibling
    results file.

### C. Email with override + validation

35. [DB] Append a third seeded proposal:
    ```
    INSERT INTO concierge_messages
      (conversation_id, role, content, proposed_actions)
    VALUES
      (${convId},
       'assistant',
       'One more follow-up — email this time.',
       '[{"type":"draft_client_note","label":"Draft: Email","payload":{"recipientName":"No-Contact Nick","subject":"Follow-up","draft":"Hi Nick — sending this by email since SMS bounced."}}]'::jsonb);
    ```
36. [Browser] Close + re-open the sheet, then tap `Confirm` on the new
    card.
37. [Browser] Tap `Send via Email`, then `Pick No-Contact Nick`.
38. [Verify]
    - The contact-input field's placeholder reads `Email address`. The
      field is empty (Nick's owner has the placeholder
      `nick.${tag}@example.test` in `users.email`, but the picker only
      pre-fills from the **recipient row** payload returned by
      `/api/concierge/recipients`, which DOES include `email`. Accept
      either an empty field OR the pre-filled `nick.${tag}@example.test`
      address — whichever the picker shows. If pre-filled, clear it.)
    - The submit button (visible text `Send via Email`) is disabled when
      the field is empty.
39. [Browser] Type `not-an-email` into the field.
40. [Verify] Submit button stays disabled (regex check fails).
41. [Browser] Clear the field and type `nick.${tag}@example.test`.
42. [Verify] Submit button is now enabled.
43. [Browser] Tap the submit button.
44. [Verify]
    - The picker closes.
    - A new assistant message appears in the concierge thread whose text
      contains either `Prepared email draft for No-Contact Nick
      (nick.${tag}@example.test).` (no SendGrid configured — expected
      in the dev environment) OR `Sent draft to No-Contact Nick
      (nick.${tag}@example.test).` (SendGrid configured). Accept either
      wording — both are valid server outcomes.
45. [DB] Confirm the durable system note in `concierge_messages`:
    ```
    SELECT count(*)::int AS n
    FROM concierge_messages
    WHERE conversation_id = ${convId}
      AND role = 'system'
      AND (
        content = 'Prepared email draft for No-Contact Nick (nick.${tag}@example.test).'
        OR
        content = 'Sent draft to No-Contact Nick (nick.${tag}@example.test).'
      );
    ```
    Expect `n = 1`.

    `[Capture — section C]` — `concierge-send-draft-stepC-sender.png`.
    The concierge sheet is open on the sender's view with the new
    email system note rendered at the bottom of the thread (either
    `Prepared email draft for No-Contact Nick (nick.${tag}@example.test).`
    or `Sent draft to No-Contact Nick (nick.${tag}@example.test).`
    depending on whether SendGrid is configured) and the email
    proposal card flipped to `Done`. Recipient context not opened in
    this section — `(n/a)` in the sibling results file.

### D. Cancel path (sanity check)

46. [DB] Append a fourth seeded proposal so we can open the picker
    without consuming a real send slot:
    ```
    INSERT INTO concierge_messages
      (conversation_id, role, content, proposed_actions)
    VALUES
      (${convId},
       'assistant',
       'Last follow-up draft.',
       '[{"type":"draft_client_note","label":"Draft: Cancel","payload":{"recipientName":"Hannah Has-Contact","subject":"Cancel test","draft":"This send will be cancelled."}}]'::jsonb);
    ```
47. [Browser] Close + re-open the sheet, then tap `Confirm` on the new
    card.
48. [Browser] In the picker, tap the `Cancel` button.
49. [Verify]
    - The picker closes.
    - The proposal card's primary button still reads `Confirm` (NOT
      `Done`) — cancel must NOT mark the action as completed.
    - No new system note matching `Sent draft` / `Prepared SMS draft` /
      `Prepared email draft` for the `Cancel test` subject appears in
      the thread.
50. [DB] Belt-and-braces — assert the cancel did not touch the durable
    state:
    ```
    SELECT count(*)::int AS n
    FROM concierge_messages
    WHERE conversation_id = ${convId}
      AND role = 'system'
      AND content LIKE '%Cancel test%';
    ```
    Expect `n = 0`.
    ```
    SELECT count(*)::int AS n
    FROM messages
    WHERE sender_clerk_id = '${userClerkId}'
      AND content = 'This send will be cancelled.';
    ```
    Expect `n = 0`.

    `[Capture — section D]` — `concierge-send-draft-stepD-sender.png`.
    The concierge sheet is open on the sender's view with the cancel
    proposal card's primary button still reading `Confirm` (proving
    cancel did NOT mark the action complete) and NO `Cancel test`
    system note appended to the thread. Same PNG satisfies the
    helper's "end-of-run final state" capture for the `sender`
    context. Recipient context not opened in this section — `(n/a)`
    in the sibling results file.

## Cleanup

Always-run teardown (regardless of pass / fail) so re-runs and parallel
runs stay isolated:

```
DELETE FROM messages
  WHERE sender_clerk_id = '${userClerkId}'
    AND recipient_clerk_id IN ('${hannahId}', 'rcpt-${tag}-nick');

-- Recipient-side notifications generated by the in-app branch.
DELETE FROM notifications
  WHERE user_clerk_id = '${hannahId}'
    AND type = 'message'
    AND title = 'New message';

DELETE FROM concierge_messages WHERE conversation_id = ${convId};

-- Hannah's connection rows are intentionally test-scoped — wipe both
-- directions so re-runs start clean. Nick's rows + outward account +
-- user are also wiped. Hannah's user / outward account are NOT
-- deleted (they are the persistent fixture).
DELETE FROM user_connections
  WHERE (from_outward_account_id = ${activeAcctId}
         AND to_outward_account_id = ${hannahAcctId})
     OR (from_outward_account_id = ${hannahAcctId}
         AND to_outward_account_id = ${activeAcctId})
     OR from_outward_account_id = ${nickAcctId}
     OR to_outward_account_id   = ${nickAcctId};

DELETE FROM outward_accounts
  WHERE owner_clerk_id = 'rcpt-${tag}-nick';

DELETE FROM users
  WHERE clerk_id = 'rcpt-${tag}-nick';

-- Reset Hannah's mutated phone fields so the fixture is left in a
-- predictable state for the next run.
UPDATE users
  SET phone = NULL, cell_phone = NULL
  WHERE clerk_id = '${hannahId}';
```

The concierge conversation row itself is left in place — it is per-user
durable state and the next seed step uses
`ON CONFLICT DO NOTHING` against it.

## Regressions this catches

- The picker's contact-input validation is removed or inverted (Path B
  steps 27–30, Path C steps 39–42 fail).
- The server stops appending the durable system note after a successful
  send (Path A step 19, Path B step 33, Path C step 45 fail).
- The in-app branch stops writing to `messages` (Path A step 18 fails).
- The team-up gate is removed for `in_app` (this plan does NOT exercise
  the negative team-up case — see
  `artifacts/api-server/src/routes/__tests__/concierge-send-draft.test.ts`
  for that branch).
- The picker's `onPick` resolver leaks across draft confirmations,
  re-firing a stale send on a new card (the cancel path, steps 48–50,
  fails because a phantom `Cancel test` system note appears).

## Notes for native (iOS / Android) runs

- `Linking.openURL("sms:...")` and `Linking.openURL("mailto:...")` will
  actually launch the system Messages / Mail app on a real device. Be
  prepared to dismiss the foregrounded compose window after each SMS /
  email send and return to the Roundhouse app. The system note
  assertions are device-agnostic — they read the concierge thread, not
  any external app.
- The FAB and picker accessibility labels are identical on native and
  web, so locator strategies do not need changes.

# Privacy toggle end-to-end through entity-thread inbox (#695, post-#663)

Use with the project's UI testing tool (Playwright-driven). Run against
the Roundhouse Expo web preview.

## Why this exists

Task #663 (the entity-membership-and-messaging cutover) replaced the
legacy 1:1 DM model with an entity-thread model: every property /
business / facility owns an `entities` row and its messages live on
that entity, fanned out via `entity_members`. The legacy DM listing,
DM thread routes, and the chat-header / team-up-note / FullProfileModal
identity surfaces were retired alongside the cutover.

The per-skin "show last initial only" toggle (#640) is still applied
server-side in `routes/messages.ts` — `listMyEntityThreads` shortens
`lastMessage.sender.name` per `formatOwnerNameForSkin` (lines 425-468)
when the *viewer* is not the message author and the *sender's* outward
account has `last_initial_only = true`. The unit tests in
`lib/__tests__/ownerNameDisplay.test.ts` cover the shortener in
isolation, but **the full producer→consumer journey** — flipping the
toggle in account settings, the API persisting it on
`outward_accounts.last_initial_only`, the entity-thread listing
shortening the preview's sender name, and the consumer's inbox row
re-rendering with the new prefix — is uncovered. A regression in any
of the three handoffs would slip past the unit tests because each only
exercises one selector.

This plan drives both sides of one entity thread in two browser
contexts so the toggler's persistence and the recipient's *external*
view are asserted in the same run.

## What is — and is not — a UI surface for the per-skin name shortening

The post-cutover audit before this rewrite found the visible
attribution surfaces narrowed to **one** in the friend's view:

- `app/inbox.tsx` renders one `EntityThreadRow` per entity the caller
  is an approved member of (testID `entity-thread-row-${entityId}`).
  Inside the row, the preview line (testID
  `entity-thread-preview-${entityId}`, lines 118-132) renders
  `${last.sender.name}: ${last.content}` when `lastMessage.sender`
  is present. **This is the surface under test.** The server
  pre-shortens `lastMessage.sender.name` per the skin rule above,
  so any regression in the persistence chain or the server
  shortener flips this prefix back to the full name.
- `components/PropertyMessagesTab.tsx` (the entity-thread room
  itself) renders message bubbles via the project's chat row
  component, which does NOT show the sender's name on incoming
  bubbles — the avatar carries the identity. So the in-room
  bubbles are NOT a UI surface for this rule and the plan does
  not assert on them.
- The entity-thread row TITLE (`thread.entityName`, line 112) comes
  from `entities.name` and is never shortened — the inbox shows
  the *property*, not the sender. No assertion is needed; the row
  title is independent of the toggle.

The legacy chat-header title, team-up-note opener-card caption, and
DM-listing row title that earlier revisions of this plan asserted on
no longer exist — `app/inbox/[otherUserId].tsx` was retired with the
cutover, the team-up-note message source was retired with the legacy
DM model, and the inbox no longer renders DM rows at all. The
FullProfileModal preview is also out of scope here: the modal
component still exists but is not currently wired into the profile
tab (tracked as a follow-up by this task), so there is no producer-
self-preview surface to assert against in the live app.

## Context

- Account settings → outward-account editor route:
  `app/account/edit/[id].tsx`. Hydrates `lastInitialOnly` from
  `account.lastInitialOnly` and PATCHes it through
  `updateMutation.mutateAsync(... { lastInitialOnly })`.
- Toggle UI lives inside the shared `OutwardAccountForm`
  (`components/OutwardAccountForm.tsx`, lines 376-424). Pressable with
  `accessibilityLabel = "Show only my last initial on this account"`
  and `accessibilityState.checked` reflecting the current value.
- The producer-side message-author surface is
  `components/PropertyMessagesTab.tsx`. The composer input has
  `testID = "property-message-input"` (line 243) and the send
  button has `testID = "property-message-send"` (line 253). The
  tab is mounted at `/property/${propertyId}?tab=messages` (the
  property detail screen reads `tab` from `useLocalSearchParams`
  and renders `PropertyMessagesTab` when `tab === "messages"`,
  see `app/property/[id].tsx` lines 234-251 and 1566-1577).
- The consumer-side surface is `app/inbox.tsx` — see "What is — and
  is not — a UI surface" above for the testIDs.
- API endpoints exercised:
  - `PATCH /api/users/me/outward-accounts/:id` (sets
    `last_initial_only`).
  - `POST  /api/properties/:id/entity-messages` (or whatever the
    property-thread send endpoint is named in the api-client; the
    test only needs the UI-level send to succeed and surface a
    new last message on the entity).
  - `GET   /api/properties/me/threads` — the entity-thread listing
    that powers `useListMyEntityThreads` (the inbox query). The
    server pre-shortens `lastMessage.sender.name` per
    `formatOwnerNameForSkin` (`routes/messages.ts` lines 425-468).

## Screenshot capture

This plan opts in to the dual-context screenshot helper at
`artifacts/round-house/e2e/dual-context-screenshots.md`. The helper
defines the storage layout, file-name convention, and capture
cadence (failing-step + section-boundary + final-state). The runner
should follow it verbatim; everything below is the
plan-specific configuration.

- **Plan slug** (storage directory): `privacy-toggle-end-to-end`
- **Short slug** (PNG file-name prefix): `privacy-toggle`
- **Storage directory**:
  `artifacts/round-house/e2e/screenshots/privacy-toggle-end-to-end/`
  — recreate empty at the start of every run so re-runs do not
  mix evidence with a previous run.
- **Context short names**: `standard` and `friend` (declared on the
  fixtures table below).
- **Section labels**: this plan groups its steps into sections
  A–E (`### A. Baseline ...`, `### B. Standard fixture flips ...`,
  etc.). The helper uses those letters directly in the PNG name
  (e.g. `privacy-toggle-stepA-friend.png`).
- **Sibling results file**:
  `artifacts/round-house/e2e/privacy-toggle-end-to-end.results.md`.
  After a run, fill in its "Per-step screenshots" table (one row
  per section) and its "Run summary" table; the file already
  contains the full set of expected file paths so a reviewer can
  scan it without consulting this plan.

The helper requires a snapshot of every open context **on any
[Verify] failure**. For this plan that's a hard requirement, not
a nice-to-have: every assertion in sections A / C / E reads a string
the *other* context produced (or chose not to produce), so a paired
snapshot is the only way to localize the regression to the right side
of the wire on a flaky run.

## Reusable signed-in fixtures

Reuses the **standard pre-onboarded fixture** described at the top of
`e2e/README.md` plus its FRIEND counterpart — both seeded by
`scripts/src/seed-standard-fixture.ts`. That seed now also adds the
FRIEND counterpart as an approved `entity_members` row
(role=`collaborator`, status=`approved`, direction=`invite`) on the
standard fixture's property entity, so both contexts land inside the
same entity thread without any ad-hoc DB stitching in this plan.

| Env var pair | Role | Context short name |
| --- | --- | --- |
| `E2E_FIREBASE_EMAIL` / `E2E_FIREBASE_PASSWORD` | The toggler. Owns the `Standard E2E Home` outward account and the `Standard E2E House` property. `users.name` is `Standard E2E Fixture`, so the privacy-on rendering is `Standard E2E F.`. | `standard` |
| `E2E_FIREBASE_FRIEND_EMAIL` / `E2E_FIREBASE_FRIEND_PASSWORD` | The entity-thread counterpart. Pre-seeded as an approved `collaborator` member of the standard fixture's property entity (so the property thread surfaces in the friend's `useListMyEntityThreads` payload). `users.name` is `Standard E2E Friend`. | `friend` |

The third "Context short name" column is the identifier the
dual-context screenshot helper uses when it names the per-step PNG
files; pin it here so the file names are predictable from reading
the plan alone.

Both accounts are pre-onboarded (`users.identity_completed_at` is set)
so sign-in lands on `/(tabs)`. If either secret is missing, report
`unable` instead of attempting a broken sign-in.

Recreate the fixtures with:

```sh
pnpm --filter @workspace/scripts run seed:standard-fixture
```

If the seed completes but the friend's
`useListMyEntityThreads` payload does not include the standard
property entity in step A's verification, fail `unable` and re-run
the seed — the membership row is the seed's responsibility, not
this plan's.

## DB seeding contract

`tag = nanoid(6)` (test-run-scoped). The transient seeded message
body embeds `${tag}` so cleanup is precise and parallel runs do not
collide.

### Identifiers to capture up front

```sql
SELECT clerk_id, active_outward_account_id, name
  FROM users
 WHERE email = '${E2E_FIREBASE_EMAIL}';
```
Capture `${standardClerkId}`, `${standardAcctId}`, `${standardName}`
(must equal `Standard E2E Fixture` — fail `unable` if it doesn't, the
seed has drifted).

```sql
SELECT clerk_id, active_outward_account_id, name
  FROM users
 WHERE email = '${E2E_FIREBASE_FRIEND_EMAIL}';
```
Capture `${friendClerkId}`, `${friendAcctId}`, `${friendName}`. Fail
`unable` if either `active_outward_account_id` is NULL.

```sql
SELECT id
  FROM properties
 WHERE owner_clerk_id = '${standardClerkId}'
   AND name = 'Standard E2E House'
 LIMIT 1;
```
Capture `${standardPropertyId}`. Fail `unable` if not found (the seed
script is the source of truth for this row).

```sql
SELECT entity_id
  FROM property_entity_links
 WHERE property_id = ${standardPropertyId}
 LIMIT 1;
```
Capture `${standardEntityId}`. Fail `unable` if not found — the seed
script populates this link row in `ensureProperty`.

```sql
SELECT count(*)::int AS n
  FROM entity_members
 WHERE entity_id            = ${standardEntityId}
   AND user_clerk_id        = '${friendClerkId}'
   AND user_outward_account_id = ${friendAcctId}
   AND status               = 'approved'
   AND archived_at IS NULL;
```
Expect `n = 1`. If `0`, fail `unable` and re-run the seed — the
friend-as-member row is the seed's responsibility.

### Pre-test reset (idempotent — runs at the start so re-runs start clean)

```sql
-- Force the toggle OFF on the standard fixture's active OA so the
-- baseline assertion is meaningful even if a prior run failed mid-flight.
UPDATE outward_accounts
   SET last_initial_only = FALSE
 WHERE id = ${standardAcctId};

-- Wipe any test entity messages on the standard property's entity so
-- the seeded body below is the most-recent message on the thread
-- (the entity-thread listing only carries the latest one).
DELETE FROM messages
 WHERE entity_id = ${standardEntityId}
   AND content   LIKE '%${tag}%';
```

(No bulk-delete of every message on the entity — the standard
fixture's seeded "welcome" content from the seed script may be
present and is harmless. The plan only needs its own tagged message
to be the latest one when the friend's inbox refetches.)

## Plan

### Pre-test seed — Standard posts the message that drives every assertion

This step authors the entity-thread message via the producer's UI
(not a raw SQL insert) so the plan also incidentally exercises the
`PropertyMessagesTab` send path. The body embeds `${tag}` and uses a
fixed prefix `Property thread message` so the assertion in section
A / C / E can match a stable substring.

1. [New Context — Standard] Create a fresh browser context. Install
   a global `page.on('dialog')` handler that accepts every dialog
   (`dialog.accept()`).
2. [Browser] Navigate to `/(auth)/sign-in`. Sign in as
   `E2E_FIREBASE_EMAIL` / `E2E_FIREBASE_PASSWORD`. Wait for navigation
   to leave `/(auth)/sign-in`. If the URL settles on
   `/(onboarding)/...`, stop and report `unable`.
3. [Browser] Navigate to `/property/${standardPropertyId}?tab=messages`.
   Wait for the messages tab to render — the composer with
   `testID = "property-message-input"` should be visible.
4. [Browser] Type the body `Property thread message ${tag}` into
   `testID = "property-message-input"`. Tap
   `testID = "property-message-send"`. Wait for the composer to
   clear (the send mutation clears `draft` on success) and for
   `sendMutation.isPending` to settle (the send button stops
   showing the spinner).
5. [DB] Confirm the message landed on the entity:
   ```sql
   SELECT id
     FROM messages
    WHERE entity_id  = ${standardEntityId}
      AND content    = 'Property thread message ${tag}'
      AND sender_clerk_id = '${standardClerkId}'
    LIMIT 1;
   ```
   Expect exactly one row. Capture its `id` as `${seedMessageId}`
   for the optional cleanup grep below; if zero rows, fail (the
   producer UI did not actually send — surface the most recent
   `POST /api/properties/.../entity-messages` response from the
   browser's network log).

### A. Baseline — friend's inbox row preview shows the full sender name

6. [New Context — Friend] Open a second, isolated browser context.
   Install the same dialog handler.
7. [Browser] Navigate to `/(auth)/sign-in`. Sign in as
   `E2E_FIREBASE_FRIEND_EMAIL` / `E2E_FIREBASE_FRIEND_PASSWORD`. Verify
   it lands outside `/(auth)/sign-in` and outside `/(onboarding)/...`.
8. [Browser] Navigate to `/inbox`. Wait for the entity-thread list
   to render (the FlatList stops showing the spinner; the empty
   state is NOT visible because the friend is now an approved
   member of the standard property entity).
9. [Verify — baseline preview prefix]
   - A row with `testID = "entity-thread-row-${standardEntityId}"`
     is visible. Its visible row title text reads `Standard E2E
     House` (the entity name comes from `entities.name`, never
     shortened).
   - The element with `testID =
     "entity-thread-preview-${standardEntityId}"` renders
     **exactly** the text `Standard E2E Fixture: Property thread
     message ${tag}` (the server emits
     `${last.sender.name}: ${last.content}`; with the toggle OFF
     `last.sender.name` is the raw `users.name`).
   - The full literal `Standard E2E F.` does **NOT** appear
     anywhere in that preview text — that's the regression marker
     the plan flips on in section C.

[Capture — section A] Per the dual-context screenshot helper
(`./dual-context-screenshots.md`), snapshot both contexts now (the
standard context is parked on `/property/${standardPropertyId}?tab=messages`
after step 4; the friend context is on `/inbox` after step 8). Save as
`screenshots/privacy-toggle-end-to-end/privacy-toggle-stepA-standard.png`
and `...-stepA-friend.png`. If any verify in this section already
failed, capture immediately at the failing step instead of at the
section boundary.

### B. Standard fixture flips the privacy toggle ON

10. [Browser — Standard context from step 1] Switch back to the
    standard context. Navigate to `/account` (the account settings
    list). Wait for the active outward account row to render.
11. [Browser] Tap the `Edit` action (the pressable with the `edit-2`
    icon and visible `Edit` text) on the row whose `ACTIVE` tag is
    visible. The URL should settle on `/account/edit/${standardAcctId}`.
12. [Verify] The privacy toggle is rendered: a pressable with
    accessibility label `Show only my last initial on this account`
    and `accessibilityState.checked = false`.
13. [Browser] Tap the toggle. Confirm
    `accessibilityState.checked` flips to `true`.
14. [Browser] Tap the `Save` button in the form footer / header.
    Wait for the `PATCH /api/users/me/outward-accounts/${standardAcctId}`
    request to return `200`. The router pops back to `/account`. If
    the PATCH returns `4xx`, surface the response body and fail.
15. [DB] Confirm the flag persisted:
    ```sql
    SELECT last_initial_only
      FROM outward_accounts
     WHERE id = ${standardAcctId};
    ```
    Expect `last_initial_only = true`. (Belt-and-braces guard
    against a UI state-only flip that didn't make it into the DB.)

[Capture — section B] Snapshot both contexts. The standard context
is on `/account` after step 14's pop-back; the friend context is
still parked on `/inbox` from section A (it has not been touched
in section B, which is intentional — capturing it here proves the
friend has NOT yet refetched, and any change visible on the friend
side at this moment is a stale-cache regression). Save as
`privacy-toggle-stepB-standard.png` and
`privacy-toggle-stepB-friend.png`.

### C. Friend's inbox preview prefix shortens after refetch

16. [Browser — Friend context from step 6] Switch back to the
    friend context. Trigger a refetch of the inbox listing.
    Either: pull-to-refresh on the FlatList (the screen wires
    `RefreshControl` → `refetch()`), or navigate away and back to
    `/inbox`, or hard-reload the URL. The query options also set
    `refetchOnWindowFocus: true`, so a tab focus is sufficient
    on web.
17. [Verify — toggled-on preview prefix]
    - The row with `testID =
      "entity-thread-row-${standardEntityId}"` is still visible
      and its title text is unchanged (`Standard E2E House`).
    - The element with `testID =
      "entity-thread-preview-${standardEntityId}"` now renders
      **exactly** `Standard E2E F.: Property thread message ${tag}`
      (the server shortened `lastMessage.sender.name` because the
      sender's OA now has `last_initial_only = true` and the
      viewer is not the author).
    - The full literal `Standard E2E Fixture` does **NOT** appear
      in that preview text.

[Capture — section C] Snapshot both contexts. Friend is on the
refetched `/inbox` (the surface under test for section C's
verifies); standard is unchanged from section B. Save as
`privacy-toggle-stepC-standard.png` and
`privacy-toggle-stepC-friend.png`. The friend PNG is the
headline piece of triage evidence on a flaky run — if step 17
asserts the wrong preview text, the friend snapshot shows
exactly which string was rendered, while the standard snapshot
proves the producer side is still in the toggled-on state
(i.e. the regression is not "the toggler reverted itself
between B and C").

### D. Toggle OFF persists

18. [Browser — Standard] Navigate to `/account/edit/${standardAcctId}`
    again.
19. [Verify] The toggle now renders with
    `accessibilityState.checked = true` (the hydrate from step 14's
    PATCH is sticky).
20. [Browser] Tap the toggle (`checked` flips back to `false`). Tap
    `Save`. Wait for `PATCH .../outward-accounts/${standardAcctId}`
    to return `200`.
21. [DB] Confirm rollback:
    ```sql
    SELECT last_initial_only
      FROM outward_accounts
     WHERE id = ${standardAcctId};
    ```
    Expect `last_initial_only = false`.

[Capture — section D] Snapshot both contexts. The standard context
is on `/account` after step 20's pop-back; the friend context is
still parked on `/inbox` from section C (intentionally untouched
between sections D and E for the same stale-cache-guard reason as
section B). Save as `privacy-toggle-stepD-standard.png` and
`privacy-toggle-stepD-friend.png`.

### E. Friend's inbox preview prefix restores on refetch

22. [Browser — Friend] Trigger another refetch of the inbox
    listing (same options as step 16).
23. [Verify — restored preview prefix]
    - The element with `testID =
      "entity-thread-preview-${standardEntityId}"` again renders
      **exactly** `Standard E2E Fixture: Property thread message
      ${tag}`. The full name is back; the literal `Standard E2E F.`
      does **NOT** appear.

[Capture — section E] Snapshot both contexts in their final,
restored state. Save as `privacy-toggle-stepE-standard.png` and
`privacy-toggle-stepE-friend.png`. Per the helper's "end of the
run regardless of pass/fail" rule, this is also the run's
final-state capture — no extra shots beyond E are needed unless
an earlier section already failed (in which case the runner has
already captured per-failure snapshots at the failing step and
can skip extra final-state captures from contexts that have since
closed).

## Cleanup

Always-run teardown (regardless of pass / fail):

```sql
-- Restore the toggle to OFF in case step 20 was skipped due to a
-- mid-test failure.
UPDATE outward_accounts
   SET last_initial_only = FALSE
 WHERE id = ${standardAcctId};

-- Drop the test message authored in the pre-test seed step (and
-- defensively any other tagged content from a partial prior run).
DELETE FROM messages
 WHERE entity_id = ${standardEntityId}
   AND content   LIKE '%${tag}%';
```

The seed-side `entity_members` row that puts the friend on the
standard property entity is **not** torn down — it's owned by the
seed script (`scripts/src/seed-standard-fixture.ts`), is idempotent
on re-run, and is part of the standing fixture every other plan
that exercises the entity-thread surface depends on.

## Regressions this catches

- `PATCH /api/users/me/outward-accounts/:id` stops accepting or
  persisting `lastInitialOnly` (e.g. the field gets dropped from
  the column allowlist in `routes/outward-accounts.ts`) → step 15 /
  step 21 DB check fails.
- `routes/messages.ts::listMyEntityThreads` stops applying
  `formatOwnerNameForSkin` to `lastMessage.sender.name` (the
  shortening block at lines 425-468) → step 17 fails (the preview
  prefix stays at `Standard E2E Fixture: ...` after the flip).
- `formatOwnerNameForSkin` regresses on multi-token names (e.g.
  collapses to first-name only, or fails to uppercase the initial)
  → step 17's exact-match assertion fails.
- The viewer-is-author guard regresses (the listing shortens the
  viewer's *own* sender name) — not directly asserted here, but
  step 9 / 23 would still pass and step 17 would still pass with
  whatever shortened text the bug emits, so this regression is
  caught indirectly via the parallel my-team-tab-message plan
  rather than this one.
- The toggle's `accessibilityLabel` or `accessibilityState.checked`
  contract drifts → steps 12, 13, 19 fail (the test runner can't
  locate or read the toggle state).
- `app/inbox.tsx` stops rendering the `${last.sender.name}:` prefix
  on the preview line, or stops emitting the
  `entity-thread-preview-${entityId}` testID → steps 9, 17, 23 all
  fail to locate or read the preview element.
- The seed's `entity_members` row for the friend is dropped (e.g.
  the seed regression breaks `ensureApprovedEntityMember`) → the
  friend's `useListMyEntityThreads` payload no longer includes the
  standard property entity, step 9's row-locator fails, and the
  identifiers-up-front membership check returns `n = 0` so the
  plan reports `unable` instead of a false negative.

## Notes for native (iOS / Android) runs

- Sign-in uses the same `app/(auth)/sign-in.tsx` form as every other
  fixture; drive both accounts through that screen.
- The producer-side composer (`testID = "property-message-input"`)
  and send button (`testID = "property-message-send"`) render
  identically on native (the underlying `TextInput` and `Pressable`
  carry the testIDs through React Native).
- The inbox row testIDs (`entity-thread-row-${entityId}`,
  `entity-thread-preview-${entityId}`) are set on a `Pressable` and
  a `Text`, so they propagate the same way on native.
- The toggle row is a `Pressable` with the accessibility label and
  state contract listed above; native screen readers (VoiceOver /
  TalkBack) announce both, and the test runner can match on either
  the visible label text or the accessibility label.

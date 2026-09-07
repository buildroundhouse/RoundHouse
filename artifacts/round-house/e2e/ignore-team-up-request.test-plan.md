# Ignore team-up request — end-to-end test plan

Use with the project's UI testing tool (Playwright-driven). Run against
the Roundhouse Expo web preview.

> **Single-context plan.** Drives only one Playwright browser context
> (the recipient triaging an inbound request). The dual-context
> screenshot helper at `./dual-context-screenshots.md` intentionally
> does not apply here; no sibling `*.results.md` template ships
> alongside this plan.

## Context

Task #598. The Invites screen now renders a third button — **Ignore** —
on each incoming team-up request row, alongside the existing **Decline**
and **Accept** buttons. The Ignore button is a pure-client affordance:

- It does **not** call `POST /users/:userId/team-up/respond`.
- It does **not** mutate the `user_connections` row in any way.
- It only shows an in-app banner with the text
  `You can come back to this request later.`, which auto-dismisses
  after ~4 seconds.
- The row therefore stays visible after the requests query is
  invalidated or refetched (e.g. by remounting the screen).

This plan exercises that contract end-to-end on web, plus parity:
the sibling **Decline** button on a second incoming request still
calls the respond endpoint and removes that row from the list.

Files exercised end-to-end:

- UI: `artifacts/round-house/app/invites.tsx` — `TeamUpRow` (renders
  the three buttons and their `accessibilityLabel`s) and
  `InvitesScreen.handleRespond` / the inline `onIgnore` handler that
  sets the banner.
- Hooks: `useListMyTeamUpRequests` and `useRespondToTeamUpRequest`
  from `@workspace/api-client-react`.
- Server contract:
  - `GET  /api/users/me/team-up-requests` — returns `incoming` rows
    while `status === 'pending'`.
  - `POST /api/users/:userId/team-up/respond` — used **only** by
    Decline / Accept; Ignore must not hit it.
- Schema: `lib/db/src/schema/user_connections.ts` — pending
  team-up rows have `status = 'pending'` and live skin-to-skin
  via `fromOutwardAccountId` / `toOutwardAccountId`.

## Accessibility / DOM contract

For every `TeamUpRow`, the three pressables must expose
`accessibilityLabel`s that include the requester's display name (the
`title` prop, which is `req.otherName || req.otherCompanyName ||
"Someone"`):

- `Accept request from ${title}`
- `Decline request from ${title}`
- `Ignore request from ${title}`

The banner that appears after Ignore renders the literal string
`You can come back to this request later.` inside the success-styled
banner block at the top of the screen (`check-circle` icon).

## Reusable signed-in fixture

This plan reuses the homeowner Firebase fixture from
`reminders-side-tab.test-plan.md`:

- `E2E_FIREBASE_EMAIL` / `E2E_FIREBASE_PASSWORD` — a homeowner-skin
  account that has finished onboarding so sign-in lands on `/(tabs)`
  immediately. The active outward account must be a homeowner (`kind =
  'home'`); other skins still receive team-up rows but the seed step
  below only attaches them to the homeowner outward account.

The two Trade Pro counterparties (the requester whose row we Ignore
and the requester whose row we Decline) are seeded directly in
Postgres. `DATABASE_URL` must be set, and both the API server
workflow (`artifacts/api-server: API Server`) and the Roundhouse Expo
workflow (`artifacts/round-house: expo`) must be running.

If `E2E_FIREBASE_EMAIL` / `E2E_FIREBASE_PASSWORD` or `DATABASE_URL`
are missing, the test should report `unable` rather than silently
fall through.

## Plan

1. [Shell] Resolve the homeowner fixture's clerk id and homeowner
   outward-account id (same query as
   `cadence-toggle.test-plan.md` step 1):

   ```
   pnpm --silent --filter @workspace/db exec tsx -e "
     const { db, usersTable, outwardAccountsTable } = require('@workspace/db');
     const { eq, and } = require('drizzle-orm');
     (async () => {
       const email = process.env.E2E_FIREBASE_EMAIL;
       const [u] = await db.select({ clerkId: usersTable.clerkId })
         .from(usersTable).where(eq(usersTable.email, email));
       if (!u) { console.error('no user row for', email); process.exit(1); }
       const [acc] = await db.select({ id: outwardAccountsTable.id })
         .from(outwardAccountsTable)
         .where(and(
           eq(outwardAccountsTable.ownerClerkId, u.clerkId),
           eq(outwardAccountsTable.kind, 'home'),
         ));
       if (!acc) { console.error('no homeowner outward account'); process.exit(1); }
       process.stdout.write(u.clerkId + '\\n' + acc.id + '\\n');
     })();
   "
   ```

   Capture as `$VIEWER_UID` and `$VIEWER_OUTWARD_ID`. If either
   command exits non-zero, stop and report `unable`.

2. [Shell] Idempotently seed two Trade Pro counterparties (Pro A =
   the one we Ignore, Pro B = the one we Decline) and a single
   `pending` `core` team-up request from each pro's outward account
   into the homeowner's outward account. Use stable handles so
   re-runs reuse the same rows; if a prior run already accepted /
   declined them, this step **resets** both rows back to `pending`
   so the screen renders both incoming requests again.

   ```
   pnpm --silent --filter @workspace/db exec tsx -e "
     const { db, usersTable, outwardAccountsTable, userConnectionsTable } = require('@workspace/db');
     const { eq, and } = require('drizzle-orm');
     (async () => {
       const VIEWER_OUTWARD_ID = Number(process.argv[1]);
       const PROS = [
         { uid: 'e2e-ignore-pro-a-uid',
           email: 'e2e-ignore-pro-a@roundhouse.test',
           name: 'Ignore Test Pro A',
           username: 'ignore-test-pro-a',
           company: 'Ignore Test Pro A Co.' },
         { uid: 'e2e-ignore-pro-b-uid',
           email: 'e2e-ignore-pro-b@roundhouse.test',
           name: 'Decline Test Pro B',
           username: 'decline-test-pro-b',
           company: 'Decline Test Pro B Co.' },
       ];
       const out = [];
       for (const p of PROS) {
         let [u] = await db.select().from(usersTable).where(eq(usersTable.clerkId, p.uid));
         if (!u) {
           [u] = await db.insert(usersTable).values({
             clerkId: p.uid, email: p.email, name: p.name,
             username: p.username, identityCompletedAt: new Date(),
             activeModeKind: 'trade_pro',
           }).returning();
         }
         let [acc] = await db.select().from(outwardAccountsTable)
           .where(and(eq(outwardAccountsTable.ownerClerkId, p.uid),
                      eq(outwardAccountsTable.kind, 'trade_pro')));
         if (!acc) {
           [acc] = await db.insert(outwardAccountsTable).values({
             ownerClerkId: p.uid, kind: 'trade_pro',
             displayName: p.name, companyName: p.company,
             companyKind: 'trade_pro',
           }).returning();
         }
         await db.update(usersTable)
           .set({ activeOutwardAccountId: acc.id, activeModeKind: 'trade_pro' })
           .where(eq(usersTable.clerkId, p.uid));

         // Pending team-up request: pro -> homeowner.
         let [conn] = await db.select().from(userConnectionsTable)
           .where(and(
             eq(userConnectionsTable.fromOutwardAccountId, acc.id),
             eq(userConnectionsTable.toOutwardAccountId, VIEWER_OUTWARD_ID),
           ));
         if (!conn) {
           [conn] = await db.insert(userConnectionsTable).values({
             fromOutwardAccountId: acc.id,
             toOutwardAccountId: VIEWER_OUTWARD_ID,
             kind: 'core', status: 'pending',
             requestedAt: new Date(),
             personalNote: 'Hi from ' + p.name + ' — would love to team up.',
           }).returning();
         } else {
           [conn] = await db.update(userConnectionsTable)
             .set({ kind: 'core', status: 'pending',
                    respondedAt: null, removedAt: null, archivedAt: null,
                    requestedAt: new Date() })
             .where(eq(userConnectionsTable.id, conn.id)).returning();
         }
         out.push(p.name + '|' + p.uid + '|' + conn.id);
       }
       process.stdout.write(out.join('\\n') + '\\n');
     })();
   " "$VIEWER_OUTWARD_ID"
   ```

   Capture the two printed lines, splitting on `|`, as
   `$PRO_A_NAME` / `$PRO_A_UID` / `$PRO_A_CONN_ID` and
   `$PRO_B_NAME` / `$PRO_B_UID` / `$PRO_B_CONN_ID`. If the command
   exits non-zero, stop and report `unable`.

3. [New Context] Create a new browser context. Install a global
   `page.on('dialog')` handler that accepts (`dialog.accept()`) any
   dialogs.

4. [Browser] Sign in following steps 2–5 of
   `reminders-side-tab.test-plan.md`: navigate to `/(auth)/sign-in`,
   type `E2E_FIREBASE_EMAIL` / `E2E_FIREBASE_PASSWORD`, tap
   `Sign in`, wait for the URL to settle on `/(tabs)`. If onboarding
   routes show instead, the seeded fixture is stale — stop and
   report `unable`.

5. [Browser] Navigate to `/invites`. Wait for the screen header
   `My invites` to be visible.

6. [Verify — both incoming team-up rows render]
   - The section header `Team-up requests` is visible.
   - Two rows are rendered beneath that header: one whose primary
     text matches `${PRO_A_NAME}` and one whose primary text
     matches `${PRO_B_NAME}`.
   - For **each** of those two rows, three pressables are present
     and exposed via accessible names that include the requester's
     name:
     - `Accept request from ${PRO_A_NAME}`
     - `Decline request from ${PRO_A_NAME}`
     - `Ignore request from ${PRO_A_NAME}`
     - `Accept request from ${PRO_B_NAME}`
     - `Decline request from ${PRO_B_NAME}`
     - `Ignore request from ${PRO_B_NAME}`

7. [Browser] Start observing network requests. Begin recording all
   POSTs whose URL matches `/api/users/.+/team-up/respond` — the
   list must remain empty across step 8 and the post-Ignore
   refetch (steps 9–10).

8. [Browser] Tap the pressable whose accessible name is
   `Ignore request from ${PRO_A_NAME}`.

9. [Verify — banner shown, no respond call, row still present]
   - The success banner is visible at the top of the screen and
     contains the literal text
     `You can come back to this request later.`
   - The Pro A row is still rendered under `Team-up requests`
     (the row must not disappear when Ignore is pressed).
   - The Pro B row is unchanged.
   - Zero requests have been made to any URL matching
     `/api/users/.+/team-up/respond` since step 7. (The Ignore
     handler is purely client-side; if any respond call is
     observed, fail and surface the request body.)

10. [Browser] Force a refetch of the team-up requests query without
    refreshing the whole page: navigate to `/(tabs)` (e.g. via the
    bottom-tab `Home` entry), wait for the tab screen to render,
    then navigate back to `/invites`. This remounts
    `InvitesScreen` and re-issues
    `GET /api/users/me/team-up-requests`.

11. [Verify — row survives the refetch]
    - The `Team-up requests` section header is still visible.
    - The row whose primary text matches `${PRO_A_NAME}` is still
      rendered beneath it (the underlying
      `user_connections` row is still `status = 'pending'`).
    - The Pro B row is also still rendered.
    - Still zero respond-API calls have been observed across the
      whole test so far.

12. [Browser] Tap the pressable whose accessible name is
    `Decline request from ${PRO_B_NAME}`. Wait for the
    `POST /api/users/${PRO_B_UID}/team-up/respond` request to
    complete with a 2xx (the body is
    `{ action: "decline", requesterOutwardAccountId: <pro B's
    outward id> }`). If the response is 4xx/5xx, surface the body
    and fail.

13. [Verify — Decline parity is preserved]
    - The success banner now reads
      `Declined the request from ${PRO_B_NAME}.` (replacing the
      earlier Ignore banner if it had not yet auto-dismissed).
    - The row whose primary text matches `${PRO_B_NAME}` is **no
      longer** rendered under `Team-up requests` (its row was
      removed by the `queryClient.invalidateQueries` call inside
      `handleRespond`).
    - The row whose primary text matches `${PRO_A_NAME}` is still
      rendered (Decline on a sibling row must not affect the
      Ignored row).

14. [Shell] Belt-and-braces cleanup: reset both seeded connections
    back to `pending` so re-runs are deterministic.

    ```
    pnpm --silent --filter @workspace/db exec tsx -e "
      const { db, userConnectionsTable } = require('@workspace/db');
      const { inArray } = require('drizzle-orm');
      const ids = process.argv.slice(1).map(Number);
      db.update(userConnectionsTable)
        .set({ status: 'pending', respondedAt: null,
               removedAt: null, archivedAt: null,
               requestedAt: new Date() })
        .where(inArray(userConnectionsTable.id, ids))
        .then(() => process.exit(0));
    " "$PRO_A_CONN_ID" "$PRO_B_CONN_ID"
    ```

## Regressions this catches

- The Ignore handler regresses to calling
  `respond.mutateAsync({ action: "decline" | "accept", ... })` —
  step 9 fails because a `/team-up/respond` POST is observed and/or
  the row vanishes from the list immediately.
- The Ignore handler regresses to invalidating the team-up query
  and the server starts returning the row as no-longer-pending
  (e.g. someone added a `status='ignored'` write) — step 11 fails
  because the Pro A row vanishes after the navigate-away-and-back
  refetch.
- The banner copy is changed away from
  `You can come back to this request later.` — step 9 fails on the
  banner-text assertion.
- The `accessibilityLabel`s on Accept / Decline / Ignore drop the
  requester's name (e.g. revert to a static `"Ignore"`) — step 6
  fails because the named pressables can't be located.
- `handleRespond` stops invalidating the team-up query after a
  successful Decline, or the server starts returning the declined
  row as `pending` again — step 13 fails because the Pro B row is
  still visible.
- The Ignore button is wired to the wrong row's handler (e.g. an
  index/key bug closes over the first row) — step 13 fails because
  Decline on Pro B inadvertently removes Pro A as well, or the
  Pro A row disappears in step 9.

## Notes for native (iOS / Android) runs

- Sign in via the same `/(auth)/sign-in` screen on device.
- The three buttons render in the same order on native (`Decline`,
  `Ignore`, `Accept`) and expose the same `accessibilityLabel`
  strings; locate them via the platform's accessibility inspector
  by name.
- The banner is a plain `View` with `Text` inside, so its literal
  text content is the same on native — match by visible text.
- To force the team-up query to refetch on device, navigate away
  to another tab and back to `/invites` (the Expo router remounts
  the screen the same way it does on web).

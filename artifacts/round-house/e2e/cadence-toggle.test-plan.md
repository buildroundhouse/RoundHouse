# Cadence toggle — end-to-end test plan

Use with the project's UI testing tool (Playwright-driven). Run against the
Roundhouse Expo web preview.

> **Single-context plan.** Drives only one Playwright browser context
> (the homeowner toggling their own cadence). The dual-context
> screenshot helper at `./dual-context-screenshots.md` intentionally
> does not apply here; no sibling `*.results.md` template ships
> alongside this plan.

## Context

Task #534. The hirer can now switch a connected Trade Pro between
**Occasional** and **Recurring** from the pro's public profile. This plan
opens the pro's profile from the homeowner's My Team screen, flips the
cadence in the classification & cadence editor, and verifies the pro
re-sorts between the **Occasional** and **Recurring** sub-buckets under
"Trade Pros" without a manual refresh.

Files exercised end-to-end:

- Editor UI: `artifacts/round-house/components/ConnectionTagModal.tsx`
  (`mode="classify-pro"`, the "Cadence" radio group with options
  Occasional / Recurring).
- Trigger: `artifacts/round-house/components/PublicProfileModal.tsx` —
  the "Set classification & cadence" / "Change classification & cadence"
  button that opens the editor. Only rendered when the *subject's*
  `activeModeKind` is `trade_pro` or `trade_pro_collab`.
- List re-sort: `artifacts/round-house/app/(tabs)/my-team.tsx` —
  `splitByCadence` partitions `core` rows into `recurring` (cadence ===
  "recurring") and `occasional` (everything else) under the **Trade
  Pros** section. The `onSaved` handler in PublicProfileModal calls
  `queryClient.invalidateQueries()`, which refetches
  `GET /api/users/me/relationships` and re-sorts the list in place.
- Server contract: `PATCH /api/users/me/connections/:id` in
  `artifacts/api-server/src/routes/users.ts`. `cadence` is a *from-side*
  field (the hirer's bucket choice), so the homeowner — who owns the
  `from` row — is authorized to flip it. Response includes the updated
  `cadence`.
- Schema: `lib/db/src/schema/user_connections.ts`
  (`cadence: "occasional" | "recurring"`, default `"occasional"`).

## Reusable signed-in fixture

This plan reuses the seeded Firebase fixture from
`reminders-side-tab.test-plan.md`:

- `E2E_FIREBASE_EMAIL` / `E2E_FIREBASE_PASSWORD` — a homeowner-skin
  account that has finished onboarding so sign-in lands on `/(tabs)`
  immediately. **The active outward account for this user must be a
  homeowner** (i.e. `companyKind` is null), so the My Team screen
  renders the homeowner layout with the cadence-aware "Trade Pros"
  bucket. If the seed account has been switched to a `trade_pro` or
  `facilities` outward account, the cadence sub-buckets live under
  "Outside Services" instead of "Trade Pros" — switch back to the
  homeowner skin via the account switcher before running this plan.

The Trade Pro counterparty is seeded directly in Postgres so the test
doesn't depend on a second sign-in flow.

- `DATABASE_URL` must be set in the Replit environment so the seed
  shell command can connect to the same Postgres the API server uses.
- The API server workflow (`artifacts/api-server: API Server`) and the
  Roundhouse Expo workflow (`artifacts/round-house: expo`) must both
  be running.

If `E2E_FIREBASE_EMAIL` / `E2E_FIREBASE_PASSWORD` or `DATABASE_URL` are
missing, the test should report `unable` rather than silently fall
through.

## Plan

1. [Shell] Resolve the homeowner fixture's clerk id (= Firebase uid)
   and outward-account id. The API server stamps `users.clerkId` with
   the Firebase uid on first request, and the homeowner skin is the
   `outward_accounts` row with `kind = 'home'` and
   `ownerClerkId = $E2E_USER_UID`. Run:

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

   Capture the two printed lines as `$VIEWER_UID` and `$VIEWER_OUTWARD_ID`.

2. [Shell] Seed (idempotently) a Trade Pro counterparty — a `users`
   row plus a `trade_pro` outward account — and a single accepted
   `core` connection from the homeowner's outward account to the pro's
   outward account, with `cadence = 'occasional'` and `classification`
   left null. Use a stable test handle so re-runs reuse the same row.

   ```
   pnpm --silent --filter @workspace/db exec tsx -e "
     const { db, usersTable, outwardAccountsTable, userConnectionsTable } = require('@workspace/db');
     const { eq, and } = require('drizzle-orm');
     (async () => {
       const VIEWER_OUTWARD_ID = Number(process.argv[1]);
       const PRO_UID = 'e2e-cadence-pro-uid';
       const PRO_EMAIL = 'e2e-cadence-pro@roundhouse.test';
       const PRO_NAME = 'Cadence Test Pro';
       const PRO_USERNAME = 'cadence-test-pro';

       // upsert Pro user
       let [pro] = await db.select().from(usersTable).where(eq(usersTable.clerkId, PRO_UID));
       if (!pro) {
         [pro] = await db.insert(usersTable).values({
           clerkId: PRO_UID, email: PRO_EMAIL, name: PRO_NAME,
           username: PRO_USERNAME, identityCompletedAt: new Date(),
           activeModeKind: 'trade_pro',
         }).returning();
       }
       // upsert Pro outward account (kind=trade_pro, owned by Pro)
       let [acc] = await db.select().from(outwardAccountsTable)
         .where(and(eq(outwardAccountsTable.ownerClerkId, PRO_UID),
                    eq(outwardAccountsTable.kind, 'trade_pro')));
       if (!acc) {
         [acc] = await db.insert(outwardAccountsTable).values({
           ownerClerkId: PRO_UID, kind: 'trade_pro',
           displayName: PRO_NAME, companyName: 'Cadence Test Pro Co.',
           companyKind: 'trade_pro',
         }).returning();
       }
       // ensure Pro's activeOutwardAccountId points at this account so
       // PublicProfileModal sees activeModeKind === 'trade_pro'.
       await db.update(usersTable)
         .set({ activeOutwardAccountId: acc.id, activeModeKind: 'trade_pro' })
         .where(eq(usersTable.clerkId, PRO_UID));

       // upsert connection (homeowner -> pro), kind=core, accepted, cadence=occasional
       let [conn] = await db.select().from(userConnectionsTable)
         .where(and(
           eq(userConnectionsTable.fromOutwardAccountId, VIEWER_OUTWARD_ID),
           eq(userConnectionsTable.toOutwardAccountId, acc.id),
         ));
       if (!conn) {
         [conn] = await db.insert(userConnectionsTable).values({
           fromOutwardAccountId: VIEWER_OUTWARD_ID,
           toOutwardAccountId: acc.id,
           kind: 'core', status: 'accepted',
           cadence: 'occasional', classification: null,
           respondedAt: new Date(),
         }).returning();
       } else {
         [conn] = await db.update(userConnectionsTable)
           .set({ kind: 'core', status: 'accepted', cadence: 'occasional',
                  classification: null, removedAt: null, archivedAt: null })
           .where(eq(userConnectionsTable.id, conn.id)).returning();
       }
       process.stdout.write(PRO_UID + '\\n' + PRO_NAME + '\\n' + acc.id + '\\n' + conn.id + '\\n');
     })();
   " "$VIEWER_OUTWARD_ID"
   ```

   Capture the printed lines as `$PRO_UID`, `$PRO_NAME`, `$PRO_OUTWARD_ID`,
   `$CONN_ID`. The seed must leave `cadence = 'occasional'` so the UI
   starts with the pro under the **Occasional** sub-bucket. If the
   command exits non-zero, stop the test and report `unable`.

3. [New Context] Create a new browser context. Install a global
   `page.on('dialog')` handler that accepts (`dialog.accept()`) any
   dialogs.

4. [Browser] Sign in following steps 2–5 of
   `reminders-side-tab.test-plan.md`: navigate to `/(auth)/sign-in`,
   type `E2E_FIREBASE_EMAIL` / `E2E_FIREBASE_PASSWORD`, tap `Sign in`,
   wait for the URL to settle on `/(tabs)`. If onboarding routes show
   instead, the seeded fixture is stale — stop and report `unable`.

5. [Browser] Tap the bottom-tab `My Team` entry (or navigate to
   `/(tabs)/my-team`). Wait for the screen header `My Team` to appear.

6. [Verify — initial sort]
   - The "Trade Pros" section header is visible.
   - Inside that section, an **Occasional** sub-section header is
     visible and a row with the visible name `${PRO_NAME}` is rendered
     beneath it.
   - The `${PRO_NAME}` row is **not** rendered under the **Recurring**
     sub-section. (The Recurring sub-header may be absent entirely if
     no other connection has `cadence = 'recurring'`.)

7. [Browser] Tap the `${PRO_NAME}` row to open the public profile
   modal. Wait for the modal header `Profile` and the pro's name to
   appear.

8. [Verify — editor entry point]
   - A button labelled `Set classification & cadence` is visible
     (initial cadence is the default `occasional` and `classification`
     is null, so the trigger uses the "Set" wording, not "Change").

9. [Browser] Tap the `Set classification & cadence` button. Wait for
   the modal header to read `Classify`.

10. [Verify — editor initial state]
    - A "Cadence" section is visible with two radio rows: `Occasional`
      and `Recurring`.
    - Neither radio is selected (both render the unfilled `circle`
      icon, not `check-circle`) — `cadence` was the schema default
      and is treated as unset by the editor.

11. [Browser] Tap the `Recurring` radio row. Then tap the header
    `Save` button. Wait for the editor modal to dismiss back to the
    public profile modal.

12. [Verify — round-trip on the profile]
    - The editor closed without surfacing an error string.
    - The trigger button text on the public profile modal is now
      `Change classification & cadence` (cadence is now non-null, so
      the button uses the "Change" wording).

13. [Browser] Tap the `X` button in the profile modal header to close
    it. Wait for the My Team screen to be fully visible again. Do
    **not** pull-to-refresh and do **not** reload the page — the
    re-sort must happen because `onSaved` invalidated the
    relationships query, not because of a manual refresh.

14. [Verify — re-sorted without manual refresh]
    - Inside the "Trade Pros" section, a **Recurring** sub-section
      header is now visible and the `${PRO_NAME}` row is rendered
      beneath it.
    - The `${PRO_NAME}` row is **no longer** rendered under the
      **Occasional** sub-section. (Occasional sub-header may be absent
      entirely if no other core row has `cadence !== 'recurring'`.)
    - Across the whole page, exactly one row with the visible name
      `${PRO_NAME}` exists (guards against the row leaking into both
      sub-buckets when the partition regresses).

15. [Browser] Tap the `${PRO_NAME}` row again to re-open the profile.
    Tap `Change classification & cadence`. In the editor, tap the
    `Occasional` radio row, then tap `Save`. Close the profile modal.

16. [Verify — flip back]
    - Without any manual refresh, `${PRO_NAME}` is back under the
      **Occasional** sub-section of "Trade Pros" and is no longer
      under **Recurring**.

17. [Shell] Belt-and-braces cleanup: reset the seeded connection back
    to its default state so re-runs are deterministic.

    ```
    pnpm --silent --filter @workspace/db exec tsx -e "
      const { db, userConnectionsTable } = require('@workspace/db');
      const { eq } = require('drizzle-orm');
      db.update(userConnectionsTable)
        .set({ cadence: 'occasional', classification: null })
        .where(eq(userConnectionsTable.id, Number(process.argv[1])))
        .then(() => process.exit(0));
    " "$CONN_ID"
    ```

## Regressions this catches

- `PATCH /api/users/me/connections/:id` stops accepting `cadence`, or
  the from-side authorization check rejects the homeowner — step 11
  fails because the editor surfaces an error and the modal stays open.
- `ConnectionTagModal` drops `cadence` from the patch body (e.g. the
  `if (cadence) body.cadence = cadence` line is removed) — step 14
  fails because the row stays under Occasional.
- `onSaved` no longer invalidates the relationships query on the
  profile modal — step 14 fails because the cached list does not
  re-sort until a manual refresh.
- `splitByCadence` in `app/(tabs)/my-team.tsx` is inverted (recurring
  vs occasional swapped) — steps 14 and 16 both fail because the row
  appears under the wrong sub-bucket.
- The "Set / Change classification & cadence" trigger is no longer
  gated on `activeModeKind === 'trade_pro' | 'trade_pro_collab'`, or
  is gated on the *viewer's* mode by mistake — step 8 fails because
  the trigger is missing or the wording flips unexpectedly.

## Notes for native (iOS / Android) runs

- Sign in via the same `/(auth)/sign-in` screen on device.
- The classification & cadence editor renders as a native page-sheet
  modal; tap the header `Save` button (not a system action) to commit.
- After closing the profile modal, the My Team list re-sorts via
  `useGetMyRelationships`'s React Query refetch — no pull-to-refresh
  is required. If the re-sort only appears after a manual refresh on
  device, that's the same regression as step 14 on web and should be
  reported.

# Privacy toggle end-to-end through entity-thread inbox — e2e run results (Task #695 plan + #702 helper, post-#663 rewrite)

**Plan:** `artifacts/round-house/e2e/privacy-toggle-end-to-end.test-plan.md`
**Helper:** `artifacts/round-house/e2e/dual-context-screenshots.md`
**Run:** _(YYYY-MM-DD — fill in on the next real run)_
**Skins covered:** Homeowner toggler (`Standard E2E Fixture`) ↔
collaborator counterpart (`Standard E2E Friend`), both members of the
same property entity (`Standard E2E House`).

This file is checked in **as a template** so subsequent runs have a
ready-to-fill scaffold — the per-section screenshot table, the
run-summary table, and the regression-evidence layout. Drop run-specific
notes inline, keep the layout, and replace the `(pending)` placeholders
with the actual PASS / FAIL / `(missing)` values once the run completes.

The plan rewrite (Task #719) re-pointed every consumer-side
verification at the entity-thread inbox row preview prefix
(`entity-thread-preview-${entityId}`), which is the only post-cutover
UI surface that consumes the per-skin "show last initial only" rule
for the friend's view of a sender name. Producer-side coverage
(`PATCH .../outward-accounts/:id` succeeds + DB row updates) is
unchanged from the pre-rewrite plan.

## Run summary

| Section | Driver context | Surface under test | Status |
| --- | --- | --- | --- |
| Pre-test seed | standard | `PropertyMessagesTab` composer + send button author the entity-thread message that drives every consumer-side assertion | _(pending)_ |
| A baseline | both | Friend's `entity-thread-preview-${standardEntityId}` reads `Standard E2E Fixture: Property thread message ${tag}` | _(pending)_ |
| B toggle ON save | standard | `/account/edit/${standardAcctId}` toggle flip + `PATCH /api/users/me/outward-accounts/:id` 200 + DB row updated | _(pending)_ |
| C friend's preview shortens | friend | Refetched `entity-thread-preview-${standardEntityId}` reads `Standard E2E F.: Property thread message ${tag}` | _(pending)_ |
| D toggle OFF save | standard | `/account/edit/${standardAcctId}` toggle flip + PATCH 200 + DB row reverted | _(pending)_ |
| E friend's preview restores | friend | Refetched `entity-thread-preview-${standardEntityId}` reads `Standard E2E Fixture: Property thread message ${tag}` again | _(pending)_ |

## Per-step screenshots

Storage: `artifacts/round-house/e2e/screenshots/privacy-toggle-end-to-end/`
(recreated empty at the start of every run — see the helper).

| Section | Standard context | Friend context | Notes |
| --- | --- | --- | --- |
| A baseline | [stepA-standard](./screenshots/privacy-toggle-end-to-end/privacy-toggle-stepA-standard.png) | [stepA-friend](./screenshots/privacy-toggle-end-to-end/privacy-toggle-stepA-friend.png) | _(pending — describe what each PNG actually shows on the run; expected steady state is standard parked on `/property/${standardPropertyId}?tab=messages` with the seeded body in the thread, friend on `/inbox` with the entity-thread row title `Standard E2E House` and the preview prefix `Standard E2E Fixture: ...`)._ |
| B toggle ON save | [stepB-standard](./screenshots/privacy-toggle-end-to-end/privacy-toggle-stepB-standard.png) | [stepB-friend](./screenshots/privacy-toggle-end-to-end/privacy-toggle-stepB-friend.png) | _(pending — standard parked on `/account` after the PATCH popped back; friend still on `/inbox` from section A with the **un**shortened prefix, proving they have not yet refetched)._ |
| C friend's preview shortens | [stepC-standard](./screenshots/privacy-toggle-end-to-end/privacy-toggle-stepC-standard.png) | [stepC-friend](./screenshots/privacy-toggle-end-to-end/privacy-toggle-stepC-friend.png) | _(pending — standard unchanged from B; friend's `/inbox` after the refetch shows the preview prefix as `Standard E2E F.: ...`)._ |
| D toggle OFF save | [stepD-standard](./screenshots/privacy-toggle-end-to-end/privacy-toggle-stepD-standard.png) | [stepD-friend](./screenshots/privacy-toggle-end-to-end/privacy-toggle-stepD-friend.png) | _(pending — standard back on `/account` after the rollback PATCH popped back; friend still on `/inbox` from section C with the shortened prefix, proving they have not yet refetched again)._ |
| E friend's preview restores | [stepE-standard](./screenshots/privacy-toggle-end-to-end/privacy-toggle-stepE-standard.png) | [stepE-friend](./screenshots/privacy-toggle-end-to-end/privacy-toggle-stepE-friend.png) | _(pending — standard unchanged from D; friend's `/inbox` after the second refetch shows the preview prefix back to `Standard E2E Fixture: ...`)._ |

If any row above shows `(missing)` instead of a clickable link, the
helper failed to write that PNG (disk error or context already
closed). Treat the absence as triage signal — note the cause in the
"Browser-driven evidence" section below rather than retrying just to
make the table green.

## Browser-driven evidence

Per-section narrative — fill in with the runner's findings on each
real run. The structure mirrors `my-team-tab-message.results.md` so
reviewers reading both files do not need to context-switch.

### Standard context (the toggler — `E2E_FIREBASE_*`)

The end-to-end UI test signed in as the standard fixture
(`e2e-standard@roundhouse-e2e.test`, clerkId
`lO8r8RwMuBdbyMMonlA0ZdBfmlD2`, active OA id 77, `users.name =
Standard E2E Fixture`) and exercised the producer side of the plan:

- **Pre-test seed:** _(pending — describe the navigation to
  `/property/${standardPropertyId}?tab=messages`, the typed body
  `Property thread message ${tag}` into `testID =
  "property-message-input"`, and the resulting one-row
  `SELECT id FROM messages WHERE entity_id = ${standardEntityId}
  AND content = 'Property thread message ${tag}'` confirmation)._
- **Section B (toggle ON save):** _(pending — describe `/account`'s
  active row, the navigation to `/account/edit/${standardAcctId}`,
  the toggle's pre-flip `accessibilityState.checked = false`, the
  post-flip `accessibilityState.checked = true`, the PATCH's
  status code, the post-pop-back URL, and the DB confirmation
  `SELECT last_initial_only FROM outward_accounts WHERE id =
  ${standardAcctId}` returning `true`)._
- **Section D (toggle OFF save):** _(pending — describe the
  re-entry into `/account/edit/${standardAcctId}`, the rehydrated
  `accessibilityState.checked = true`, the post-flip `false`, the
  rollback PATCH status code, and the DB confirmation `... =
  false`)._

### Friend context (the entity-thread counterpart — `E2E_FIREBASE_FRIEND_*`)

The end-to-end UI test signed in as the friend fixture
(`e2e-standard-friend@roundhouse-e2e.test`, clerkId
`THNSrhT1g9e3Sm2MAPuknaLzoJ33`, active OA id 79, `users.name =
Standard E2E Friend`) and exercised the consumer side of the plan
against the inbox row preview prefix:

- **Section A (baseline preview prefix):** _(pending — describe
  the post-sign-in landing route, the navigation to `/inbox`, the
  wait for `useListMyEntityThreads` to settle, and the visible row
  `entity-thread-row-${standardEntityId}` whose preview element
  `entity-thread-preview-${standardEntityId}` reads `Standard E2E
  Fixture: Property thread message ${tag}`. Confirm the literal
  `Standard E2E F.` is absent from the preview text)._
- **Section C (toggled-on preview prefix):** _(pending — describe
  the refetch trigger used (pull-to-refresh / re-navigate /
  hard-reload / window-focus), and the post-refetch preview
  element rendering `Standard E2E F.: Property thread message
  ${tag}`. Confirm the literal `Standard E2E Fixture` is absent
  from the preview text)._
- **Section E (restored preview prefix):** _(pending — describe
  the second refetch trigger and the preview element returning to
  `Standard E2E Fixture: Property thread message ${tag}`)._

## Regressions filed during the run

_(pending — add one subsection per regression encountered, mirroring
the heading/symptom/root-cause/fix/filed-for-tracking layout used in
`my-team-tab-message.results.md`. If the run completes cleanly with
every section PASS, replace this section with the line `No
regressions surfaced this run.` and move on.)_

## Repo changes that produced this result

| Path | Change |
| --- | --- |
| `artifacts/round-house/e2e/dual-context-screenshots.md` | Helper convention added in Task #702 — defines storage layout, file-name convention, and capture cadence for any e2e plan that drives more than one Playwright context. (Unchanged in this run unless the runner notes otherwise.) |
| `artifacts/round-house/e2e/privacy-toggle-end-to-end.test-plan.md` | Rewritten in Task #719 (post-#663 cutover) — the consumer-side `[Verify]` steps now target the entity-thread inbox row preview prefix (`entity-thread-preview-${entityId}`) instead of the retired chat-header / team-up-note / DM-listing surfaces. Producer side (toggle save + DB persistence) and the dual-context screenshot layout are unchanged. |
| `artifacts/round-house/e2e/privacy-toggle-end-to-end.results.md` | _(pending — describe what was filled in during this run: per-section status, per-context narrative, regression entries, etc.)_ |
| `scripts/src/seed-standard-fixture.ts` | Extended in Task #719 — adds the FRIEND counterpart as an approved `entity_members` row (role=`collaborator`, status=`approved`, direction=`invite`) on the standard fixture's property entity via the new `ensureApprovedEntityMember` helper, so both contexts land inside the same entity thread without ad-hoc DB stitching in the plan. |
| `artifacts/round-house/e2e/screenshots/privacy-toggle-end-to-end/*.png` | _(pending — list the PNGs written this run; expect 10 files, one per (section A–E, context) pair, per the helper's filename convention)._ |

## Follow-ups that remained open after this run

- **Surface `properties.id` on the entity-thread listing payload.**
  `app/inbox.tsx` deep-links into `/property/${thread.entityId}?tab=messages`,
  but the property route expects a property id, not an entity id. The
  friend-side verifications in this plan do not require opening the
  thread (the row preview prefix is the surface under test), so the
  broken navigation does not affect this plan's coverage — but any
  user who taps the row in the live app lands on a 404. Tracked
  separately so the next iteration of the inbox screen can pivot on a
  real `properties.id` from the API payload instead of the entity id.
- **Wire `FullProfileModal` into `/(tabs)/profile`.** The component
  exists and consumes `formatOwnerNameForSkin(profile.name,
  activeOutwardAccount?.lastInitialOnly)` on its
  `testID = "full-profile-display-name"` element, but ripgrep across
  `artifacts/round-house/app/` for `FullProfileModal` returns zero
  hits. Without a trigger on the profile tab, the producer's own
  privacy preview is unreachable from the running app — a separate
  follow-up from this plan, which only asserts on the friend's view.
- **Rebuild or remove `app/invites.tsx` and `app/inbox/[otherUserId].tsx`.**
  Both still import legacy DM hooks (`getListConversationsQueryKey` /
  `useGetConversation` / `useSendMessage`) that the cutover stripped
  from `lib/api-client-react/src/generated/api.ts`, so they crash on
  mount the moment any code path pushes those routes. Outside this
  plan's scope (none of the plan's verifications navigate to either
  screen) but flagged here so the next pass at the messaging UI can
  close the regression.

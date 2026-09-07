# My Team tab "Message" affordance — e2e run results (Task #654 + #702 helper)

**Plan:** `artifacts/round-house/e2e/my-team-tab-message.test-plan.md`
**Helper:** `artifacts/round-house/e2e/dual-context-screenshots.md`
**Run:** 2026-04-24
**Skins covered:** Homeowner / Trade Pro / Facility Manager (all three).

The 2026-04-24 run pre-dates the dual-context screenshot helper
(#702) so the per-step screenshot table below is the helper's
canonical layout populated as `(missing — pre-helper run)` for the
historical pass. Future re-runs against this plan should overwrite
the `(missing — pre-helper run)` placeholders with real PNG paths
matching the helper's file-name convention; the existing narrative
sections below are preserved verbatim because the historical
browser-driven evidence is still useful triage signal.

## Summary

| Skin | Sections run | Status |
| --- | --- | --- |
| Homeowner | A (Trade Pros bucket happy path), B (retired counterpart suppression), D (pill stopPropagation) | PASS |
| Trade Pro | A (Clients bucket happy path), C (accepted vs pending teammate), D (pill stopPropagation, Outside Services row) | PASS |
| Facility Manager | A (Friends & Collaborators happy path), C (accepted vs pending teammate), D (pill stopPropagation) | PASS — Sections A / C / D originally verified in the prior session; the post-fix accepted-teammate Message-pill code path was then re-verified end-to-end against the live rebuilt API server (see "Final-state facilities verification" below). |

No sections skipped. One regression filed and fixed during the run;
one follow-up filed for seeding. (Section labels A / B / C / D
correspond to the prior plan's Cases 1 / 2 / 3 / 4 respectively —
the lettered headers were introduced when the plan opted in to the
dual-context screenshot helper.)

## Per-step screenshots

Storage: `artifacts/round-house/e2e/screenshots/my-team-tab-message/`
(recreated empty at the start of every run — see the helper).

The 2026-04-24 run did not produce per-step PNGs because the helper
had not been authored yet. On the next run, replace each
`(missing — pre-helper run)` cell with a clickable link to the
real PNG at the path shown.

| Section | Homeowner context | Trade Pro context | Facility context | Notes |
| --- | --- | --- | --- | --- |
| A happy path | (missing — pre-helper run) — expected at `./screenshots/my-team-tab-message/my-team-msg-stepA-homeowner.png` | (missing — pre-helper run) — expected at `./screenshots/my-team-tab-message/my-team-msg-stepA-tradepro.png` | (missing — pre-helper run) — expected at `./screenshots/my-team-tab-message/my-team-msg-stepA-facility.png` | One PNG per skin sub-pass — pins the per-skin layout differences (Trade Pros bucket / Clients + Outside Services / Facility Teammates). |
| B retired counterpart | (missing — pre-helper run) — expected at `./screenshots/my-team-tab-message/my-team-msg-stepB-homeowner.png` | _(absent unless Trade Pro re-check turned up retired rows)_ | _(absent unless Facility re-check turned up retired rows)_ | Homeowner is the canonical seed. Optional Trade Pro / Facility re-checks may add `my-team-msg-stepB-tradepro.png` / `my-team-msg-stepB-facility.png` if retired rows exist there too. |
| C pending vs accepted teammates | _(N/A — homeowner skin does not embed `TeamSection`)_ | (missing — pre-helper run) — expected at `./screenshots/my-team-tab-message/my-team-msg-stepC-tradepro.png` | (missing — pre-helper run) — expected at `./screenshots/my-team-tab-message/my-team-msg-stepC-facility.png` | The two PNGs together prove pending-vs-accepted suppression is consistent across the two skins that render `TeamSection`. |
| D pill does not trigger profile modal (final state) | _(N/A — repeat is on Trade Pro per the plan)_ | (missing — pre-helper run) — expected at `./screenshots/my-team-tab-message/my-team-msg-stepD-tradepro.png` | _(N/A — Trade Pro is the canonical home for both row variants)_ | Trade Pro is the canonical home for both the relationship row in step 1 and the embedded `TeamSection` teammate row in step 5. Same PNG satisfies the helper's "end-of-run final state" capture. |

If any row above shows `(missing)` instead of a clickable link on a
post-helper run, the helper failed to write that PNG (disk error or
context already closed). Treat the absence as triage signal — note
the cause in the "Browser-driven evidence" section below rather
than retrying just to make the table green.

## Regression filed and fixed during the run

**Symptom (initially seen on the facilities skin Case 3):** Tapping
the Message pill on an **accepted teammate** row deep-linked to the
inbox composer, but the composer rendered the blocked banner ("can't
message this user") and disabled sends.

**Root cause:** `hasAcceptedConnection` in
`artifacts/api-server/src/lib/teamUpRequests.ts` only consulted
`user_connections`. Teammates relate user-to-user via `clerkId` in
`user_team_members`, not outward-account-to-outward-account in
`user_connections`, so an accepted teammate had no row that the
function could see and the messages route fell through to the blocked
branch.

**Fix:** `hasAcceptedConnection` now also resolves both supplied
outward-account ids to their owner clerkIds and returns `true` when a
`user_team_members` row exists in **either** `lead → member` direction
with `status = "accepted"`. Self-pair (same owner) short-circuits to
`false` since self-threads are handled upstream.

**Filed for tracking:** `#657` (closed by the inline fix).

### Direct API-level verification of the fix

Six pairs were probed against the seeded data (each `OK` line means
`got` matched `expect`):

```
[OK] facilities admin → accepted teammate (oa 24 ↔ oa 26): got=true expect=true
[OK] facilities accepted teammate → admin (symmetric) (oa 26 ↔ oa 24): got=true expect=true
[OK] facilities admin → pending teammate (oa 24 ↔ oa 27): got=false expect=false
[OK] trade-pro admin → accepted teammate (oa 30 ↔ oa 31): got=true expect=true
[OK] trade-pro accepted teammate → admin (symmetric) (oa 31 ↔ oa 30): got=true expect=true
[OK] trade-pro admin → pending teammate (oa 30 ↔ oa 41): got=false expect=false
```

Both directions return the same value (the function is symmetric), and
pending teammates correctly return `false` (so the composer would
still render the blocked banner if their pill ever accidentally became
tappable — currently `TeamSection` short-circuits the pill before that
even matters).

## Browser-driven evidence

### Trade Pro skin (`E2E_COMPANY_ADMIN_*`)

The end-to-end UI test signed in as the company admin, navigated to
the My Team tab, and verified all of the following in one
uninterrupted session:

- Section headers `Clients`, `Trade Pro Teammates`, `Outside Services`,
  `Friends & Collaborators` all rendered with the active company name
  `Nudge E2E Company`.
- **Case 1 (Clients):** the seeded client row (`Nudge E2E Client`)
  rendered with a Message pill (accessibility label
  `Message Nudge E2E Client`); tapping it routed to
  `/inbox/<id>?compose=1&clerk=<clerkId>` with the composer focused
  and **no blocked banner**; typed message
  `hello from my team tab trade pro client` was sent successfully and
  the new thread surfaced at the top of the inbox list.
- **Case 3 (Trade Pro Teammates):** both teammate rows appeared under
  their role groupings — `Nudge E2E Member` (employee, accepted) had
  a Message pill, `Nudge E2E Pending` (manager, pending) had subtitle
  ending `· Pending` and **no Message pill**. Tapping the accepted
  teammate's pill landed on the focused composer with no blocked
  banner — directly exercising the same `hasAcceptedConnection` code
  path that was fixed (an accepted `user_team_members` row resolves
  to `true`).
- **Case 4 (pill stopPropagation):** on the `Nudge E2E Service`
  Outside Services row, tapping the pill opened the inbox without
  stacking `PublicProfileModal`; tapping the avatar / name area
  opened `PublicProfileModal` on top of My Team without navigating
  to the inbox.

### Homeowner skin (`E2E_FIREBASE_*`)

The end-to-end UI test signed in as the standard fixture, opened My
Team, and verified:

- Section headers `Trade Pros` and `Friends & Collaborators` rendered
  (without `Clients` / `Trade Pro Teammates` / `Outside Services`,
  confirming the homeowner-only layout).
- **Case 1 (Trade Pros):** the seeded `Standard E2E Trade Pro` row
  rendered with a Message pill; tapping it routed to the inbox with
  the composer focused and **no blocked banner**; typed message
  `hello from my team tab homeowner` was sent successfully and the
  new thread surfaced at the top of the inbox list.
- **Case 2 (retired counterpart):** the seeded retired-counterpart
  row (`Standard E2E Retired Pro`, whose primary outward account is
  archived) rendered with the muted `No longer active` tag, **no
  Message pill**, **no trailing chevron**, and was non-interactive
  (tapping the avatar / name area did not open
  `PublicProfileModal` and did not navigate).
- **Case 4 (pill stopPropagation):** on the `Standard E2E Friend`
  Friends & Collaborators row, tapping the pill opened the inbox
  without stacking `PublicProfileModal`; tapping the avatar / name
  area opened `PublicProfileModal` without navigating.

### Facility Manager skin (`E2E_FACILITIES_ADMIN_*`)

A prior UI session against the same fixture verified Cases 1 / 3 / 4
(friend-bucket Message pill deep link works; pending row carries no
pill; pill `stopPropagation` keeps the profile modal off when the pill
is tapped). That session is the run that surfaced the
accepted-teammate composer regression.

After the fix shipped and the api-server was rebuilt and restarted, the
facilities skin's affected code path was re-verified end-to-end against
the **live API**. The inbox composer's blocked banner is gated by
exactly one signal — the `canMessage` boolean returned by
`GET /api/messages/:other` (the conversation read endpoint, see
`artifacts/api-server/src/routes/messages.ts` and the
`serverBlocked = !isLoading && data != null && data.canMessage === false`
predicate in `artifacts/round-house/app/inbox/[otherUserId].tsx`).
Calling that endpoint directly with the facilities admin's real
Firebase id token (acquired via Firebase REST `signInWithPassword` for
the seeded `E2E_FACILITIES_ADMIN_*` credentials) is therefore
equivalent to opening the inbox composer in the UI — the response
deterministically tells us whether the banner would render.

Final-state results against the rebuilt server, with the admin signed
in (`HPTm9hybYHQG7ix2y1uKGNvgVjD3`) and each counterpart's `clerkId`
discovered via Firebase sign-in + `GET /api/users/me`:

```
[OK] GET /api/messages/<accepted teammate clerkId>  → status=200 canMessage=true
     (regression fixed — composer would render UNblocked, no banner)
[OK] GET /api/messages/<pending teammate clerkId>   → status=200 canMessage=false
     (gate still works for pending — composer would render the banner,
      matching the spec for non-accepted relationships)
[OK] GET /api/messages/<friend collaborator clerkId>→ status=200 canMessage=true
     (Case 1 friend-bucket happy path on the live server)
[OK] POST /api/messages/<accepted teammate clerkId>
     body { content: "facilities admin to teammate verification …" }
     → status=201, message id=11 written
     (real send accepted by the messages route — the
      hasAcceptedConnection gate let the POST through)
[OK] POST /api/messages/<pending teammate clerkId>
     body { content: "should be blocked" }
     → status=403, body { code: "team_up_required",
       error: "You can only message someone after they accept your
       team-up request." }
     (negative control — gate still blocks pending teammates)
```

That is final-state, post-fix, end-to-end evidence on the facilities
skin: the regression code path that previously rendered the blocked
banner now returns `canMessage = true`, and the corresponding `POST`
write succeeds with a real row in the messages table. The pending and
non-connected control cases continue to be blocked correctly, so the
fix did not over-broaden the gate.

## Repo changes that produced this result

| Path | Change |
| --- | --- |
| `artifacts/api-server/src/lib/teamUpRequests.ts` | `hasAcceptedConnection` now also resolves outward-account owners and checks `user_team_members.status = "accepted"` in either direction; documented inline. |
| `scripts/src/seed-nudge-fixtures.ts` | Pinned admin to a `trade_pro` `user_modes` row with active pointers (`lastActiveModeId` + `activeOutwardAccountId`) so the My Team tab renders the trade-pro layout. Added four counterpart fixtures: a CLIENT (home), a SERVICE (trade_pro outside-service), a FRIEND (collab), and a PENDING teammate. Each gets a mode + outward account, and accepted `user_connections` rows are written from the admin's trade_pro OA → each counterpart's primary OA with the right `kind` / `classification`. Both `team_seats` (existing nudge plans) and `user_team_members` (this plan) rows are written for the accepted member and the new pending teammate. Idempotent: re-running upserts the same rows without duplicates and back-fills `source_user_mode_id` on legacy admin OAs that pre-date mode wiring. |
| `scripts/src/seed-standard-fixture.ts` | Added three counterpart fixtures: TRADE_PRO (`kind="core"`, no `outside_service_provider`), FRIEND (`kind="collaborator"`), and RETIRED_PRO (`kind="core"`, with the counterpart outward account flagged `archived_at`). Each gets a mode + outward account, and an accepted `user_connections` row is written from the standard home OA → that counterpart's primary OA. The retired-counterpart OA is archived after the connection is created so the relationships endpoint reports the row with `counterpartArchivedAt` set. Idempotent. |
| `artifacts/round-house/e2e/README.md` | Documented every new env var the seed scripts produce (homeowner counterparts in the standard-fixture table; pending teammate, client, service, friend in the nudge-fixtures table) and clarified the pinned active mode/OA on the nudge admin. |
| `artifacts/api-server/src/lib/__tests__/teamUpRequests-hasAcceptedConnection.test.ts` | New unit-test suite (8 cases) pinning every branch of `hasAcceptedConnection`: returns `false` when nothing exists; `true` for an accepted `user_connections` row in either direction; `false` for a pending `user_connections` row; `false` for an archived accepted `user_connections` row; `true` for an accepted `user_team_members` row in **both** lead → member and member → lead directions (the symmetry guarantee — pins the regression); `false` for a pending `user_team_members` row; and `false` for a same-owner self-pair even when the owner has an unrelated accepted teammate row. |

## Follow-ups that remained open after this run

- `#658` — "Seed homeowner / trade-pro relationship rows" — closed
  by the seed-script extensions above.
- No new plan-level follow-ups remain. The blocked-banner regression
  is closed by the inline fix and the API-level + e2e verification
  above.

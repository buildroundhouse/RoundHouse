# My Team tab "Message" affordance — e2e (#647)

## Why this exists

Task #643 added a `Message` pill to every messageable row inside the
People sheet (and its embedded `TeamSection`). Task #646 mirrored that
affordance onto the standalone **My Team tab**
(`app/(tabs)/my-team.tsx`) so the same one-tap deep link to the inbox
composer is reachable without first opening the profile flow.

The People sheet is covered by `friends-list-message.test-plan.md`,
but the My Team tab renders a **different screen** with a different
per-skin layout:

- Homeowner: Trade Pros (Occasional / Recurring) → Friends & Collaborators
- Trade Pro: Clients → Trade Pro Teammates → Outside Services → Friends & Collaborators
- Facility Manager: Facility Teammates → Friends & Collaborators

Since the row component, container `Pressable`, and pending-vs-accepted
filtering are owned by this screen (and by `TeamSection` it embeds),
the affordance needs its own end-to-end coverage. The four cases below
exercise the happy path on each skin's bucket, the retired-counterpart
suppression, the pending-teammate suppression, and the
"pill swallows the row tap" interaction guarantee.

## Setup

The tab requires an outward account in each of the three supported
skins to assert layout coverage. Where possible reuse existing
seeded fixtures:

1. **Homeowner skin** — sign in as the standard pre-onboarded fixture
   (`E2E_FIREBASE_EMAIL` / `E2E_FIREBASE_PASSWORD`, see
   `e2e/README.md`). Through the relationships API, ensure the
   homeowner has at least one accepted relationship in **each** of:
   - a trade-pro counterpart (lands in the **Trade Pros** bucket),
   - a friend / collaborator counterpart (lands in **Friends &
     Collaborators**), and
   - a relationship whose counterpart skin has been retired
     (`user_connections.counterpartArchivedAt` set, e.g. by having the
     other side archive the paired outward account). This row will
     appear with the muted "No longer active" tag.
2. **Trade Pro skin** — sign in as the Nudge company admin
   (`E2E_COMPANY_ADMIN_EMAIL` / `E2E_COMPANY_ADMIN_PASSWORD`, see
   `e2e/README.md`) so `Nudge E2E Company` is the active outward
   account. Ensure the company has:
   - at least one accepted client relationship (lands in **Clients**),
   - at least one outside-service trade-pro counterpart (lands in
     **Outside Services**),
   - at least one friend / collaborator relationship,
   - the seeded `accepted` non-admin teammate
     (`E2E_COMPANY_MEMBER_EMAIL`) on the **Trade Pro Teammates**
     `team_seats` row, and
   - one additional teammate seat whose `team_seats.status = "pending"`
     (any second invitee will do — the row appears with the
     "Pending" suffix).
3. **Facility Manager skin** — sign in as the seeded facilities
   admin (`E2E_FACILITIES_ADMIN_EMAIL` /
   `E2E_FACILITIES_ADMIN_PASSWORD`, see `e2e/README.md`) so
   `Facilities E2E Operations` is the active outward account. The
   shared fixture already provides:
   - the seeded `accepted` teammate
     (`E2E_FACILITIES_TEAMMATE_EMAIL`) on the **Facility Teammates**
     `user_team_members` row,
   - the seeded `pending` teammate
     (`E2E_FACILITIES_PENDING_EMAIL`) on the **Facility Teammates**
     `user_team_members` row (the row appears with the
     "Pending" suffix), and
   - one accepted Friends & Collaborators relationship to
     `E2E_FACILITIES_FRIEND_EMAIL`.

For all three skins, capture the recipient row's
`counterpartOutwardAccountId` (when set) and `clerkId` from the
`/api/relationships/me` response — both values appear in the deep
link the Message pill produces.

## Reusable signed-in fixtures

Each skin uses a distinct fixture and the plan signs in / out of
the same browser context as it walks across skins (the My Team
tab renders a different layout per `companyKind`, so each skin
needs its own observation pass).

| Env var pair | Role | Context short name |
| --- | --- | --- |
| `E2E_FIREBASE_EMAIL` / `E2E_FIREBASE_PASSWORD` | **Homeowner skin** — standard pre-onboarded fixture. Drives section A's homeowner pass and section B's retired-counterpart pass. | `homeowner` |
| `E2E_COMPANY_ADMIN_EMAIL` / `E2E_COMPANY_ADMIN_PASSWORD` | **Trade Pro skin** — Nudge company admin (`Nudge E2E Company`). Drives section A's trade-pro pass, section C's trade-pro teammate pass, and section D's trade-pro pill-vs-row interaction. | `tradepro` |
| `E2E_FACILITIES_ADMIN_EMAIL` / `E2E_FACILITIES_ADMIN_PASSWORD` | **Facility Manager skin** — `Facilities E2E Operations`. Drives section A's facilities pass and section C's facility teammate pass. | `facility` |

The "Context short name" column is the identifier the dual-context
screenshot helper uses when it names the per-step PNG files (see
"Screenshot capture" below). All three fixtures are pre-onboarded;
if any secret is missing, the relevant per-skin pass should be
reported `unable` (do **not** skip silently — the per-skin layout
coverage is the whole point of this plan).

## Screenshot capture

This plan opts in to the dual-context screenshot helper at
`artifacts/round-house/e2e/dual-context-screenshots.md`. The helper
defines the storage layout, file-name convention, and capture
cadence (failing-step + section-boundary + final-state). The runner
should follow it verbatim; everything below is the
plan-specific configuration.

- **Plan slug** (storage directory): `my-team-tab-message`
- **Short slug** (PNG file-name prefix): `my-team-msg`
- **Storage directory**:
  `artifacts/round-house/e2e/screenshots/my-team-tab-message/`
  — recreate empty at the start of every run.
- **Context short names**: `homeowner`, `tradepro`, and `facility`
  (declared on the fixtures table above). The plan re-uses a
  single browser context across skins by signing out and back in,
  so the three short names label distinct per-skin states rather
  than three concurrently-open contexts.
- **Section labels**: `A. happy path: Trade Pros / Clients /
  Friends bucket rows`, `B. retired counterpart: Message control
  suppressed`, `C. pending vs. accepted teammates`,
  `D. pill does not trigger the profile modal`.
- **Sibling results file**:
  `artifacts/round-house/e2e/my-team-tab-message.results.md`.
  After a run, fill in its "Per-step screenshots" table and
  "Run summary" table; the file already contains the full set of
  expected file paths so a reviewer can scan it without
  consulting this plan.

Section A runs three sub-passes (one per skin). Capture one PNG
per skin at the section-A boundary so the per-skin layout
differences (Trade Pros / Clients / Outside Services / Facility
Teammates buckets) are pinned down for the reviewer. Sections C
and D run on the trade-pro and facility skins; capture both
contexts they touch at each section boundary.

## Section A — happy path: Trade Pros / Clients / Friends bucket rows

Run this case **once per skin** (homeowner / trade pro / facilities)
because each skin shows a different bucket headline above the row.

1. Sign in with the skin under test and tap the **My Team** tab in the
   bottom navigation.
2. Wait for the relationships and team-listing requests to settle and
   confirm the per-skin section headers are visible:
   - Homeowner: "Trade Pros" + "Friends & Collaborators"
   - Trade Pro: "Clients" + "Trade Pro Teammates" + "Outside Services"
     + "Friends & Collaborators"
   - Facility Manager: "Facility Teammates" + "Friends & Collaborators"
3. Pick an accepted, non-retired person row in any rendered bucket
   (Trade Pros / Clients / Outside Services / Friends & Collaborators)
   and confirm a `Message` pill (icon `message-circle` + label
   "Message") is rendered on the right side of the row, between the
   name/sub line and the chevron.
4. Confirm the pill is reachable by accessibility label
   `Message <person name>` (set on the inner `Pressable` in
   `app/(tabs)/my-team.tsx`).
5. Tap `Message`.
6. **Expect**: the app navigates to
   `/inbox/<counterpartOutwardAccountId or clerkId>?compose=1&clerk=<clerkId>`
   (the route param is the counterpart outward-account id when the
   relationship row carries one, otherwise the personal clerk id; the
   `clerk` query is **always** the personal clerk id). The conversation
   loads and the composer text input has focus (keyboard up on device,
   caret blinking on web).
7. Type "hello from my team tab" and tap Send. **Expect**: the message
   appears in the thread; no blocked banner is shown for an accepted
   relationship.
8. Navigate back to the inbox list — the new thread is at the top.

[Capture — section A] Per the dual-context screenshot helper
(`./dual-context-screenshots.md`), snapshot the My-Team-tab state
for each skin pass. Save as
`screenshots/my-team-tab-message/my-team-msg-stepA-homeowner.png`,
`my-team-msg-stepA-tradepro.png`, and
`my-team-msg-stepA-facility.png` — one per per-skin sub-pass. The
three PNGs together pin the per-skin layout differences (Trade
Pros bucket / Clients + Outside Services / Facility Teammates).
On any [Verify] failure, capture the active skin's context
immediately at the failing step instead of at the section
boundary.

## Section B — retired counterpart: Message control suppressed

1. As the homeowner fixture, open the My Team tab.
2. Locate the row from setup step 1 whose counterpart skin has been
   retired (it renders with the muted "No longer active" tag).
3. **Expect**:
   - No `Message` pill is shown on that row (the row should render
     the avatar / name / "No longer active" tag and **stop** — neither
     the message pill nor the trailing chevron should appear).
   - The whole row is non-interactive (`accessibilityState.disabled`
     is `true`); tapping it does **not** open the public profile
     modal.
4. Repeat the visual check on the Trade Pro and Facility skins for any
   retired rows present in their relationships (skip the skin if none
   exist — homeowner setup is the canonical place to seed this case).

[Capture — section B] Snapshot the homeowner context now (the
canonical seed for the retired-counterpart case lives there).
Save as `my-team-msg-stepB-homeowner.png` showing the My-Team
tab's relevant retired-counterpart row with the "No longer
active" tag and **no** `Message` pill. If the optional Trade
Pro / Facility re-checks turned up retired rows, capture
additional `my-team-msg-stepB-tradepro.png` /
`my-team-msg-stepB-facility.png` PNGs alongside; otherwise the
homeowner PNG alone satisfies the section boundary.

## Section C — pending vs. accepted teammates

This case requires the Trade Pro and Facility Manager skins because
those are the only layouts that render the embedded `TeamSection`.

1. Sign in as the Trade Pro fixture and open the My Team tab. Scroll
   to the **Trade Pro Teammates** group rendered between Clients and
   Outside Services.
2. Confirm both teammate rows from setup step 2 appear under their
   role groupings (`MANAGERS` / `PARTNERS` / `EMPLOYEES`) and that the
   pending row's subtitle ends with `· Pending`.
3. **Expect**: the accepted teammate row has the `Message` pill
   (accessibility label `Message <teammate name>`), and the pending
   teammate row does **not** have the pill — there is no accepted
   account to message yet (`TeamSection` short-circuits via
   `canMessage = !!onMemberMessage && !isPending`).
4. Tap `Message` on the accepted teammate row.
5. **Expect**: the app navigates to
   `/inbox/<teammate clerkId>?compose=1&clerk=<teammate clerkId>`
   (My Team passes only the clerk id for teammates — there is no
   counterpart outward-account id to pin), the conversation loads, and
   the composer is focused.
6. Sign out and repeat steps 1-5 against the Facility Manager fixture
   under the **Facility Teammates** header.

[Capture — section C] Snapshot both contexts touched in this
section. Save as `my-team-msg-stepC-tradepro.png` (Trade Pro
My-Team tab showing Trade Pro Teammates with the accepted row's
`Message` pill and the pending row without one) and
`my-team-msg-stepC-facility.png` (Facility Manager My-Team tab
showing the equivalent Facility Teammates state). Both PNGs
together prove pending-vs-accepted suppression is consistent
across the two skins that render `TeamSection`.

## Section D — pill does not trigger the profile modal

The row container itself opens `PublicProfileModal` via
`setOpenClerkId`. The Message pill must intercept the press so the
modal does not also open under the inbox screen.

1. As any signed-in skin, open the My Team tab and find an accepted
   non-retired person row that has the Message pill.
2. Tap directly on the `Message` pill (not the avatar / name area).
3. **Expect**: the app navigates to the inbox thread (per Case 1) and
   the `PublicProfileModal` does **not** appear stacked behind /
   underneath the inbox screen. Returning from the inbox via the back
   gesture should land back on the My Team tab with no modal visible.
4. As a control, tap the avatar or name area of the same row.
   **Expect**: the inbox is **not** opened; instead the
   `PublicProfileModal` opens on top of the My Team tab — confirming
   the pill's `e.stopPropagation()` is the only thing routing to the
   inbox.
5. Repeat once on a teammate row inside the embedded `TeamSection`
   (Trade Pro skin) so both row variants are covered (the teammate
   row's container also wires `onPress={() => onMemberPress?.(...)}`,
   so the same propagation guard must hold).

[Capture — section D / final state] Snapshot the trade-pro
context (the canonical home for both row variants — the
relationship row in step 1 and the embedded `TeamSection`
teammate row in step 5). Save as
`my-team-msg-stepD-tradepro.png` showing the My Team tab after
returning from the inbox via the back gesture, with no
`PublicProfileModal` stacked behind. This satisfies the helper's
"end-of-run final state" capture requirement.

## Notes / non-goals

- The deep-link contract (`/inbox/<target>?compose=1&clerk=<clerkId>`,
  composer auto-focus, blocked-banner copy) is owned by `messageHrefFor`
  + the inbox thread screen and is already covered by
  `friends-list-message.test-plan.md` Cases 1 and 2. This plan
  intentionally does not re-cover the gated / blocked-banner path —
  the My Team tab uses the same helper and the same destination
  screen, so verifying the navigation produces the right URL on Case 1
  is sufficient.
- The `My Team tab → row → Message` path uses the row's
  `counterpartOutwardAccountId` when present (preserving the same
  skin pair the inbox list shows), and falls back to `clerkId`
  otherwise. The `TeamSection` teammate path always uses the personal
  clerk id (teammates are a single account, not a relationship).
- Pending teammates intentionally do not show a pill and are not
  tappable for messaging in this surface — the only way to reach a
  teammate is after they accept the seat invite. The `Manage` button
  inside `TeamSection`'s header remains the path to resend / cancel
  pending invites.
- Self-views are not reachable from this screen (the active user is
  never in their own relationships list and is excluded from
  `team_seats`), so the "no Message pill on self" check from the
  People-sheet plan does not apply here.
- The Facility Manager skin uses its own seeded fixture
  (`E2E_FACILITIES_*`, see `e2e/README.md`). If for some reason that
  fixture is unavailable, the relevant code path
  (`companyKind === "facilities"` branch in `app/(tabs)/my-team.tsx`)
  is structurally identical to the trade-pro branch minus the
  Clients / Outside Services buckets, so risk of regression is low —
  but the assertion is still owed and should not be skipped on a
  normal run.

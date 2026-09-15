# Intake implementation checkpoint — not release-ready

Implementation branch: `fix/approved-roles-intake-live`.

The approved governing documents remain unchanged. This file records execution
status only; it does not define product policy.

## Implemented

- Unified Property / Trade / Supplier intake with the approved role catalogue,
  residential address fields, conditional role questions, photo selection using
  the existing upload service, draft storage, Back, and section editing.
- Fixed ACTIVATE rejecting otherwise identical JSONB drafts because PostgreSQL
  normalizes object key ordering.
- Transactional activation, free creation limits, duplicate checks, retry locks,
  saved roles/memberships, and private History creation after approval.
- Device draft caching, account draft restoration, malformed-cache fallback,
  and protection against changing a reviewed pending request.
- Approval and intake finalization in one transaction; paid eligibility checked
  again at approval; pending requests notify the controlling account.
- Billing preparation before first activation, without membership or History,
  and an explicit return from billing to the saved intake.
- Operational first-connection checks, History write rejection, nested messaging
  scope checks, private History access checks, and either-party paid eligibility.
- Legacy setup entry points redirect to approved intake; assembled API rejects
  legacy Property, Business, Entity and outward-account creation routes.
- Current profile displays exact saved approved titles and recognizes canonical
  Entity kinds. Historical contribution records were not rewritten.
- Obsolete avatar-handshake tests replaced with checks for the current
  Entity-backed helper and the existing 410 Gone endpoints. Current approval
  behavior is exercised through the real Entity approval route.

## Verification

- Focused policy, intake database/browser, Identity, profile, gate, and retired
  endpoint tests: 85 passed across seven files.
- All workspace type checks pass (`pnpm typecheck`).
- API build and Expo web export pass.
- `git diff --check` passes.
- Browser tests render the actual intake screen with React Native Web and call
  real Express handlers against an isolated PGlite PostgreSQL engine. They cover
  Property, Trade, Supplier, Back, unsaved refresh recovery, Review edits,
  role changes, activation, and persisted History.
- Database checks also cover Commercial creation, shared free allowances,
  concurrent request retries, rollback on failed saves, approval authorization,
  either paid party, pending requests, billing preparation, and History access.
- These tests stub Firebase identity and the outer navigation shell. They do not
  prove full Firebase sign-in, native restart, or entry into the actual Command
  Center. Photo/storage and processor billing are not exercised by that shell.
- The broader test run was not green: 353 tests passed and two assertions failed
  (reminder notification wiring and startup health expectations); 57 additional
  suites failed to load, including 50 requiring DATABASE_URL. Subsequent focused
  work corrected client alias resolution and the retired handshake tests.
  The broader suite still needs an isolated full-schema database rerun.

## Remaining before merge and live release

- Verify the full application with Firebase test sign-in, persistent test
  database, uploaded photos, billing test mode and actual Command Center
  navigation. No such complete local environment is configured.
- Finish the invitation-driven role/scope handoff and verify that all invitation
  variants require reviewed activation and the appropriate consent.
- Complete the documented service/product selection controls and audit missing
  Business-profile skips and destination profile persistence.
- Resolve the exact Supplier role-specific required questions; the governing
  screen document does not enumerate them. Audit commercial display wording
  using the shared approved Property authority catalogue; invent no new titles.
- Finish the downstream permission/transfer audit, including legacy endpoints,
  multiple working contexts, subscription changes and historical attribution.
- Run production-equivalent migrations on an isolated full-schema PostgreSQL
  database, including its actual indexes/constraints. PGlite route tests use
  schema-derived columns and are not a migration verification.

No implementation changes have been merged into main or the hosting branch.
No production deployment, production migration, or live subscription change
has been performed. The user has authorized eventual merge and publication;
the remaining condition is implementation and release verification.

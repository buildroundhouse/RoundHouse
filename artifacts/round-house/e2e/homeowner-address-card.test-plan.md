# Homeowner address card

## Implemented

- Property Owner entry now renders a structured street/unit/city/state/ZIP card instead of a no-op plus button.
- 50 states and DC are selectable in a modal list on native and web.
- Street/city/state start a debounced Google Places Text Search using the existing EXPO_PUBLIC_GOOGLE_PLACES_API_KEY configuration. A complete US street match is required to populate a ZIP; a city centroid is not accepted.
- The user explicitly selects a result, so an approximate result never silently replaces their address.
- Edits invalidate previous match metadata. Outdated requests are aborted/ignored; requests time out after 10 seconds.
- Missing configuration, lookup failure and no matches have visible explanations. A manually completed address can be explicitly accepted as unchecked. Neither matching nor manual entry claims to verify residence, ownership, unit, or residential zoning.
- Continue activates the existing home-mode API, saves an account/mode-scoped local address draft and advances to the existing homeowner profile intake. The address is not put in navigation URLs.
- Final profile submission saves the structured address under intakeData.propertyAddress and retains the formatted placeAddress for existing consumers. This does not create/claim a global property record or bypass ownership checks.
- Failed save attempts leave the form intact; a successful activation is reused during same-screen retry rather than creating another mode.

## Automated verification

Run `node --experimental-strip-types --test artifacts/round-house/lib/property-address.test.ts` from repository root. Nine tests cover state options, complete street responses, missing ZIPs, city centroids, non-US responses, required-field errors, manual confirmation, unit formatting, malformed drafts and API failures.

Built API client declarations, then compared TypeScript diagnostics against the unchanged base source: 30 baseline diagnostics, 30 current, none introduced. The whole app's typecheck still fails on pre-existing errors (including business spacing tokens, intake type definitions, and outward-account components).

## Device/backend checks still required before release

1. Run the target branch on iPhone and web with configured Firebase/backend and Places key. Do not create fake production accounts for tests.
2. Enter a known street/city/state, confirm a match, and verify its returned ZIP. Try a multi-unit address.
3. Edit quickly while responses are delayed; no old response may fill the new address.
4. Disable lookup access; confirm the message and explicit manual route. Check invalid ZIP and missing state errors.
5. Tap Continue twice; verify one home-mode activation and advance to homeowner profile with address retained.
6. Finish required homeowner profile fields; verify server intake data includes the structured address and the app leaves onboarding.
7. Simulate save failure and retry. Restart between the address step and profile completion; verify draft restoration for the same account only.

Business draft-only submission and missing service chips are separate issues, not changed here. Codespace and phone sessions are not automatically updated by this patch.

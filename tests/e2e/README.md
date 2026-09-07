# End-to-end tests

Playwright tests that drive the running Round House mobile web app. The tests
sign up a fresh Firebase user, bypass onboarding via direct DB writes, and
exercise full UI flows.

## Run

Make sure the `expo` and `api-server` workflows are running, then:

```sh
pnpm run test:e2e
```

## Required env

- `EXPO_PUBLIC_FIREBASE_API_KEY` — used to call Firebase signUp REST endpoint.
- `DATABASE_URL` — used to bypass the identity/intake onboarding flow by
  setting `users.identity_completed_at`, `users.avatar_url`, and inserting a
  `user_modes` row with `intake_completed_at`.
- `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` — required by the Find on map banner
  spec only; the banner short-circuits to `null` when this key is missing.
- `E2E_BASE_URL` (optional) — overrides the app URL. Defaults to
  `https://$REPLIT_DEV_DOMAIN` and falls back to `http://localhost:80`.

## Specs

- `undo-delete-work-log.spec.ts` — covers the optimistic delete + Undo
  snackbar flow on the property-detail Logs tab.
- `section-mute-undo.spec.ts` — covers the NotificationSettings section
  master toggle: Undo restores every previously-on row in the section
  (including the legacy `notifyJobStarted` / `notifyJobCompleted` fields),
  toggling another section dismisses the banner, and the banner
  auto-dismisses after ~5s.
- `recently-deleted-account-restore.spec.ts` — covers task #325's
  "Recently deleted" section in account settings: signs up a fresh user,
  seeds two outward accounts with a connection on the non-active one,
  deletes the non-active account from its Edit screen, asserts it
  appears under "Recently deleted" with a relative-time label, taps
  Restore, then verifies the skin is back in the switcher and the
  archived-along-with-it connection is live again in the database.
- `outward-account-archive.spec.ts` — covers the public-profile switcher's
  Archive button: archiving a non-active row removes it from the list, and
  archiving the active row makes the client switch to a fallback first and
  then refetch with the new `x-active-outward-account-id` header.
- `operator-purge-dashboard.spec.ts` — covers the operator purge-runs
  dashboard (#391/#401): authenticates against the Basic-auth gate using
  `OPERATOR_API_KEY`, stubs the `/api/admin/outward-account-purge-runs`
  JSON, and asserts the rendered table — including that a `runsTrimmed`
  of `0` collapses to the em-dash placeholder while a non-zero value
  renders as a plain integer. Skipped if `OPERATOR_API_KEY` is unset.
- `personal-profile-editor.spec.ts` — covers the Personal Profile screen
  (#567): seeds a user with a trade_pro outward account whose intake holds
  per-account `phone` + `contactEmail` overlay values, asserts
  `/account/personal` shows the raw users-row fields (no overlay bleed),
  edits name/email/phone and confirms persistence across a hard reload
  AND across switching the active outward account, then verifies a
  malformed email is rejected by the server (`400 Invalid email
  address`) without mutating the DB.
- `find-on-map-backfill.spec.ts` — covers the MapBackfillBanner ("Find this
  on the map") on the property screen: a legacy property (address, no
  placeId/lat/lng) shows the banner; tapping it backfills the coordinates
  via POST /api/properties/:id/geocode (with the Google Places call
  intercepted by Playwright) and the banner disappears. A second test
  asserts the banner never renders for a property that already has a
  placeId/lat/lng.

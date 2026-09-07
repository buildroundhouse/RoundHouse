# Avatar "Start over" onboarding flow (task #626)

> **Single-context plan.** Drives only one Playwright browser context
> (the onboarding user). The dual-context screenshot helper at
> `./dual-context-screenshots.md` intentionally does not apply here;
> no sibling `*.results.md` template ships alongside this plan.

Task #625 added a "Start over — pick a different hat" affordance to
`app/(onboarding)/intake.tsx`, plus a hardware-back confirm and the
`DELETE /users/me/modes/:modeId` endpoint that backs it. The server
endpoint already has unit coverage (`artifacts/api-server/src/routes/__tests__/discard-mode.test.ts`),
but the end-to-end mobile flow — pick a skin → start typing → tap
Start Over → confirm → land back on the picker with the just-abandoned
tile pickable again — had no automated coverage.

## Automated coverage

`tests/e2e/avatar-start-over.spec.ts` walks the flow on the mobile
web build:

- **Setup.** Sign up a fresh Firebase user. Bypass the *identity*
  step only (set `users.identity_completed_at` and `avatar_url`) so
  `useProfile()` reports `needs-mode-picker` — the new account has
  no `user_modes` rows, so the picker is what the user lands on.
- **A. Pick → start typing.** Sign in via the UI, get redirected
  through `/` → `/(onboarding)/mode-picker`, tap the **My Home**
  tile, wait for `POST /api/users/me/modes` (the activation), and
  assert the URL transitions to `/(onboarding)/intake`. Type a
  unique value into the **Property** (`placeName`) text field.
- **B. Cancel branch keeps typed data intact.** Tap **Start over —
  pick a different hat**, dismiss the confirm dialog (the RN
  `Alert.alert` two-button cancel + destructive form maps to
  `window.confirm` on react-native-web). Assert no `DELETE
  /users/me/modes/:id` request fires, the screen stays on intake,
  and the placeName input still holds the value typed in step A.
- **C. Confirm branch discards and returns to picker.** Tap **Start
  over** again, this time auto-accept the dialog. Assert the
  `DELETE /users/me/modes/:modeId` returns 204, the URL navigates
  back to `/(onboarding)/mode-picker`, and the **My Home** tile is
  pickable again — i.e. its `onPress` still fires (the activated
  state cleared) rather than being stuck under the disabled
  "Already activated" overlay copy. The `user_modes` row is gone
  from the DB and `users.last_active_mode_id` is null.
- **D. Re-pick lands on a fresh intake.** Tap **My Home** again,
  wait for the new activation, assert the form is back on the
  intake screen with an empty `placeName` input (proves the
  abandoned mode's `intake_data` did not bleed into the new one).

## Manual / device-only coverage

The Android hardware-back confirm path in `intake.tsx` is wired via
`BackHandler.addEventListener("hardwareBackPress", …)`. React Native
Web's `BackHandler` is a no-op — there is no browser event that
fires it — so this branch can only be exercised on a real Android
build. On device, with the intake form open and at least one
character typed, pressing the system back button should surface the
exact same "Start over — pick a different hat?" confirm dialog that
the in-screen button shows, instead of silently popping back to the
mode picker (which would leave the half-built avatar attached to the
account). The same code path is under test indirectly here: the
in-screen button's `startOver()` callback is what the back handler
calls when `canStartOver` is true.

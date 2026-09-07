# Roundhouse — native iOS/Android builds

This document explains how to produce installable iOS and Android builds of
the Roundhouse Expo app and how to point a build at the same API server the
web preview uses. It's the prerequisite for any "verify on real iOS / Android
devices" test plan in `e2e/`.

## What's in the repo

- `app.json` — declares the iOS `bundleIdentifier` and Android `package`
  (`app.replit.roundhouse`). EAS needs both to register the app under your
  Expo account / App Store Connect / Play Console.
- `eas.json` — build profiles consumed by `eas build`:
  - `development` — internal-distribution dev client. iOS targets the
    Simulator, Android produces an `.apk`. Use this for day-to-day device
    testing with hot reload.
  - `development-device` — same as `development`, but iOS produces a
    device-installable `.ipa` (requires an ad-hoc / internal Apple
    provisioning profile).
  - `preview` — internal-distribution standalone build (no dev menu).
    iOS device `.ipa`, Android `.apk`. Use for handing a build to a tester.
  - `preview-simulator` — same as `preview` but built for the iOS
    Simulator (`.app` bundle).
  - `preview-staging` — same shape as `preview`, but `EXPO_PUBLIC_DOMAIN`
    points at `round-house-staging.replit.app`.
  - `production` — App Store / Play Store build. iOS `.ipa`, Android
    `.aab`, `autoIncrement: true`.

Every profile sets `EXPO_PUBLIC_DOMAIN` so the bundle bakes in the API host
at build time. The same env var is read by `app/_layout.tsx` (passes it to
the API client's `setBaseUrl`) and by `lib/uploads.ts`.

## One-time setup

1. Install the EAS CLI on the build machine:
   ```sh
   npm install -g eas-cli
   ```
2. From `artifacts/round-house/`, sign in and link the project:
   ```sh
   eas login
   eas init           # creates the Expo project, writes the projectId into app.json
   ```
3. (iOS only) Make sure you have an Apple Developer account. The first
   `eas build -p ios` run will offer to generate a distribution certificate
   and provisioning profile for you — accept the defaults.
4. (Android only) The first `eas build -p android` run will offer to
   generate an Android keystore — accept the defaults so EAS stores it
   for you.

## Producing a build

All commands are run from `artifacts/round-house/`.

### iOS Simulator (fastest dev loop)

```sh
eas build --profile development --platform ios
```

When the build finishes, EAS prints a URL to the `.tar.gz` archive. Download,
extract, and drag the `.app` onto a running iOS Simulator window — or run:

```sh
xcrun simctl install booted /path/to/Roundhouse.app
xcrun simctl launch booted app.replit.roundhouse
```

### iOS device (TestFlight-style internal install)

```sh
eas build --profile development-device --platform ios
# or, for a non-dev-client preview build:
eas build --profile preview --platform ios
```

EAS prints a QR code / install link. Open it in Safari on the target
iPhone (the device's UDID must already be registered in your Apple
Developer account; `eas device:create` walks you through it).

### Android device or emulator

```sh
eas build --profile development --platform android
```

EAS produces an `.apk` and prints an install link. On the device:

- Scan the QR code with the camera, tap the link, and accept the install
  prompt (you'll need to allow installs from the source the first time).
- Or, with `adb` connected: `adb install ./roundhouse-development.apk`.

For Google Play internal testing builds, use `--profile preview` (still
`.apk`) or `--profile production` (produces the `.aab` you upload to the
Play Console).

## Pointing a build at a non-prod API

Each profile in `eas.json` sets `EXPO_PUBLIC_DOMAIN` under `env`. To point
a build at a different API server (e.g. a staging Replit deployment, a
PR preview, or your own machine via a tunnel):

1. Edit `eas.json` and change the `EXPO_PUBLIC_DOMAIN` value on the
   profile you're about to build, OR pass it inline:
   ```sh
   EXPO_PUBLIC_DOMAIN=my-pr-preview.replit.app \
     eas build --profile preview --platform ios
   ```
2. Trigger the build as above. The bundled JS reads the value at module
   load time (see `app/_layout.tsx`), so it ships baked into the app —
   you cannot change the host without producing a new build.
3. The API server must be reachable from the device's network. Replit
   `*.replit.app` URLs are publicly routable; a local dev server is not
   unless you run an `ngrok` / `cloudflared` tunnel and point
   `EXPO_PUBLIC_DOMAIN` at the tunnel host.

`preview-staging` is provided as a worked example.

> **Pipeline validation status:** the build configuration in this repo
> has NOT yet been validated by an actual `eas build` run on a real
> Expo project. The first person to run through "One-time setup" above
> should complete the smoke test below on iOS and Android and update
> this note. Tracked as follow-up #510.

## Smoke test (per platform, after a successful build)

Run this once on each platform after the very first build to prove the
pipeline works end-to-end. Subsequent feature test plans in `e2e/` assume
the app installs and reaches the API.

1. Install the build on a device or simulator (see commands above).
2. Launch the app. The splash should hide and the sign-in screen render.
3. Sign in with a known test account (the same `E2E_*` fixtures the
   `e2e/` plans use are fine).
4. Navigate to `/reminders`. Verify the reminders list loads (i.e. the
   API call succeeded — confirms `EXPO_PUBLIC_DOMAIN` is correct and
   the device can reach it).
5. Record the date, build number, and platform in the PR description so
   the tester downstream knows the pipeline was last validated.

## Troubleshooting

- **`eas build` says "no projectId"** — run `eas init` once to write
  `expo.extra.eas.projectId` into `app.json`.
- **iOS build fails with "no provisioning profile"** — re-run with
  `--clear-cache --auto-submit-with-profile=...` or let EAS regenerate
  credentials interactively (`eas credentials`).
- **App opens to a blank/white screen on device** — almost always a
  wrong `EXPO_PUBLIC_DOMAIN`. Check the device's HTTP traffic (Safari
  Web Inspector for iOS, `adb logcat` for Android) and confirm the
  base URL matches a reachable host.
- **API requests get CORS / 401 errors only on device** — the API
  must accept the device's `Origin`. Native fetches send a synthetic
  `Origin` of `null` or the bundle id; check the API's CORS policy.

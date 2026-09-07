# Manual device test plan: NotificationSettings section-mute Undo banner

## Why this exists

The automated coverage in `tests/e2e/section-mute-undo.spec.ts` runs only
against the Expo **web** build via Playwright (chromium-mobile viewport).
The Undo banner ships to native iOS and Android too, where the React Native
`Switch` component, `AccessibilityInfo` announcements, `setTimeout` behaviour
under app backgrounding, and SafeArea / keyboard-avoiding behaviour all
differ from web. Run this plan on at least one iOS target and one Android
target before each release that touches `app/(tabs)/profile.tsx`.

Source under test:
- `artifacts/round-house/app/(tabs)/profile.tsx` — `NotificationSettings`
  component, `pendingUndo` state, banner JSX (~lines 1423–1478), and the
  `~5000ms` auto-dismiss timer (~line 1050).

## Targets

Run the three scenarios below on **each** of these:

- iOS: latest iPhone simulator on the latest stable iOS, **plus** one
  physical iPhone on the lowest still-supported iOS version.
- Android: a Pixel emulator on the latest stable Android API, **plus** one
  physical Android device (any OEM skin) on API 30 or lower if available.

If a physical device is not available, an additional simulator/emulator on
the lowest supported OS version is acceptable as a stopgap, but log it.

## Pre-conditions

1. A test account that has completed identity + mode/intake (mirrors what
   `bypassOnboarding` does in the web e2e).
2. All Jobs and Messages notification prefs default-on (the freshly-seeded
   state is fine).
3. App opened to **Profile → Notifications**, scrolled so the Jobs section
   master switch is visible.
4. VoiceOver (iOS) / TalkBack (Android) **off** for scenarios A–C, then
   repeat scenario A once with the screen reader **on** (see Accessibility
   section).

## Scenarios

### A. Happy path: mute → Undo restores every row

1. Tap the Jobs section master switch (the row labelled
   "Turn off all Jobs notifications").
2. **Expect:** every Jobs row switch animates to off; a dark banner appears
   above the section list reading "Muted all Jobs notifications" with an
   "UNDO" button on the right and a bell-off icon on the left.
3. Tap "UNDO" within 5 seconds.
4. **Expect:**
   - Banner disappears immediately.
   - Every Jobs row switch animates back to on, including the two legacy
     rows (`notifyJobStarted`, `notifyJobCompleted`).
   - Pull-to-refresh the Notifications screen and confirm rows stay on
     (i.e. the server state was restored, not just the local switch).

### B. Toggling another section dismisses the banner

1. Tap the Jobs master switch off again. Confirm the Jobs banner appears.
2. **Within 5 seconds**, tap the Messages section master switch off.
3. **Expect:**
   - The Jobs banner disappears the instant Messages is toggled (it does
     not linger, and it is not replaced by a stacked banner).
   - A new banner appears reading "Muted all Messages notifications".

### C. Auto-dismiss after ~5 seconds

1. Continuing from scenario B (Messages banner visible) — start a stopwatch
   when the banner appears.
2. Do not interact with the screen.
3. **Expect:** banner disappears on its own between 4.5s and 6.0s after
   it appeared. The Messages rows stay off (auto-dismiss does not undo).

## Platform-specific things to actively look for

These are areas where web Playwright cannot catch a regression:

- **Switch flip animation timing.** On iOS the native `Switch` has a
  ~200ms slide; on Android it's an instant snap. Confirm the banner shows
  immediately on tap on both, not only after the animation settles.
- **SafeArea overlap.** On a notched iPhone in landscape, and on Android
  devices with a 3-button nav bar, the banner must not be clipped by the
  status bar, the home indicator, or the tab bar at the bottom.
- **Backgrounding the app mid-timer.** Trigger the banner, then background
  the app (home gesture) for 10 seconds, then return. The banner should be
  gone (the JS timer either fires while backgrounded or is cleared on
  resume — either is acceptable; a banner stuck on screen forever is **not**).
- **Lock screen mid-timer.** Same as above with the device locked.
- **Rotation mid-timer.** Trigger the banner, rotate the device. The
  banner should re-layout cleanly and still auto-dismiss on schedule.
- **Rapid double-tap on the master switch.** The second tap must not leave
  a stale banner behind or send a duplicate bulk-update request.
- **Rapid double-tap on UNDO.** Must not crash, must not double-restore.
- **Dark mode.** Toggle system dark mode and re-run scenario A; the
  banner uses `colors.foreground` for its background and `colors.background`
  for text, which inverts under dark mode — verify it stays readable
  (contrast ratio ≥ 4.5:1 by eye check).
- **Reduced motion** (iOS Settings → Accessibility → Motion → Reduce
  Motion ON, Android Developer Options → Animator duration scale → Off).
  Banner should still appear and disappear; just without animation jank.
- **Offline.** Turn airplane mode on, trigger a section mute. The banner
  must still show (the optimistic toggle is what triggers it). When the
  network returns, the bulk update should retry or surface `bulkError`
  rather than silently dropping.

## Accessibility pass (run scenario A only)

Repeat scenario A once on each platform with the screen reader enabled:

- **iOS VoiceOver:** When the banner appears, VoiceOver should announce
  the banner text ("Muted all Jobs notifications") because the wrapping
  `View` has `accessibilityLiveRegion="polite"`. On iOS this attribute is
  partially supported — if no announcement fires, file a bug to add an
  explicit `AccessibilityInfo.announceForAccessibility(...)` call alongside
  `setPendingUndo`.
- **Android TalkBack:** The polite live region should announce the banner
  text reliably. Confirm the UNDO button is reachable by swipe-right and
  reads as "Undo Jobs change, button".
- Focus order: after tapping the master switch, focus should remain on the
  switch (not jump into the banner) so the user can keep navigating.

## Reporting

For every bug surfaced by this plan, file a separate task in the project
tracker referencing this file and including: device + OS version, exact
scenario letter, screen recording if possible, and whether the bug also
reproduces on the Expo web build (so we know whether to extend the
Playwright spec or only the device plan).

If all scenarios pass on all targets with no platform-specific findings,
record the run (date, tester, devices, app version / git sha) at the
bottom of this file under a "Runs" heading so future testers have a
history.

## Runs

<!-- Append entries here, newest first. Example:
- 2026-04-21 — Tester: @alice — iPhone 15 Pro (iOS 18.2, sim) + Pixel 8
  (Android 15, emu) + iPhone 12 (iOS 17.5, device) — sha abc1234 — all
  scenarios pass, no platform-specific findings.
-->

# Current Command Center Contract

This document is the implementation lock for the active RoundHouse Command Center. Older toolbar arrangements must not be restored.

## Timeline

- The Timeline is the center of the Command Center.
- The upper-left control is **Timeline Search**, not a camera.
- Search filters the chronological Timeline in place and clearing it restores all events.
- The right edge has four overlays, in order: **Daily Grind**, **Tasks / Lists**, **Receipts**, **Properties**.

## Bottom bar

The bottom bar has exactly five positions:

1. **Resolution** — far left. Opens the Resolution workspace. Its centered-pivot toggle escalates from green to red, yellow-rim, red-rim, and urgent. Opening the workspace acknowledges the current alert state and returns the toggle to green.
2. **People** — opens known RoundHouse participants.
3. **CAPTURE** — dominant raised center control. Tap opens the camera. Press and hold opens Concierge. Concierge has no separate permanent button.
4. **Estimates / Invoices** — opens the estimating and invoicing workspace.
5. **Calendar** — opens scheduling and calendar work.

## Regression guards

- Do not restore Timeline, Clients, My Team, or Profile as bottom-bar positions.
- Do not add a second permanent camera control above the Timeline.
- Do not add a separate permanent Concierge control.
- Do not use the unstable native-tabs implementation; the shared tab bar must work consistently in Expo Go, iOS builds, Android, and web.

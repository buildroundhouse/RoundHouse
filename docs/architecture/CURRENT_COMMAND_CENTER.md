# Current Command Center Contract

This document is the implementation lock for the active RoundHouse Command Center. Older toolbar arrangements must not be restored.

## Timeline

- The top bar is, in order: **personal profile picture**, **active company name**, **status + points ticker**, **notification bell**, **mailbox**.
- The Timeline is the center of the Command Center.
- The upper-left control is **Timeline Search**, not a camera.
- Search filters the chronological Timeline in place and clearing it restores all events.
- The right edge has four overlays, in order: **Daily Grind**, **Tasks / Lists**, **Receipts**, **Properties**. Their stack starts below the Timeline controls and must not crowd the top bar.

## Bottom bar

The bottom bar has exactly five positions:

1. **Resolution** — far left. Opens the Resolution workspace. The control is a centered-pivot physical toggle and never inherits the tab bar's blue selection color. No active Resolution is gray and leaned left. Waiting on somebody else is green and leaned left. Action waiting on the signed-in user is red and leaned right. Repeated unanswered prompts on that same Resolution escalate independently: prompt 2 adds a yellow rim, prompt 3 adds a red rim, and prompt 4 adds a fire rim. Unrelated questions are never added together to manufacture escalation.
2. **People** — opens known RoundHouse participants.
3. **CAPTURE** — dominant raised center control. Tap opens the camera. Press and hold opens Concierge. Concierge has no separate permanent button.
4. **Estimates / Invoices** — opens the estimating and invoicing workspace.
5. **Calendar** — opens scheduling and calendar work.

## Regression guards

- Do not restore Timeline, Clients, My Team, or Profile as bottom-bar positions.
- Do not add a second permanent camera control above the Timeline.
- Do not add a separate permanent Concierge control.
- Do not use the unstable native-tabs implementation; the shared tab bar must work consistently in Expo Go, iOS builds, Android, and web.
- Do not substitute an emoji, lightning bolt, or generic on/off glyph for the documented centered-pivot Resolution control.

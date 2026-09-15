# Daily Grind day planner

## Governing visual contract

- Daily Grind remains the dark Command Center slide-over: about 88–90% of the screen width, full usable height above bottom navigation, rounded right corners, and an X close control.
- It reads as one compact morning briefing, not a stack of dashboard modules. The hierarchy is: morning greeting, **Today**, items needing attention, optional suggestions, then **Set My Day**.
- The header shows the title, date/weather line, and one restrained 100–130 px concierge card limited to a few short lines.
- The full-width **Today** card is the visual focus. Confirmed calendar items and today's timed reminders appear automatically as compact rows. Selected suggestions appear here immediately while the day is assembled.
- **From Yesterday**, **Needs You**, and **Maybe Today** use dense 48–56 px rows. Show only a few suggestions initially and reveal the remainder through **Show more**.
- **Shop** expands inside Maybe Today and displays unfinished Shopping List items with checkboxes; it never navigates away. Checked choices are reflected in Today.
- Tasks & Lists, Shopping, and Calendar remain small secondary links. A prominent **Set My Day** action stays anchored at the drawer bottom.
- After Set My Day, planning sections disappear and the panel becomes a clean chronological **Today's Grind** checklist for the remainder of that day.
- Do not restore Yesterday/Today/Tomorrow screens, giant empty cards, or full Calendar, Resolution, or reminder-management modules inside Daily Grind.

Follows `docs/architecture/screens/06_ROUNDHOUSE_DAILY_GRIND.md` on Main and Danny's September 14 direction: replace the old reminders hub with a morning planner and choices from existing lists, including a Go shopping choice that reveals unfinished shopping-list items.

The Daily Grind rail tab opens the dedicated planner. Its large working sheet covers the header and Timeline while preserving the existing rail and bottom controls. Yesterday / Today / Tomorrow select the planning date. Users add or remove references to existing list items; no source item is copied or marked completed by planning it. Completed source items no longer appear as unfinished plan items.

The first focused Command Center visit each local day opens Daily Grind automatically. It also checks on app resume and local date rollover while focused. The once-per-day marker is scoped to the signed-in person on that device. Closing it does not reopen it during that day. This is an in-app morning opening, not a scheduled operating-system launch or notification.

The sheet includes due and overdue unfinished reminders, actionable Resolutions, and tomorrow's reminder count. Existing reminder and Resolution destinations retain ownership of their records. Plans store source list/item IDs per person and date on the device. Existing shopping/custom lists remain the current on-device list store; cross-device list/plan synchronization is not implemented.

Calendar currently aliases the reminders screen and has no independent appointment feed. No weather integration is present. Those integrations remain outstanding; the planner does not fabricate forecasts, appointments, or personal commitments. Manage lists & reminders opens the existing editor. The separate full Tasks / Lists master-index redesign is outside this change.

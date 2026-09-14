# Daily Grind day planner

Follows `docs/architecture/screens/06_ROUNDHOUSE_DAILY_GRIND.md` on Main and Danny's September 14 direction: replace the old reminders hub with a morning planner and choices from existing lists, including a Go shopping choice that reveals unfinished shopping-list items.

The Daily Grind rail tab opens the dedicated planner. Its large working sheet covers the header and Timeline while preserving the existing rail and bottom controls. Yesterday / Today / Tomorrow select the planning date. Users add or remove references to existing list items; no source item is copied or marked completed by planning it. Completed source items no longer appear as unfinished plan items.

The first focused Command Center visit each local day opens Daily Grind automatically. It also checks on app resume and local date rollover while focused. The once-per-day marker is scoped to the signed-in person on that device. Closing it does not reopen it during that day. This is an in-app morning opening, not a scheduled operating-system launch or notification.

The sheet includes due and overdue unfinished reminders, actionable Resolutions, and tomorrow's reminder count. Existing reminder and Resolution destinations retain ownership of their records. Plans store source list/item IDs per person and date on the device. Existing shopping/custom lists remain the current on-device list store; cross-device list/plan synchronization is not implemented.

Calendar currently aliases the reminders screen and has no independent appointment feed. No weather integration is present. Those integrations remain outstanding; the planner does not fabricate forecasts, appointments, or personal commitments. Manage lists & reminders opens the existing editor. The separate full Tasks / Lists master-index redesign is outside this change.

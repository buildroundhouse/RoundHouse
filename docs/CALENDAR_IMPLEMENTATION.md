# Calendar implementation

The Command Center Calendar route now opens a dedicated scheduling screen instead of re-exporting Reminders. This implements the scheduling and dispatch model in `docs/architecture/screens/14_CALENDAR.md` (governing main-branch document).

## Account behavior

- An approved business Owner/Admin/Manager can schedule only on Properties accessible to the selected account. Property Owners/Managers can schedule their own Property visits.
- Workers never receive the company board or unpublished proposals. They see their confirmed assignments; independent workers see their own published requests.
- Homeowners see visits for their own Properties. Viewers receive no operational scheduling authority.
- Required participants individually accept, decline, suggest another time, or add a message. The overall appointment becomes Confirmed only when every required approval is accepted.
- Membership removal, archived accounts/Entities, selected-account isolation, and optimistic revisions are enforced by the server.

## Flow

1. Choose existing Property, people, local time and duration; save Proposed.
2. Publish the proposal. In-app notifications go to affected recipients.
3. Confirmed appointments appear in the individual's Daily Grind, including tomorrow's view, across that person's accounts only.
4. Rescheduling preserves earlier times and responses in history, resets required approvals, and notifies affected recipients. Concurrent stale responses are rejected.
5. Property and navigation links reuse the legacy Property mapping; business managers can message the selected client. Notification taps open Calendar.

Private availability stores only an Unavailable interval. Another user's private commitments are never returned. Publishing/rescheduling cannot overlap a selected participant's Unavailable time.

## Integration boundaries

- Night-before automated SMS is not enabled: the existing app only has SMS compose links, with no sending provider/consented-recipient delivery service. In-app updates are persisted; the UI does not claim an SMS was delivered.
- Calendar does not fabricate GPS arrival, Check In, or Work Session completion. Navigation opens Maps; the larger Capture/Work Session lifecycle remains separate work.
- Existing Messages/Property/Resolution screens do not yet offer scheduling shortcuts. The single Calendar route accepts `propertyEntityId` and `appointmentId`; all appointment mutations use one API.
- No automatic Resolution is created by scheduling negotiation.

## Verification

Real PostgreSQL-compatible PGlite tests execute the additive deployment DDL twice and verify role scopes, unpublished proposal privacy, approval gating, personal Daily Grind handoff, rescheduling history, stale responses, Unavailable conflicts, and removal/authentication enforcement. Production API and Expo web builds are checked. Full repository typechecking has existing unrelated errors; changed Calendar files are checked separately.

# Resolution Center page

Behavior follows `docs/architecture/screens/09_ROUNDHOUSE_RESOLUTION_CENTER.md`
on the documentation branch/main. This implementation replaces the Resolution
tab's old export of the Reminders page. Command Center appearance is a separate
change; this page does not modify its tabs, header, or bottom control styling.

- Explicit **Control Center** back button, including inside an opened resolution.
- New resolutions require an existing property/business and an approved participant.
  Server-side membership checks reject unrelated recipients and read-only creators.
- Red **Needs Your Attention**, green **Waiting on Them**, gray **Resolved**.
- Existing questions/requests, response text, requested actions, next-step choices,
  names and dates remain available. No record is deleted or reassigned.
- Replies append a permanent discussion event and pass responsibility; they do
  not close the item. Follow-up escalation counts unanswered follow-ups on the
  same item, never unrelated requests or page visits.
- Only the creator can deliberately close after recording and verifying the
  outcome. Closed history cannot be edited. Resolved unread markers are per
  participant and clear when that participant opens the detail.
- Actions require authentication and participation, and lock the row before
  appending history. Legacy mutation paths cannot overwrite managed history or
  delete questions. The schema migration only adds a nullable JSONB column.
- Resolution notification links open this page, including the specific item.

Historical questions do not contain a property/business ID or originating
conversation ID. The page explicitly labels missing context; it never infers
ownership or copies an unrelated profile. Earlier response text is retained,
but the old system did not retain every previous edit or responsibility change.
Calendar/document/message evidence integration is separate work; a recorded next-step preference is not represented as proof that
the appointment or other action happened. Existing Reminders features remain
available through their existing destinations; they are not rendered here.

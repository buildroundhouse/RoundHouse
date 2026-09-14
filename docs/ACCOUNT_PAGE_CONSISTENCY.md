# Account behavior across Command Center, Profile and Resolution Center

Reviewed against the governing Roles & Permissions, Command Center, Profile and
Resolution specifications on main, preserving the newer hosted header/tab layout
in CURRENT_COMMAND_CENTER.md.

| Account | Identity context | Resolution participation |
| --- | --- | --- |
| Homeowner | Residential Property; multiple homes explicitly say My Homes / Properties in Command Center | Current approved contribution scope |
| Home Manager | Home role plus approved Manager authority | Delegated scope; no authority to close another creator's Resolution |
| Home Team Member | Home participation; never promoted by a typed job title | Approved contribution scope only |
| Trade Professional | Business identity, separate from client Properties | Only permitted Entity contexts |
| Trade Team Member | Business participation, separate from client Property authority | Approved contribution scope only; no inherited ownership |
| Commercial Management / Team Member | Facility identity and approved authority | Approved contribution scope only |
| Viewer, including legacy aliases | Neutral Viewer; Residential Property or Facility, never Trade Viewer | Read-only personal Resolution history; no creation, replies, follow-ups or closeout |

Command Center and Profile now share the role/authority resolver. Profile editing
and preview resolve the mode attached to the selected account, avoiding edits to
another role while switching. Capture explains Viewer read-only access; account
switching resets its composer and the Resolution workspace.

Command Center requests an attribution-based personal work Timeline. It excludes
coworker work (including work performed through a company account), retains the
person's legitimately attributed history without requiring continued Property
membership, and does not embed current private Property details in those records.
The existing shared feed and Entity access checks remain separate. Search filters
this personal Timeline. The existing points calculation now uses those personal
records; it is still based on the fetched work records, not a full rewards ledger.

Resolution creation contexts and ongoing contribution permission are checked against
the selected avatar's approved memberships. Explicit contribution restrictions and
Viewer membership are honored; read-only recipients aren't offered requests that
require contribution. Historical participants may still read their existing
Resolutions. Only the original creator may verify and close one. The Command Center
toggle reads the same Resolution state as the page, including responsibility passed
back through replies and per-thread follow-ups. Read-only history does not demand
action through the toggle.

Older personal questions have no Entity ID. Operational avatars retain their existing
personal discussion path; no Entity or ownership is inferred for those records.
This does not implement the wider future permission-delegation, linked Calendar
completion evidence, public Property discovery or full rewards-ledger work described
in the governing documents.

Validation: 69 focused tests (role rendering, account selection, actual SQL attribution
against an isolated in-memory database, API mutation authorization and shared toggle
state); Expo production web export and API bundle pass. No new type errors in changed
files; unrelated pre-existing app and API test type errors still block whole-project
typecheck. No signed-in handset verification was available in this session.

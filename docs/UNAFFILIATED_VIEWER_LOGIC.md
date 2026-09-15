# Unaffiliated Viewer lifecycle

Governing product rule from Danny, September 14, 2026. This rule supersedes older
logic that treats an unaffiliated Viewer as a new-user choice or limits this
state to people whose previous role was Viewer.

## Eligibility and transition

An existing account defaults to Viewer when its last approved Entity affiliation
ends. The previous role does not matter. The account must have genuinely
participated in an Entity before; an unused baseline account or an invitation
that was never accepted does not qualify.

| Previous role | Departure | Result when no affiliation remains |
| --- | --- | --- |
| Viewer | Removed from the Entity | Unaffiliated / Viewer |
| Homeowner | Sells the house and is no longer tied to it | Unaffiliated / Viewer |
| Trade Pro owner | Sells the business and is no longer tied to it | Unaffiliated / Viewer |
| Trade teammate | Leaves or loses the job and business participation ends | Unaffiliated / Viewer |
| Home teammate, manager, facility participant, or any other role | Last approved participation ends | Unaffiliated / Viewer |

If another approved Entity affiliation remains, keep that affiliation and its
assigned role. A pending invitation does not grant a role or replace verified
Unaffiliated status. A later approved membership supplies the new Entity and role.
A sale or ownership transfer qualifies only when participation actually ends;
retaining an admin or other membership means the account is still affiliated.

## Account and retained work

Keep the same personal account and saved identity. Do not create a replacement
account, discard work, or make the person repeat completed identity intake.
The account holds the person's own work history without requiring a current
Entity affiliation, including their own work performed through a former business.
A removed teammate must not need access to the former shared company account to
recover their own history.

Ending affiliation ends access and authority over the former Entity. Retained
personal history does not grant access to other people's work or the former
Entity's current private information. Preserve historical authorship and original
Entity references on records; "unaffiliated" describes the account's current
relationship, not an instruction to erase the history of where work happened.
Original Entity records remain in the Entity's history.

## Intake and consistent presentation

- New users complete the Entity-first intake or join an Entity. They cannot choose
  an unaffiliated Viewer account to bypass intake.
- If an account was mistakenly given only the automatic Viewer/Collaborator
  baseline and support returns it to original intake, clear identity completion,
  the baseline mode, and its outward account together. While identity completion
  remains empty, sign-in must not recreate either baseline. Completing identity
  re-enables normal baseline provisioning and continues into Entity-first intake.
- Verified former participants can return to their retained account without
  creating or joining a replacement Entity.
- Command Center, Profile, and View Profile display **Unaffiliated** on the
  Entity/name line and **Viewer** immediately underneath. Do not display the old
  Entity name or former owner, manager, or teammate role as current identity.
- Apply Viewer permissions consistently, including read-only Capture and
  Resolution composition. Retained history does not restore contribution rights.

## Acceptance checks

Verify each departure in the table, remaining affiliation, an unaccepted
invitation, a brand-new account, and later approved re-affiliation. Verify retained
personal work for both directly authored work and work performed through a shared
business account. Confirm former Entity access ends without deleting either the
personal history or the Entity's original records.

## Implementation status

This document defines required behavior, not proof of a live deployment. The
prepared implementation covers verified Entity membership removal, property
removal history, the intake exception, and shared Viewer presentation. Its
publication remains pending. The older shared-company account departure and
personal archive mapping still require implementation and verification. Current
property ownership transfer retains the seller as an admin until that membership
is ended separately. These gaps do not narrow the governing rule above.

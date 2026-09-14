# People directory

The People bottom tab (`clients`) and legacy `my-team` route now share the same
People directory, also reused in the profile People modal. The previous screens
queried `/users/me/relationships`, which deliberately returns empty arrays after
the Entity migration. Their Friends & Collaborators headings were still deployed.

The replacement reads `/entities/mine` for the selected account, then the existing
member endpoints only for approved Entity memberships that allow contact visibility
(controller/owner/admin unless explicitly denied, or an explicit seeContacts grant).
It excludes pending, removed and archived memberships and the signed-in person.
Viewer accounts do not read Business directories. Home Team precedes Trade
Professionals, and rows retain their Property, Facility or Business grouping.
Legacy collaborator roles display as Viewer. Search matches visible names, roles,
Business names and Entity names. Profile and Message target the member's exact
outward account. Account changes reset the directory and selected person.

The page has a visible Command Center back button. It does not manage permissions
or mix pending invitations into People. No server authorization rules were changed.
Address search and richer relationship-source cards remain limited by the fields
provided by the existing Entity endpoints; no addresses or permissions are inferred.

Validation: 11 focused permission/filter/grouping assertions; actual component
rendered in a mocked phone-width browser fixture, confirming search, pending exclusion
and return navigation; production web export passed. Existing unrelated app type
errors remain; no errors in the changed People files. Signed-in handset verification
was not available.

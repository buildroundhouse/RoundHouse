# Profile aligned to current screen rules

Implements the Profile structure in `docs/architecture/screens/03_ROUNDHOUSE_PROFILE_SCREENS.md` on the repository's `main` branch.

- Persistent, large Back to Command Center control navigates directly to `/(tabs)` without changing the active role or outward account.
- Editable personal banner and photo, with the person visually dominant and Entity identity secondary.
- View Profile shows only personal fields selected as Public. Both Share controls enter Invitation Center.
- Separate Trade Professional, Residential Home, and Commercial Facility lookup entries; Discover is explicitly Coming Soon.
- Personal information includes bio, contact, web/social links, experience, strengths, and certifications. Existing personal values are carried into the editor. New edits are saved under the current mode's `personalProfile`, preserving Entity branding and other intake fields. Each field has a Public/Private switch.
- The outward profile endpoint redacts private personal fields and legacy duplicates for non-self viewers. Contact restrictions still take precedence. Uploaded personal banners must belong to the caller.
- Authority & Permissions, Subscription & Account, and Other Settings are distinct destinations. Account cancellation is a support request and does not promise to erase contributed history.
- Analytics, rewards, business setup, and role switching no longer occupy the personal Profile page.

## Current dependencies and limits

Public opt-in Property discovery and permission delegation are not implemented by the existing backend. The lookup page explicitly limits Property results to the caller's accessible Properties. The permissions page reports approved memberships and explicit grants but does not pretend to implement delegation. Account cancellation opens a support email; subscription management uses the existing billing page.

The Invitation Center reuses existing received/request/sent flows and adds the shared Share Roundhouse doorway. This change does not claim to complete every invitation state in the future governing contract.

## Validation

Web export and API bundle passed. Four focused privacy/validation tests cover private-field redaction, removal of duplicate legacy personal values, contact restrictions, self/legacy behavior, and malformed visibility values. Whole-project typechecking retains unrelated existing errors. Signed-in handset behavior still requires checking in the test app.

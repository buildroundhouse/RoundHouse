# Profile aligned to current screen rules

Implements the Profile structure in `docs/architecture/screens/03_ROUNDHOUSE_PROFILE_SCREENS.md` on the repository's `main` branch.

- Sign out appears at the bottom of Profile, immediately below Other Settings and above the Roundhouse footer, for every account type. It uses the existing authentication sign-out action; the authenticated layout returns the user to sign-in. The button disables while signing out, and failures leave the user on Profile with a retry message.
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

## Avatar navigation follow-through

Every role uses the shared ProfileNavigation and ProfilePreview, including Homeowner,
Home Manager, Home Team Member, Trade Professional, Trade Team Member, and Viewer
(including historical Viewer aliases). The private account page also has a persistent
Back to Command Center header and View Profile entry. Preview offers both Back to
Profile and direct Back to Command Center. Navigation preserves the active avatar.

The old FullProfileModal now forwards to the current preview. Private account role
links open the current Profile instead of reopening the retired intake editor.
Approved Entity membership supplies Owner / Admin / Manager designations; a typed
job title or pending invitation cannot grant authority. Switching active context
resets the profile's open panels and editor state.

Validation: 22 focused rendering/navigation/privacy tests across the avatar roles;
Expo web production export passes. Changed application files have no TypeScript
errors; unrelated existing account/switcher errors still block the full typecheck.
These tests use mocked account data; signed-in handset validation is separate.

## Unaffiliated profile identity

Follow the governing [Unaffiliated Viewer lifecycle](UNAFFILIATED_VIEWER_LOGIC.md). When the last
approved Entity affiliation ends, every former role defaults to Viewer. Show
**Unaffiliated** on the Entity/name line and **Viewer** immediately underneath;
replace stale Entity identity and former authority consistently across Command
Center, Profile, and View Profile. Preserve the personal account and its own work
history, including work performed through a former business, without restoring
former Entity access. New users do not qualify for this intake exception.
The linked document distinguishes required behavior from implementation status.

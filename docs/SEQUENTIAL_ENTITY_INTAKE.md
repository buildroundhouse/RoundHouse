# Sequential entity intake

Danny's September 14, 2026 instruction governs the intake vocabulary and overrides the older avatar-first lists in architecture notes.

1. Property or Business — its own screen.
2. Property: Residential or Commercial — its own screen. Business: choose the trade/business type from the existing business-type catalog — its own screen.
3. Relationship — its own screen. Property: Owner, Manager, Home Team Member, Viewer. Business: Owner, Manager, Business Team Member, Viewer.
4. Owners enter property address or business profile details, then continue to the remaining details. These are separate screens with Back navigation.

Do not offer Collaborator in intake. The old mode-picker route redirects to the entity-first start. Invalid or old role-first links restart the sequence instead of silently choosing a property owner.

Residential and commercial owner paths use the existing home and facilities runtime respectively. The selected entity type, property/business type, and relationship are retained as `entrySelection` in the completed intake. The address card stays a separate step and retains ZIP lookup/manual-entry behavior. Business Continue now creates the pending business profile and opens the existing validated details form with the entered data restored.

Joining a space is different from creating an owner's workspace. Manager, Team Member, and Viewer selections show the existing invitation flow. Selecting one never creates an owner account or grants permissions. Invitations retain the server-authorized access; this change does not migrate historical membership roles or redefine authorization. Without an invitation, the user can refresh or continue without joining a space.

## Why the old flow survived

Git history shows commit `771737fe21949cddd311c3641b96b40c420fd288` (September 8, 2026) added an entry screen driven by `ENTRY_CHOICES`. Before the correction, that list in `lib/entry-intake.ts` still exposed Property Owner, Trade Pro, trade/commercial team roles, Commercial Supplier, and Collaborator as the initial choices. `HANDOFF.md` also continued to describe mode-picker as the setup entry. The implementation and documentation therefore retained conflicting legacy instructions; this is evidence of an incomplete transition, not evidence that hosting rolled back the app.

PR #10 replaced that flow and merged into `fix/permanent-phone-hosting` as `3533f060c4a50919c0e5ffd4b1cc56ed2af5c4d8`. These references record the correction, not a requirement to deploy an old commit forever.

## Implementation and regression requirements

- Start: `app/(onboarding)/entry.tsx`.
- Type screens: `entry-property-type.tsx` and `entry-business-type.tsx`.
- Relationship screen: `entry-role.tsx`.
- Details/connection: `entry-entity.tsx`, `entry-business.tsx`, `entry-access.tsx`, then `intake.tsx` as applicable.
- Choice definitions and validation: `lib/entry-intake.ts`; saved setup data: `lib/entry-draft.ts`.
- Never flatten these choices into one screen, reintroduce role-first entry, or infer ownership from a joining relationship.
- Back navigation and selected entity/type must survive the transitions. Invalid legacy links must return to the new entry sequence.
- Retain the existing `entry-intake.test.ts` and `entry-navigation.test.ts` checks when changing setup. Add coverage for changed behavior, including the exact displayed role vocabulary.
- Historical `_collab` keys and membership fields are compatibility details, not user-facing labels. Renaming a label is not a database or authorization migration.

## Verification recorded September 14, 2026

Five flow tests and six actual screen-navigation/draft tests passed. Expo web export succeeded. Render reported the merged correction live, `/api/health` returned 200 with successful migrations, the deployed JavaScript included the new intake labels, and the sign-in page loaded in a browser. Full signed-in intake submission was not verified. The full frontend typecheck still reported ten existing errors outside the changed screens.

The local export used synthetic build credentials and was not deployed. Render rebuilt the source with the service configuration. This verification record must not be presented as proof of every account's completed intake or native-app behavior.


## Saved personal identity is a completed checkpoint

Personal identity (photo, name, optional phone) is saved to the signed-in user's server record before space intake. Email belongs to the existing sign-in account. Failing, leaving, or restarting property/business intake must not clear that identity or require another account signup.

`identityCompletedAt` is the durable completion checkpoint. Missing or changed display media must not send a completed person back into identity setup. Old identity links redirect to the active unfinished intake, or the Property/Business start if no unfinished space is available. It is acceptable to restart space selection when no progress can be recovered; it is not acceptable to restart completed identity. Personal corrections remain available through the personal profile editor.

The identity form restores personal fields from `/users/me/personal`, not the business/property display overlay. Profile queries are scoped to the authenticated UID to prevent a previous account's cached state from influencing setup. A genuinely expired or signed-out session may still require sign-in; signing in to the same account must restore its saved identity rather than create it again.

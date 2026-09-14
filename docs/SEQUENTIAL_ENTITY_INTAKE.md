# Sequential entity intake

Danny's September 14, 2026 instruction governs the intake vocabulary and overrides the older avatar-first lists in architecture notes.

1. Property or Business — its own screen.
2. Property: Residential or Commercial — its own screen. Business: choose the trade/business type from the existing business-type catalog — its own screen.
3. Relationship — its own screen. Property: Owner, Manager, Home Team Member, Viewer. Business: Owner, Manager, Business Team Member, Viewer.
4. Owners enter property address or business profile details, then continue to the remaining details. These are separate screens with Back navigation.

Do not offer Collaborator in intake. The old mode-picker route redirects to the entity-first start. Invalid or old role-first links restart the sequence instead of silently choosing a property owner.

Residential and commercial owner paths use the existing home and facilities runtime respectively. The selected entity type, property/business type, and relationship are retained as `entrySelection` in the completed intake. The address card stays a separate step and retains ZIP lookup/manual-entry behavior. Business Continue now creates the pending business profile and opens the existing validated details form with the entered data restored.

Joining a space is different from creating an owner's workspace. Manager, Team Member, and Viewer selections show the existing invitation flow. Selecting one never creates an owner account or grants permissions. Invitations retain the server-authorized access; this change does not migrate historical membership roles or redefine authorization. Without an invitation, the user can refresh or continue without joining a space.

Validation: entity/type/relationship routing tests and an Expo web export. Build credentials used for local export are synthetic, so compilation is not proof of live authentication or deployment.

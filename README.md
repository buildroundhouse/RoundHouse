# RoundHouse

## Current intake contract — September 14, 2026

Read [Sequential entity intake](docs/SEQUENTIAL_ENTITY_INTAKE.md) before changing onboarding, role selection, or setup navigation. This is the current intake specification and supersedes conflicting role-first or avatar-first descriptions in older handoffs, architecture proposals, and test plans.

Each numbered step is a separate screen:

1. **Property or Business**.
2. **Residential or Commercial** for Property; **business type** for Business.
3. **Owner, Manager, Home Team Member, or Viewer** for Property; **Owner, Manager, Business Team Member, or Viewer** for Business.
4. Details or the invitation connection flow appropriate to that selection.

Use **Viewer**, never **Collaborator**, as the intake label. Preserve the preceding choices and provide Back navigation. Selecting a relationship does not grant access: server-authorized membership determines permissions.

[HANDOFF.md](HANDOFF.md) contains a historical implementation snapshot; its legacy routes and role names must not be copied into new intake work. Historical database identifiers are not UI requirements.

# Roundhouse Property Entity Screen

## Purpose

The Property Entity is the permanent digital place for one Property and also a legitimate workplace for authorized Homeowners, Home Team Members, Trade Professionals, and Trade Team Members.

It is not another personal Command Center.

**Command Center = the person's working view.**  
**Property Entity = what is happening here, what belongs here, and what authorized people can do here.**

The Property Entity should preserve enough positional familiarity from the Command Center that people can work without relearning the interface, while remaining visually distinct enough that they always understand they are inside a Property rather than on their personal Command Center.

---

## 1. Top Identity Area

The person's Avatar remains visible in the upper-right so the interface always identifies who is operating.

The Entity view does **not** show the person's Points / Status control. Points belong to the person and remain part of the personal Command Center / Reward Center experience.

An Entity-context Mail control remains available. Opening Mail from the Property Entity opens the same Roundhouse Mail system filtered to conversations associated with that Property and available to the current person.

---

## 2. Compact Property Header

The Property Entity begins with a compact horizontal identity header rather than a tall hero that consumes excessive working space.

### Left approximately one-third

Shows:

- Property name
- Physical address
- If the Property name and address are effectively the same identifier, the address alone may be sufficient

If the person has access to multiple Properties, a small bright Roundhouse-blue **Switch** control appears beneath the Property identity.

**Switch** opens the person's available Property choices and changes the current Property context.

If the person has access to only one Property, **Switch** is hidden.

### Right approximately two-thirds

Shows the representative Property photograph / splash image.

The wider image area prevents the Property photograph from becoming visually narrow or cramped while keeping the overall header compact.

---

## 3. Property Timeline

The Property Timeline remains the visual and architectural center of the Entity screen.

It shows the collective chronological history of the Property according to the current person's Role, authority, and permissions.

The Timeline Search control remains in the familiar upper-left area of the Timeline and filters the Property Timeline only.

**Avatar Timeline = what I am doing.**  
**Property Timeline = what is happening here.**

The Property Timeline is the living chronological view. The durable archival view of significant past Records lives in **Vault → Property History / Records**.

---

## 4. Right Edge — Four Property Tabs

The Property Entity uses the same four-tab right-edge geometry as the Command Center to preserve muscle memory, but the tabs are Property-scoped.

### 1. Work

Work is the top right-edge Property tab and replaces personal Daily Grind inside the Property Entity.

Its governing question is:

**What needs doing at this place?**

Work includes legitimate Property work across requested, open, assigned, in-progress, complete, verified, and cancelled lifecycle states according to permission. The user-facing label remains **Work**, not **Pending Work**, because the screen covers more than not-yet-started items.

Property Work can receive or surface homeowner requests, assigned work, due Maintenance occurrences, corrective Work created from Standards drift, and other legitimate Property action. Business-level Work and Property-level Work can reference the same underlying Record according to scope and permissions rather than creating duplicate work items.

**Work organizes the job. CAPTURE documents the real work session.**

The full Property Work screen and execution logic is governed by:

**`23_PROPERTY_WORK.md`**

### 2. Tasks / Lists

Uses the familiar Tasks / Lists position but shows only authorized Property-scoped tasks, checklists, shopping lists, and other lists belonging to or deliberately shared into this Property.

Private personal lists remain on the person's Command Center unless deliberately shared or otherwise governed by Entity permissions.

### 3. Maintenance

Maintenance is the Property's ongoing care workspace.

It answers:

**What should keep happening here, and is this Property staying in the condition we expect?**

Maintenance contains two internal views:

**Routine Maintenance | Standards**

- **Routine Maintenance** manages repeating Property care and cadence.
- **Standards** defines expected Property conditions and detects drift when those conditions are no longer being maintained.

When routine care becomes due or a Standard drifts, Maintenance can surface actionable work into **Work**. CAPTURE documents actual work performed, Calendar handles scheduled time, Resolution handles genuine unresolved dependencies, and Vault preserves durable history.

The full Maintenance and Standards experience is governed by:

**`18_PROPERTY_MAINTENANCE_STANDARDS.md`**

### 4. Vault

Vault is the permanent Property-information destination and the fourth / bottom right-edge Property tab.

It answers:

**What durable information belongs to this Property, and where can an authorized person reliably find it later?**

Vault's primary internal sections are:

- **Specs**
- **Assets & Equipment**
- **Documents**
- **Property History / Records**

**Specs** stores durable facts about the Property itself such as paint, finishes, materials, tile, cabinetry, hardware, measurements, and permission-controlled access information.

**Assets & Equipment** stores serviceable physical equipment that has its own maintenance, work history, documents, and lifecycle. Asset Detail is governed by **`19_PROPERTY_ASSET_DETAIL.md`**.

**Documents** is the clear durable file home for the Property. The governing path is **Property Entity → Vault → Documents**. Warranties, manuals, disclaimers, surveys, easements, inspections, reports, permits, plans, installation records, and other durable Property files live here as one underlying Record even when they are also reachable from an Asset, Work item, Timeline event, or other legitimate context. Documents is governed by **`21_PROPERTY_VAULT_DOCUMENTS_RECORDS.md`**.

**Property History / Records** is the durable archival view of what happened at the Property. It can surface completed Work, Maintenance, Standards evidence, installations, inspections, Asset lifecycle events, major Property changes, relevant ownership / authority changes, disclaimers and resolving Records, and other significant historical Records. It references the same underlying Records rather than creating an archive copy. Property History is governed by **`22_PROPERTY_HISTORY_RECORDS.md`**.

Property Handoff does **not** become another Vault folder containing duplicate knowledge. Handoff assembles a permission-aware briefing from existing Specs, Assets, Documents, Property History, Maintenance, Work, and deliberately shared information.

The full Vault and Specs architecture is governed by:

**`20_PROPERTY_VAULT_SPECS.md`**

The visible Vault control should ultimately be icon-first using a custom Roundhouse visual symbol rather than a platform-standard emoji. The word **Vault** is the current governing label.

---

## 5. Bottom Bar — Familiar Working Positions

The Property Entity preserves the same five-position bottom-bar geometry as the personal Command Center because these are high-frequency tools where muscle memory matters.

From left to right:

1. **Resolution**
2. **People**
3. **CAPTURE**
4. **Estimates / Invoices**
5. **Calendar**

Each control operates in the current Property context and remains subject to the person's Role, authority, and permissions.

### Resolution

Shows or creates Resolutions connected to this Property.

### People

Shows legitimate people and relationships relevant to this Property rather than the person's entire People directory.

### CAPTURE

Remains the dominant center control. When used from inside the Property Entity, the Property context is already known and should be carried into the resulting work session and Timeline records.

### Estimates / Invoices

Shows or creates Estimates and Invoices relevant to this Property when authorized.

### Calendar

Remains in the same far-right bottom position used on the Command Center. Inside the Property Entity it opens the schedule relevant to this Property and the current person's permissions.

Calendar does **not** move merely to make room for Vault; preserving its familiar position is intentional.

---

## 6. Visual Distinction From the Command Center

The Property Entity may reuse familiar control positions, but it must not feel like the person's Command Center with a different title.

Primary context signals are:

- compact Property-specific header;
- Property photograph occupying the wider right side of that header;
- Property name/address on the left;
- blue **Switch** control when multiple Properties are available;
- Property-scoped Timeline;
- **Work** rather than personal Daily Grind;
- **Maintenance** as the Property care workspace;
- **Vault** as the Property memory / permanent-information destination;
- absence of personal Points / Status in the Entity top area.

The goal is familiar operation with unmistakable context.

---

## 7. Governing Rules

1. The Property Entity is both a permanent record and a legitimate place where authorized people work.
2. Durable facts about the Property belong with the Property Entity, not in a person's Command Center.
3. Shared working tools may occupy the same physical positions as equivalent Command Center tools when doing so preserves useful muscle memory.
4. Equivalent placement does not mean equivalent scope: Entity controls operate within the current Property and its permissions.
5. Personal systems such as Daily Grind and personal Points do not become Property systems merely because the person entered a Property.
6. The Property identity and blue **Switch** control provide Property switching; a separate permanent Properties tab is not required inside the Property Entity.
7. Mail opened from the Entity is the same Roundhouse Mail system filtered to that Entity context.
8. Property **Work** is the top right-edge operating view and answers what needs doing at this place. It is not named Pending Work because its scope includes active and completion states as well as pending states.
9. Maintenance governs recurring care and Property Standards; due work and drift can feed Work rather than becoming parallel task systems.
10. Vault is the permanent Property-information destination, with Specs, Assets & Equipment, Documents, and Property History / Records as its primary internal sections.
11. Property Documents has one clear home: **Property Entity → Vault → Documents**. Other valid pathways reference the same underlying files rather than creating copies.
12. Property Timeline is the living view; **Vault → Property History / Records** is the durable archival view. Both can present the same underlying Record without duplication.
13. Handoff assembles current permitted Property truth and does not maintain a duplicate permanent copy of that truth.
14. The Property Entity should feel visually distinct from the personal Command Center while preserving useful positional familiarity.

---

## Governing Phrase

**The Command Center tells me what I am doing. The Property Entity tells me what is happening here and gives me the tools I am authorized to use here.**

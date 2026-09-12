# Roundhouse Property Work

## Purpose

**Work** is the top right-edge working screen inside the Property Entity.

Its home is:

**Property Entity → Work**

It answers:

**What needs doing at this place?**

Work is intentionally named **Work**, not **Pending Work**, because the screen includes requested, open, assigned, in-progress, completed-awaiting-verification, and other legitimate Property work states.

Work is not a second Daily Grind, not a second Calendar, and not a replacement for CAPTURE.

**Work organizes responsibility and execution. CAPTURE documents the real work session.**

---

# 1. Position Inside the Property Entity

The Property Entity right-edge order remains:

1. **Work**
2. **Tasks / Lists**
3. **Maintenance**
4. **Vault**

Work occupies the same top position where **Daily Grind** appears on the personal Command Center, preserving useful muscle memory while changing scope.

**Daily Grind = what I need to do.**  
**Property Work = what needs doing at this Property.**

---

# 2. Work Screen

Work opens as a Property-scoped working sheet over the Property Timeline rather than replacing the Property Entity with an unrelated app area.

At the top:

**Work**  
Property name beneath it  
**Search Work**                 **+ Create Work**

The Create Work control appears only when the current person's authority permits creating Property work.

The screen should emphasize action and responsibility rather than forcing users to understand internal database states.

---

# 3. Primary Working Categories

A simple status row can include:

**Needs Attention | Requested | Assigned | In Progress | Completed**

These are the user-facing working groupings.

The underlying lifecycle may retain more precise states where useful:

**Requested → Open → Assigned → In Progress → Complete → Verified**

with **Cancelled** as a terminal state.

The interface does not need to expose every state as a permanent top-level tab. The working categories can group them intelligently.

Examples:

- **Requested** can include newly requested work awaiting acceptance.
- **Needs Attention** can surface overdue, blocked, failed verification, or otherwise actionable items.
- **Assigned** can include accepted work with responsibility established but not yet started.
- **In Progress** means actual execution has begun.
- **Completed** can include Complete and Verified, with verification state visible where required.

The architecture preserves the useful legacy lifecycle without making the UI feel like a status-management system.

---

# 4. Work Cards

Each Work card should answer the important questions at a glance:

**What is it? Where / what does it concern? Who owns it? When does it need attention? What state is it in?**

A card may show:

- title
- short category / Property area
- priority when meaningful
- assignee
- due date
- current state
- related Asset when useful
- source when useful, such as Maintenance or Homeowner Request

Example:

**Replace Rear Exterior Light**  
Exterior · High Priority  
Assigned: Mike Rodriguez  
Due Sept. 18  
**Assigned**

Example:

**Water Heater Flush**  
Routine Maintenance  
Due today  
**Open**

Example:

**Investigate Pool Pump Noise**  
Pool Equipment · Pentair Pump  
Requested by Homeowner  
**Requested**

Cards should remain compact enough that several work items can be scanned without opening each one.

---

# 5. Search and Filters

**Search Work** searches work connected to the current Property and available to the current person.

Search can match useful terms such as:

- title
- category
- Property area / room
- Asset
- assignee
- requester
- priority
- notes / description where appropriate

Additional filters may include:

- assignee
- due date
- priority
- category
- Asset
- status

The screen should prioritize fast retrieval over heavy project-management controls.

---

# 6. Create Work

**+ Create Work** creates a Property-scoped Work item.

Because the user is already inside the Property Entity, the Property is automatically known and should not be reselected.

A lightweight creation flow may include:

- title
- description
- category
- priority
- requester / creator
- assignee when known
- due date when useful
- related Asset
- optional photos / files
- optional external / PO reference where appropriate

The user should be able to create a useful Work item quickly without being forced to populate every field.

---

# 7. Work Detail

Tapping a Work card opens **Work Detail**.

Work Detail may show:

- title
- description
- current state
- category
- priority
- requester / creator
- assignee
- due date
- related Property area
- related Asset / Equipment
- appointment / Calendar relationship
- photos
- files
- work-focused comments
- chronological activity
- related Maintenance / Standard
- related Resolution when a real blocker exists
- related Estimate / Invoice
- CAPTURE history / evidence

Attachments can retain meaningful phase context such as:

- starting condition
- in progress
- completion

Work Detail should make the Work item understandable as one coherent Record rather than forcing the person to reconstruct the job from several screens.

---

# 8. Primary Worker Action — Start Work

For an authorized assigned worker, a strong action appears in Work Detail:

**Start Work**

Starting work moves into the established CAPTURE workflow with context already known:

- current Property
- Work item
- related Asset when one exists
- assigned person / acting identity

The worker should not have to reselect the same Property or job information.

**Work identifies the job. CAPTURE begins the real work session.**

---

# 9. CAPTURE Integration

CAPTURE remains the governing real-time execution system.

Relevant CAPTURE activity may update Work progress and create durable evidence such as:

- arrival / check-in context
- starting-condition photographs
- task execution
- Mid-Job Capture
- materials / parts used
- service notes
- completion photographs
- cleanup / pack-out
- check-out

A CAPTURE session connected to Work remains the same underlying work evidence when surfaced in Property Timeline, Business Work, Asset History, or Property History.

No duplicate execution record is required.

---

# 10. Calendar Integration

Work can be scheduled, but Work is not a Calendar.

When time is agreed or assigned:

**Work → Calendar appointment**

The Calendar governs:

- proposed time
- pending confirmation
- confirmed appointment
- scheduling / dispatch

A confirmed appointment should not be silently rewritten merely because Work metadata changes.

The Work item keeps a link to its appointment.

---

# 11. Maintenance Integration

Routine Maintenance may create or surface Work when care becomes due.

Governing flow:

**Maintenance Rule → Due Occurrence → Work**

Example:

**Water Heater Flush — Annual**  
becomes a real dated Work item when due.

The Maintenance Rule remains the durable recurring template. The Work item is the actual occurrence that needs action.

Completing the Work can feed Maintenance history and update the next cadence without creating duplicate records.

---

# 12. Standards Integration

When a Property Standard drifts, corrective Work can be created.

Example:

**Standard:** Exterior lighting operational  
**Drift:** Rear fixture not functioning  
**Work:** Replace rear exterior light

The Standard remains the standing expectation. Work handles the corrective action.

Completion / evidence can return the Standard to **On Track** while preserving the historical drift and correction.

---

# 13. Homeowner / Property Requests

A legitimate Homeowner or Property request can become Work.

Example:

**Request:** Upstairs sink is leaking  
→ **Work:** Diagnose and repair upstairs sink leak

The request should not disappear merely because it has been converted into Work. The relationship between requester and resulting Work remains visible according to permission.

This prevents separate competing request and work-order systems.

---

# 14. Business Work Relationship

Property Work and Business Work can show the same underlying Work item from different scopes.

**Business Work** answers:

**What does this Business have on its plate across all Properties?**

**Property Work** answers:

**What needs doing at this place?**

Example:

A Business manager sees **Replace Rear Exterior Light** in Business Work across all jobs.

Entering the Property shows the same Work item in Property Work.

It is not copied or recreated.

This follows the governing Business Work rule:

**Business Work organizes responsibility and execution across the Business. Property Work narrows that same reality to one place. CAPTURE proves what actually happened during the work session.**

---

# 15. Resolution Integration

A genuine unresolved dependency can create or link to a Resolution.

Examples:

- waiting for homeowner decision
- approval required
- missing information
- disputed scope
- unavailable critical material
- unclear responsibility

Work should not become a substitute Resolution merely because something is waiting.

The Work item remains the job. Resolution tracks the unresolved issue preventing or affecting the job.

---

# 16. Comments and Mail

Work Detail can contain focused comments because those comments belong to execution of that Work item.

Examples:

- clarify exact fixture location
- confirm replacement part
- note site condition

This is not a replacement for Roundhouse Mail.

**Work comments = discussion attached to the job.**  
**Mail = communication between people.**

Comments follow Work permissions.

---

# 17. Completion and Verification

When execution is finished, the responsible worker can mark Work **Complete** where authorized.

If verification is required, the item remains clearly identifiable as completed but awaiting verification until an authorized person verifies it.

Verification means an authorized person confirmed the result according to the actual review performed. It should not imply broader workmanship certification than what was genuinely reviewed.

After completion / verification, the Work item can remain accessible through Property History rather than remaining prominent in active Work forever.

---

# 18. Work and Property History

Active Work belongs in the Work screen.

Meaningful completed Work becomes part of durable Property history.

**Work = what needs doing now.**  
**Property History = what happened here.**

The same underlying Work Record can transition from active Work visibility to historical retrieval without being copied.

---

# 19. Permissions

Property Work is permission-aware.

Examples:

- Homeowners / authorized Property authorities can see and create legitimate Property work according to authority.
- Trade Professionals see Work they are permitted to access through the Property / Business relationship.
- Trade Team Members see assigned or otherwise permitted Work.
- Managers can see and assign Work according to governing Business authority.
- outside trade partners see only Work legitimately shared / assigned to them.
- Viewers remain view-only where Work visibility is permitted.

Assignment does not grant unrelated Property visibility.

---

# 20. Visual Direction

The Work tab should feel like an operational sheet attached to the Property Entity, not a separate project-management product.

Key visual behaviors:

- opens over the Property Timeline;
- Property name remains visible;
- compact status / filter controls;
- scan-friendly Work cards;
- strong state clarity without excessive color coding;
- strong **Start Work** action when appropriate;
- related Asset / due date / assignee visible without opening every item;
- clear close / return to Property Timeline.

The right-edge icon should ultimately be a custom Roundhouse-designed Work symbol. The governing label remains **Work**.

---

## Governing Relationship

**Daily Grind = what I need to do.**  
**Property Work = what needs doing at this Property.**  
**Business Work = what the Business has on its plate.**  
**CAPTURE = what actually happened during the work session.**

---

## Governing Rule

**Property Work is the Property-scoped operating view for requested, assigned, active, and recently completed work. It organizes what needs doing at this place while CAPTURE documents the real execution and Property History preserves what happened.**

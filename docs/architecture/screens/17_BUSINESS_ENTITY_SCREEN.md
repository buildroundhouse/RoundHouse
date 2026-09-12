# Roundhouse Business Entity Screen

## Purpose

The Business Entity is the permanent digital place for one Business and also a legitimate workplace for authorized Owners, Managers, Trade Professionals, Trade Team Members, and approved outside trade partners.

It is not another personal Command Center.

**Command Center = the person's working view.**  
**Business Entity = what the Business is doing, who is operating through it, what Properties it is serving, and what Business-owned resources and records belong to it.**

The Business Entity should preserve useful positional familiarity from the Command Center while remaining visually distinct enough that the person always understands they are inside the Business rather than on their personal Command Center.

---

## 1. Top Identity Area

The person's Avatar remains visible in the upper-right so the interface always identifies who is operating.

The Business Entity does **not** show the person's Points / Status control. Points belong to the person and remain part of the personal Command Center / Reward Center experience.

A Business-context Mail control remains available. Opening Mail from the Business Entity opens the same Roundhouse Mail system filtered to conversations associated with that Business and available to the current person.

---

## 2. Compact Business Header

The Business Entity begins with the same compact Entity-header language used by the Property Entity.

### Left approximately one-third

Shows:

- Business name
- useful identifying information appropriate to the Business

If the person legitimately operates through more than one Business Entity, a small bright Roundhouse-blue **Switch** control appears beneath the Business identity.

**Switch** opens the person's available Business choices and changes the current Business context.

If the person has access to only one Business, **Switch** is hidden.

### Right approximately two-thirds

Shows the representative company photograph / Business image / branding.

The wider image area keeps the image visually useful without making the header tall enough to consume substantial working space.

---

## 3. Business Timeline

The Business Timeline is the collective chronological history of Business activity available to the current person according to Role, authority, and permissions.

It is not a dump of every employee's private personal Timeline.

The familiar Timeline Search control remains in the upper-left area of the Timeline and filters the Business Timeline only.

**Avatar Timeline = what I am doing.**  
**Business Timeline = what the Business is doing.**

---

# 4. Right Edge — Four Business Tabs

The Business Entity uses the same four-tab right-edge geometry as the Command Center and Property Entity so users retain positional familiarity.

The tabs are Business-scoped:

1. **Work**
2. **Team**
3. **Properties**
4. **Vault**

These controls should ultimately be icon-first. Their governing text labels remain available for accessibility, tooltips, expanded states, and documentation.

---

## 4.1 Work

Work answers:

**What does this Business have on its plate across all Properties?**

It is the Business-level integration home for the useful logic previously split across **My Jobs**, Work Orders, assignments, requests, due work, recurring work, and related execution systems.

Work is a Business-scoped working sheet over the Timeline rather than another unrelated destination.

### Work is not Daily Grind

Daily Grind belongs to a person and answers what that person needs to do today.

Business Work is collective and answers what the Business has on its plate.

A manager may see work across the Business according to authority. A Trade Team Member sees only work they are permitted or assigned to see. Opening Business Work does not expose private personal schedule details or another person's private Timeline.

### Business Work View

The governing Business Work screen uses a lean tiered **Work Flow Rail** inspired by a timeline / bracket structure rather than a full Kanban board or literal tournament bracket.

The lifecycle remains:

**Requested → Open → Assigned → In Progress → Complete → Verified**

with **Cancelled** as a terminal exception.

Each lifecycle stage appears as a tier on one slim rail. Compact Work cards sit beside the tier they currently occupy and connect with a short branch line. The bracket inspiration should be structural, not decorative.

**Needs Attention** is a priority condition above the rail, not another lifecycle stage. It can surface overdue, blocked, failed-verification, urgent, or otherwise actionable Work while each item remains in its real stage.

Business Work cards make **Property context** prominent because the screen spans many jobsites. Property, assignee, due date, and current state are the main scan points.

Stages can expand or collapse, and filters can narrow by Property, assignee, due date, priority, category, Asset, or attention state without changing the underlying rail.

The full Business Work screen, Flow Rail, lifecycle, responsive layout, and execution relationships are governed by:

**`26_BUSINESS_WORK.md`**

### Work Item / Work Order Core Information

A work item can retain the useful legacy Work Order structure where appropriate:

- title / description
- Property
- category
- priority
- creator / requester
- assignee
- due date
- optional related Asset / Equipment record
- optional purchase-order or external reference number
- status / current state
- photographs
- files
- comments / discussion
- chronological activity history

Attachments may retain meaningful phase context such as:

- created / starting condition
- in progress
- completion

This preserves the useful visual evidence structure already present in the older Work Order system.

### Assignment

Authorized Owners / Managers can assign or reassign Business work to appropriate Trade Team Members or approved outside trade partners.

The assigned person's own working views may surface that assignment, but the underlying work item remains attached to the Business and Property context rather than becoming a duplicate personal record.

A person should be able to see their assigned work across Properties through their own working experience while managers can inspect the Business-wide work picture here.

### Status / Execution Flow

The governing lifecycle is:

**Requested → Open → Assigned → In Progress → Complete → Verified**

with **Cancelled** as a terminal state.

Governing interpretation:

- **Requested** — someone has legitimately requested work.
- **Open** — accepted into the Business workload but not yet assigned.
- **Assigned** — responsibility has been given to a person/team.
- **In Progress** — actual work has begun.
- **Complete** — worker says the requested work is finished.
- **Verified** — an authorized manager / governing party confirms completion where verification is required.
- **Cancelled** — the work will not proceed.

The Flow Rail communicates this progression without forcing the user to manage six giant columns.

### CAPTURE Integration

A work item is not a competing replacement for CAPTURE.

**Work identifies and organizes the job. CAPTURE documents the real work session.**

When an assigned work item is opened at a Property, an authorized worker can move into the Property / CAPTURE workflow. Real-time check-in, photographs, checklist changes, materials, shopping, breaks, estimates, invoices, and check-out remain governed by CAPTURE.

Relevant CAPTURE results can update the work item's progress and become part of the Business and Property Timeline without creating duplicate records.

### Calendar Integration

Scheduled work belongs on Calendar.

A Work item may be linked to an appointment, but Work does not become a second calendar. Scheduling negotiation and confirmed time remain governed by Calendar.

### Resolution Integration

A genuine unresolved problem can create or link to a Resolution.

A Work item should not be used merely as a substitute for a Resolution when the core problem is waiting on another person, approval, decision, missing information, or another unresolved dependency.

A blocked Work item stays in its actual lifecycle stage and can show a compact blocker / Needs Attention indicator.

### Recurring Work

Recurring maintenance or repeating Business work may generate future Work items according to an approved cadence.

The recurring rule is the template; each generated occurrence becomes a real dated work item / Record so the Business can see whether that occurrence was completed, skipped, deferred, or remains outstanding.

### Comments and Attachments

Work can retain a focused work discussion area with photographs and files where useful.

This is not a replacement for Roundhouse Mail. Comments stay attached to the Work item because they are part of executing that work; broader person-to-person communication remains in Mail.

Comments and attachments follow the Work item's permissions.

### Verification

Where a Business uses manager verification, an authorized Owner / Manager may verify completed work.

Verification should mean someone with legitimate authority confirmed the result; it must not be presented as automatic proof of workmanship or quality beyond what was actually reviewed.

### Governing Work Rule

**Business Work organizes responsibility and execution across the Business. Property Work narrows that same reality to one place. CAPTURE proves what actually happened during the work session.**

---

## 4.2 Team

Team is the Business-scoped operating roster.

It answers:

**Who operates through this Business?**

The visible label is **Team**, not **Business Team**. The right-edge control should ultimately be icon-first using a custom Roundhouse crew / roster symbol rather than a businessman, tie, briefcase, office-building, or generic single-person icon.

The preferred icon direction is a compact **connected crew mark**: three simple avatar-like circular nodes arranged as a group and subtly connected by one shared line / base. It should communicate people working together without implying gender, hierarchy, or corporate status, and it should remain visually distinct from the broader bottom-bar People icon.

Team is not the person's full People directory.

### Team hierarchy

The primary organization is:

1. **Owners / Managers**
2. **Trade Team Members**
3. **Subcontractors / Outside Trade Partners**

This distinction is deliberate:

**Trade Team Members belong to the Business. Subcontractors work with the Business.**

Subcontractors remain visible because they are part of how the Business gets work done, but they do not receive Business-member authority merely because they appear in Team.

### Team sheet

The Team tab opens a Business-scoped working sheet over the Timeline.

At the top:

- **Team**
- Business name
- **Search Team**
- **+ Add / Invite** when the current person has authority

Each person can show:

- Avatar
- name
- title / position
- relationship to the Business
- current authority / membership state where appropriate
- concise current assignment context where useful

Pending invitations appear separately from the active roster.

### Person action card

Tapping a person opens a compact action card rather than immediately navigating away.

Depending on relationship and permission, actions may include:

- View Profile / Entity
- View Assigned Work
- Message
- Call
- Email
- view relevant Property / job relationships

For authorized Owners / Managers, Business members may additionally expose appropriate controls for:

- Business authority
- assignments
- membership state

Subcontractors / outside partners do **not** receive internal Business-member authority controls.

The full Team screen, icon direction, roster structure, invitation behavior, and Team-vs-People boundary are governed by:

**`27_BUSINESS_TEAM.md`**

---

## 4.3 Properties

Properties is the Business-level doorway into the Properties this Business legitimately works with.

It is not simply a copy of the person's personal Property list.

The view may group Properties by client / customer where useful and should make it easy to identify the current jobsite.

Tapping a Property opens the established compact Property action card:

- **Enter Property**
- **Navigate to Property** when an authorized usable address exists

Entering the Property opens the separate Property Entity and its Property-scoped tools.

---

## 4.4 Vault

Vault is the permanent Business-information and Business-asset destination.

It is not limited to paperwork.

**Property Vault = permanent things belonging to the Property.**  
**Business Vault = permanent things belonging to the Business.**

### Business-owned assets

Vault may contain shared Business assets such as:

- vehicles
- trailers
- large equipment
- generators
- ladders
- tents / canopies
- specialty tools
- estimating tools
- measuring / diagnostic equipment
- other durable shared Business equipment

Each Business asset can eventually show useful operational information such as:

- asset name / type
- photograph
- identifier / serial / asset number where useful
- normal storage location
- current location or associated job when known
- current custodian / person who has it
- availability / in-use state
- maintenance / service history
- related documents

This allows an authorized Trade Team Member to answer practical questions such as:

**Who has the laser measure?**  
**Which truck is the generator in?**  
**Is the trailer available?**

Owners / Managers may have deeper editing and lifecycle controls while authorized workers can still see enough information to locate and use shared equipment.

### Business records and documents

Vault may also contain durable Business records such as:

- licenses
- insurance certificates
- company documents
- equipment warranties / manuals
- policies
- approved templates
- other permanent Business records

The final internal Vault architecture can evolve as legacy systems are reconciled, but Business-owned assets are a first-class part of Vault rather than an afterthought.

### Visual direction

Vault should ultimately use an icon-first custom Roundhouse visual symbol rather than a platform-standard emoji. **Vault** is the current governing label.

---

# 5. Bottom Bar — Familiar Working Positions

The Business Entity preserves the established five-position bottom-bar geometry where the same core tools remain useful:

1. **Resolution**
2. **People**
3. **CAPTURE**
4. **Estimates / Invoices**
5. **Calendar**

These controls operate inside the Business context and according to Role, authority, and permissions.

The bottom bar is not redesigned merely because the Business Entity has its own right-side tools. Preserving high-frequency muscle memory is intentional.

### Team vs People

These are not duplicates.

**Team** = people who belong to or actively work alongside this Business in the Business operating structure.

**People** = the broader legitimate relationship network available in the current Business context, such as clients / homeowners, suppliers, authorized contacts, and other people connected through Business participation.

---

# 6. Visual Distinction From the Command Center

The Business Entity may reuse familiar control positions, but it must not feel like the Owner's or worker's personal Command Center with a new title.

Primary context signals include:

- compact Business-specific header;
- Business name / identity on the left;
- blue **Switch** when multiple Businesses are available;
- Business photograph / branding occupying the wider right side of the header;
- Business Timeline;
- **Work** rather than personal Daily Grind;
- tiered Business Work Flow Rail across Properties;
- icon-first **Team** control using a connected-crew visual rather than a businessman metaphor;
- Business-scoped **Properties**;
- Business **Vault**;
- absence of personal Points / Status in the Entity top area.

The goal is familiar operation with unmistakable Business context.

---

# 7. Governing Rules

1. The Business Entity is both a permanent Business record and a legitimate collective workplace.
2. Business Work is collective workload; Daily Grind remains personal.
3. Business Work uses a lean tiered Work Flow Rail for **Requested → Open → Assigned → In Progress → Complete → Verified** rather than a dense full Kanban board or literal tournament bracket.
4. **Needs Attention** is a priority condition across lifecycle stages, not another Work stage.
5. Team is the Business operating roster and answers who operates through the Business.
6. Team uses the governing label **Team** and should ultimately be represented by an icon-first connected-crew mark, not a businessman / corporate stereotype.
7. Team distinguishes Business members from subcontractors / outside trade partners while keeping both operationally visible.
8. Team does not replace the broader People system.
9. Properties shows the jobsites / Properties the Business legitimately works with and provides the doorway into each Property Entity.
10. Vault owns durable Business information and Business-owned shared assets.
11. Shared equipment may expose custody, location, availability, and service history to authorized workers without granting administrative authority.
12. Work Orders / assignments remain useful architecture but must integrate with CAPTURE, Calendar, Resolution, Property Records, and Timelines rather than forming an isolated parallel system.
13. Work comments are work-record discussion; Roundhouse Mail remains the communication system between people.
14. Personal Points / Status remain outside the Business Entity top area.
15. Familiar tool positions should be preserved where doing so improves muscle memory, but all Entity controls operate within Entity scope and permissions.
16. The Business Entity must remain visually distinct enough that the person never mistakes it for their personal Command Center.

---

## Governing Phrase

**The Command Center tells me what I am doing. The Business Entity tells us what the Business is doing, who is doing it, where the work is happening, and what the Business owns.**

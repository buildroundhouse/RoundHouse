# Roundhouse Team

## Purpose

**Team** is the second right-edge working screen inside the Business Entity.

Its home is:

**Business Entity → Team**

It answers:

**Who operates through this Business?**

Team is the Business operating roster. It is intentionally distinct from the broader **People** system.

Invitation behavior is governed by **`33_INVITATIONS.md`**.

---

# 1. Position Inside the Business Entity

The Business Entity right-edge order remains:

1. **Work**
2. **Team**
3. **Properties**
4. **Vault**

Team occupies the second right-edge position.

The right-edge control should ultimately be icon-first. The word **Team** remains the governing label for accessibility, tooltips, expanded states, documentation, and any context where text is needed.

---

# 2. Team Icon Direction

The Team icon should not use a businessman silhouette, tie, briefcase, corporate-building symbol, or generic single-person icon.

The preferred Roundhouse icon direction is a **small connected crew mark**: three simple avatar-like nodes arranged as a compact working group and subtly connected by one shared line / base.

It should communicate **crew / roster / working together**, not management status.

---

# 3. Team vs People

## Team

**Team = people who belong to or actively operate with this Business.**

Examples:

- Owners / Managers;
- Trade Team Members;
- accepted Subcontractors / Outside Trade Professionals.

## People

**People = the broader legitimate relationship network available in the current Business context.**

Examples:

- clients / homeowners;
- suppliers;
- Property contacts;
- referral relationships;
- other legitimate Business-connected people.

A person can appear in People without being part of Team.

Team should never become a duplicate full Business contact directory.

**Viewer is not a Business Team category.** Viewer is the neutral view-only Role used when someone is deliberately added to a Residential Property or Commercial Facility.

---

# 4. Team Screen

Team opens as a Business-scoped working sheet over the Business Timeline.

At the top:

**Team**  
Business name beneath it  
**Search Team**                 **+ Add / Invite**

The Add / Invite control appears only when the current person's authority permits inviting or adding people to the Business operating structure.

The screen should feel like a clean roster, not an HR administration dashboard.

---

# 5. Governing Team Groups

The roster is organized into three clear groups:

1. **Owners / Managers**
2. **Trade Team Members**
3. **Subcontractors / Outside Trade Professionals**

This distinction is intentional.

**Trade Team Members belong to the Business. Subcontractors work with the Business.**

A subcontractor remains a Trade Professional in their own right. Their outside-Business relationship does not turn them into an internal employee merely because the Business uses them on a job.

---

# 6. Team Rows

Each person appears as a compact row or card showing appropriate information such as:

- Avatar;
- name;
- title / trade when useful;
- Business relationship;
- current authority / membership state where appropriate;
- concise current assignment context.

Example:

**Mike Rodriguez**  
Lead Carpenter  
3 active assignments

Example:

**Carlos Hernandez**  
HVAC · Outside Trade Professional  
Spring Lake Residence

The screen should not expose unrelated personal information simply because the person is on the roster.

---

# 7. Search Team

**Search Team** searches only the Business operating roster available to the current person.

Search may match name, title / position, trade, Business relationship, and relevant Property / assignment context where permitted.

Search does not expand permissions.

---

# 8. Person Action Card

Tapping a Team member opens a compact **Person Action Card** rather than immediately navigating away.

Depending on relationship and permission, actions may include:

- **View Profile / Entity**;
- **Assigned Work**;
- **Message**;
- **Call**;
- **Email**;
- relevant Property / job relationships.

For authorized Owners / Managers, internal Business members may additionally expose controls for Business authority, assignment responsibility, and membership state.

Subcontractors / Outside Trade Professionals do **not** receive internal Business-member authority merely because they are on the roster.

---

# 9. Assigned Work

Assigned Work is a shortcut into the same underlying Business Work records.

**Team identifies who is operating. Work identifies what they are responsible for.**

No separate worker-specific Work datastore is created.

---

# 10. Add / Invite

Authorized people use **+ Add / Invite** to establish a real Business relationship.

The flow must first establish **how the person is participating**, rather than treating everyone as the same kind of Business member.

Typical choices include:

- Trade Team Member;
- Subcontractor / Outside Trade Professional;
- Supplier or other supported Business relationship where applicable.

Owner, Lead, and Manager are authority designations layered separately from the person's base Role.

Before sending, Roundhouse should show a plain-language confirmation such as:

**Invite Carlos Hernandez to JD Design Studios as an Outside Trade Professional?**

The invitation appears in the global Invitation Center as well as the Business's Pending area.

---

# 11. Subcontractor / Outside Trade Professional Flow

When the Business intends to use a subcontractor on a Property, the person is first established through the **Business relationship**.

The governing sequence is:

**Business invites Sub → Sub accepts Business relationship → Business assigns / proposes Sub to Property → Property access is resolved**

The Business is responsible for bringing its participant forward.

Roundhouse should not require the subcontractor to:

- search for the homeowner's Property;
- independently request access;
- wait for the Business to approve a request that the Business itself caused.

Roundhouse should not require the Homeowner to search for the subcontractor and rebuild the Business's staffing decision either.

---

# 12. Claimed Property Approval

When a claimed Property is governed by a Homeowner and the Business does **not** have delegated participant-management authority, assigning a subcontractor creates a simple Homeowner approval request.

Example:

**JD Design Studios wants to add Carlos Hernandez to Spring Lake Residence.**  
Kitchen project · HVAC  
**Approve | Decline**

The request identifies the Business, participant, Property, Work context, requested access scope, and person who initiated it.

The homeowner approves the Property participation, not the Business membership. The subcontractor already accepted the Business relationship.

---

# 13. Delegated Manager Authority

A Homeowner may explicitly give the Trade Professional / Business **Manager authority** that includes permission to manage Property participants.

When that authority is active:

**Business assigns accepted Sub → authorized Manager approves Property access on Owner's behalf → Homeowner is informed**

The Homeowner is not asked to approve the same participant again.

The informational Notification should make the authority source clear, for example:

**JD Design Studios added Carlos Hernandez to Spring Lake Residence.**  
**Authorized through JD's Manager authority.**

Roundhouse permanently records who performed the action, which delegated authority allowed it, the Business relationship, Property, permission scope, and time.

Removing or narrowing Manager authority stops future automatic approvals outside the remaining scope.

---

# 14. Unclaimed Properties

When the Business legitimately manages an **Unclaimed Property**, it may assign accepted Business participants directly within its legitimate operational authority.

The system should not create a circular request / approval loop against a Property the Business itself is currently stewarding operationally.

When the legitimate owner later claims the Property, the same Property and its history remain. Current participant permissions are reevaluated under claimed-owner governance.

---

# 15. Business-Derived Property Access

Property access created because a person is working through this Business is **Business-derived**.

Roundhouse must preserve the source of that permission.

If the Business later removes that person from the governing Business relationship, the person's current Property permissions that depend **only** on that Business relationship are automatically removed.

The Homeowner should not have to clean up the Business's former worker manually.

Historical Work, CAPTURE evidence, Timeline activity, communications, Resolutions, and attribution remain intact.

---

# 16. Independent Homeowner Relationship

A former Business-derived participant can later have a separate direct relationship with the Homeowner.

If the Homeowner independently wants to keep working with that Trade Professional, Roundhouse creates a **new independent Property authorization**.

Ending the original Business relationship then removes only Business-derived access; it does not destroy the new independent Property relationship.

---

# 17. Pending Invitations

Pending invitations appear separately from the active roster, normally below active Team or behind a simple **Pending** control.

A pending row may show:

- invited person / phone / email where available;
- intended Business relationship;
- invited by;
- invitation date;
- setup-required state;
- accepted Business but awaiting Property approval;
- resend / cancel controls when authorized.

Pending invitations must not look like active Team members before they accept.

---

# 18. Authority vs Role

Team preserves the Roundhouse distinction between **Role** and **authority**.

A person's base Role describes how they participate. Authority describes what they are allowed to control.

Examples of authority include Owner, Lead, Manager, and limited operational authority.

The Team screen can surface authority where useful without turning every row into a permissions matrix.

---

# 19. Relationship to Properties

A Team member may have legitimate relationships to one or more Properties through assigned Work or Business-derived participation.

The Person Action Card may show relevant Properties / jobs and the source of current access when useful.

Tapping a Property follows the established Property doorway.

---

# 20. Relationship to Mail

Team offers convenient communication actions but does not become a communication system.

**Team = roster and operating relationships.**  
**Mail = communication.**

Mail remains Entity-contextual and permission-aware.

---

# 21. Relationship to Calendar

Team may surface assignment context but should not expose another person's full private schedule.

Business scheduling and dispatch remain governed by Calendar.

---

# 22. Permissions

Team is permission-aware.

- Owners / authorized Managers may manage broader Business roster information according to authority;
- Trade Team Members see only roster information legitimately available to them;
- Outside Trade Professionals see only the Business and Property information necessary for their authorized work;
- Business membership alone does not grant unrelated Property access;
- Business authority alone does not grant the right to approve Property participants unless the Property Owner delegated that authority.

---

# 23. Visual Direction

Team should feel like a clean, approachable operating roster.

Visual priorities:

- icon-first right-edge control;
- compact connected-crew symbol;
- simple roster groups;
- generous Avatar recognition;
- name and relationship first;
- minimal secondary metadata;
- Person Action Card instead of immediate navigation;
- pending invitations visibly separate from active members;
- no dense HR tables;
- no org-chart hierarchy unless future requirements genuinely need one.

---

## Governing Relationship

**Team = the Business operating roster.**  
**People = the broader Business relationship network.**  
**Work = what the Team is responsible for.**  
**Invitation Center = how legitimate participation is established.**  
**Mail = how people communicate.**

---

## Governing Rule

**Team shows the people who belong to or actively operate with the Business. A subcontractor is first invited into the Business relationship; the Business then brings that accepted participant forward to a Property. Claimed Properties require Owner approval unless explicitly delegated Manager authority allows the Business to approve participants on the Owner's behalf. Unclaimed Properties allow the legitimate managing Business to establish necessary participant access directly. Business-derived Property access ends automatically when its governing Business relationship ends, while historical records and independently authorized relationships remain. Viewer is not a Business Team category.**

# Roundhouse Team

## Purpose

**Team** is the second right-edge working screen inside the Business Entity.

Its home is:

**Business Entity → Team**

It answers:

**Who operates through this Business?**

The visible product language is **Team**, not **Business Team** and not a businessman / executive metaphor.

Team is the Business operating roster. It is intentionally distinct from the broader **People** system.

---

# 1. Position Inside the Business Entity

The Business Entity right-edge order remains:

1. **Work**
2. **Team**
3. **Properties**
4. **Vault**

Team occupies the second right-edge position.

The right-edge control should ultimately be **icon-first**. The word **Team** remains the governing label for accessibility, tooltips, expanded states, documentation, and any context where text is needed.

---

# 2. Team Icon Direction

The Team icon should not use:

- a businessman silhouette;
- a tie;
- a briefcase;
- a corporate-building symbol;
- a generic single-person icon.

Those symbols either imply the wrong kind of person or fail to communicate a working group.

The preferred Roundhouse icon direction is a **small connected crew mark**:

- three simple circular / avatar-like nodes;
- arranged as a compact group rather than a hierarchy pyramid;
- subtly connected by one shared line / base so the symbol reads as people operating together;
- visually distinct from the broader People icon.

The icon should communicate **crew / roster / working together**, not management status.

If the icon is shown without text, tapping or hovering should reveal **Team**.

---

# 3. Team vs People

This distinction is governing.

## Team

**Team = people who belong to or actively operate with this Business.**

Examples:

- Owners / Managers;
- Trade Team Members;
- approved Subcontractors / Outside Trade Partners.

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
3. **Subcontractors / Outside Trade Partners**

This distinction is intentional.

**Trade Team Members belong to the Business. Subcontractors work with the Business.**

Outside trade partners remain operationally visible without receiving internal Business authority merely because they appear in Team.

---

# 6. Team Rows

Each person appears as a compact row or card.

A Team row may show:

- Avatar;
- name;
- title / position when useful;
- Business relationship;
- current authority / membership state where appropriate;
- concise current assignment context when useful.

Example:

**Mike Rodriguez**  
Lead Carpenter  
3 active assignments

Example:

**Carlos Hernandez**  
HVAC · Outside Trade Partner  
Spring Lake Residence

The screen should not expose unrelated personal information simply because the person is on the roster.

---

# 7. Search Team

**Search Team** searches only the Business operating roster available to the current person.

Search may match:

- name;
- title / position;
- trade;
- relationship type;
- relevant Property / assignment context where permitted.

Search does not expand permissions.

---

# 8. Person Action Card

Tapping a Team member opens a compact **Person Action Card** rather than immediately navigating away from the Team screen.

Depending on relationship and permission, actions may include:

- **View Profile / Entity**;
- **Assigned Work**;
- **Message**;
- **Call**;
- **Email**;
- relevant Property / job relationships.

For authorized Owners / Managers, internal Business members may additionally expose controls for:

- Business authority;
- role / operating title;
- assignment responsibility;
- membership state.

Subcontractors / Outside Trade Partners do **not** receive internal Business-member authority controls.

---

# 9. Assigned Work

Assigned Work is a shortcut into the same underlying Business Work records.

Example:

Tapping **Assigned Work** for Mike filters or opens Business Work to the Work currently assigned to Mike.

This does not create a separate worker-specific Work datastore.

**Team identifies who is operating. Work identifies what they are responsible for.**

---

# 10. Add / Invite

Authorized people can use **+ Add / Invite** to bring someone into the appropriate Business relationship.

The flow should first establish what kind of relationship is being created rather than treating every person as the same kind of Business member.

Useful relationship choices include:

- internal Business member;
- Trade Team Member;
- Subcontractor / Outside Trade Partner.

The invitation flow should collect only the information necessary to establish the relationship and authority.

Detailed profile information can be completed later.

---

# 11. Pending Invitations

Pending invitations should appear in a separate compact area, normally below the active roster or behind a simple **Pending** control.

A pending row may show:

- invited person / email / phone as available;
- intended relationship;
- invited by;
- invitation date;
- resend / cancel controls when authorized.

Pending invitations should not look like active Team members before they accept.

---

# 12. Authority vs Role

Team must preserve the Roundhouse distinction between **Role** and **authority**.

A person's base Role describes the kind of participant they are.

Authority describes what they are permitted to do within this Business.

Examples of authority may include:

- Owner;
- Manager;
- limited operational authority.

These should not be confused with separate base roles.

The Team screen can surface authority where useful without turning every row into a permissions matrix.

---

# 13. Subcontractors / Outside Trade Partners

Subcontractors and outside trade partners remain visible because they are legitimately part of how the Business gets work done.

Their Team presentation should make the outside relationship clear.

They may have:

- assigned Work;
- relevant Property access;
- Mail communication;
- contact actions;
- limited visibility into the Work they are authorized to perform.

They do not automatically gain:

- internal Business administration;
- unrelated team visibility;
- unrelated Property access;
- company-wide private information.

---

# 14. Relationship to Properties

A Team member may have legitimate relationships to one or more Properties through assigned Work or Business participation.

The Person Action Card may show relevant Properties / jobs.

Tapping a Property follows the established Property doorway rather than creating a new Team-specific Property screen.

---

# 15. Relationship to Mail

Team offers convenient Message / Call / Email actions, but it does not become a communication system.

**Team = roster and operating relationships.**  
**Mail = communication.**

Message opens the same Roundhouse Mail system in the appropriate context.

---

# 16. Relationship to Calendar

Team may surface assignment context, but it should not display another person's full private schedule.

Business scheduling and dispatch remain governed by Calendar.

Where authority permits, a manager can reach relevant scheduled Work through the Work / Calendar relationship rather than through a private-person calendar view embedded inside Team.

---

# 17. Permissions

Team is permission-aware.

Examples:

- Owners / Managers may see and manage broader Business roster information according to authority;
- Trade Team Members see only roster information legitimately available to them;
- Outside Trade Partners see only the people / contacts necessary for their authorized Business relationship;
- Viewers remain view-only when Team visibility is permitted.

Being a Team member does not automatically expose every other participant's private information.

---

# 18. Visual Direction

Team should feel like a clean, approachable operating roster.

Visual priorities:

- icon-first right-edge control;
- no businessman / corporate stereotype;
- compact connected-crew icon direction;
- simple roster groups;
- generous Avatar recognition;
- name and relationship first;
- minimal secondary metadata;
- Person Action Card instead of immediate navigation;
- pending invitations visibly separate from active members;
- no dense HR tables;
- no org-chart hierarchy unless future requirements genuinely need one.

The screen should answer **who operates through this Business** within seconds.

---

## Governing Relationship

**Team = the Business operating roster.**  
**People = the broader Business relationship network.**  
**Work = what the Team is responsible for.**  
**Mail = how people communicate.**

---

## Governing Rule

**Team shows the people who belong to or actively operate with the Business, using an icon-first connected-crew identity rather than a businessman metaphor. It remains a lightweight operating roster, while broader relationships stay in People and responsibility stays in Work.**

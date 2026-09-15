# ROUNDHOUSE — SOURCE OF TRUTH

Round House transforms the way work is documented, making it effortless, engaging, and fun.

Built for those who Build- Contractors, homeowners, and businesses track, showcase and record projects in real-time, turning progress into a living history.

Designed to strengthen the relationship between the client and provider by gamifying professionalism and accountability, ensuring every milestone is captured and rewarded.

More than a tool, it creates a lasting, transferable record of work that evolves with every inspiration, every contribution- Round House carefully pieces together the larger narrative.

*original website copy*

## Purpose

This document defines the fundamental architecture, language, and core value of Roundhouse. It is the governing reference for what Roundhouse is and how its primary objects relate.

Detailed rules for ownership, permissions, records, invitations, pathways, gamification, subscriptions, and advertising belong in their respective governing documents.

The Entity model is defined in **`ROUNDHOUSE_ENTITY_MODEL.md`**. Exact Role titles, authority, and subscription eligibility are defined in **`ROUNDHOUSE_ROLES_AND_PERMISSIONS.md`**, titled **Roles & Authority**. Intake screens and navigation are defined in **`screens/01_ROUNDHOUSE_INTAKE_SCREENS.md`**.

## Core Value

Roundhouse is a grassroots platform built to serve local communities.

At its center is the relationship between the **Homeowner** and the **Trade Professional** and the work they do together.

Roundhouse is designed to encourage good communication, proper documentation, accountability, and best business practices between the people caring for a Property and the people performing the work.

For the Homeowner, Roundhouse provides a permanent record of the home—its work, repairs, improvements, materials, photos, decisions, and history.

For the Trade Professional, that same work builds a lasting portfolio record of the work they actually performed and contributed over time.

The Property record and the Trade Professional's work history are connected by the work while remaining independent records that can survive changes in ownership, employment, Businesses, and relationships.

Roundhouse is intended to strengthen local relationships between Homeowners, trades, workers, suppliers, and Businesses serving the communities where they live and work.

## 1. People and Entities

Roundhouse has **People and Entities**.

A **Person** is a real human with one permanent personal account.

An **Entity** is a Property, Business, or History that exists in RoundHouse.

There are three Entity types:

- **Property** — Residential or Commercial.
- **Business** — Trade Professional or Supplier.
- **History** — private to the person whose activity created the history inside it.

A person connects to an Entity and has a Role within that Entity.

**People connect through Entities. No communication, documentation, or operational activity happens outside an Entity.**

Invitations establish legitimate Entity participation.

The app uses Property, Home, Business, Facility, or History in customer-facing language. Entity is the internal architecture term.

## 2. Acting Identity

A Person can participate in Roundhouse in different capacities.

Before creating operational activity, Roundhouse must know:

**Who is acting, and within what Entity?**

The operating relationship is:

**Person → Acting Identity → Entity → Record**

Authentication identifies the human. Role, authority, permission, and authorship come from the person's actual participation in the selected Entity.

A new account completes its first legitimate Property or Business relationship before entering the Command Center. Until that connection is complete, sign-in resumes intake with the person's saved information.

The person's private History is created after that first successful connection. They access History in the Viewer Role. History remains available alongside their other connections and after those connections end.

## 3. Roles

RoundHouse has four top-level Role categories:

1. **Property**
2. **Trade**
3. **Supplier**
4. **History Viewer**

Each category uses the exact sub-role titles in **`ROUNDHOUSE_ROLES_AND_PERMISSIONS.md`**. A Role exists within its Entity relationship.

### Viewer

Viewer access is specific to its context.

In a Residential Property, the title is **Home (Viewer)**. Viewing also applies to Commercial Facilities through the governing Property relationship. The Viewer sees what is shared with them and may message within the permitted Property context, use Share RoundHouse, and search for or establish another Property or Business connection.

In the person's private **History**, the Role is **History Viewer**. Only the person tied to that History can access it. History displays their combined contributions; its active functions are Share RoundHouse and the search, connection, and setup paths for Properties and Businesses. New documentation, messages, Work, and scheduling take place in the applicable Property or Business context.

Viewer participation does not earn points, badges, or status progression. Access to one's own History is available with a paid or unpaid account.

### Pro Designations

**Pro identifies paid status; the title also identifies the person's position.**

Examples include **Home Pro (Owner)**, **Home Pro (Manager)**, **Home Pro (Teammate)**, **Trade Pro (Owner)**, **Trade Pro (Lead)**, **Trade Pro (Owner – Lead)**, **Trade Pro (Manager – Lead)**, and the corresponding Supplier titles.

Standard unpaid titles are **Homeowner**, **Trade Professional**, and **Supplier**. **Home Admin**, **Trade Admin**, and **Supplier Admin** require paid access and retain those titles without an additional Pro label.

Use the parentheses and en dash in combined positions exactly as specified by Roles & Authority.

### Authority

Owner, Manager, Lead, and Admin authority is determined by the current sub-role and authorized scope. Lead applies to Trade and Supplier participation. Ownership and day-to-day responsibility are recorded separately where they differ.

A change in Role, authority, or subscription affects current and future access while preserving prior contributions and their original attribution.

## 4. Property

A Property exists independently of the person who owns it, creates its Roundhouse profile, manages it, or performs work there.

A person may establish a Property for legitimate work before its Owner joins, using the creation and authority rules in the governing documents.

Ownership, stewardship, access, and participation may change while the Property and its history remain.

There should be **one Roundhouse Property for one real-world Property**.

## 5. Business

A Business is an Entity with its own persistent identity, participants, history, records, resources, and relationships.

The people who own, manage, work for, or work with a Business may change without creating a new Business Entity or erasing its history.

A Business is not simply a person's profile operating under a company name.

## 6. Participation and Access

People participate in Entities through Roles, authority, and permissions.

These determine what someone may do or see within an Entity and can be granted, changed, delegated, or removed without changing the underlying identity of the Person or Entity.

### Paid-Party Rule

For people-to-people interaction, organization, or coordination inside a Property, Business, or Facility, **at least one party to the relationship must have a paid subscription**. That may be the participating person or the person who owns or controls the Property, Business, or Facility.

Subscription eligibility and authorization are checked separately. Paid status alone does not grant ownership or access to another person's records.

A free account may create **one Property and one Business**. Additional creation opens the relevant **Add Pro** path. Search and connection to existing Properties and Businesses remain available under the governing access rules.

### Permission Source

Every active permission must have an identifiable source so Roundhouse can answer:

**Who authorized this access, under what authority, through what relationship, and is that source still valid?**

Permission sources may include:

- direct Property Owner authorization;
- delegated Property Manager authorization;
- Business-derived assignment;
- authorized Property administration;
- a Viewer invitation to a specific Property;
- independent direct Property relationship;
- another explicit governing authorization.

A permission source may end without erasing history.

## 7. Invitations

Roundhouse uses one governing invitation / participation system.

The Invitation Center is the central place for:

- invitations received;
- invitations sent;
- access requests;
- pending approvals;
- Share Roundhouse;
- Entity / Role context;
- current status.

A Business brings its own accepted subcontractors / outside Trade participants forward to a Property rather than asking those people to independently negotiate access with the Homeowner.

For a claimed Property, participant access normally requires Owner approval unless the Owner has explicitly delegated Manager authority that includes participant management.

For an Unclaimed Property legitimately administered for work, the authorized Admin may establish necessary participant access within the applicable subscription and permission scope.

Full behavior is governed by **`screens/33_INVITATIONS.md`**.

## 8. Delegated Manager Authority

A Property Owner may explicitly delegate Manager authority within the governing subscription rules without transferring ownership.

Where that authority includes **participant management**, the authorized Manager may approve appropriate Business participants into the Property on the Owner's behalf.

The Owner receives an informational Notification instead of a redundant approval task.

The Record permanently preserves who exercised the authority, what scope allowed it, and which Business / participant relationship was involved.

Removing or narrowing Manager authority stops future actions outside the remaining scope.

## 9. Business-Derived Property Access

A participant may receive Property access because they are working through a Business.

That access is **Business-derived** and must retain its Business source.

If the governing Business relationship ends, Roundhouse automatically removes current Property permissions that depend solely on that relationship.

The Homeowner does not have to manually clean up the Business's former participant.

This does not erase legitimate Work, CAPTURE evidence, communications, Resolution history, Timeline Records, or attribution.

### Independent Property Access

A Homeowner and Trade participant may later establish a separate direct Property relationship.

That independent authorization has its own permission source and is not destroyed merely because a former Business-derived relationship ends.

Roundhouse revokes the permission source that ended without erasing another legitimate source that remains.

## 10. Records and Attribution

Operational activity belongs to the Roundhouse Record system, is connected to the legitimate Entity context in which it occurred, and remains attributable to the Person and Acting Identity that created it.

This includes Work, photos, notes, tasks, materials, receipts, approvals, communications, participant decisions, and other Timeline activity.

A Record does **not** become a separate stored copy merely because it appears in a Property, Business, History, or Command Center view. Roundhouse stores the canonical Record once and projects that same Record into each authorized context.

For example, one Work Record may simultaneously appear as:

- a Work Card in **Property → Work** because the work concerns that Property;
- the same Work Card in **Business → Work** because the Business is responsible for or participated in that work;
- the same Work Card in the participating person's **History** and appropriate Command Center view because that person is assigned to or historically attributed to it.

Those views point to the same underlying Record ID. Updating the canonical Record updates every authorized projection; no synchronization between copies is required.

Photos and files follow the same principle. They retain author / uploader provenance and legitimate Entity / Work relationships without becoming separate media copies owned by each account that can see them.

A Record does not lose its original authorship or authority context because ownership, employment, Business participation, management, or access later changes.

## 11. Ownership, Control and Creation

These are separate concepts:

**Real-world ownership · Roundhouse control/stewardship · Role · authority · permission · access · leadership · authorship · record authority**

Creating a Property or Business does not automatically establish real-world ownership.

Roundhouse allows ownership, control, participation, and permissions to change without destroying the Entity or its existing history. Ownership claims and transfers follow **`ROUNDHOUSE_OWNERSHIP_AND_RECORD_AUTHORITY.md`** and the account limits in Roles & Authority.

## 12. Roundhouse History

Roundhouse preserves what happened over time: who participated, what work occurred, what was documented, who approved access, and in what capacity each person was acting.

Current Roles, ownership, permissions, Business relationships, and membership may change.

The private History Entity combines the person's legitimate contributions across past and present Properties and Businesses. Losing all current Property and Business connections leaves that History available. Its visibility does not reopen the former workspaces or expose activity the person is not entitled to see.

History behavior is defined in **`../HISTORY_ENTITY_LOGIC.md`**.

## 13. Record Portability

Roundhouse must not hold legitimate records hostage to continued use of the service.

A Person or Entity leaving Roundhouse must have a path to export the records they are legitimately entitled to retain. The intended portable form is a standard **ZIP archive** containing original files plus sufficient structured and human-readable metadata for the archive to remain useful outside Roundhouse.

Export preserves existing record and visibility rights; it does not create new permission to publish or expose information that was private inside Roundhouse.

The detailed export workflow may be implemented after the MVP work surfaces, but the core data model must not prevent portable exit or a future service wind-down export.

Detailed Work-card and portability behavior is governed by **`screens/34_WORK_RECORD_CARDS_AND_PORTABILITY.md`**.

## Governing Rule

**RoundHouse follows Person → Acting Identity → Entity → Record. Property, Business, and History are the three Entity types. Current Role titles and authority follow Roles & Authority. Records are stored once and displayed in authorized contexts with original attribution preserved. Initial intake requires a successful Property or Business connection before Command Center entry and History creation. Shared people-to-people activity requires at least one paid party and the appropriate authorization. Business-derived access ends with its governing relationship, while legitimate history and independent authorizations remain.**

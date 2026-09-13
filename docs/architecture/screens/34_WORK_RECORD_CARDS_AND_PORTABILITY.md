# Roundhouse Work Record Cards and Portability

## Purpose

This document defines how one Roundhouse **Work Record** can appear as a compact Work Card in several legitimate views without duplicating the underlying data.

It also records the governing portability rule for users or Entities that leave Roundhouse.

---

# 1. One Record, Multiple Views

A Work Order / Work Record is stored once in Roundhouse.

It does **not** belong exclusively to the Trade Professional's account, the Business Entity, or the Property Entity merely because it is visible there.

Instead, the canonical Work Record exists in the Roundhouse data layer with durable relationships to the relevant:

- Property;
- Business when applicable;
- creator / requester;
- assignee / worker;
- Acting Identity;
- Asset when applicable;
- CAPTURE evidence;
- photos / files;
- Estimate / Invoice / Calendar / Resolution relationships when applicable.

The same Work Record can then be projected into different authorized views.

**Property Entity → Work** answers:

**What work happened or needs to happen at this Property?**

**Business Entity → Work** answers:

**What work is this Business responsible for across Properties?**

**Personal Command Center / Work history** answers:

**What Work Records am I responsible for or historically attributed to?**

These are different projections of the same Record ID, not synchronized copies.

---

# 2. Shared Work Card

Roundhouse uses one compact Work Card presentation contract for the same Work Record across contexts.

The card may display:

- Work title;
- current lifecycle state;
- due date when useful;
- Property context when the viewer is not already inside that Property;
- assignee when useful;
- related Asset when useful;
- priority / category when meaningful;
- photo / comment indicators when useful.

The surrounding context controls emphasis rather than creating a different record type.

### Property context

Inside **Property → Work**, the Property is already known, so the card can emphasize:

- title;
- assignee;
- Asset / area;
- due date;
- state.

### Business context

Inside **Business → Work**, Property identity becomes prominent because the Business is looking across multiple Properties.

### Personal context

Inside a person's Command Center / work history, the card emphasizes:

- Property;
- Work title;
- current state;
- the person's assignment / attribution;
- Business context when useful.

Tapping any projection opens the same underlying Work Record.

---

# 3. No Redundant Storage

A Work Card is a **view**, not another stored Work Order.

Roundhouse must not create separate Property, Business, and personal copies that later need synchronization.

Status changes, evidence, comments, photos, assignment, verification, and other legitimate updates occur on the canonical Work Record and become visible everywhere that Record is authorized to appear.

This follows the governing Roundhouse rule:

**The Entity is a context for the Record. The Command Center is a working view of Records relevant to the person. Neither requires a duplicate copy.**

---

# 4. Granular Work Records

A Work Record may be deliberately granular when that creates useful Property history.

Examples:

- Replace kitchen faucet;
- Replace failed GFCI;
- Repair sticking rear door;
- Replace water heater;
- Patch and paint ceiling damage.

A larger visit, service call, job, or project may contain several Work Records.

This lets a later user retrieve one specific repair without searching through a receipt, invoice, Daily Grind list, or unrelated project notes.

Granularity must not create duplicate administrative entry. Workers should not have to enter the same information twice simply because the Work Record appears in several views.

---

# 5. Daily Grind Relationship

Daily Grind remains a person's lightweight working plan.

**Assigned Work can surface automatically in Daily Grind.**

A lightweight Daily Grind task may be promoted / converted into a durable Work Record when it represents a real repair, installation, service, correction, or other Property outcome.

Roundhouse should not automatically convert every completed task into Work because many tasks are merely steps such as:

- call client;
- pick up materials;
- measure opening;
- clean up;
- send photo.

The governing relationship is:

**Work can feed Daily Grind automatically. Daily Grind can create Work deliberately without duplicate entry.**

---

# 6. Photos and Evidence

Photos and files retain authorship / uploader provenance but are not treated as private property of either the worker's account or the Property account simply because they appear there.

A photo can remain attached to the legitimate historical Work Record even after employment, membership, or account relationships change.

The same underlying photo may appear through:

- Property history;
- Work Detail;
- Business work history;
- the attributed worker's legitimate personal work history.

This does not require duplicate media objects.

**Authorship and persistence do not automatically grant public-use permission.**

Interior or otherwise private Property imagery may remain legitimate historical evidence while public portfolio use is separately controlled by the appropriate Property authority and governing visibility rules.

---

# 7. Record Portability / Exit Package

Roundhouse must not make legitimate records inaccessible merely because a person or Entity stops using the service.

A future **Export / Exit Package** should be downloadable as a standard **ZIP archive** containing the records the requester is legitimately entitled to retain.

Where practical, the package should contain:

- original photos / files;
- Work Records and Work history;
- relevant Asset / Property records according to permission;
- receipts / invoices / documents according to entitlement;
- timestamps and authorship / attribution metadata;
- a structured manifest suitable for later import or archival use;
- a simple human-readable index so the archive remains useful without Roundhouse.

An export preserves legitimate records. It does not create new visibility or publication rights that the requester did not already possess.

If Roundhouse service were ever discontinued, the product should provide a reasonable wind-down period in which users can retrieve their entitled records in this portable form.

The detailed export implementation is **not an MVP Work-screen requirement**, but the data architecture must not prevent it.

---

## Governing Rule

**A Work Record exists once in Roundhouse and may be projected as the same Work Card into Property, Business, and personal views according to permission and attribution. Photos and evidence retain provenance without being duplicated between accounts. Roundhouse must preserve a path for entitled users and Entities to export their legitimate records in a portable ZIP archive rather than locking those records inside the service.**

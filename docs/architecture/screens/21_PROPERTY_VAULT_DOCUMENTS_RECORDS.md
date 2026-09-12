# Roundhouse Property Vault — Documents & Permanent Records

## Purpose

**Documents** is the durable file-retrieval section inside the Property Vault.

Its clear home is:

**Property Entity → Vault → Documents**

Documents answers:

**What file or formal record belongs to this Property, and where can an authorized person reliably retrieve it later?**

Documents is not a separate top-level Property destination, not a Command Center button, and not a duplicate archive detached from the work or Asset that produced the file.

The underlying document remains one durable Property record even when it is discoverable from several legitimate contexts.

---

# 1. Location Inside Vault

Vault's primary internal sections are:

1. **Specs**
2. **Assets & Equipment**
3. **Documents**
4. **Property History / Records**

Documents is the third internal Vault section.

The governing path is:

**Property Entity → Vault → Documents**

A file may also be reachable from an Asset, Work item, Maintenance record, Estimate / Invoice, Timeline event, or Handoff when that relationship is legitimate, but those pathways point to the same underlying document rather than creating copies.

---

# 2. Documents Screen

The Documents screen should feel like a clean Property filing cabinet rather than a generic cloud-drive browser.

At the top:

**Documents**  
Property name beneath it  
**Search Documents**                 **+ Add**

The Add control appears only when the current person has authority to add durable Property records.

Search remains Property-scoped and permission-aware.

---

# 3. Document Categories

A compact category filter can include:

**All | Warranties & Manuals | Property & Legal | Inspections & Reports | Permits & Plans | Receipts & Installations | Disclaimers | Other**

The categories are retrieval aids, not rigid record types. Roundhouse may refine or expand them without changing the underlying document model.

Examples include:

### Warranties & Manuals

- manufacturer warranty
- owner's manual
- installation manual
- product data sheet
- service bulletin

### Property & Legal

- survey
- easement
- title-related Property document where appropriate
- HOA / Property-specific governing document
- other durable Property legal material

### Inspections & Reports

- home inspection
- water report
- soil report
- engineering report
- environmental report
- specialty inspection

### Permits & Plans

- permit
- approved drawing
- plan set
- site plan
- inspection approval connected to a permit

### Receipts & Installations

- major equipment purchase receipt
- installation invoice
- proof of purchase
- commissioning / startup record

Routine worker receipts remain governed by the receipt / financial workflow unless deliberately promoted into durable Property documentation.

### Disclaimers

- accepted condition disclaimer
- risk acknowledgment
- other persistent disclosure materially connected to Property work or condition

---

# 4. Document Cards

Documents appear as compact cards or rows optimized for quick recognition.

A card may show:

- file-type / preview thumbnail
- document title
- category
- date
- related Asset / area / Work item when useful
- status when the document has been superseded or archived

Example:

**HVAC Warranty — Trane XR15**  
Warranty & Manual  
Outdoor Unit · Added Sept. 3, 2025

Example:

**2024 Property Survey**  
Property & Legal  
Survey · Recorded May 18, 2024

Example:

**Foundation Inspection Report**  
Inspection & Report  
Engineer report · Jan. 12, 2026

The list should prioritize recognizable document titles rather than exposing storage filenames as the primary label.

---

# 5. Add Document

An authorized person can add a document by selecting or capturing an appropriate file.

The Add flow should collect only useful durable metadata, such as:

- title
- category
- date / effective date when relevant
- optional description / note
- related Asset
- related Work / Maintenance / Record
- issuer / provider when useful
- visibility / restriction where required

The product should not force every field for every file.

When a document already exists as an attachment to a legitimate Work, CAPTURE, Asset, Estimate / Invoice, or other Record, promoting it into durable Property Documents should link the existing file / Record rather than silently creating another independent copy.

---

# 6. Document Detail

Tapping a document opens **Document Detail** inside the Property Vault.

The screen may show:

- document preview
- title
- category
- document / effective date
- issuer / provider
- description / notes
- related Property area
- related Asset
- related Work, Maintenance, Estimate / Invoice, or other Record
- added by / added date
- current visibility / access treatment
- lifecycle status when applicable

Available actions depend on authority and file type, but may include:

- View
- Share through an authorized Roundhouse pathway
- Download / export where product policy permits
- Edit metadata
- Replace with newer version
- Mark superseded
- Link to an Asset / Record

The screen should not encourage destructive deletion of legitimate history merely because a newer file exists.

---

# 7. One Document, Multiple Legitimate Pathways

This is a governing rule.

A manual attached to an HVAC Asset may be visible through:

**Vault → Documents**

and:

**Vault → Assets & Equipment → HVAC Unit → Documents**

It remains one underlying document.

Likewise, an inspection report created during Work may appear from:

- the Work Record;
- Property Timeline / History;
- Vault → Documents;
- a related Asset if appropriate.

Do not create duplicate documents merely to make them visible from multiple places.

---

# 8. Relationship to Property History / Records

**Documents** and **Property History / Records** serve different retrieval needs.

Documents answers:

**Where is the file?**

Property History / Records answers:

**What happened?**

A document can belong to a historical event without becoming a second event.

Example:

**Event:** Water heater replaced on March 4.  
**Documents:** installation invoice, warranty, product manual.  
**Asset:** new water heater service passport.

All can reference the same underlying Records and files.

---

# 9. Relationship to Assets

Asset-specific documents should remain linked to that Asset.

Examples:

- warranty
- manual
- installation record
- service bulletin
- inspection report

They are discoverable from both the Asset Detail Documents section and Vault → Documents according to permission.

The Asset remains the strongest context when the file belongs primarily to one piece of equipment.

---

# 10. Relationship to Work and CAPTURE

Work identifies and organizes the job. CAPTURE documents the real work session.

A file produced during work can become a durable Property Document when it has lasting Property value.

Examples:

- permit closeout
- inspection certificate
- commissioning report
- signed installation document
- durable warranty

Ordinary transient work attachments do not automatically clutter Vault Documents.

The distinction is deliberate:

**Work attachment = useful to the job.**  
**Property Document = worth preserving as part of the Property's permanent information.**

---

# 11. Disclaimers

Accepted Disclaimers are persistent Property Records.

When a Disclaimer remains materially relevant to authorized work, it cannot simply be hidden from an authorized Trade Professional whose work may be affected by it.

A later Record may resolve, supersede, or materially change the underlying condition, but the historical Disclaimer remains preserved.

A Disclaimer may therefore carry:

- accepted date
- accepting party / parties
- related condition / area / Asset
- related Work or Record
- current relevance state
- superseding / resolving Record when applicable

The UI should clearly distinguish **historical preservation** from **currently active warning** so old disclaimers do not create permanent false alarms.

---

# 12. Versioning and Superseded Documents

Some documents naturally receive newer versions.

Examples:

- updated survey
- renewed warranty documentation
- revised plan set
- replacement insurance / inspection material where relevant

Roundhouse should preserve the older legitimate document while allowing a newer document to become the current reference.

Useful lifecycle treatment may include:

- **Current**
- **Superseded**
- **Archived**

Superseded does not mean deleted.

Where a new file replaces an older reference, Document Detail should make that relationship visible.

---

# 13. Search

**Search Documents** searches only documents available to the current person at the current Property.

Search can match useful information such as:

- title
- category
- issuer
- Asset name
- Work / project name
- document date
- useful metadata / notes

Examples:

`survey`  
`Trane warranty`  
`foundation inspection`  
`permit`  
`water report`

Vault-wide Search may also return Documents alongside Specs, Assets, and Records without changing the underlying location of the file.

---

# 14. Permissions and Privacy

Documents remain subject to Property authority, Role, relationship, privacy, and Record visibility.

A file being stored with the Property does not make it visible to every Property participant.

Examples:

- Homeowners / authorized Property authorities may manage broad Property documentation.
- Trade Professionals should receive documents materially necessary for authorized work when permitted.
- Trade Team Members see what their legitimate work and permissions require.
- Viewers remain view-only and see only permitted records.
- sensitive legal, access, or private information may require narrower permission.
- private internal Business records do not become homeowner-visible merely because they concern the same Property.

Visibility changes do not erase the underlying legitimate Record.

---

# 15. Property Handoff

Handoff may surface documents that a newly authorized person genuinely needs to become oriented.

Examples:

- relevant plans
- important inspection report
- Asset manual
- materially relevant Disclaimer

Handoff links to the existing Vault Document. It does not create a handoff copy.

---

# 16. Persistence Through Property Changes

Durable Property Documents remain with the Property record through legitimate changes in:

- Homeowner
- Trade Professional
- Trade Team Member
- service provider
- other participants

Access may change. The underlying Property history does not disappear simply because the people involved change.

This follows the governing Roundhouse Record rule: legitimate history is preserved, while visibility and access are permission-dependent.

---

## Governing Rule

**Vault → Documents is the Property's durable filing cabinet. Files stay connected to the Asset, Work, condition, or event that gave them meaning, while Documents provides one predictable place to retrieve them without creating duplicate copies.**

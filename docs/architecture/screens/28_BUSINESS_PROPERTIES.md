# Roundhouse Business Properties

## Purpose

**Properties** is the third right-edge working screen inside the Business Entity.

Its home is:

**Business Entity → Properties**

It answers:

**Where is this Business legitimately authorized to work?**

Business Properties is not the Business owner's personal Property list, not a lead list, and not every Property the Business has ever heard about.

A Property appears here because the Business has a legitimate Property relationship that grants current operational access.

---

# 1. Position Inside the Business Entity

The Business Entity right-edge order remains:

1. **Work**
2. **Team**
3. **Properties**
4. **Vault**

The visible label is **Properties**.

The right-edge control should ultimately be icon-first. The word **Properties** remains the governing label for accessibility, tooltips, expanded states, and documentation.

---

# 2. Properties Icon Direction

The Properties icon should communicate **multiple places the Business works**, not navigation.

Preferred direction:

- two or three simple roofline / Property silhouettes;
- slightly staggered or grouped;
- compact enough for the right rail;
- visually distinct from a single Property identity icon;
- no generic map pin as the primary symbol.

A map pin implies navigation. **Properties** represents the Business's authorized Property relationships.

---

# 3. Governing Property Eligibility

A Property appears in Business → Properties only when the Business has a legitimate current relationship to that Property.

Examples may include:

- owner-authorized service relationship;
- active or accepted Work;
- ongoing maintenance responsibility;
- authorized Property participation;
- legitimate Business-created Property awaiting owner claim;
- another explicit permission path recognized by Roundhouse.

A past lead, rejected estimate, imported address, personal contact, or old customer name does not automatically become an active Business Property.

---

# 4. Two Primary Property Sections

The default screen is divided into two distinct sections:

## Owner-Connected

Properties where an owner / homeowner has claimed the Property and the Business has a legitimate authorized relationship to work there.

## Unclaimed

Properties the Business has legitimately created or is operationally maintaining, but no owner has yet claimed the Property in Roundhouse.

The system may internally treat these as Business-managed pending claim, but the visible user-facing label is simply:

**Unclaimed**

This distinction is important enough to remain visible rather than being hidden inside a sort order.

---

# 5. Property Claim State Is Not Work Status

**Owner-Connected** and **Unclaimed** describe the Property's ownership / authority state inside Roundhouse.

They do not describe whether work is active, completed, overdue, or recently visited.

A Property can be Owner-Connected with no current Work.

An Unclaimed Property can have active Work, Maintenance, Documents, Assets, or History.

The two-section structure must not be confused with job status.

---

# 6. Claim Transition

When the legitimate owner claims an Unclaimed Property, Roundhouse does **not** create a new Property.

The same Property Record transitions from:

**Unclaimed → Owner-Connected**

The Property keeps its existing authorized history, including information such as:

- Work;
- CAPTURE evidence;
- Maintenance;
- Assets;
- Specs;
- Documents;
- Property History;
- appropriate Business relationships;
- legitimate existing Timeline records.

Nothing should be duplicated merely because ownership has been claimed.

The claim process may change permissions and visibility, but it does not replace the Property identity.

---

# 7. Business Authority on Unclaimed Properties

An Unclaimed Property does not mean the Business owns the real estate.

It means Roundhouse does not yet have a claimed owner identity governing that Property.

The Business may have enough legitimate authority to create and maintain operational Property records because of its real-world working relationship.

Roundhouse should avoid language that implies legal ownership by the Business.

The Business remains a participating Entity with operational authority appropriate to the relationship until an owner claim establishes or changes Property governance.

---

# 8. Properties Screen

Properties opens as a Business-scoped working sheet over the Business Timeline.

At the top:

**Properties**  
Business name beneath it  
**Search Properties**

Search spans both primary sections.

The default body is:

**Owner-Connected**  
[property cards]

**Unclaimed**  
[property cards]

Each section can collapse when useful while preserving its count.

---

# 9. Default Sorting

Within each section, Properties are sorted by **most recent legitimate Property activity**.

Useful activity may include:

- recent Work;
- current or upcoming appointment;
- CAPTURE session;
- Property record update;
- Maintenance activity;
- legitimate Business interaction tied to that Property.

Recency is a sorting rule inside each ownership section, not a replacement for the two-section structure.

---

# 10. Property Cards

Each Property card should remain compact and easy to scan.

A card may show:

- representative Property photo;
- Property name;
- address;
- owner / homeowner identity when permitted and useful;
- claim state when needed;
- small current Work / attention indicator;
- recent activity cue where useful.

Example:

**Spring Lake Residence**  
110 Dripping Springs  
Owner: Sarah Miller  
2 active Work items

Example:

**Canyon Ridge House**  
214 Canyon Ridge  
**Unclaimed**  
Last worked Sept. 10

The card should not become a duplicate Work dashboard.

---

# 11. Property Action Card

Tapping a Property opens the established compact Property Action Card.

Primary actions:

- **Enter Property**
- **Navigate** when an authorized usable address exists

Additional contextual actions may appear only when genuinely useful and permitted.

**Enter Property** opens the Property Entity.

**Navigate** uses the physical address.

These remain distinct actions.

---

# 12. Search

**Search Properties** searches both Owner-Connected and Unclaimed Properties available to the current person through the Business.

Search may match:

- Property name;
- address;
- owner / homeowner where permitted;
- Work title where useful;
- Property identifier;
- Asset or other contextual terms where useful.

Search results should preserve the Property's claim state so the user can still tell whether the Property is Owner-Connected or Unclaimed.

---

# 13. Relationship to Business Work

Business Properties answers:

**Where does this Business have authorized Property relationships?**

Business Work answers:

**What does this Business have on its plate across those Properties?**

A Property card may show a small active-Work count or attention indicator, but detailed Work belongs in **Business Entity → Work**.

Tapping Work-related context should reference the same underlying Work records.

---

# 14. Relationship to People

A Property may connect the Business to owners, homeowners, occupants, Property contacts, or other legitimate people.

Those broader relationships belong in **People**.

Properties should show only enough person context to identify or operate at the Property.

It should not become a duplicate client directory.

---

# 15. Relationship to Property Entity

Business Properties is a doorway, not a substitute for the Property Entity.

Entering a Property narrows the operating scope to that Property and opens its own:

- Property Timeline;
- Work;
- Tasks / Lists;
- Maintenance;
- Vault;
- Property-scoped bottom tools.

The Business does not receive broader Property visibility merely by entering it. All Property permissions still apply.

---

# 16. Inactive / Historical Business Relationships

When a Business no longer has an active operational relationship to a Property, that Property should not remain mixed into the active Properties screen indefinitely.

Historical Business records may remain legitimately retrievable according to record-retention and permission rules.

Future UI may provide an **Inactive / Past** filter or historical retrieval path if needed.

Ending active authorization does not erase legitimate historical Business records.

---

# 17. Permissions

Business Properties is permission-aware.

Examples:

- Owners / Managers may see the Business's authorized Properties according to authority;
- Trade Team Members may see only Properties relevant to their permitted Business participation;
- Outside Trade Partners see only Properties legitimately shared or assigned to them;
- Viewers remain view-only where permitted.

A Business relationship to one Property does not imply access to another Property.

---

# 18. Visual Direction

Properties should feel like a clean portfolio of authorized jobsites, not a CRM and not a map application.

Visual priorities:

- icon-first grouped-roofline control;
- one Search bar across both sections;
- clear **Owner-Connected** and **Unclaimed** separation;
- most-recently-active sorting within each section;
- compact photo-led Property cards;
- minimal Work indicators;
- clear claim-state language;
- no duplicate Work dashboard;
- no legal-ownership implication for Business-managed Unclaimed Properties.

The user should be able to understand immediately which Properties are owner-governed and which are still awaiting owner claim.

---

## Governing Relationship

**Owner-Connected = the Property has a claimed owner and the Business is authorized to participate.**  
**Unclaimed = the Business has a legitimate operational Property relationship but no owner has yet claimed the Property in Roundhouse.**  
**Business Work = what needs doing across those Properties.**  
**Property Entity = the operating and permanent record for one Property.**

---

## Governing Rule

**Business Properties shows only Properties where the Business has a legitimate current operational relationship. It separates Owner-Connected Properties from Unclaimed Properties, sorts each section by recent activity, and preserves the same Property Record when an owner eventually claims an Unclaimed Property.**

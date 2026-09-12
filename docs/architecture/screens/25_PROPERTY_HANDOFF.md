# Roundhouse Property Handoff

## Purpose

**Property Handoff** is a focused, permission-aware briefing that helps an authorized person quickly understand a Property before or as they begin working there.

It answers:

**What do I need to know about this Property right now?**

Handoff does **not** create a second copy of Property knowledge.

It assembles current information from the Property's existing Specs, Assets, Documents, Work, Maintenance, Standards, Property History, People relationships, and deliberately shared notes.

**Vault contains the truth. Handoff assembles the truth for the person who needs to get oriented.**

---

# 1. Exact Location

Property Handoff has one permanent home:

**Property Entity → Vault → Handoff**

On the Vault home screen, **Handoff** is a persistent secondary action in the Vault header area alongside **Search Vault**.

It is **not** a fifth Vault section.

The four primary Vault sections remain:

1. **Specs**
2. **Assets & Equipment**
3. **Documents**
4. **Property History / Records**

Handoff is an assembled briefing generated from those systems and other authorized current Property context.

The Property Entity right-edge tabs therefore remain unchanged:

**Work | Tasks / Lists | Maintenance | Vault**

---

# 2. First-Entry Handoff Prompt

When a person has newly received legitimate access to a Property, Roundhouse may surface a compact prompt when they first enter the Property Entity:

**Property Handoff available**  
A quick briefing before you begin.

Actions:

**Open Handoff**  
**Not Now**

The prompt should not hijack every Property entry and should not permanently block access to the Property.

After the person has opened or dismissed the prompt, Handoff remains available from its permanent home:

**Property Entity → Vault → Handoff**

If materially relevant information changes later, Roundhouse may show a subtle **Updated** state on the Handoff action rather than repeatedly forcing the briefing open.

---

# 3. Handoff Screen

Handoff opens as a focused briefing screen inside the Property Entity.

At the top:

**Property Handoff**  
Property name beneath it

A back control returns to Vault / the Property Entity.

The screen should feel like a concise briefing, not a second dashboard and not a long report.

Only sections that contain useful, permitted information are shown.

---

# 4. Know Before You Start

The first section is:

**Know Before You Start**

This is reserved for information that is materially useful before someone begins work or participates at the Property.

Examples may include:

- active Property-specific warnings;
- materially relevant accepted disclaimers;
- important access instructions the person is permitted to see;
- current unresolved Property conditions relevant to the person's role;
- special homeowner / Property instructions that were deliberately shared;
- important scope or site constraints.

This section should remain concise and high-signal.

Historical information should not remain presented as a current warning after it has been resolved or superseded.

---

# 5. Current Work & Attention

Handoff may show the Work most relevant to the current person.

Examples:

- assigned Work;
- requested Work they are responsible for;
- work scheduled soon;
- Work blocked by a relevant Resolution;
- corrective Work created from Standards drift;
- due Maintenance that has become actionable Work.

This section links to the real Work items in **Property → Work**.

Handoff does not maintain a second Work list.

---

# 6. Key Property Facts

Handoff may surface a small number of useful Specs relevant to the person's role or current Work.

Examples:

- paint / finish information;
- relevant material specifications;
- measurements;
- approved product identifiers;
- permitted access information;
- room / area reference facts.

The section should favor the exact answer a person may need on site rather than presenting the entire Specs library.

Each item links to the underlying Spec in Vault.

---

# 7. Assets & Equipment

Handoff may show Assets that are relevant to the person's current participation.

Examples:

- HVAC equipment being serviced;
- water heater involved in current Work;
- pool equipment tied to Maintenance;
- appliance or controller relevant to the assignment.

A compact Asset row may show:

- Asset name;
- photo where useful;
- location;
- current status;
- model / identifying information where useful;
- relevant maintenance state.

Tapping the Asset opens its existing Asset Detail.

---

# 8. Maintenance & Standards

Handoff may surface only the Maintenance / Standards information the current person needs to understand.

Examples:

- maintenance due soon;
- overdue care relevant to their role;
- Standard drift requiring attention;
- evidence requirement for a Standard they are expected to meet;
- recurring care related to the Asset they are servicing.

Handoff does not become a Maintenance dashboard.

The full system remains in **Property → Maintenance**.

---

# 9. Relevant Documents

Handoff may surface Documents when they are materially useful to orientation or current work.

Examples:

- installation manual;
- warranty;
- inspection report;
- permit closeout;
- engineering report;
- accepted disclaimer;
- plan / drawing relevant to the assignment.

The document remains stored in:

**Property Entity → Vault → Documents**

Handoff only links to it.

---

# 10. Recent Important History

Handoff may show a short selection of recent Property history when it helps explain the current situation.

Examples:

- recent major repair;
- Asset replacement;
- significant inspection;
- recently resolved condition;
- recent Standard drift and correction;
- prior Work directly related to the current assignment.

This section should be selective.

Handoff is not a replacement for **Vault → Property History / Records**.

---

# 11. People / Contacts

Handoff may show people the current person legitimately needs to know for this Property.

Examples:

- Homeowner / Property authority where appropriate;
- Business manager;
- assigned Trade Professional;
- relevant Trade Team Member;
- approved outside trade partner;
- other Property contact necessary to the current role.

Only legitimate contact details and relationships available under current permissions are shown.

Handoff does not become a second People directory.

---

# 12. Role-Aware Assembly

Two people may receive different Handoffs for the same Property.

That is intentional.

A Homeowner may see broad Property context.

A Trade Professional may see information materially relevant to the authorized scope of work.

A Trade Team Member may see the Work, Assets, Specs, Documents, and contacts required for their assignment without gaining unrelated Property access.

A Viewer receives only viewable information already permitted by that relationship.

**Handoff never expands permission. It only assembles information the current person is already authorized to access.**

---

# 13. No Duplicate Handoff Data

Handoff content is assembled live from existing Records and systems.

Roundhouse should not create a second permanent Handoff copy of:

- Specs;
- Assets;
- Documents;
- Work;
- Maintenance;
- Standards;
- Property History;
- People relationships.

A small amount of user-specific Handoff state may be stored, such as:

- first offered date;
- last viewed date;
- dismissed / reviewed state.

That state controls presentation only. It does not copy the underlying Property information.

---

# 14. Changes After Handoff Is Viewed

Because Handoff assembles live Property truth, the briefing naturally reflects current permitted information the next time it is opened.

Roundhouse may indicate that the Handoff has meaningful updates since the person's last review.

It should not automatically treat every minor metadata edit as a reason to interrupt the person again.

High-value changes may include:

- materially relevant new warning;
- significant new assigned Work;
- important Asset change;
- new relevant inspection / report;
- new active Standard drift;
- important access or scope change.

---

# 15. Visual Direction

Handoff should feel calm, concise, and prepared for the person rather than like a database export.

Visual priorities:

- strong Property identity at the top;
- **Know Before You Start** first;
- only relevant sections;
- compact cards / rows;
- clear links into the underlying Property systems;
- no giant all-record dump;
- no duplicated editing tools;
- no fifth right-edge tab;
- no fifth permanent Vault section.

The screen should feel like someone handed the person a clean, current briefing before they began.

---

# 16. Governing Relationships

**Vault = where the Property's durable truth lives.**  
**Handoff = the briefing assembled from that truth.**  
**Work = what needs doing now.**  
**Maintenance = how the Property should continue to be cared for.**  
**Property History = what happened here.**

---

## Governing Rule

**Property Handoff has one permanent home: Property Entity → Vault → Handoff. It is a role-aware briefing assembled from the current Property truth, never a duplicate store of that truth, and it may be surfaced contextually when a newly authorized person first enters the Property.**

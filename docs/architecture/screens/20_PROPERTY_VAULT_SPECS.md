# Roundhouse Property Vault & Specs

## Purpose

Vault is the permanent information destination inside the Property Entity.

It answers:

**What durable information belongs to this Property, and where can an authorized person reliably find it later?**

Vault is not a second Work screen, not a second Maintenance screen, and not a general dumping ground.

Active work stays in **Work**. Recurring care and condition monitoring stay in **Maintenance**. Real-time work evidence stays in **CAPTURE**. Vault preserves the durable Property truth those systems create.

---

# 1. Vault Position Inside the Property Entity

Vault remains the fourth / bottom right-edge Property tab:

1. **Work**
2. **Tasks / Lists**
3. **Maintenance**
4. **Vault**

The visible Vault control should ultimately use a custom Roundhouse-designed icon rather than a platform-standard emoji.

---

# 2. Vault Home

Opening Vault presents a Property-scoped permanent-information screen.

At the top:

**Vault**  
Property name beneath it  
**Search Vault**                 **Handoff**

**Handoff** is a persistent secondary action in the Vault header area. It opens the role-aware Property briefing governed by **`25_PROPERTY_HANDOFF.md`**.

Handoff is **not** a fifth Vault section. The primary Vault sections remain:

- **Specs**
- **Assets & Equipment**
- **Documents**
- **Property History / Records**

These are not unrelated silos. They are different retrieval views over durable Property information.

### Specs

Permanent reference facts about the Property itself: finishes, materials, paint, tile, cabinetry, hardware, dimensions, access information, and similar specifications.

### Assets & Equipment

Serviceable physical things at the Property that have their own identity, maintenance needs, work history, documents, and lifecycle.

Asset Detail is governed by:

**`19_PROPERTY_ASSET_DETAIL.md`**

### Documents

Documents is the clear durable file home for the Property.

The governing path is:

**Property Entity → Vault → Documents**

It contains durable Property files such as warranties, manuals, disclaimers, permits, plans, surveys, easements, inspection reports, water / soil reports, installation records, and other formal Property documentation.

A document may also be reached from the Asset, Work item, Maintenance record, Timeline event, Estimate / Invoice, or other legitimate Record that produced or uses it, but those pathways point to the same underlying document rather than creating copies.

The full Documents and permanent-record logic is governed by:

**`21_PROPERTY_VAULT_DOCUMENTS_RECORDS.md`**

### Property History / Records

Property History / Records is the durable archival view of what happened at the Property.

It is intentionally distinct from the living Property Timeline:

**Property Timeline = what is happening here.**  
**Property History = what happened here.**

History can surface completed Work, maintenance, Standards evidence, installations, inspections, Asset lifecycle events, major Property changes, ownership / authority changes where appropriate, disclaimers and resolving Records, and other significant historical events.

History does not duplicate those systems. It references the same underlying Records and gives the Property a predictable long-term retrieval view.

The full Property History architecture is governed by:

**`22_PROPERTY_HISTORY_RECORDS.md`**

---

# 3. Specs Screen

Specs should feel like a fast visual reference book for the physical Property, not a database form.

At the top:

**Specs**  
Property name beneath it  
**Search Specs**                 **+ Add**

The Add control appears only when the current person has authority to create durable Property specifications.

---

## 3.1 Spec Categories

A compact category row allows fast filtering:

**All | Paint & Finishes | Materials | Fixtures | Measurements | Access | General**

The architecture preserves the useful legacy concept of category + label + value + optional photo while modernizing the visible category language.

Categories should remain extensible. Roundhouse should not force every Property into a rigid construction taxonomy.

---

## 3.2 Spec Cards

The body is a clean stack or responsive grid of compact visual cards.

The card pattern is:

**Photo / swatch → Label → Exact answer → Location / supporting context**

Example:

**Living Room Paint**  
[small wall / color photo]  
Sherwin-Williams Alabaster  
**SW 7008**  
Living Room

Example:

**Kitchen Countertop**  
[photo]  
Calacatta Laza Quartz  
**2 cm · Polished**

Example:

**Guest Bath Floor Tile**  
[photo]  
Daltile Memoir  
**12 × 12 · Petal Black**

The most practically useful value should receive the strongest visual emphasis.

A person standing in a paint store, supply house, or jobsite should be able to locate the answer within seconds.

---

# 4. Spec Detail

Tapping a Spec card opens a simple **Spec Detail** screen inside the Property Vault.

The screen may show:

- representative photo / swatch
- Spec name
- category
- Property location / room / area
- exact value / specification
- manufacturer / brand where useful
- product identifier / code where useful
- dimensions / finish where useful
- notes
- last updated time
- last updated by

Authorized people receive an **Edit** control.

The screen should not require every possible field. Specs remain flexible reference records rather than rigid product forms.

---

# 5. What Belongs in Specs vs Assets

This distinction is governing.

## Specs describe the Property itself

Examples:

- wall paint
- stain color
- flooring
- tile
- countertop material
- cabinet finish
- door hardware
- plumbing finish
- dimensions
- trim profile
- access instruction

## Assets describe serviceable physical equipment

Examples:

- HVAC unit
- water heater
- pool pump
- generator
- appliance
- irrigation controller

A model number for an HVAC unit belongs with the **HVAC Asset**, because that equipment has maintenance, service history, work, documents, and a lifecycle.

Do not duplicate the same equipment identity in Specs merely because the older Knowledge system allowed appliance or model-number entries there.

---

# 6. Copy-Friendly Exact Values

Important Spec values should be easy to select or copy.

Examples:

- `SW 7008`
- `3/8 in.`
- `Brushed Nickel`
- `Calacatta Laza`

The product should optimize Specs for real-world retrieval, not merely visual browsing.

---

# 7. Photos and Swatches

A Spec may include an optional photograph.

Useful examples include:

- paint swatch / wall photograph
- tile photograph
- countertop photograph
- hardware photograph
- trim profile
- material sample

The photograph supports recognition; it does not replace the exact written value.

A Spec without a photo remains fully valid.

---

# 8. Access Information

**Access** may contain sensitive Property information such as:

- gate instructions
- lockbox information
- mechanical-room access
- alarm procedures
- other restricted entry details

Sensitive Access information must use tighter permission rules than ordinary visible Specs.

A person who can see general Property Specs does **not** automatically receive gate codes, lockbox codes, alarm information, or other restricted credentials.

The UI should clearly distinguish restricted Access records from ordinary Specs and avoid exposing sensitive values in list previews when permission is not appropriate.

---

# 9. Search

**Search Specs** searches the current Property's specification records.

Search should match useful retrieval terms such as:

- label
- value
- brand
- product code
- category
- room / location
- notes where appropriate

Example searches:

`living room paint`  
`SW 7008`  
`countertop`  
`guest bath tile`

---

# 10. Property Handoff

Handoff is **not** a permanent Vault folder containing a second copy of Property information.

Its permanent entry point is:

**Property Entity → Vault → Handoff**

The Vault header keeps a persistent **Handoff** action beside **Search Vault**.

When a newly authorized person first enters the Property, Roundhouse may also surface a compact **Property Handoff available** prompt with **Open Handoff** and **Not Now**. After opening or dismissing it, the Handoff remains available from Vault.

Vault contains the durable truth.

**Property Handoff assembles the truth for a person who needs to become oriented.**

When appropriate, Roundhouse can assemble a Property Handoff from existing records such as:

- Know Before You Start information;
- important Specs;
- key Assets;
- relevant Documents;
- pinned / deliberately shared Property information;
- recent relevant Work;
- current Maintenance / Standards state;
- unresolved items the person is permitted to see;
- recent Property History relevant to their role;
- relevant People / contacts.

This preserves the useful legacy Handoff behavior without creating duplicate knowledge that can become stale.

Handoff follows the current person's permissions. It never expands visibility merely because the information is useful for orientation.

The full Handoff screen, placement, first-entry behavior, and role-aware assembly are governed by:

**`25_PROPERTY_HANDOFF.md`**

---

# 11. Notes and Durable Property Knowledge

The legacy Property Knowledge system included free-form Property notes, pinned notes, attachments, and visibility controls.

That capability should be preserved, but not every note automatically becomes a permanent Property Spec or Document.

Useful durable notes may be:

- pinned / promoted into permanent Property Records;
- connected to a Spec, Asset, Document, Maintenance item, or other Record;
- surfaced in Handoff when deliberately appropriate.

Private internal notes remain private according to their governing visibility and do not become homeowner-visible merely because they concern the same Property.

---

# 12. Permissions

Vault is permission-aware.

Different users may legitimately see different parts of the same Property Vault.

Examples:

- a Homeowner may manage broad Property records;
- an authorized Trade Professional may need Specs, Asset details, manuals, reports, and service history relevant to their work;
- a Viewer remains view-only and sees only information permitted to that relationship;
- restricted Access information can have narrower visibility than ordinary Specs;
- sensitive Documents can have narrower visibility than ordinary Vault records;
- Property History follows underlying Record permissions;
- Handoff assembles only information the current person is already permitted to see;
- private Business/internal notes and files remain excluded unless deliberately shared.

The presence of a record in Vault does not mean universal visibility.

---

# 13. Governing Relationships

**Specs = durable facts about the Property itself.**  
**Assets = durable service passports for physical equipment.**  
**Documents = the predictable durable filing cabinet for Property files.**  
**Property History / Records = the durable archival view of what happened.**  
**Handoff = a permission-aware briefing assembled from existing truth.**

---

## Governing Rule

**Vault is where the Property remembers. Specs provide the exact answer about the place; Assets remember the equipment; Documents preserve the files without duplicating them; History preserves what happened without duplicating the underlying Records; Handoff assembles what a person needs to know without creating a second copy of the truth.**

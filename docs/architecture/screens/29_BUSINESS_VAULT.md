# Roundhouse Business Vault

## Purpose

**Vault** is the fourth right-edge working screen inside the Business Entity.

Its home is:

**Business Entity → Vault**

It answers:

**What permanent things belong to this Business, and where are they now?**

Business Vault is the durable home for Business-owned physical assets and permanent Business records.

The current-possession system for shared assets is a first-class part of the architecture and should remain highly visible rather than being reduced to a hidden metadata field.

---

# 1. Position Inside the Business Entity

The Business Entity right-edge order remains:

1. **Work**
2. **Team**
3. **Properties**
4. **Vault**

The visible label remains **Vault**.

The right-edge control should ultimately use the same custom Roundhouse Vault icon language used by Property Vault, while the contents make clear that this is the **Business** Vault.

---

# 2. Business Vault Home

Opening Vault presents a Business-scoped permanent-information screen.

At the top:

**Vault**  
Business name beneath it  
**Search Vault**

The two primary sections are:

- **Assets & Equipment**
- **Business Records**

The structure stays deliberately simple.

---

# 3. Assets & Equipment

Assets & Equipment contains durable Business-owned physical things that matter operationally.

Examples include:

- vehicles;
- trailers;
- generators;
- ladders;
- tents / canopies;
- specialty tools;
- laser measures;
- diagnostic equipment;
- estimating / measuring equipment;
- large shared tools;
- other durable Business equipment.

This section is not intended for ordinary consumable inventory such as screws, caulk, sandpaper, or disposable supplies.

---

# 4. Current Possession — Governing Asset Concept

Every shared Business asset can have a clearly visible **Current Possession** state.

Current Possession answers:

**Who or what currently has this asset?**

Examples:

**Current Possession: Mike Rodriguez**  
**Current Possession: Truck 2**  
**Current Possession: Spring Lake Residence**  
**Current Possession: Main Shop**

This is intentionally more useful than a vague generic status such as "checked out."

A worker should be able to open Business Vault and answer immediately:

**Who has the laser measure?**  
**Which truck is the generator in?**  
**Where did the trailer go?**

---

# 5. Possession Is Not Ownership

A Business asset remains owned by the Business unless its ownership record changes.

**Possession** means current custody / physical control.

It does not mean the person, truck, Property, or location owns the asset.

Examples:

**Business owner:** DMT Design Build  
**Current Possession:** Mike Rodriguez

or:

**Business owner:** DMT Design Build  
**Current Possession:** Truck 2

The interface should never blur Business ownership and current possession.

---

# 6. Possession Is Not Assignment

Assignment and possession are related but different.

**Assigned to Mike** may mean Mike is responsible for using a tool on a job.

**Current Possession: Mike** means Mike currently has physical custody of it.

An asset may be assigned for upcoming Work while still physically sitting at the shop.

Roundhouse should preserve both concepts when both matter rather than forcing one field to do two jobs.

---

# 7. Valid Possession Targets

Current Possession may point to a legitimate operational holder such as:

- a Team member;
- an approved outside Trade Partner where permitted;
- a Business vehicle;
- a Business trailer;
- a Business storage location / shop;
- a Property / jobsite;
- another valid Business asset that acts as a container or carrier.

Examples:

**Laser Measure → Mike Rodriguez**

**Generator → Truck 2**

**Extension Ladder → Spring Lake Residence**

**Tile Saw → Main Shop**

This allows Roundhouse to represent how tools actually move through a working Business.

---

# 8. Asset Cards

Each Asset card should make the practical operating information visible without opening Asset Detail.

A card may show:

- representative photo;
- asset name;
- type / category;
- asset number / tag when useful;
- **Current Possession**;
- current location when distinct and known;
- availability state;
- maintenance / service attention when relevant.

Example:

**Bosch Laser Measure**  
LM-04  
**With Mike Rodriguez**  
Available after current job

Example:

**Honda Generator**  
GEN-02  
**In Truck 2**  
Available

Example:

**16' Enclosed Trailer**  
TR-01  
**Spring Lake Residence**  
In Use

Current Possession should be one of the strongest scan points on the card.

---

# 9. Asset Availability

Possession and availability are separate.

Useful availability states may include:

- **Available**;
- **In Use**;
- **Reserved**;
- **Service / Repair**;
- **Unavailable**;
- **Unknown** where the Business genuinely does not know.

Example:

An asset may be:

**Current Possession: Main Shop**  
**Availability: Service / Repair**

or:

**Current Possession: Mike Rodriguez**  
**Availability: In Use**

This avoids treating location as availability.

---

# 10. Asset Detail

Tapping an Asset opens **Business Asset Detail**.

The top of Asset Detail should answer the most important operational questions first:

- What is it?
- Who / what has it now?
- Where is it?
- Is it available?

The screen may then include:

- photo;
- asset name;
- category;
- asset tag / serial / identifier;
- Business owner;
- **Current Possession**;
- current physical location where known;
- normal storage / home location;
- availability;
- condition;
- maintenance / service status;
- related Work;
- manuals / warranties / documents;
- notes;
- acquisition / lifecycle information where useful;
- possession history.

The screen should feel like an operational passport for the asset, not an accounting depreciation form.

---

# 11. Transfer Possession

Authorized people can use a clear action:

**Transfer Possession**

The transfer flow selects the new legitimate holder / location and records the change.

Examples:

**Main Shop → Mike Rodriguez**  
**Mike Rodriguez → Truck 2**  
**Truck 2 → Spring Lake Residence**  
**Spring Lake Residence → Main Shop**

The interaction should be fast enough to use in the field.

A transfer should update one underlying possession state rather than creating multiple contradictory "current" holders.

---

# 12. Possession History

Each possession change can create a chronological custody history.

A history entry may include:

- previous holder;
- new holder;
- time / date;
- person who recorded the transfer;
- related Property / Work context when useful;
- optional transfer note.

Example:

**Sept. 12 · 8:14 AM**  
Main Shop → Mike Rodriguez  
For Spring Lake exterior-light Work

Example:

**Sept. 12 · 4:48 PM**  
Mike Rodriguez → Truck 2

This creates useful accountability without turning the system into punitive employee surveillance.

---

# 13. Correcting Possession

Real jobs are messy. Someone may forget to record a transfer.

Authorized Owners / Managers should be able to correct Current Possession when the recorded state is wrong.

A correction should preserve the fact that the record was corrected rather than silently rewriting custody history as though the original entry never existed.

Roundhouse should optimize for restoring truthful operational state, not punishing imperfect check-in behavior.

---

# 14. Current Location

When useful, Roundhouse can distinguish **Current Possession** from **Current Location**.

Example:

**Current Possession: Mike Rodriguez**  
**Current Location: Spring Lake Residence**

The possession holder answers who has responsibility / custody.

The location answers where the asset is physically believed to be.

For an asset stored inside a vehicle or trailer, the container may itself supply useful location context.

Roundhouse should avoid forcing users to maintain duplicate location data when possession already gives the practical answer.

---

# 15. Containers and Nested Possession

Some Business assets naturally contain other assets.

Examples:

- tools inside a truck;
- generator inside a trailer;
- equipment stored in a service van.

Roundhouse may support nested possession relationships such as:

**Generator → Truck 2 → Mike Rodriguez / Spring Lake Residence**

The UI should still present a simple practical answer rather than exposing a complicated graph.

Example display:

**In Truck 2 · with Mike at Spring Lake**

---

# 16. Search Assets

Search should help a worker answer practical retrieval questions quickly.

Search may match:

- asset name;
- category;
- asset tag;
- serial / identifier;
- Current Possession holder;
- vehicle / trailer;
- Property / jobsite;
- normal storage location.

Example searches:

`laser`  
`Mike`  
`Truck 2`  
`Spring Lake`  
`generator`

---

# 17. Filters

Useful lightweight filters may include:

- Available;
- In Use;
- With Team Member;
- In Vehicle / Trailer;
- At Property;
- At Shop / Storage;
- Service / Repair.

These are retrieval aids, not separate ownership categories.

---

# 18. Maintenance and Service

Business Assets can have their own maintenance and service history.

Examples:

- trailer tire replacement;
- generator oil service;
- vehicle maintenance;
- ladder inspection;
- tool calibration;
- equipment repair.

Maintenance / service information belongs with the Business Asset because it is part of the asset's durable lifecycle.

If actual Work is needed, the same Business Work system can be used where appropriate.

---

# 19. Related Documents

An Asset may link to durable Business documents such as:

- warranty;
- manual;
- purchase receipt;
- service record;
- registration;
- inspection certificate;
- equipment specification.

The document remains one underlying Record even if it can also be found through Business Records.

---

# 20. Business Records

**Business Records** is the durable non-asset information side of Business Vault.

Examples include:

- licenses;
- insurance certificates;
- company documents;
- policies;
- approved templates;
- equipment warranties / manuals;
- registrations;
- other permanent Business files and records.

Business Records should be organized for reliable retrieval without turning Vault into a generic cloud-drive replacement.

---

# 21. Business Record Categories

Useful categories may include:

- **Licenses & Certifications**;
- **Insurance**;
- **Company Documents**;
- **Policies**;
- **Templates**;
- **Asset Documents**;
- **General Records**.

Categories remain extensible as legitimate Business needs emerge.

---

# 22. Search Vault

**Search Vault** searches Business Vault information available to the current person.

It may find:

- Assets;
- possession holder names;
- locations;
- asset tags;
- Business Record titles;
- document categories;
- useful metadata.

Search does not expand permissions.

---

# 23. Permissions

Business Vault is permission-aware.

Examples:

- Owners / Managers may manage broad Business Assets and Records according to authority;
- Trade Team Members may see shared equipment location / possession information needed to operate effectively;
- workers may transfer possession when authorized;
- sensitive Business Records may be restricted more tightly than ordinary Asset availability;
- outside Trade Partners see only Business Vault information legitimately shared with them;
- Viewers remain view-only where permitted.

A worker may need to know who has the generator without receiving access to the Business's insurance policy or confidential company records.

---

# 24. Timeline and Record Behavior

Meaningful asset events may surface in the Business Timeline according to permission.

Examples:

- major asset added;
- possession transfer relevant to a job;
- asset moved to Service / Repair;
- asset returned to service;
- significant maintenance completed.

Routine possession movements should not flood the Business Timeline.

The durable Asset Detail retains the full useful possession history.

---

# 25. Visual Direction

Business Vault should feel like a well-organized company equipment room and records cabinet.

Visual priorities:

- two simple primary sections: **Assets & Equipment | Business Records**;
- Current Possession highly visible on Asset cards;
- photo-led asset identification;
- fast Search;
- obvious availability state;
- quick **Transfer Possession** action;
- simple custody history;
- no spreadsheet-heavy inventory interface;
- no accounting-dashboard feel;
- no confusing possession with ownership.

The core operational experience should make finding shared equipment feel immediate.

---

## Governing Relationships

**Business Vault = permanent things belonging to the Business.**  
**Assets & Equipment = durable physical Business property.**  
**Current Possession = who or what has the asset now.**  
**Availability = whether the asset can currently be used.**  
**Business Records = durable Business files and records.**

---

## Governing Rule

**Business Vault preserves Business-owned assets and permanent records. For shared equipment, Current Possession remains a first-class operational truth so an authorized worker can quickly determine who has an asset, where it is, whether it is available, and how custody changed over time without confusing possession with ownership.**

# Roundhouse — Original Vocabulary Recovery Audit

**Review copy only — not added to the Admin Suite**

## Purpose

This document inventories the recoverable **job/trade titles, descriptions, services, strengths, tokens/chips, categories, aliases, and other selectable vocabulary** from the original Replit-era Roundhouse code that was imported into GitHub, plus a clearly separated note about newer-build vocabulary.

The goal is to review the material **before** consolidating it into the Admin Suite or deleting old implementation files. The old Replit Admin Center was only a partial management surface; it was never a complete inventory of Roundhouse vocabulary. Important curated lists also lived directly in app and server logic, so recovery must inspect both Admin-related code and ordinary application logic.

## Recovery boundary

The earliest full Replit-era application snapshot currently visible in the GitHub history is:

- Commit: `a121068e3e58f84648ed599af47fdf05bb7659fd`
- Message: `restore`
- Date: September 7, 2026

A comparison from that snapshot to the current `main` branch shows that the relevant original vocabulary files still survive in the repository. The main implementation change since that snapshot is unrelated object-storage work; the newer architecture documents were added later.

**Important limitation:** Git preserves files and committed code. If a long list of Titles or Tokens was created directly inside a Replit/Postgres database through the Admin Label Room and was never committed/exported as code or seed data, GitHub will not contain those database rows. This matters because the Label Room visibly advertises **Tokens** and **Titles**, but the original committed backend seed only contains six preset sets and does not include those two datasets.

---

# 1. What is definitely preserved

## Original Admin Label Room set names

The old Replit Admin Center was incomplete. The Label Room is evidence of some intended/admin-editable collections, **not** a complete source of truth for the vocabulary that existed in Roundhouse. Many lists were hardcoded or otherwise maintained directly in app/server logic.

The original Label Room UI shows these eight collections:

1. Home priorities
2. Maintenance focus
3. Trades
4. Service categories
5. Work-order categories
6. Work-order priorities
7. Tokens
8. Titles

**Source:** `artifacts/round-house/app/account/rooms/label-room.tsx`

### Backend reality at the restored snapshot

The original preset backend only implements these six sets:

- Home priorities
- Maintenance focus
- Trades
- Service categories
- Work-order categories
- Work-order priorities

**Tokens and Titles are not in the backend `PRESET_SET_KEYS`.**

That means the Label Room concepts are definitely preserved, but their complete original datasets are **not present in the committed preset seed**. This does **not** mean the missing vocabulary failed to exist elsewhere in the app; it means the Admin preset layer was incomplete and the recovery must continue through the rest of the application logic.

**Source:** `artifacts/api-server/src/lib/presetChips.ts`

---

# 2. Full original Service Catalog

The original code contains **136 services in 15 groups**. This is the largest clearly preserved curated list and should be treated as valuable source data.

## Design & Creative — 11

- Architectural Renderings
- Structural Engineer
- Interior Designer
- Landscape Design
- Custom Wall Relief
- Custom Ambient Lighting Packages
- SketchUp
- AI Design Engines
- AutoCAD
- Mixed Material Art
- Mixed Medium Artist

## Handyman & General Contracting — 6

- General contracting
- Handyman services
- Home repairs
- Property maintenance
- Punch list completion
- Move-in/out turnover

## Carpentry & Cabinetry — 12

- Carpenter
- Cabinet Maker
- Finish carpentry
- Trim & molding
- Cabinet install
- Built-ins & shelving
- Door install/repair
- Window install/repair
- Drywall install
- Drywall repair
- Framing
- Stair install/repair

## Flooring — 5

- Flooring install (hardwood)
- Flooring install (tile)
- Flooring install (LVP)
- Carpet install
- Subfloor repair

## Plumbing — 15

- Leak detection
- Pipe repair
- Pipe replacement
- Drain cleaning
- Sewer line repair
- Toilet install/repair
- Faucet install/repair
- Water heater install
- Water heater repair
- Tankless water heater
- Garbage disposal
- Sump pump install
- Backflow testing
- Gas line install/repair
- Re-pipe (whole home)

## Electrical — 11

- Panel upgrade
- Wiring & rewiring
- Outlet & switch install
- Lighting install
- Recessed lighting
- Ceiling fan install
- EV charger install
- Generator install
- Smoke/CO detector install
- Surge protection
- Electrical inspection

## HVAC — 11

- AC install
- AC repair
- Furnace install
- Furnace repair
- Heat pump install
- Mini-split install
- Ductwork install/repair
- Duct cleaning
- Thermostat install
- HVAC tune-up
- Indoor air quality

## Painting — 6

- Interior painting
- Exterior painting
- Cabinet refinishing
- Wallpaper hanging/removal
- Deck staining
- Pressure washing

## Roofing & Exterior — 8

- Roof install
- Roof repair
- Gutter install/cleaning
- Siding install/repair
- Stucco repair
- Chimney repair
- Skylight install
- Soffit & fascia repair

## Concrete & Masonry — 6

- Concrete pour
- Concrete repair
- Driveway install/repair
- Patio install
- Brick & stone masonry
- Retaining walls

## Landscape & Yard — 13

- Lawn care & mowing
- Tree trimming
- Tree removal
- Shrub & hedge trimming
- Mulch & bed install
- Sod install
- Sprinkler install/repair
- Drainage solutions
- Fence install/repair
- Deck install
- Hardscape design
- Snow removal
- Leaf removal

## Cleaning — 7

- Standard house cleaning
- Deep cleaning
- Move-in/out cleaning
- Post-construction cleaning
- Carpet cleaning
- Window cleaning
- Junk removal

## Specialty — 14

- Pool maintenance
- Pool install/repair
- Pest control
- Mold remediation
- Asbestos abatement
- Insulation install
- Solar install
- Smart home install
- Security system install
- Garage door install/repair
- Appliance install/repair
- Locksmith services
- Window treatments
- Awnings & shades

## Remodels — 7

- Kitchen remodel
- Bathroom remodel
- Basement finishing
- Attic conversion
- ADU construction
- Whole-home remodel
- Tenant improvement

## Inspection & Consulting — 4

- Home inspection
- Energy audit
- Project management
- Estimating & consulting

**Original sources:**
- `artifacts/round-house/lib/serviceCategories.ts`
- `artifacts/api-server/src/lib/presetChips.ts`

---

# 3. Original service-search aliases and synonyms

These existed as a separate search vocabulary and should be preserved even where their canonical names need reconciling with the 136-service catalog.

- **Electrical** → electrician, wiring, outlets, panel
- **Plumbing** → plumber, leak, pipe, drain, water heater
- **HVAC** → heating, cooling, ac, air conditioning, furnace
- **Roofing** → roofer, roof repair, shingles
- **Painting** → painter, interior paint, exterior paint
- **Carpentry** → carpenter, woodwork, framing, trim
- **Flooring** → floors, hardwood, tile floor, laminate, lvp
- **Drywall** → sheetrock, patch hole
- **Landscaping** → lawn, yard work, gardening, mowing
- **Tree Service** → tree removal, stump, arborist
- **Concrete** → cement, slab, driveway
- **Masonry** → brick, stone, block
- **Locksmith** → lock, rekey, key
- **Pest Control** → exterminator, rodent, termite
- **Cleaning** → maid, house cleaning, janitorial
- **Pressure Washing** → power wash
- **Window Cleaning** → wash windows
- **Solar Installation** → solar panels, pv
- **Welding** → welder, metalwork
- **Excavation** → digging, trenching, grading

**Source:** `artifacts/round-house/lib/serviceSynonyms.ts`

### Recovery note

Some alias keys, such as `Electrical`, `Plumbing`, `Roofing`, `Carpentry`, `Drywall`, `Landscaping`, `Tree Service`, `Welding`, and `Excavation`, do not map one-to-one to the later granular service names. They should be reconciled, not discarded.

---

# 4. Original top-level Trade choices

The principal original intake Trade list contains:

- General Contractor
- Electrician
- Plumber
- HVAC
- Carpenter
- Painter
- Landscaper
- Cleaner
- Handyman
- Other

**Sources:**
- `artifacts/round-house/lib/intake-schemas.ts`
- `artifacts/api-server/src/lib/presetChips.ts`

## Alternate original provider-invite Trade list

A separate original property-provider flow contains:

- Plumber
- Electrician
- HVAC
- Pool Tech
- Handyman
- Landscaper
- Cleaner
- Painter
- Roofer
- Pest Control
- Other

This alternate list adds **Pool Tech, Roofer, and Pest Control**, while omitting General Contractor and Carpenter.

**Source:** `artifacts/round-house/components/AddProviderModal.tsx`

### Combined definite legacy trade vocabulary

Across those two original lists, the definitely preserved trade labels are:

- General Contractor
- Electrician
- Plumber
- HVAC
- Carpenter
- Painter
- Landscaper
- Cleaner
- Handyman
- Pool Tech
- Roofer
- Pest Control
- Other

---

# 5. Original Trade strengths / skills

## Trade worker strengths

- Framing
- Finish carpentry
- Electrical
- Plumbing
- Paint
- Demo
- Tile
- Drywall
- Exterior

## Commercial / facility worker strengths

- General maintenance
- Electrical
- Plumbing
- HVAC
- Groundskeeping
- Janitorial
- Security

**Source:** `artifacts/round-house/lib/intake-schemas.ts`

These are particularly important because the **new Intake architecture still calls for Personal skills/strengths**.

---

# 6. Original job / occupation titles that can be proven from Git

The original imported code contains Role/Title fields, but they are free-text fields with example placeholders rather than a committed long controlled Titles catalog.

The definite examples are:

## Trade team examples

- Foreman
- Apprentice
- Office Manager

## Commercial / facility examples

- Maintenance Lead
- Property Manager

## Home team examples

- Family member
- House manager

**Source:** `artifacts/round-house/lib/intake-schemas.ts`

### Critical finding: the long Titles list is not in the committed source

The Admin Label Room explicitly presents a **Titles** collection, but the original backend seed does not implement a Titles set. Because the Admin Center was incomplete, this alone is not evidence that Titles only lived in the database. The correct conclusion is that the long controlled Titles catalog has **not yet been located in the committed code examined so far**.

So at this point there are only **7 job-title examples that can be positively recovered from committed code**.

If a much longer list existed, possible locations include:

1. additional app/server logic not yet identified;
2. rows stored in the Replit/Postgres database;
3. an uncommitted Replit working version;
4. another repository/export not present in this GitHub history.

Because the old Admin Center was not comprehensive, **database-only storage should not be assumed without further evidence**.

This is the biggest unresolved preservation issue.

---

# 7. Original token / chip vocabulary that can be recovered

The original Label Room advertises **Tokens**, but no committed `tokens` preset dataset exists in the backend. However, several curated token-like lists survive elsewhere.

## Classification tokens

### Worker
**Description:** An employee or recurring helper who works inside the property.

### Outside service provider
**Description:** A vendor or trade pro you call in for specific jobs.

## Work-cadence tokens

### Occasional
**Description:** One-off or as-needed jobs.

### Recurring
**Description:** Regular, ongoing work.

## On-site identity tokens

- Contractor
- Handyman
- Specialist
- Technician
- Vendor
- Other…

## Legacy personal-relationship chips

- Mom
- Dad
- Spouse
- Sibling
- Boyfriend ♥
- Girlfriend ♥
- Old friend
- New friend
- Friend
- Neighbor
- Designer
- Other…

These are legacy descriptors. They do **not** reinstate Friend/Collaborator as current Roundhouse Roles.

## Trade-team functional chips

- Plumbing
- Carpentry
- Electrical
- Painting
- Roofing
- Landscaping
- Other…

## Facility-team functional chips

- Maintenance
- Housekeeping
- Gardener
- Security
- Concierge
- Office
- Other…

**Source:** `artifacts/round-house/lib/connectionTags.ts`

### Critical finding: the long Tokens list is also not in the committed preset backend

Like Titles, the Label Room advertises Tokens, but `tokens` is not an implemented preset backend set in the restored source. The lists above are token-like data already recovered from ordinary app logic. The missing Admin preset does not prove that these were the only Tokens or that a fuller list lived only in the database.

---

# 8. Original Home priority chips

- Warmth
- Longevity
- Design
- Safety
- Calm
- Garden
- Memory

**Sources:**
- `artifacts/round-house/lib/intake-schemas.ts`
- `artifacts/api-server/src/lib/presetChips.ts`

---

# 9. Original commercial / maintenance focus chips

- Preventive
- Compliance
- Uptime
- Cost
- Tenant satisfaction
- Energy

**Sources:**
- `artifacts/round-house/lib/intake-schemas.ts`
- `artifacts/api-server/src/lib/presetChips.ts`

---

# 10. Original commercial Operation choices

- Office
- Retail
- Hospitality
- Multifamily
- Industrial
- Education
- Healthcare
- Other

**Source:** `artifacts/round-house/lib/intake-schemas.ts`

---

# 11. Original team-size choices

- Solo
- 2–5
- 6–20
- 20+

**Source:** `artifacts/round-house/lib/intake-schemas.ts`

---

# 12. Original experience bands

## Trade Professional

- <2 years
- 2–5 years
- 5–10 years
- 10+ years

## Worker / collaborator-era profile

- <1 year
- 1–3 years
- 3–7 years
- 7+ years

**Source:** `artifacts/round-house/lib/intake-schemas.ts`

---

# 13. Original Work-Order controlled values

## Categories

- Preventive
- Corrective
- Emergency
- Inspection

## Priorities

- Low
- Normal
- High
- Urgent

**Source:** `artifacts/api-server/src/lib/presetChips.ts`

These are preserved as vocabulary even if the new architecture ultimately maps old Work Orders into another record model.

---

# 14. Original discovery / “Find” category taxonomy

The original Find screen used a fixed 14-category taxonomy for success stories/discovery:

- Designer / Architect
- Housekeeper
- Contractor
- Handyman
- Electrician
- Plumber
- Landscaper
- Tree Trimmer
- Roofer
- Pest Control
- Security / IT
- Pool
- HVAC
- Home Staging

## Search terms attached to those categories

- **Designer / Architect** → designer, architect, interior design
- **Housekeeper** → housekeeper, house keeping, house cleaning, cleaner, maid
- **Contractor** → contractor, general contractor, gc, remodel
- **Handyman** → handyman, handy man, handyperson
- **Electrician** → electrician, electrical
- **Plumber** → plumber, plumbing
- **Landscaper** → landscaper, landscaping, lawn, yard
- **Tree Trimmer** → tree trimmer, tree, arborist
- **Roofer** → roofer, roofing, roof
- **Pest Control** → pest control, exterminator, pest
- **Security / IT** → security, alarm, cctv, camera, it, network, wifi
- **Pool** → pool
- **HVAC** → hvac, ac, air conditioning, heating, furnace, heat pump
- **Home Staging** → home staging, staging, stager

**Source:** `artifacts/round-house/app/find.tsx`

This is useful vocabulary even though Find itself is not necessarily current architecture.

---

# 15. Original onboarding “hat” labels, descriptions, and taglines

These are legacy onboarding descriptions, preserved because you specifically asked about the descriptive work that was done.

## Home

**Description:** I run a place I care about. Track work, history, people.  
**Tagline:** Your place, tracked.

## Home Teammate

**Description:** I help out at someone's home.  
**Tagline:** Teammate at a home.

## Trade Pro

**Description:** I do the work. Run my day, log jobs, manage clients.  
**Tagline:** Your jobs, your day, your record.

## Trade Teammate

**Description:** I work at a Trade Pro business.  
**Tagline:** Teammate at a Trade Pro business.

## Facility Management

**Description:** I keep operations running. Work orders, team, standards.  
**Tagline:** Operations and standards.

## Facility Teammate

**Description:** I work at a commercial facility.  
**Tagline:** Teammate at a commercial facility.

## Collaborator — legacy

**Description:** I collaborate with a Trade Pro or Facilities team.  
**Tagline:** Work assigned by someone else.

### Collaborator subtypes — legacy

**Trade Pro collaborator:** I work under a Trade Pro on jobs.  
Tagline: Work assigned by a pro.

**Facilities collaborator:** I work inside a facilities team.  
Tagline: Take work, log progress.

**Source:** `artifacts/round-house/app/(onboarding)/mode-picker.tsx` and `artifacts/round-house/lib/intake-schemas.ts`

Current architecture supersedes Collaborator with the appropriate modern Role/Entity participation model.

---

# 16. Other original relationship descriptions

These are clearly marked legacy in the code, but the wording is preserved for reference.

## Add as Client
Someone you serve or work for.

## Add as Core
Part of your internal team.

## Add as Collaborator
External contributor or partner.

**Source:** `artifacts/round-house/components/ConnectionKindChooser.tsx`

These old avatar-to-avatar relationship categories are **not current architecture**.

---

# 17. Original outward-account descriptions

## Home
I take care of one or more homes.

## Trade Pro
I provide trade services to clients.

## Facility Management
I manage facilities or commercial properties.

**Source:** `artifacts/round-house/components/OutwardAccountForm.tsx`

Again, these are preserved wording, not current governing structure.

---

# 18. New-build branch wording worth retaining separately

A later `rebuild/entry-intake-v1` branch contains these entry descriptions. They are not all current architecture, but they are useful wording and should not be confused with the original Replit snapshot.

## Property Owner
I own or manage a home or property.  
**Tagline:** Find or create the property.

## Trade Pro
I run or represent a trade business that works on properties.  
**Tagline:** Find or create the business.

## Trade Team Member
I work for or with a Trade Pro business.  
**Tagline:** Find the business you work with.

## Commercial Pro
I manage commercial property, facilities, or commercial work.  
**Tagline:** Find or create the business.

## Commercial Team Member
I work on a commercial or facilities team.  
**Tagline:** Find the business or facility team.

## Commercial Supplier
I provide recurring goods or services such as linens, water, uniforms, or deliveries.  
**Tagline:** Find or create the supplier business.

## Collaborator — superseded
I help with work but I am not claiming ownership of the property or business.  
**Tagline:** Connect through a property or business.

**Source:** branch `rebuild/entry-intake-v1`, `artifacts/round-house/lib/entry-intake.ts`

Current architecture supersedes the Collaborator entry.

---

# 19. New governing Intake requires additional controlled vocabulary

The current architecture now calls for the following Trade information:

- Business Services
- Position / trade
- Optional role / title
- Years of trade experience
- Relevant experience / position selections
- Business / management experience where relevant
- Personal skills / strengths
- Licenses & Certifications

This tells us that the future Admin vocabulary registry should eventually cover:

- Trades
- Services
- Titles / positions
- Strengths / skills
- Experience bands
- Credential / license types
- Tokens / descriptors
- Search aliases

But this review document intentionally does **not invent missing original values** and does not yet add anything to the Admin Suite.

---

# 20. Recovery status

| Collection | Recovery status | What is currently recoverable |
| --- | --- | --- |
| Services | **Recovered** | 136 services / 15 groups |
| Service aliases | **Recovered** | 20 canonical alias groups |
| Top-level Trades | **Recovered** | 10 primary + 3 additional legacy trade labels |
| Trade strengths | **Recovered** | 9 |
| Facility strengths | **Recovered** | 7 |
| Home priorities | **Recovered** | 7 |
| Maintenance focus | **Recovered** | 6 |
| Operation types | **Recovered** | 8 |
| Team-size choices | **Recovered** | 4 |
| Experience bands | **Recovered** | 2 different four-band systems |
| Work-order categories | **Recovered** | 4 |
| Work-order priorities | **Recovered** | 4 |
| Discovery categories | **Recovered** | 14 + search terms |
| Relationship/token-like chips | **Recovered** | Classification, cadence, on-site, personal relationship, trade-team, facility-team lists |
| Onboarding descriptions/taglines | **Recovered** | Original mode-picker text plus later rebuild wording |
| Titles | **Incomplete / needs recovery** | Only 7 definite examples in committed source |
| Admin Tokens preset set | **Incomplete / needs recovery** | Concept exists; token-like lists survive, but no committed `tokens` preset dataset |

---

# 21. The two red flags before cleanup

## Red flag 1 — Titles

The interface clearly says the Label Room manages **Titles**, but the long Title catalog has not yet been found in the committed preset seed or in the specific app-logic files reviewed for this audit. Since the old Admin Center was incomplete, the repo itself still needs to be treated as the larger recovery source.

## Red flag 2 — Tokens

The interface clearly says the Label Room manages **Tokens**, but `tokens` is not an implemented preset backend set in the restored source. Several token-like lists survive in ordinary app logic such as `connectionTags.ts`, and there may be additional lists elsewhere in the application.

### Correct recovery posture

The old Replit Admin Center should **not** be treated as the master catalog. It was a partial management interface layered over a product where substantial vocabulary and behavior lived directly in application logic.

Therefore, before deleting old Replit-era material, **Titles and Tokens should remain marked “Needs Reconstruction / Search App Logic + Possible Database Data.”** The repo should be searched broadly before concluding anything was database-only.

---

# 22. Source files reviewed for this audit

Primary original snapshot sources:

- `artifacts/round-house/lib/serviceCategories.ts`
- `artifacts/round-house/lib/serviceSynonyms.ts`
- `artifacts/api-server/src/lib/presetChips.ts`
- `artifacts/round-house/lib/intake-schemas.ts`
- `artifacts/round-house/lib/connectionTags.ts`
- `artifacts/round-house/components/AddProviderModal.tsx`
- `artifacts/round-house/app/find.tsx`
- `artifacts/round-house/app/(onboarding)/mode-picker.tsx`
- `artifacts/round-house/components/ConnectionKindChooser.tsx`
- `artifacts/round-house/components/OutwardAccountForm.tsx`
- `artifacts/round-house/app/account/rooms/label-room.tsx`

Later/new-build reference:

- branch `rebuild/entry-intake-v1`
- `artifacts/round-house/lib/entry-intake.ts`

Current architecture reference:

- `docs/architecture/screens/01_ROUNDHOUSE_INTAKE_SCREENS.md`
- `docs/architecture/ROUNDHOUSE_ROLES_AND_PERMISSIONS.md`

---

# Bottom line

The **service catalog and most chip/strength/trade vocabulary are safely recoverable from Git**.

The large **Titles** and possibly **Tokens** catalogs are **not yet fully recovered**. The incomplete Admin Center is only one clue; the broader app/server logic remains an equally important source and should be searched before any conclusion about missing data is made.

**Do not treat Titles or Tokens as fully recovered yet, and do not treat the old Admin Center as the source of truth for what existed.**
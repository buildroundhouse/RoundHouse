# ROUNDHOUSE — ADMIN SUITE

## Purpose

The Admin Suite is Roundhouse's hidden operator, testing, configuration, support, and product-administration workspace.

It is **not** part of normal Homeowner, Trade Professional, Team Member, Commercial, Supplier, Property, or Command Center navigation. It exists so authorized Roundhouse administrators can safely operate and test the product without exposing administrative controls to ordinary users.

This document is also a **preservation document ahead of repository cleanup**. It consolidates valuable behavior, vocabulary, datasets, visual language, and operator functions that currently exist across the Replit-era implementation and the newer Roundhouse architecture.

The cleanup rule is:

**Nothing containing unique Roundhouse behavior, vocabulary, test capability, or curated data is removed until that information is represented here or deliberately superseded by a current governing architecture document.**

The Admin Suite must not be rebuilt as a generic corporate dashboard.

---

# 1. Source Priority

The Admin Suite consolidates information from two different eras of Roundhouse.

When they conflict, use this order:

1. **Current governing architecture documents** define current Roles, Entity structure, screens, permissions, Points/Status direction, and product behavior.
2. **This Admin Suite document** preserves and organizes administrative capabilities and curated data that remain useful.
3. **Existing implementation code** is a behavioral and visual reference, but old Role names or product assumptions do not override current architecture.

Examples:

- **Viewer** is current architecture; old **Collaborator/Friend** language is not a current base Role.
- **Pro** is a membership designation, not a base Role.
- Owner, Co-Owner, Lead, and Manager are authority designations rather than separate base Roles.
- Legacy Bronze / Silver / Gold / Platinum reward tiers are implementation history; the new Reward Center uses configurable Roundhouse Status concepts such as **Wood** and **Iron**.

Legacy vocabulary can still be preserved as descriptive labels, test fixtures, migration data, or search aliases without reinstating obsolete architecture.

---

# 2. Hidden Entry and Admin Authentication

The designed hidden doorway is the Roundhouse logo on the Sign In screen.

**Long-press the logo for approximately 600 ms → Admin Sign In.**

The Sign In screen visibly changes into an **Admin Sign In** state. Existing implementation also includes browser-specific long-press protection so context menus and image dragging do not swallow the gesture.

Admin Sign In may accept an admin username plus password while normal Sign In uses ordinary user credentials. The hidden gesture itself is **not security**. Actual Admin Suite access requires authenticated administrative authority enforced server-side.

A development/recovery fallback may exist when the long-press cannot be triggered, but that is not the primary designed experience.

Once authenticated as an administrator:

**Admin Sign In → Admin Lobby**

The normal user Command Center is not the Admin landing page.

---

# 3. Navigation Contract — No Dead Ends

The Admin Suite previously contained navigation that depended on generic history-based Back behavior. Existing `RoomShell` code, for example, sends the **Lobby** control through `router.back()`. That can fail or return somewhere unexpected when a room is entered through a deep link, refresh, restored browser state, or alternate route.

The rebuilt suite must use **destination-based navigation** for structural Admin controls.

### Required Navigation

- **Lobby** always routes directly to the Admin Lobby.
- **HUB** always routes directly to the Admin Lobby.
- **Exit Admin** always routes deliberately to the administrator's normal Roundhouse Profile / Command Center context.
- A demo identity always has a persistent escape path back to the real administrator.
- Browser refresh or a direct room URL must not strand the administrator.
- An ordinary Back gesture may still work, but it is never the only way out of an Admin room.

The current lobby already reflects this philosophy in one place: tapping the large **ADMIN** marquee directly routes out to the normal Profile instead of depending on an async modal that previously appeared broken/inactive.

**Admin navigation must be explicit, testable, and impossible to dead-end.**

---

# 4. Admin Lobby — "Behind the Curtain"

The Admin Lobby is intentionally theatrical.

It should feel like entering a private backstage area ordinary Roundhouse users never see.

The established visual composition includes:

- deep velvet / near-black background;
- burgundy and oxblood gradients;
- brass and warm gold trim;
- glowing marquee bulbs;
- curtain-like dividers;
- oversized **ADMIN** marquee;
- large door-like destinations;
- brass plaques, knobs, borders, and uppercase labels;
- restrained neon accents used as glow rather than the primary palette.

The top marquee reads conceptually as:

**Behind the curtain**  
**ADMIN**

The three original rooms remain visually important:

1. **Game Room**
2. **Label Room**
3. **Avatar Wardrobe**

As the Suite expands, these original three should remain recognizable rather than being flattened into a generic menu. Additional rooms can continue below them as a **Backstage Corridor** or second set of doors.

### Expanded Admin Suite

The optimized suite should contain:

1. **Game Room** — Points, Status, Badges, scoring, rewards, leaderboards, prize administration.
2. **Label Room** — controlled vocabulary, chips, Tokens, Titles, Trades, Services, Strengths, search aliases and reusable option sets.
3. **Avatar Wardrobe** — create demo identities, run real onboarding, wear/test identities and return safely.
4. **Mailroom** — user reports, help/support cases, feedback and the Admin mailbox.
5. **Test Lab** — QA, broken-screen/navigation tracking, scenario testing and issue concentration by screen/version/Role.
6. **Control Room** — restricted system health and operator functions where appropriate.

The Lobby should continue to feel like a private club, backstage theater, old arcade and workshop blended together—not Settings and not a database console.

---

# 5. Governing Visual Palette

The existing Admin implementation establishes the following palette and it should be preserved unless deliberately redesigned:

- Velvet: `#1A0B12`
- Velvet Deep: `#0E0509`
- Velvet Sheen: `#2A1320`
- Oxblood: `#5A0F1F`
- Burgundy: `#7E1C32`
- Walnut: `#2A1B11`
- Walnut Light: `#3E2918`
- Emerald: `#0F3A2E`
- Emerald Deep: `#082019`
- Brass: `#C9A24A`
- Brass Bright: `#E8C875`
- Brass Dim: `#8C6F2E`
- Parchment: `#F4ECD7`
- Bone: `#EDE6D6`
- Ash: `#9C8E73`
- Neon Cyan: `#5FE6FF`
- Neon Magenta: `#FF6BD6`
- Neon Lime: `#C9FF5F`

These are part of the Admin Suite's identity, not incidental implementation colors.

### Shared Room Language

Admin rooms use:

- direct **Lobby** return control;
- framed marquee with glowing bulbs;
- small uppercase marquee kicker;
- large heavy room title;
- short uppercase tagline;
- circular outlined crest/icon;
- dark translucent **Velvet Cards**;
- thin room-accent borders;
- brass-style outlined action controls;
- tactile spacing and restrained glow.

The intent is a stylized backstage control environment.

---

# 6. Game Room

## Character

The Game Room is the most arcade-like room.

**Velvet / Oxblood + Brass + selective Neon Magenta glow.**

Existing language includes:

**Insert Coin**  
**Game Room**

The room represents the machinery behind Roundhouse recognition, Points, Status, Badges and future rewards.

## Existing Functions to Preserve

### Stats

System-wide reward activity, including:

- total Points awarded;
- total point events;
- number of participating users;
- event-category breakdown;
- total logins;
- total estimates;
- total invoices;
- questions answered;
- answers marked helpful;
- Roundhouse shares;
- work logs.

### Score Controls

Administrators can inspect and change the point value awarded for recognized event types without requiring a new client release.

### Scoreboard

Ranked users by accumulated Points with point total, event count and Status/tier information.

### User Drill-Down

Authorized administrators can inspect a user's reward activity, including:

- identity needed for legitimate support/fulfillment;
- total Points;
- Status/tier;
- point-event history;
- source references where available;
- latest prize state.

Administrative access to personal data is limited to legitimate operational need.

### Prize Administration

Existing prize workflow uses:

**Eligible → Selected → Shipped**

Contact/mailing information may be shown where legitimately required for fulfillment.

---

## Preserved Legacy Point Events

The existing reward engine contains these defaults. They are preserved here as **implementation inventory**, not permanent product law:

| Event | Existing Default |
| --- | ---: |
| Log completed | +5 |
| Generic/additional work log | +2 |
| Job delivered | +25 |
| Rating received | +15 |
| Success story shared | +50 |
| Profile completed | +75 |
| App invite signup | +10 |
| Question answered | +5 |
| Answer confirmed helpful | +20 |
| Estimate sent | +20 |
| Invoice sent | +50 |
| Shared Roundhouse | +10 |
| Daily login before 6 AM | +10 |
| Daily login before 7 AM | +5 |
| Daily login before 9 AM | +3 |
| Daily login at/after 9 AM | +2 |

The newer CAPTURE architecture adds much richer real-time behavior that can eventually generate or refine point events for check-in, task completion, photos, Mid-Job Capture, receipts, check-out, completed work logs and Post Entry reliability. The Game Room should be the administrative home for tuning those event values once the final event taxonomy is established.

---

## Preserved Legacy Badges

Existing code currently defines these fixed badges:

- **First Log** — first logged work entry
- **Ten Logs** — ten logged work entries
- **First Job** — first completed assigned job
- **Five-Star** — perfect homeowner rating
- **Ten Jobs** — ten completed assigned jobs
- **Storyteller** — shared a success story
- **Profile Pro** — completed profile
- **Fifty Jobs** — fifty completed assigned jobs

Legacy code associates these with Bronze / Silver / Gold / Platinum tiers. Those tier names are not authoritative for the new build.

The new Reward Center architecture also contains visual/future badge concepts worth preserving:

- **Early Sign-On Superstar**
- **Sign-On Streak** — potentially `7`, `14`, `30`, etc.
- **Sharing Superstar**
- **60% to Active User**
- **Status Hero**
- **Profile 100% Complete**

### Badge Builder — Optimized Game Room

Badges should move from fixed code into an Admin-managed **Badge Catalog / Badge Builder**.

An administrator should be able to:

- create a Badge definition;
- name it;
- add description and "How to earn" copy;
- choose its icon/art treatment;
- define whether it is active, coming soon, hidden, or retired;
- associate it with an event/count/threshold rule where supported;
- preview earned and locked states;
- archive rather than destroy a Badge that has already been earned;
- inspect how many people have earned it.

Creating a Badge definition does not automatically create event logic that does not exist. The Admin UI can configure supported triggers; new event sources may still require product logic.

---

## Status Configuration

Legacy implementation contains Bronze / Silver / Gold / Platinum thresholds.

The new Reward Center architecture instead demonstrates Roundhouse-specific Status such as:

**Wood → Iron → future Status levels**

Exact final Status names and thresholds are intentionally configurable.

The Game Room should therefore manage:

- Status name;
- threshold;
- order;
- visual treatment;
- active/retired state;
- preview of progression.

**Points are the number. Status is the level produced by accumulated Points.**

Do not hard-code obsolete tier names into the rebuilt Admin Suite.

---

## Future Reward Administration

The new Reward Center architecture preserves future capability for:

- Roundhouse rewards;
- sponsored tools/equipment;
- home/garden products;
- service discounts;
- advertising benefits;
- brand deals;
- team rewards;
- an **In-House Rewards Creation Center** where a Business/Home authority creates and fulfills its own team incentives.

The Game Room can eventually administer Roundhouse-owned/sponsored reward programs while Business/Home-created rewards remain scoped to the Entity that created them.

---

# 7. Label Room — Controlled Vocabulary Registry

## Character

The Label Room feels like a cabinetmaker's sample room, atelier, or old workshop.

**Walnut + Brass + Parchment**, with colored swatches for label families.

Existing language includes:

**Atelier**  
**Swatch Wall**  
**Scrap Drawer**

The Label Room is not merely a settings list. It is the central place for reusable controlled vocabulary across Roundhouse.

---

## Stable Identity and Historical Integrity

A controlled label should have a stable underlying ID.

Administrators may:

- create;
- rename;
- reorder;
- group;
- move between groups;
- archive/retire;
- restore where appropriate.

Renaming changes presentation without rewriting historical records.

Archived values enter the conceptual **Scrap Drawer**:

- hidden from new pickers;
- still resolvable on existing records;
- visibly marked retired where useful.

**Labels may evolve without destroying history.**

---

# 8. Preserved Vocabulary Inventory

This section is a cleanup-preservation registry. These values currently exist in implementation code, current architecture, or both.

## A. Home Priorities

Existing controlled values:

- Warmth
- Longevity
- Design
- Safety
- Calm
- Garden
- Memory

The current Intake architecture still calls for selectable Home-goal chips, so this vocabulary remains useful even if the final labels evolve.

## B. Maintenance / Commercial Focus

- Preventive
- Compliance
- Uptime
- Cost
- Tenant satisfaction
- Energy

## C. Current Legacy Top-Level Trades

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

The new Trade Intake architecture calls for **Business Services**, **Position/trade**, **Relevant experience/position selections**, and **Personal skills/strengths**. The final new-build Trade taxonomy should be richer than this old ten-item list, but these values must not be lost during migration.

## D. Work-Order Categories

- Preventive
- Corrective
- Emergency
- Inspection

## E. Work-Order Priorities

- Low
- Normal
- High
- Urgent

These are preserved vocabulary. Whether the new architecture continues to use a Work Order object or maps these concepts into another record type should be decided separately.

## F. Operation Types

Existing commercial/facilities intake values:

- Office
- Retail
- Hospitality
- Multifamily
- Industrial
- Education
- Healthcare
- Other

## G. Team Size

- Solo
- 2–5
- 6–20
- 20+

## H. Experience Bands

Existing Trade Professional intake:

- <2 years
- 2–5 years
- 5–10 years
- 10+ years

Existing worker/collaborator-era intake:

- <1 year
- 1–3 years
- 3–7 years
- 7+ years

The new build may normalize these into one experience system, but both ranges are preserved for review before cleanup.

## I. Trade Strengths / Skills

Existing Trade worker strength choices:

- Framing
- Finish carpentry
- Electrical
- Plumbing
- Paint
- Demo
- Tile
- Drywall
- Exterior

The new Trade Intake explicitly requires **Personal skills/strengths**, so this should become an Admin-managed set rather than disappearing with the old intake schema.

## J. Commercial / Facility Strengths

- General maintenance
- Electrical
- Plumbing
- HVAC
- Groundskeeping
- Janitorial
- Security

## K. Existing Role / Occupation Title Examples

Current implementation contains free-text Role fields with examples including:

- Foreman
- Apprentice
- Office Manager
- Maintenance Lead
- Property Manager
- Family Member
- House Manager

The current Trade Intake calls for **Optional role/title** and **Relevant experience/position selections**.

Therefore **Titles** should become a real Admin-managed registry rather than remaining scattered placeholder examples.

The full original Title corpus has **not yet been located in the active backend**. Until reconstructed or found, repository cleanup must not assume that the current seven examples represent the complete original list.

---

# 9. Service Catalog — Preserve in Full

The existing Roundhouse service library contains **136 services in 15 groups**. This is substantial curated work and should be preserved as a first-class Admin-managed catalog.

## Design & Creative

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

## Handyman & General Contracting

- General contracting
- Handyman services
- Home repairs
- Property maintenance
- Punch list completion
- Move-in/out turnover

## Carpentry & Cabinetry

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

## Flooring

- Flooring install (hardwood)
- Flooring install (tile)
- Flooring install (LVP)
- Carpet install
- Subfloor repair

## Plumbing

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

## Electrical

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

## HVAC

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

## Painting

- Interior painting
- Exterior painting
- Cabinet refinishing
- Wallpaper hanging/removal
- Deck staining
- Pressure washing

## Roofing & Exterior

- Roof install
- Roof repair
- Gutter install/cleaning
- Siding install/repair
- Stucco repair
- Chimney repair
- Skylight install
- Soffit & fascia repair

## Concrete & Masonry

- Concrete pour
- Concrete repair
- Driveway install/repair
- Patio install
- Brick & stone masonry
- Retaining walls

## Landscape & Yard

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

## Cleaning

- Standard house cleaning
- Deep cleaning
- Move-in/out cleaning
- Post-construction cleaning
- Carpet cleaning
- Window cleaning
- Junk removal

## Specialty

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

## Remodels

- Kitchen remodel
- Bathroom remodel
- Basement finishing
- Attic conversion
- ADU construction
- Whole-home remodel
- Tenant improvement

## Inspection & Consulting

- Home inspection
- Energy audit
- Project management
- Estimating & consulting

### Service Catalog Optimization

The Label Room should allow:

- group creation/rename/order;
- service creation/rename/order;
- archive/restore;
- trade-category filtering;
- synonyms/search aliases;
- optional description/help text;
- future licensing/certification relevance;
- preview of where a service appears in Intake, Profile and People search.

---

# 10. Search Alias / Synonym Inventory

The repository contains a separate service-search synonym list. It is useful data even though several canonical keys no longer match the newer granular 136-service catalog exactly.

Preserve these aliases for reconciliation rather than deleting them:

- Electrical → electrician, wiring, outlets, panel
- Plumbing → plumber, leak, pipe, drain, water heater
- HVAC → heating, cooling, ac, air conditioning, furnace
- Roofing → roofer, roof repair, shingles
- Painting → painter, interior paint, exterior paint
- Carpentry → carpenter, woodwork, framing, trim
- Flooring → floors, hardwood, tile floor, laminate, lvp
- Drywall → sheetrock, patch hole
- Landscaping → lawn, yard work, gardening, mowing
- Tree Service → tree removal, stump, arborist
- Concrete → cement, slab, driveway
- Masonry → brick, stone, block
- Locksmith → lock, rekey, key
- Pest Control → exterminator, rodent, termite
- Cleaning → maid, house cleaning, janitorial
- Pressure Washing → power wash
- Window Cleaning → wash windows
- Solar Installation → solar panels, pv
- Welding → welder, metalwork
- Excavation → digging, trenching, grading

### Optimization

Search aliases should ultimately live with the Admin-managed Service Catalog so each canonical service can carry its own aliases. The old alias list should not remain a disconnected second taxonomy.

---

# 11. Tokens / Relationship Descriptors — Preservation Inventory

The original Label Room explicitly contains **Tokens** as a managed concept, but the current preset backend does not expose a live `tokens` set. Valuable token-like vocabularies still exist elsewhere in the repo and should be consolidated here before cleanup.

These values are **descriptive vocabulary**, not necessarily current base Roles.

## Classification

- Worker
- Outside service provider

## Work Cadence

- Occasional — one-off or as-needed jobs
- Recurring — regular, ongoing work

## On-Site Identity

- Contractor
- Handyman
- Specialist
- Technician
- Vendor
- Other

## Legacy Personal Relationship Chips

- Mom
- Dad
- Spouse
- Sibling
- Boyfriend
- Girlfriend
- Old friend
- New friend
- Friend
- Neighbor
- Designer
- Other

**Important:** Roundhouse no longer has Friend or Collaborator as governing People categories/base Roles. These labels may still be useful as optional relationship descriptions for a Home Team Member, Viewer, or other authorized relationship, but they must not recreate the old Role architecture.

## Trade Team Functional Chips

- Plumbing
- Carpentry
- Electrical
- Painting
- Roofing
- Landscaping
- Other

## Facility / Commercial Team Functional Chips

- Maintenance
- Housekeeping
- Gardener
- Security
- Concierge
- Office
- Other

### Token Optimization

The rebuilt Label Room should explicitly define what a **Token** means in current Roundhouse architecture.

A good governing use is:

**Token = a lightweight descriptive chip that adds useful context without changing Role, Authority or Permission.**

Examples:

**Trade Team Member · Electrical**  
**Home Team Member · House Manager**  
**Trade Professional · Recurring · HVAC**

Tokens must never silently grant access or authority.

---

# 12. Titles — Preservation and Reconstruction

The Label Room visually promised a **Titles** collection, but the active preset backend currently supports only:

- Home priorities
- Maintenance focus
- Trades
- Service categories
- Work-order categories
- Work-order priorities

Therefore **Tokens and Titles are visible in the Admin concept but missing from the live preset backend**.

This is a cleanup blocker, not evidence that the concepts were unimportant.

### Rebuilt Titles Registry

Titles should support role/context filtering, for example:

**Trade / Field**
- Foreman
- Apprentice
- Lead
- Technician
- Installer
- Journeyman
- Estimator
- Project Manager
- Superintendent

**Trade / Office / Business**
- Office Manager
- Operations Manager
- Bookkeeper
- Scheduler / Dispatcher
- Sales / Estimator

**Home**
- Family Member
- House Manager
- Caretaker

**Commercial**
- Maintenance Lead
- Property Manager
- Facility Manager
- Building Engineer
- Maintenance Technician

These additional examples are a normalized starting structure for the new build, not a claim that they were all present in the original Replit list.

The original list should continue to be searched/recovered if additional source history becomes available.

---

# 13. New-Build Intake Fields That Belong in Admin-Managed Vocabulary

Current governing Intake architecture calls for the following selectable or semi-controlled Trade information:

- Business Services
- Position / trade
- Optional role / title
- Years of trade experience
- Relevant experience / position selections
- Business / management experience where relevant
- Personal skills / strengths
- Licenses & Certifications

The Admin Suite should own the reusable vocabulary for these fields where control is beneficial.

Recommended Label Room registries:

- **Trades**
- **Services**
- **Titles / Positions**
- **Strengths / Skills**
- **Experience bands**
- **Credential / license types**
- **Tokens / descriptors**
- **Search aliases**

This gives Roundhouse one controlled place to evolve the option universe without scattering hard-coded lists through screens.

---

# 14. Avatar Wardrobe

## Character

The Wardrobe is backstage in the most literal sense.

**Emerald / Emerald Deep + Brass**, with hanger/rack imagery and theatrical language such as:

**Backstage**  
**The rack is empty**  
**Step into avatar**  
**STITCH A NEW AVATAR**

## Existing Functions to Preserve

The Wardrobe allows an administrator to:

- create a fresh demo identity;
- send that identity into the same onboarding/signup flow a real user experiences;
- choose username and avatar/photo through the actual Identity screen;
- complete onboarding/intake as that person;
- step into / wear an existing demo identity;
- experience the actual app from that perspective;
- create realistic demo Properties, Businesses, Entities and interactions;
- return safely to the Admin Suite;
- delete demo identities and their controlled demo data.

This is not merely fixture generation. It is **first-person Role testing**.

### Current Governing Demo Roles

The Wardrobe should ultimately support the current base Role architecture:

- Homeowner
- Home Team Member
- Viewer
- Trade Professional
- Trade Team Member
- Commercial Management
- Commercial Team Member
- Supplier

Authority can then be layered where applicable:

- Owner
- Co-Owner
- Lead
- Manager

Legacy demo kinds such as `collab` or old Collaborator variants are migration/testing artifacts only.

### Demo Isolation

Demo identities and demo-created data must not contaminate ordinary discovery.

Where demo data can appear to an administrator or tester, it should be visibly marked **DEMO**.

### Safety Boundary

Wardrobe testing uses controlled demo identities. The Admin Suite should **not** casually turn into an "impersonate any real user" system.

---

# 15. Wardrobe Optimization — Scenario Testing

The Wardrobe should evolve into a repeatable testing tool.

In addition to **Create new avatar**, support optional scenario templates such as:

- New Homeowner with no Property yet
- Homeowner with one Property
- Homeowner with multiple Properties
- Home Team Member
- Viewer
- Trade Professional Owner
- Trade Professional Manager
- Trade Team Member
- Independent Trade Professional / subcontractor relationship
- Commercial Management
- Commercial Team Member
- Supplier

Templates should still use the real app architecture after provisioning; they are shortcuts for controlled test setup, not fake alternate UI.

An administrator should be able to reset or retire a scenario without touching genuine production users.

---

# 16. Persistent HUB / Exit

When wearing a demo identity, the administrator must always have an unmistakable path back to the real Admin Suite.

The existing implementation has a floating **HUB** chip that directly routes to the Admin Hub.

Governing requirement:

**An administrator must never become trapped in a demo identity or confuse a demo identity with their real identity.**

The Hub control should remain visually distinct from ordinary app navigation and should never depend on route history.

---

# 17. Mailroom — User Reports and Admin Mailbox

The new Profile architecture places **Help / Support** under **Other Settings**. This should feed a dedicated Admin **Mailroom** rather than disappearing into an external inbox with no product context.

The Mailroom is a new Admin Suite room built around actual user problems and feedback.

## User-Side Entry

Help / Support should include a clear **Report a Problem** path.

A report can cover:

- Something is broken
- Navigation / button does not work
- Sign-in / account problem
- Property / People / Role / permission problem
- CAPTURE / work-session problem
- Calendar / scheduling problem
- Estimates / invoices / payment problem
- Points / Status / Badge problem
- Messaging problem
- Billing / subscription problem
- Data / privacy concern
- Incorrect information
- General feedback / suggestion
- Other

## Context Captured With a Report

Where available and appropriate, the report should automatically include technical context so the user does not have to explain everything:

- reporting user identity;
- acting Role / Identity;
- current Entity/Property context;
- screen/route where the report was submitted;
- date/time;
- app version/build;
- platform/OS;
- relevant error identifier if one exists.

Diagnostics should be scoped to the issue. Do not attach unrelated private content merely because the reporter is a user.

Screenshots/log attachments may be user-added or deliberately captured when supported.

## Admin Mailbox

Each report becomes a **Support Case** with an admin thread.

Suggested states:

**New → In Review → Waiting on User → Escalated → Resolved**

A case supports:

- user message;
- attachments;
- automatically captured context;
- private Admin notes;
- Admin reply to the user;
- assignment to an Admin/support person;
- priority;
- tags/feature area;
- duplicate/related-case linking;
- resolution summary;
- reopen if the problem persists.

Normal support cases remain Mailroom records rather than being forced into the user-facing Resolution system.

## Problem Concentration

The Mailroom should answer questions such as:

- Which screen is generating the most reports?
- Which build/version introduced a cluster?
- Are Trade Team Members having a different problem from Homeowners?
- Are multiple reports describing the same broken button?
- What remains unresolved?

This turns support into a testing signal rather than a pile of disconnected email.

---

# 18. Test Lab

The **Test Lab** is the QA companion to the Wardrobe and Mailroom.

It should help answer:

**What is broken, where is it broken, for whom, and has it been retested?**

Useful Test Lab views include:

- Open reported problems by screen/feature
- Navigation failures
- Known broken controls
- Needs Retest
- Fixed / verified
- Issues by app version
- Issues by Role
- Issues by platform
- Repeat reports / likely duplicates
- Recent regressions

### Wardrobe Connection

From a reproducible issue, an Admin can create or open an appropriate **demo scenario** in the Wardrobe and attempt the same flow from the same Role type.

Do not impersonate the real reporting user when a controlled demo scenario can reproduce the problem.

### Navigation Audit

Because the earlier Admin Suite itself suffered from apparently broken/inactive navigation, the Test Lab should include a simple Admin route audit:

- every room has a functioning Lobby destination;
- every deep link has a safe exit;
- every modal/sheet has an intentional close path;
- no structural Admin control depends only on browser history;
- demo identity always exposes HUB;
- Sign In hidden-door entry works on supported platforms.

---

# 19. Control Room — Restricted Operations

The repo contains lower-level operator tooling that should not be lost, although it remains a separate permission boundary from ordinary product administration.

Existing operator capabilities include:

- API health check;
- startup/database-migration health;
- outward-account purge health;
- recent purge-run history;
- on-demand purge sweep;
- operator dashboard.

The optimized Admin Suite may expose a **Control Room** summary to appropriately authorized operators, but it must not weaken the underlying operator-security boundary.

The product Admin role and server/operator authority are not automatically the same thing.

A normal Admin Suite user should not receive a raw database console, secrets, unrestricted server access, or destructive infrastructure actions merely because they can manage product configuration.

---

# 20. Admin Authority and Privacy

The hidden doorway is only discovery; real access is permission-controlled.

Admin access must be scoped by function.

Examples of separable administrative authority:

- Product configuration
- Rewards/Game Room
- Vocabulary/Label Room
- Demo/Test administration
- Support/Mailroom
- Prize fulfillment
- Operator/System health

Administrative access to personal information must be connected to legitimate support, safety, fulfillment, testing, or operational need.

**Admin does not mean unlimited curiosity access.**

---

# 21. Current Known Gaps / Reconciliation Work

These are important cleanup blockers or rebuild tasks:

### Tokens

The Label Room explicitly advertises **Tokens**, but the current preset backend does not implement a token set. Candidate token vocabularies survive in relationship/tag code and are preserved above.

### Titles

The Label Room explicitly advertises **Titles**, but the current preset backend does not implement a title set. Only scattered title examples currently survive in intake code. The original full corpus should be recovered if possible.

### Strengths

Useful strength lists survive in old intake code but are not currently Admin-managed. The new build still needs Personal skills/strengths, so these should be migrated into a controlled registry.

### Service Synonyms

Useful aliases survive, but several old canonical keys no longer match the granular service catalog. Preserve and reconcile them rather than deleting them.

### Reward Status Names

Legacy Bronze/Silver/Gold/Platinum conflicts with the newer Wood/Iron Status direction. Preserve historical data but let current Reward Center architecture govern display/status design.

### Badges

Badges exist in code and in new architecture examples, but no complete Admin Badge Builder currently governs them. Game Room should absorb this capability.

### User Support Mailbox

Current architecture calls for Help/Support, but a dedicated Admin Mailroom/support-case system is not yet implemented. This is an intentional Admin Suite expansion.

### Admin Navigation

Some existing Admin room Lobby controls use route-history Back behavior. The rebuild should route explicitly to the Lobby and retain persistent HUB/Exit behavior.

### Legacy Roles

Old Friend/Collaborator terminology remains in implementation. Preserve useful descriptive vocabulary, but current Role architecture governs.

---

# 22. Cleanup Gate

Before deleting a Replit-era file that touches Admin, Intake, Rewards, Services, People labels, testing or support, verify that its unique information has been accounted for.

Use four statuses:

**Captured** — represented in governing architecture/current data.  
**Legacy Preserved** — no longer governing, but intentionally recorded for migration/reference.  
**Needs Reconstruction** — evidence exists that valuable data/function existed, but the complete source is not yet recovered.  
**Superseded** — current architecture deliberately replaces it and no unique data remains.

A file should not be deleted merely because its screen is old.

### Protected Reference Files

At minimum, preserve/review these before cleanup:

- `artifacts/round-house/app/(auth)/sign-in.tsx`
- `artifacts/round-house/app/account/admin.tsx`
- `artifacts/round-house/app/account/rooms/game-room.tsx`
- `artifacts/round-house/app/account/game-room.tsx`
- `artifacts/round-house/app/account/rooms/label-room.tsx`
- `artifacts/round-house/app/account/preset-chips.tsx`
- `artifacts/round-house/app/account/wardrobe.tsx`
- `artifacts/round-house/app/account/skins.tsx`
- `artifacts/round-house/components/admin/RoomShell.tsx`
- `artifacts/round-house/components/admin/AdminQuickExit.tsx`
- `artifacts/round-house/lib/adminTheme.ts`
- `artifacts/round-house/lib/intake-schemas.ts`
- `artifacts/round-house/lib/presetChips.tsx`
- `artifacts/round-house/lib/serviceCategories.ts`
- `artifacts/round-house/lib/serviceSynonyms.ts`
- `artifacts/round-house/lib/connectionTags.ts`
- `artifacts/api-server/src/lib/presetChips.ts`
- `artifacts/api-server/src/lib/rewards.ts`
- `artifacts/api-server/src/routes/game-room.ts`
- `artifacts/api-server/src/routes/preset-chips.ts`
- `artifacts/api-server/src/routes/admin-demo-profiles.ts`
- `artifacts/api-server/src/routes/admin.ts`
- `artifacts/api-server/src/routes/health.ts`
- relevant database schemas for Admin demo profiles, point settings, prize winners and preset chips/groups.

This list can shrink only after the preserved behavior/data is safely represented in the rebuilt system.

---

# 23. Governing Admin Suite Rules

1. **The Admin Suite is hidden from normal product navigation but protected by real authenticated authority.**
2. **Long-press Sign In logo → Admin Sign In** remains the designed hidden doorway.
3. The Lobby retains its **Behind the Curtain** visual identity.
4. Velvet, oxblood, walnut, emerald, brass, bulbs, marquees, curtains and workshop/arcade language are intentional product design.
5. Structural Admin navigation uses explicit destinations; **Lobby/HUB/Exit must never depend solely on route history**.
6. **Game Room** governs Roundhouse recognition mechanics: Points, Status, Badges, score controls, statistics, scoreboard and applicable rewards/prizes.
7. **Label Room** becomes the central controlled-vocabulary registry for Trades, Services, Titles, Strengths, Tokens, aliases and other reusable option sets.
8. Existing curated lists are preserved before cleanup even when their old screen/Role model is obsolete.
9. **Avatar Wardrobe** creates isolated demo identities and allows true first-person testing through real onboarding and product flows.
10. Current Roles govern new Wardrobe scenarios; legacy Collaborator/Friend roles do not return as base Roles.
11. Demo identities/data remain isolated and visibly identifiable where needed.
12. The administrator always has a persistent, direct path back to the Admin Hub.
13. **Mailroom** receives user Help/Support reports as structured Support Cases and allows Admin response, private notes, assignment and problem clustering.
14. **Test Lab** converts reports into reproducible QA signals and connects naturally to Wardrobe demo scenarios.
15. **Control Room** may surface system health to separately authorized operators without merging product-admin permission with unrestricted infrastructure access.
16. User-facing support problems remain Support Cases; they do not automatically become user-facing Resolutions.
17. Admin access to user information is limited to legitimate operational purpose.
18. No Replit-era file containing unique curated vocabulary or Admin behavior is deleted until it is **Captured, Legacy Preserved, Reconstructed, or deliberately Superseded**.

The simplest expression of the Admin Suite is:

**Roundhouse in front. Backstage controls, testing, support and product stewardship behind the curtain.**

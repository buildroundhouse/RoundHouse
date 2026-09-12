# ROUNDHOUSE — ADMIN SUITE

## Purpose

The Admin Suite is Roundhouse's hidden operator workspace.

It is **not** part of the normal homeowner, Trade Professional, team-member, or Property navigation. It exists so authorized Roundhouse administrators can manage system-wide game mechanics, reusable labels, demo identities, and related operator functions without exposing those controls to ordinary users.

This document preserves both:

1. the **functional purpose** of the Admin Suite; and
2. its **distinct theatrical visual identity**.

The Admin Suite must not be rebuilt as a generic corporate dashboard.

---

## Hidden Entry

The deliberate entry point is the Roundhouse logo on the Sign In screen.

**Long-press the logo for approximately 600 ms → Admin Sign In.**

The normal Sign In form changes into a visibly distinct Admin Sign In state. Authentication still uses the normal identity system; administrator authority is determined separately by Roundhouse.

Once an authenticated account is recognized as a Roundhouse admin, the account enters the **Admin Lobby** rather than the ordinary Command Center.

This hidden-door interaction is part of the Admin Suite's character and should be preserved unless a future security or platform requirement makes a different entry mechanism necessary.

A fallback technical route may exist for development or recovery, but it is not the primary designed user experience.

---

# 1. Admin Lobby — "Behind the Curtain"

The Admin Lobby is intentionally theatrical.

It should feel like entering a private backstage room that ordinary Roundhouse users never see.

The current visual composition establishes the governing character:

- deep velvet / near-black background;
- burgundy and oxblood gradients;
- brass and warm gold trim;
- glowing marquee bulbs;
- a curtain-like divider;
- oversized **ADMIN** marquee;
- three large door-like destinations;
- brass plaques, knobs, borders, and uppercase labels;
- restrained neon accents used as glow, not as the primary palette.

The top marquee reads conceptually as:

**Behind the curtain**  
**ADMIN**

The lobby presents three doors:

1. **Game Room**
2. **Label Room**
3. **Avatar Wardrobe**

The lobby should continue to feel like a private club, backstage theater, old arcade, and workshop blended together—not like Settings or a database console.

### Governing Palette

The existing implementation establishes these important colors:

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

These colors are not incidental implementation details. They define the visual personality of the Admin Suite.

---

# 2. Shared Room Language

Each Admin room uses the same basic backstage visual system while receiving its own accent color.

A room opens over a dark gradient and includes:

- a small brass-style **Lobby** return chip;
- a framed marquee with rows of glowing bulbs above and below;
- small uppercase marquee kicker;
- large heavy room title;
- short uppercase room tagline;
- circular outlined room crest/icon;
- dark translucent **Velvet Cards** with thin accent borders;
- rounded outline action buttons styled like brass controls.

The room system should maintain generous spacing and a tactile, slightly physical quality.

The intent is not realism. It is a stylized interface that feels like **controls hidden behind the public-facing Roundhouse experience**.

---

# 3. Game Room

## Character

The Game Room is the most arcade-like room.

Its governing visual language is:

**Velvet / Oxblood + Brass + selective Neon Magenta glow.**

The landing marquee uses language such as:

**Insert Coin**  
**Game Room**

The room represents the machinery behind Roundhouse points, competition, and prizes.

## Functions

The Game Room currently supports five administrative areas:

### Stats

System-wide point and participation statistics, including total points, events, users, and event-category breakdowns.

### Scores

Administrators can inspect and change the points awarded for individual event types.

A change here can affect Roundhouse's live points system, so this is a true operator control rather than a display-only page.

### Scoreboard

A ranked list of users by accumulated points, including point totals, event counts, and tier/status information.

### User Drill-Down

An administrator can inspect an individual user's point total and point-event history.

The existing implementation also exposes relevant account/contact information needed for legitimate administrative functions.

### Prizes

The Admin Suite can manage prize eligibility and fulfillment.

The existing flow includes states such as:

**Eligible → Selected → Shipped**

The administrator can see the information legitimately needed to fulfill a prize, including mailing/contact information where available.

## Governing Principle

**The Game Room controls the rules and administration of the Roundhouse points economy.**

It should remain visually playful even when the underlying function is serious.

---

# 4. Label Room

## Character

The Label Room feels more like a cabinetmaker's sample room, atelier, or old workshop than an arcade.

Its visual language is:

**Walnut + Brass + Parchment**, with colored swatches representing the individual label families.

The landing language includes concepts such as:

**Atelier**  
**Swatch Wall**  
**Scrap Drawer**

This language is worth preserving because it makes an administrative taxonomy tool feel like part of Roundhouse rather than a spreadsheet editor.

## Functions

The Label Room manages reusable controlled labels used throughout Roundhouse.

Examples in the existing system include sets for:

- Home priorities
- Maintenance focus
- Trades
- Service categories
- Work-order categories
- Work-order priorities
- Tokens
- Titles

The specific set names can evolve with the current architecture, but the underlying function remains.

Administrators can:

- create labels;
- rename labels;
- reorder labels;
- group labels where appropriate;
- move labels between groups;
- archive/retire labels;
- restore or continue resolving historical labels without rewriting old records.

### Historical Integrity

A label uses a stable underlying identity.

Renaming a label changes how that identity is presented without rewriting the historical record that used it.

Archiving places a label in the conceptual **Scrap Drawer**:

- it disappears from new selections;
- existing records continue to show the label they were assigned.

## Governing Principle

**Labels may be retired or renamed without destroying history.**

---

# 5. Avatar Wardrobe

## Character

The Wardrobe is backstage in the most literal sense.

Its visual language is:

**Emerald / Emerald Deep + Brass**, with hanger/rack imagery and theatrical language such as:

**Backstage**  
**The rack is empty**  
**Step into avatar**

The purpose is to make administrative testing feel like putting on another identity rather than manipulating raw user records.

## Functions

The Wardrobe allows an authorized administrator to create and manage **demo identities**.

A demo identity behaves like a real Roundhouse user for testing purposes while remaining explicitly marked as demo data.

The administrator can:

- create a new demo identity;
- send that identity through the same onboarding/intake experience as a real person;
- **step into / wear** that identity;
- experience Roundhouse from that user's point of view;
- create realistic demo Properties/Entities and interactions;
- return to the Admin Suite;
- delete a demo identity when it is no longer needed.

The value of the Wardrobe is not merely generating test data. It allows the administrator to **experience the actual application from another Role's perspective**.

### Demo Isolation

Demo identities must not contaminate normal production discovery.

They may behave normally inside the controlled test environment, but ordinary users should not discover them as if they were genuine Trade Professionals, homeowners, or other participants.

Demo-created Properties and Entities should likewise remain visibly identifiable as demo data where they could otherwise be mistaken for real production records.

### Current Role Architecture Governs

Some existing Replit-era Wardrobe code still contains legacy role names such as **Collaborator**.

Those names are **not** authoritative.

The Wardrobe concept is preserved, but any rebuilt demo-role choices must follow the current Roundhouse governing Roles and permissions, including the current use of **Viewer** rather than Collaborator.

---

# 6. Returning From a Demo Identity

When an administrator is wearing a demo identity, Roundhouse needs an unmistakable way to return to the real administrator identity / Admin Hub.

The existing implementation uses a persistent **Hub / Exit** affordance while the admin is operating through the application.

The exact mechanics may evolve, but the governing requirement is:

**An admin must never become trapped inside a demo identity or confuse the demo identity with their real admin identity.**

---

# 7. Admin Authority and Privacy

The hidden entry gesture is not itself security.

Actual Admin Suite access requires authenticated administrative authority.

The UI may hide these screens from ordinary users, but server-side permissions remain the real access boundary.

Administrative access to personal information must remain tied to legitimate operational functions. The Admin Suite is not a blanket license to expose private user information merely because a person is an administrator.

---

# 8. Separate Operator / Server Administration

Roundhouse also contains lower-level server/operator administrative tooling for functions such as maintenance, purge operations, deployment support, and system health.

That tooling is **not the same product surface as the Admin Suite described here**.

The distinction is:

**Admin Suite = Roundhouse product administration with a deliberate visual experience.**  
**Operator / Server Admin = technical system maintenance.**

They may share authentication concepts or backend services, but they should not be casually merged into one giant dashboard.

---

# Protected Visual / Implementation References

Until the Admin Suite is deliberately rebuilt under this architecture, the following existing files are important visual and behavioral references and should not be removed as generic "Replit leftovers":

- `artifacts/round-house/app/(auth)/sign-in.tsx`
- `artifacts/round-house/app/account/admin.tsx`
- `artifacts/round-house/app/account/rooms/game-room.tsx`
- `artifacts/round-house/app/account/game-room.tsx`
- `artifacts/round-house/app/account/rooms/label-room.tsx`
- `artifacts/round-house/app/account/preset-chips.tsx`
- `artifacts/round-house/app/account/wardrobe.tsx`
- `artifacts/round-house/components/admin/RoomShell.tsx`
- `artifacts/round-house/components/admin/AdminQuickExit.tsx`
- `artifacts/round-house/lib/adminTheme.ts`

Relevant backend/data support for Game Room, preset labels, and demo identities should likewise be treated as active reference architecture until intentionally replaced.

---

# Governing Rules

1. **The Admin Suite is a hidden Roundhouse operator environment, not part of normal user navigation.**
2. Long-pressing the Sign In logo is the designed hidden doorway into Admin Sign In.
3. Actual authority is enforced by authenticated admin permissions, not by knowledge of the hidden gesture.
4. The Admin Lobby retains its **Behind the Curtain** theatrical identity.
5. The visual language—velvet, oxblood, walnut, emerald, brass, bulbs, marquees, curtains, plaques, workshop/arcade language—is part of the product and must not be discarded during rebuild.
6. **Game Room** governs points, score rules, scoreboards, user point history, and prize administration.
7. **Label Room** governs reusable controlled labels while preserving historical identity through rename/archive operations.
8. **Avatar Wardrobe** creates isolated demo identities and lets an admin experience Roundhouse as those identities.
9. Demo identities and demo-created data must remain visibly and technically isolated from normal discovery where necessary.
10. Legacy Replit role names inside the Wardrobe do not override the current governing Role architecture.
11. The administrator must always have a clear path back from a worn demo identity to the Admin Hub.
12. Product-facing Admin Suite screens remain conceptually separate from lower-level server/operator maintenance tooling.
13. Existing Admin Suite implementation files are **protected references** until a deliberate replacement preserves both their behavior and their visual character.

The simplest expression of the Admin Suite is:

**Roundhouse in front. Backstage controls behind the curtain.**

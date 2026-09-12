# Roundhouse Property Asset Detail

## Purpose

The Property Asset Detail screen is the permanent service passport for one physical asset or piece of equipment belonging to a Property.

It lives inside:

**Property Entity → Vault → Assets & Equipment → Asset Detail**

The Asset Detail should feel like a **miniature Entity page inside the Property Vault**. It is not a separate Entity in the data model, but visually it borrows the same identity-first language so the person always knows exactly which piece of equipment they are looking at.

Examples include:

- HVAC systems
- water heaters
- electrical panels
- pumps
- generators
- appliances
- pool equipment
- irrigation controllers
- security equipment
- other serviceable Property assets

---

## 1. Asset Identity Header

The top of Asset Detail uses a compact Entity-like header rather than a plain form.

### Asset image

A strong representative photo identifies the physical asset.

The image should be large enough to make the equipment immediately recognizable without consuming excessive vertical space.

### Asset identity

Beside or directly beneath the image, show the most useful identifying information:

**Trane XR15 Heat Pump**  
Outdoor Unit · Back Yard

Secondary identity can include:

- category
- asset tag
- model number
- serial number

The screen should prioritize recognition first and technical metadata second.

---

## 2. Compact Status Strip

Immediately below the identity header is a simple status strip.

Example:

**Operational · Last serviced May 14 · Next maintenance Nov. 14**

The strip may surface useful states such as:

- Operational
- Needs Attention
- Out of Service
- Maintenance Due
- Warranty Active / Expired when useful

This is not a diagnostic certification system. Status reflects the best current Roundhouse record and authorized observations.

---

## 3. Primary Action — Create Work

A prominent authorized action appears near the top:

**Create Work**

This allows a person who identifies a problem to create a Work item already linked to:

- the current Property
- the exact Asset
- the current person / requester

Example:

**Vault → Water Heater → Create Work**

The new Work item should not require the user to reselect the Property or equipment.

If work later becomes scheduled, Calendar governs the appointment. If actual work begins, CAPTURE governs the real work session.

---

# 4. Internal Asset Sections

The Asset Detail uses four simple internal sections:

**Overview | Maintenance | History | Documents**

These sections remain inside the Asset Detail screen rather than sending the person through unrelated app areas.

---

## 4.1 Overview

Overview contains the durable identity and reference information for the Asset.

Possible fields include:

- Asset name
- Category
- Property location
- Asset tag / identifier
- Manufacturer
- Model number
- Serial number
- Installation date
- Installer / provider when known
- Warranty information
- expected useful reference life where intentionally recorded
- notes
- representative photographs
- useful technical specifications

Overview should remain practical rather than becoming a generic equipment database.

The old asset architecture already supports the core identity model of:

**Photo + Name + Asset Tag + Category + Location + Notes**

The new Asset Detail expands that information into a durable service passport.

---

## 4.2 Maintenance

Maintenance shows the recurring care and Standards directly related to this Asset.

Examples:

- Replace HVAC filter every 90 days
- Annual furnace inspection
- Flush water heater yearly
- Test generator monthly
- Inspect sump pump quarterly

A Maintenance item can show:

- title
- cadence
- current state
- last completed
- next due
- assigned person when applicable

Standards may also be attached when they express an expected Asset condition.

Example:

**Standard: No visible leaks at water heater**

The Asset Detail does not create a parallel maintenance system. It presents the subset of the Property's Maintenance architecture connected to this Asset.

Tapping a maintenance item opens the governing Maintenance / Standard record.

---

## 4.3 History

History is the chronological service record for the Asset.

It should visually read like an Asset-specific Timeline.

Examples of history events:

- installation
- inspection
- scheduled maintenance completed
- repair
- failed component
- part replacement
- service call
- CAPTURE work session
- Standard evidence
- warranty service
- condition note
- Asset moved / replaced / retired

Example:

**May 14 — Annual HVAC Service**  
DMT DESIGN BUILD  
CAPTURE completed · condenser cleaned · capacitor tested

**Jan. 8 — Repair**  
Contactor replaced  
Invoice #108

**Sept. 3, 2025 — Installed**  
Trane XR15 Heat Pump

History should link back to the underlying Work, CAPTURE, Estimate / Invoice, Maintenance, Standard, document, or other Record rather than duplicating those records.

The result is a durable service history that survives changes in Homeowners, contractors, and workers according to Property record rules.

---

## 4.4 Documents

Documents contains durable files specifically related to the Asset.

Examples:

- owner's manual
- installation manual
- warranty
- purchase receipt
- installation invoice
- inspection report
- service bulletin
- product specification sheet
- equipment photographs
- permits or related reports when applicable

These files remain Property Records and may also be discoverable through the broader Property Vault / Documents view.

The Asset Detail provides the predictable retrieval point for files belonging to this exact piece of equipment.

---

# 5. Connection to Work

Work items can attach directly to an Asset.

This allows Work to answer not only:

**What needs to be done at this Property?**

but also:

**What exactly are we working on?**

An Asset-linked Work item can appear in:

- Property Work
- authorized Business Work
- assigned worker views
- Asset History

without becoming duplicate records.

---

# 6. Connection to CAPTURE

CAPTURE remains the real-time evidence system for work performed on the Asset.

When a worker begins CAPTURE from an Asset-linked Work item, the Property and Asset context should already be known.

Relevant CAPTURE results can feed Asset History, including:

- starting condition photos
- Mid-Job Capture
- completed photos
- task results
- materials / parts used
- service notes
- check-in / check-out context

CAPTURE documents what happened. Asset Detail organizes that history around the equipment.

---

# 7. Connection to Maintenance and Standards

The Asset can be the subject of Routine Maintenance and Standards.

Maintenance determines what should happen repeatedly.

Standards define the condition the Asset should remain in.

If a routine becomes due or a Standard drifts, actionable work can surface into Work while the Asset Detail continues to show the underlying maintenance relationship and permanent history.

---

# 8. Connection to Estimates / Invoices

Estimates and Invoices may be linked to Asset-related work when appropriate.

Asset History can display the relationship without turning the Asset screen into an accounting ledger.

Example:

**Contactor Replacement**  
Work completed Jan. 8  
Invoice #108 · Paid

The Estimate / Invoice system remains the governing financial record.

---

# 9. Permissions

Asset visibility follows Property permissions.

Authorized Trade Professionals and Trade Team Members may need broad enough Asset visibility to safely and effectively perform work, including model, location, service history, manuals, relevant Standards, and prior conditions.

Private internal Business notes do not automatically become Property-visible merely because they relate to the Asset.

Owners / authorized Property authorities may manage durable Asset records according to governing authority rules.

---

# 10. Lifecycle

An Asset should not simply disappear when replaced.

Possible lifecycle states include:

- Active
- Out of Service
- Replaced
- Retired

When an Asset is replaced, its historical service record remains preserved.

A replacement Asset becomes its own Asset record and may reference the Asset it replaced.

This protects the long-term Property history.

---

## Governing Rule

**An Asset Detail is the permanent service passport for one physical thing at the Property: what it is, where it is, how it should be maintained, what has happened to it, and the records that belong to it.**

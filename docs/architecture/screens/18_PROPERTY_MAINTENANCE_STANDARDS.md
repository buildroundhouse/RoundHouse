# Roundhouse Property Maintenance & Standards

## Purpose

Maintenance is the third right-edge working tab inside the Property Entity.

It is the Property's ongoing care system: what should continue to happen, what condition the Property should remain in, what is coming due, and what has drifted out of the expected state.

Maintenance is intentionally split into two internal views:

**Routine Maintenance | Standards**

They are related but not interchangeable.

**Routine Maintenance = do this again on a cadence.**  
**Standards = keep this Property in this expected condition.**

Maintenance does not replace Work, CAPTURE, Calendar, Resolution, or Vault. It coordinates with them.

---

## 1. Maintenance Working Sheet

Tapping **Maintenance** opens a Property-scoped working sheet over the Property Timeline, preserving the Entity context and right-edge navigation behavior.

The top of the sheet shows the Property identity and a compact maintenance health strip:

**On Track · Due Soon · Overdue**

This is not intended to become a dense analytics dashboard. It gives the person an immediate read on the Property's care state.

Directly beneath the health strip is the internal switch:

**Routine Maintenance | Standards**

The selected view controls the cards below without leaving the Maintenance sheet.

---

# 2. Routine Maintenance

Routine Maintenance contains repeating care activities for the Property.

Examples include:

- HVAC filter replacement
- water-heater flush
- pool service
- smoke / CO detector checks
- gutter cleaning
- pest service
- seasonal HVAC service
- irrigation inspection
- recurring cleaning
- other repeating Property care

## Routine Maintenance Cards

Each card should feel like a Property care routine rather than a Work Order.

A card may show:

- maintenance title
- cadence
- next due date / relative time
- assigned person when applicable
- current state
- short description when useful

Example:

**HVAC Filter**  
Every 90 days · Due in 12 days  
Assigned: Danny  
**On Track**

Example:

**Water Heater Flush**  
Yearly · 18 days overdue  
**Needs Attention**

## Cadence

The preserved cadence model supports useful defaults such as:

- Daily
- Weekly
- Every 2 weeks
- Monthly
- Custom day interval

Additional practical periods such as quarterly, semiannual, annual, or seasonal can be supported where the product requires them.

A recurring maintenance rule remains the durable template. When an occurrence becomes due, Roundhouse can create or surface an actionable item in **Work** rather than forcing the user to manage execution inside the maintenance template itself.

## Assignment

A maintenance routine may be assigned to an authorized Home Team Member, Trade Professional, Trade Team Member, or other legitimate participant according to Property permissions.

Assignment identifies expected responsibility. It does not grant broader Property access than the person's Entity permissions allow.

## Active / Paused

A recurring routine can be **Active** or **Paused**.

Paused means Roundhouse stops generating or surfacing future occurrences until the routine is reactivated. Pausing does not erase prior maintenance history.

## Routine → Work

When maintenance becomes due:

**Maintenance Rule → Due Occurrence → Work**

Work then handles responsibility and execution.

If scheduled time is needed, Calendar governs the appointment.

If a dependency or unresolved decision blocks execution, Resolution may govern that unresolved issue.

If actual work is performed, CAPTURE documents the real work session.

When completed, the outcome becomes Property history and can contribute to the permanent service record in Vault.

---

# 3. Standards

Standards define the condition the Property is expected to remain in.

A Standard is not merely a repeating task. It is a standing expectation that can be checked and evidenced over time.

Examples:

- Pool chemistry remains within the expected range
- exterior lights are operational
- fire extinguishers are present and current
- mechanical room remains clear and accessible
- landscaping remains within agreed condition
- critical equipment is visibly free of leaks
- guest-unit turnover condition meets the Property's defined expectation

## Standards View

Standards appears as its own internal view beside Routine Maintenance:

**Routine Maintenance | Standards**

The Standards view uses a clean vertical stack of cards.

A card may show:

**Pool Chemistry**  
Check weekly  
Last met: Sept. 8 · Next check: Sept. 15  
Evidence: Photo  
**On Track**

or:

**Exterior Lights Operational**  
Check monthly  
Last met: July 20  
**Drift — Needs Attention**

The visual priority is the condition and its current health, not administrative metadata.

---

## 4. Standard Definition

An authorized person creating or editing a Standard can define:

- title
- description
- cadence / check interval
- required evidence type
- optional keyword / recognition aid where useful
- reusable quick phrases for recurring documentation

Preserved evidence types include:

- **Log / Note**
- **Photo**
- **Rating / Confirmation**

The final customer-facing wording may be simplified, but Roundhouse should preserve the ability for different Standards to require different kinds of proof.

## Quick Phrases

Standards may offer reusable quick phrases drawn from approved prior wording or deliberately configured phrases.

Example:

- `Pool cleaned and chemistry balanced`
- `No visible leaks`
- `All exterior fixtures operational`

Quick phrases reduce repetitive typing. They are shortcuts, not automatic evidence; the person still deliberately records that the Standard was met.

---

# 5. Standard Detail

Tapping a Standard card opens a **Standard Detail** view inside the Property context.

The top shows:

- Standard title
- full description
- cadence
- required evidence
- current status
- last time met
- next expected check

A prominent authorized action appears when appropriate:

**Meet Standard**

Meet Standard collects the evidence required by that Standard.

Examples:

- Photo Standard → capture / attach photo
- Note Standard → add note or approved quick phrase
- Rating / Confirmation Standard → provide the permitted confirmation

The resulting evidence is timestamped and attributed to the person who supplied it.

---

# 6. Evidence History

Below the current Standard details is its chronological evidence history.

Example:

**Sept. 8 — Met**  
Photo + `Pool cleaned and chemistry balanced`  
Mike Rodriguez

**Sept. 1 — Met**  
Photo

**Aug. 25 — Met**  
Note

Evidence history may contain:

- date / time met
- person who recorded it
- photo where applicable
- note
- relevant supporting record

Authorized corrections can be made according to record rules, but the purpose of the history is to preserve a trustworthy recurring condition record rather than a disposable checklist.

---

# 7. Drift

**Drift** means a Standard has moved outside its expected check interval or there is evidence that the expected condition is no longer being maintained.

Drift is a Property condition signal, not its own competing task system.

A Standard may visually move through simple states such as:

- **On Track**
- **Due Soon**
- **Drift / Needs Attention**

Roundhouse should avoid alarm fatigue. A Standard becoming slightly late should not automatically create the same urgency as a safety-critical failure.

The exact escalation treatment can consider Standard importance later.

## Drift → Work

When Drift requires action, Maintenance can create or surface actionable work in **Work**.

Example:

**Standard:** Exterior Lights Operational  
**Drift detected:** rear fixture not working  
→ **Work:** Repair rear exterior light

The Standard remains the standing expectation. The Work item handles the corrective action.

When corrective work is completed and appropriate evidence is recorded, the Standard returns to an on-track state without erasing the historical drift event.

---

# 8. Relationship to Other Property Systems

## Work

Work handles what needs to be done now.

Maintenance may feed due or corrective work into Work.

## CAPTURE

CAPTURE documents what actually happened during a real work session.

A Maintenance occurrence or Standard-related Work item can link to CAPTURE results rather than duplicating photos, materials, time, and completion evidence.

## Calendar

Calendar schedules time.

A maintenance routine may create or link to an appointment, but the Maintenance tab does not become a second scheduling system.

## Resolution

Resolution handles genuine unresolved dependencies, approvals, questions, or decisions.

Maintenance should not create a Resolution merely because something is due.

## Vault

Vault preserves the durable Property record.

Completed maintenance, equipment service history, Standard evidence, related manuals / reports, and other permanent Property information may be retrieved through Vault according to the final Vault architecture.

The Maintenance sheet remains the active care workspace; Vault remains the durable retrieval destination.

## Timeline

Meaningful Maintenance events can appear on the Property Timeline according to record and visibility rules, including important completion, evidence, drift, corrective work, or service events.

Routine system calculations do not need to clutter the Timeline.

---

# 9. Permissions

Maintenance is Property-scoped and permission-aware.

A Homeowner / authorized Property authority may create and manage routines and Standards.

Home Team Members, Trade Professionals, and Trade Team Members may see, fulfill, document, or manage particular Maintenance items according to their Role and permissions.

A person does not gain access to unrelated Property information merely because they are assigned one maintenance item.

Internal Trade documentation remains private unless the governing Record is deliberately shared into the Property-visible record.

---

# 10. Governing Maintenance Flow

**Define Care → Monitor Cadence / Condition → Surface Due or Drift → Work → Calendar when scheduled → CAPTURE actual work → Record Result → Vault preserves history**

---

## Governing Rule

**Maintenance defines how the Property should be cared for. Work handles what needs doing now. CAPTURE documents what actually happened. Vault remembers it.**

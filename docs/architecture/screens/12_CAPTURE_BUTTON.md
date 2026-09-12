# ROUNDHOUSE — CAPTURE BUTTON

## Purpose

**CAPTURE is Roundhouse’s primary daily work-recording control.**

It creates the factual Timeline of a workday: arrival, planned work, estimates, progress, photographs, completed tasks, breaks, shopping trips, materials, changes, invoicing, client wrap-up, and departure.

**Tap CAPTURE = Daily Log / Work Session**  
**Press and hold CAPTURE = Concierge**

CAPTURE works independently. Concierge may assist, but it is not required.

---

## Daily Log

CAPTURE activity becomes part of the chronological **Daily Log / Timeline**.

Photos, notations, task updates, breaks, shopping trips, scope changes, estimates, invoices, and work-session events belong to this record. They do not automatically become Notes or Daily Grind items.

**Document the day while the day is happening.**

---

## Arrival and Check-In

If the worker used **Navigate to Property**, GPS arrival should prompt:

**You’ve arrived — Check In?**

Checking in:

- creates a precise real-time timestamp,
- starts the Property work session and work clock,
- and creates the first Timeline event.

Roundhouse then recommends an **arrival photo**, ideally the front of the Property.

The worker does not need a finished task list before checking in. They may already be unloading materials, organizing tools, reviewing purchases, inspecting the site, or waiting for the client.

**Arrival → Check In → Optional Arrival Photo → Preparation / Client Meeting → Task Plan**

---

## Task Plan, Property Suggestions, and Estimate

Roundhouse asks:

**What do you plan to accomplish today?**

The worker creates a checklist and estimates each task:

☐ Replace faucet — 1 hr  
☐ Repair cabinet door — 45 min  
☐ Inspect leaking supply line — 30 min  
☐ Cleanup / Pack Out — 30 min

Times are planning estimates, not promises.

### Property List Suggestions

While the initial task list is being created, Roundhouse should surface unfinished items already associated with that Property, including:

- Open Tasks
- Unchecked Shopping List items

Completed or already checked items are excluded.

The worker remains inside the task-building flow. The surrounding screen subtly grays out while a small suggestion panel appears to **hover near the checklist being created**.

Example:

**Suggested from this Property**

Repair loose cabinet hinge — **Add**  
Pick up faucet cartridge · Shopping — **Add**  
Buy matching caulk · Shopping — **Add**

Tapping **Add** immediately inserts the item into today’s checklist without navigating away. The suggestion then shows that it has been added so it cannot be duplicated.

Nothing is automatically added. Shopping List suggestions retain their relationship to the original Shopping List record.

**Roundhouse should use what it already knows about the Property to help formulate today’s plan rather than making the worker remember and re-enter it.**

This is a desired CAPTURE behavior and may be simplified or deferred if necessary for MVP without changing the underlying work-session architecture.

### Cleanup / Pack Out

**Cleanup / Pack Out is automatically added as the final task.**

Roundhouse provides an estimated cleanup time that the worker can adjust. It contributes to the projected completion time and must ultimately be marked **Completed** or **Left Unfinished** like every other task.

Once the initial checklist is established, Roundhouse prompts the worker into **Estimates** so the estimate document can be produced while the work session is active.

Preparing the estimate is part of conducting the job and should occur within legitimate working time.

---

## Visual Checklist Timeline

The checklist does not appear in the Timeline as ordinary text.

Roundhouse renders it as a **visual checklist card**.

As tasks are completed, updated cards appear:

☑ Replace faucet  
☐ Repair cabinet door  
☐ Inspect leaking supply line  
☐ Cleanup / Pack Out

Previous versions remain in the Timeline.

If a task is added, a new card appears with that task highlighted.

The Timeline therefore preserves:

**Original Plan → Changes → Progress → Final Result**

These are Roundhouse-generated visual representations of the live checklist, not worker photographs.

---

## Task Documentation and Mid-Job Capture

Ideally, each meaningful task develops:

**Starting Photo → Mid-Job Photo / Notation → Completed Photo**

Roundhouse encourages this without requiring workers to interrupt productive work.

Approximately halfway through the expected work period, it may prompt for a **Mid-Job Capture**. The worker can photograph progress, add a notation, check off work, or **Skip for Now**.

Skipping the prompt does not immediately lose the opportunity.

As long as the worker is **still at the Property and the live work session remains open**, the Mid-Job Capture can still be completed and receive full real-time Points.

If the worker reaches **Cleanup / Pack Out** without one, Roundhouse prompts:

**Mid-Job Capture Missing — Capture Now for Points**

A photo, notation, or both satisfies it.

Once the worker has left and the job is being reconstructed as a Post Entry, those Points can no longer be recovered. Roundhouse displays:

**Mid-Job Capture Points Lost**

The worker must dismiss this notice before completing the Post Entry.

Roundhouse never asks someone to invent a midpoint record after the fact.

---

## Completing Tasks and Points

Checking off a completed task creates an updated checklist card.

The card can briefly animate and send earned Points toward the worker’s Points ticker.

Real-time task completion, photographs, Check In, Mid-Job Capture, accurate breaks, receipts, Check Out, and a completed work log are all high-value Point events.

The system rewards interaction without making the worker a slave to the app.

---

## Changes During the Job

More time does **not** automatically mean more scope or more money.

### Taking Longer

The original work requires more time than estimated. The worker revises the expected completion time while the original estimate remains preserved.

### Shopping Trip

Example:

**Need caulk — shopping trip required.**

The worker may have forgotten something that reasonably should have been on the truck. The job takes longer, but that does not automatically mean the client should pay for the additional travel.

Roundhouse separates:

**Billable · Non-Billable · Requires Approval**

### New Condition / Scope Change

A genuinely new condition—hidden leak, damaged wiring, failed component, structural issue, etc.—is documented through CAPTURE.

The record shows:

**What was discovered → what it changes → expected time/cost impact**

Additional work requiring approval is not treated as authorized until approval is received.

---

## Breaks, Shopping Trips, and Materials

Roundhouse distinguishes:

**Lunch Break**  
**General Break**  
**Shopping Trip**

Lunch and General Break pause active work time.

Examples:

**12:06 PM — Lunch Break — Off Clock**  
**12:47 PM — Back to Work**

**2:15 PM — General Break — Off Clock**  
**2:43 PM — Back to Work**

Lunch is distinguished because the worker may leave the Property. A General Break needs no private explanation—the worker might be sitting in the truck with the AC running, taking a personal call, or discussing tomorrow’s job with the boss.

The client simply sees that the worker is **off the clock**.

A Shopping Trip is different. It remains part of the job record and requires the associated **receipt upload**. Whether the trip or purchase is chargeable remains a separate decision.

At the end of the visit, Roundhouse also asks about **materials used from truck stock**:

**Material + Estimated Cost**

This captures caulk, screws, fittings, adhesives, wire, lumber, or other materials without a same-day receipt.

Recording cost does not automatically mean charging the customer that amount.

---

## Invoice, Client Wrap-Up, and Final Pack-Out

When the work tasks are completed but **Cleanup / Pack Out remains open**, Roundhouse prompts:

**Prepare Invoice**

The invoice should be prepared while the worker is still legitimately on the job clock.

This matters because presenting the invoice does not necessarily mean the business interaction is over. The client may review the completed work, ask questions, discuss the invoice, make payment, or show the worker additional work for a future visit. That conversation can easily take another half hour, and the worker’s professional time should not become free simply because the physical repair has been completed.

### Mr. Handyman Principle

When working for Mr. Handyman, the training taught a practical version of this principle.

The technician would essentially complete the cleanup but intentionally leave a very small visible final task—a few tools out or a small pile still needing to be swept. The invoice would then be presented and the client conversation completed. Afterward, the technician performed the final quick sweep, packed the remaining items, and left.

The customer felt they were not simply paying someone to clean up, while the technician’s invoicing, payment, questions, and business conversation still occurred during the legitimate service visit.

Roundhouse does not need workers to stage a mess, but it should preserve the underlying principle:

**The work session is not finished merely because the repair itself is finished.**

**Work Complete → Cleanup Essentially Complete → Invoice / Client Wrap-Up → Final Cleanup / Pack Out → Check Out**

---

## Check-Out

After invoicing, client wrap-up, and final Cleanup / Pack Out, CAPTURE provides **Check Out**.

Real-time checkout creates a precise departure timestamp.

The final visual checklist card requires every task to be:

**☑ Completed**

or

**☐ Left Unfinished**

Anything unfinished requires a reason or next step, such as:

- Follow-up visit required
- Waiting on approval
- Materials required
- Removed from today’s work
- No longer required

A completion photograph is encouraged for each completed task.

The final card answers:

**What was planned → what changed → what was completed → what remains**

---

## Post Entry

Workers can complete part or all of a work log afterward.

Anything entered after the live event is clearly labeled:

**Post Entry**

A worker may reconstruct the date, arrival and departure times, tasks, photos, materials, shopping trips, breaks, and results.

Post Entries still have value and earn Points, but fewer than real-time records because manually entered timestamps are less reliable.

After a Post Entry departure time is supplied, if no interruptions were entered, Roundhouse asks:

**Any breaks or shopping trips?**

Options include:

**Lunch Break · General Break · Shopping Trip · No Breaks or Shopping Trips**

A Shopping Trip requires the receipt.

Missing Mid-Job Capture is not reconstructed. The worker instead acknowledges:

**Mid-Job Capture Points Lost**

and must dismiss that notice before completing the Post Entry.

---

## Incomplete Work Logs

If a work session remains incomplete at the end of the day, the Command Center displays:

**Complete Work Log**

This leads directly back into CAPTURE.

Roundhouse does not require reconstruction of every missed moment. What must ultimately be resolved is whether each task was:

**Completed or Left Unfinished**

Later additions become **Post Entries** where appropriate.

If the log remains incomplete the next morning, **Daily Grind prominently surfaces it and insists that it be completed while the information is still fresh.**

---

## Points Philosophy

The basic hierarchy is:

**Real-time complete work log = highest Points**  
**Real-time log missing Mid-Job Capture = fewer Points**  
**Complete Post Entry = fewer Points, but still rewarded**  
**Incomplete work log = unresolved and lowest value**

Workers can skip intrusive prompts and keep working.

As long as the live job session remains open, they can still add the Mid-Job Capture and earn those Points before final pack-out.

**Roundhouse should reward documentation without interfering with craftsmanship.**

---

## Concierge

Press and hold CAPTURE to activate **Concierge**.

Concierge can help organize tasks, interpret photographs, prepare customer communication, document changed conditions, or assist with the work session.

It assists CAPTURE; it does not replace it.

---

## Governing Workflow

**Arrival → Check In → Arrival Photo → Preparation → Task Plan + Property Suggestions → Estimate → Work → Mid-Job Capture → Task Completion → Cleanup Essentially Complete → Invoice / Client Wrap-Up → Final Cleanup / Pack Out → Materials → Check Out → Final Checklist**

The finished Timeline should answer:

**What was planned? What changed? What was completed? What remains? What did it cost? And how reliably was it documented?**

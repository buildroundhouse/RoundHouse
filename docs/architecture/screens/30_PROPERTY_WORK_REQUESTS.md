# Roundhouse Property Work Requests

## Purpose

**Request Work** is the Property-side front door for asking an authorized Business to actually do work at a Property.

Its home is:

**Property Entity → Work → Request Work**

It answers:

**Something at this Property needs to be done. How do I ask the right Business to take responsibility for the work?**

A legitimate Work Request enters the shared Work architecture at **Requested** and can continue through the normal lifecycle:

**Requested → Open → Assigned → In Progress → Complete → Verified**

There is no separate Client Requests system and no duplicate Work Order.

---

# 1. Governing Boundary

Roundhouse separates three different kinds of interaction:

**Work Request** = I am asking an authorized Business to do actual work.  
**Resolution** = I need a specific person or group to answer, decide, approve, clarify, select, provide information, or complete some other required outcome.  
**Discover → Ask a Pro** = a future public question to the broader professional ecosystem.

Examples:

**Please repair the leaking upstairs sink.** → Work Request  
**Is this water-heater sound normal?** → Resolution when directed to someone in an existing relationship  
**Which tile do you want?** → Resolution  
**Can we access the house Tuesday?** → Resolution  
**Public question to plumbers in my area** → Discover → Ask a Pro

Work must not become a second Q&A or messaging system.

---

# 2. Placement

Request Work is not another Property right-edge tab.

The permanent path is:

**Property Entity → Work → Request Work**

For an authorized Homeowner / Property authority, the Work screen can expose a clear **Request Work** action.

For Trade Professionals / Managers with operational creation authority, the existing **+ Create Work** action remains appropriate.

These actions reach the same Work architecture from different intent:

- **Request Work** = homeowner / Property participant asks an authorized Business to take on real work;
- **Create Work** = authorized operational participant creates Work directly.

---

# 3. Who Can Receive a Work Request

Request Work is normally addressed to a Business that already has a legitimate relationship to the Property.

If only one appropriate Business is authorized / connected, Roundhouse should preselect it.

If multiple Businesses are legitimately connected, the requester chooses the intended Business.

Request Work should not quietly expose unrelated Businesses or create a new Property relationship merely because a Business exists in global search.

Finding a new Business belongs to the Profile's Find / Entity Search and future Discover ecosystem.

---

# 4. Request Work Flow

The creation flow should be lightweight.

Because the person is already inside the Property Entity, the Property is automatically known.

Useful fields include:

- **What needs to be done?**
- short description;
- area / room when useful;
- related Asset / Equipment when known;
- photos / files;
- urgency / priority when appropriate;
- receiving Business when more than one legitimate Business is available.

The requester should not need to understand internal assignment or Business workflow states before submitting a legitimate Work Request.

---

# 5. The Work Request Record

The request preserves useful source information such as:

- requester;
- Property;
- receiving Business;
- original work request / description;
- submitted photos / files;
- area / Asset relationship;
- submission time;
- request source;
- current Work state;
- resulting Calendar, Estimate / Invoice, CAPTURE, Resolution, or other legitimate relationships.

The original request remains visible after acceptance so nobody has to reconstruct why the Work exists.

---

# 6. Business Work Intake

A submitted Work Request appears to the authorized receiving Business in:

**Business Entity → Work → Requested**

It is the same underlying Work Record visible in Property Work.

The Business Work card should make useful intake context obvious:

- Work request title;
- Property;
- requester;
- age of request;
- urgency when meaningful;
- photo / Asset cue when useful.

Example:

**Repair upstairs sink leak**  
Spring Lake Residence  
Requested by Sarah Miller  
12 min ago  
**Requested**

The Business should not need a separate Client Requests application to discover the request.

---

# 7. Business Intake Actions

An authorized Business participant can open the Requested item and take an appropriate operational action.

Typical actions include:

- **Accept / Open Work**;
- **Assign** when responsibility is known;
- **Schedule Visit** when inspection or service time is required;
- **Prepare Estimate** when scope / price must be established;
- **Create Resolution** when an answer, approval, selection, clarification, access decision, or other dependency is required;
- **Decline / Close** when legitimate.

A question or dependency should not be managed through ad hoc comments merely to keep the Work moving. When a real answer or decision is required, use Resolution.

---

# 8. Acceptance

When the Business accepts the request as actual Work, the same Record moves forward in the governing lifecycle.

Typical transition:

**Requested → Open**

From there the Business may:

- assign responsibility;
- establish priority;
- schedule an appointment;
- connect an Asset;
- create an Estimate where needed;
- begin execution through CAPTURE.

The requester relationship remains preserved.

Roundhouse does not create a second Work item merely because a request was accepted.

---

# 9. Resolution Integration

If the Business needs an answer, decision, approval, selection, clarification, information, or required action from another person, that dependency belongs in **Resolution**.

Examples:

- Which fixture do you want?
- Can we enter the Property Tuesday morning?
- Please approve this change.
- Send the model number from the equipment label.
- Is this finish acceptable?
- Do you want repair or replacement?

The Work item remains the job.

The Resolution represents the unresolved matter affecting that job.

The Resolution may pass responsibility back and forth until the creator can verify the required outcome and close it.

When the Resolution is completed, Work can continue without creating a second job or losing the decision history.

**Work = the job. Resolution = the thing that must be settled so the job can move forward.**

---

# 10. Scheduling

A Business may need to inspect or perform work before the full scope is complete.

**Schedule Visit** creates or links the appropriate Calendar appointment.

Calendar governs time.

The Work Record governs why the appointment exists.

A confirmed appointment should not be silently rewritten merely because Work metadata changes.

---

# 11. Decline / Close

A Business may legitimately decline or close a Requested Work item when it cannot or should not perform the requested work.

Examples:

- outside scope / trade;
- Business no longer serves the Property;
- safety / licensing boundary;
- duplicate request;
- requester withdraws the request.

The reason can be preserved when useful.

Closing does not erase the original request Record.

---

# 12. Requester View

The Homeowner / requester should see understandable progress rather than the Business's full internal workflow complexity.

Useful requester-facing states may include:

- **Sent**;
- **Reviewing**;
- **Accepted**;
- **Scheduled**;
- **In Progress**;
- **Completed**;
- **Closed**.

When a Resolution requires the requester's response, the Work view may clearly surface that there is a matter needing attention, while Resolution remains the governing responsibility system.

---

# 13. Comments and Mail

Work-focused comments may exist because they concern execution of the Work item.

Roundhouse Mail remains the communication system between people.

Resolution remains the system for matters that must stay visibly unresolved until a required answer or outcome is obtained.

**Work comments = execution discussion.**  
**Mail = communication.**  
**Resolution = responsibility for an unresolved question / decision / required outcome.**

Do not recreate a Q&A thread inside Work Requests.

---

# 14. Discover / Ask a Pro Separation

The legacy **Ask a Pro** idea does not belong in Property Work Requests.

Its intended future home is:

**Profile → Discover → Ask a Pro**

There, a homeowner may eventually ask a public question to the broader professional community and receive answers from multiple relevant professionals.

That public discussion is separate from the private Property Work system.

If a public Discover interaction later establishes a legitimate relationship and actual work is requested, Roundhouse can then create the appropriate private Work, Resolution, Calendar, or Estimate relationship.

---

# 15. Notifications

Useful request events may generate notifications according to the broader Notifications architecture.

Examples:

- new Work Request received;
- Work Request accepted;
- assignment established;
- appointment scheduled;
- linked Resolution needs the person's attention;
- Work completed.

Notifications are not Mail and should follow user notification preferences.

---

# 16. Permissions and Privacy

Property Work Requests are permission-aware.

Examples:

- a Homeowner / authorized Property authority may request legitimate work;
- a Home Team Member may request work only when permitted;
- a Business receives only requests legitimately addressed to it through the Property relationship;
- Trade Team Members see Requests according to Business authority / assignment;
- outside Trade Partners see only Work deliberately shared / assigned to them;
- Viewers remain view-only where Work visibility is permitted.

Submitting a Work Request does not grant the receiving Business unrelated Property visibility.

Accepting Work does not grant the requester unrelated Business visibility.

---

# 17. Property and Business Timelines

Meaningful Work Request events may appear in the relevant Property / Business Timeline according to permissions.

Examples:

- Work requested;
- request accepted;
- inspection scheduled;
- resulting Work completed.

Routine internal metadata edits should not flood the Timeline.

The same underlying Work Record should be surfaced rather than copied.

---

# 18. Visual Direction

Request Work should feel like a simple way to ask a trusted Business to take care of something, not like filling out a commercial work-order form.

Visual priorities:

- one clear **Request Work** action inside Property Work;
- Property already known;
- plain-language work description;
- easy photo attachment;
- optional area / Asset selection;
- clear receiving Business;
- simple requester-facing progress;
- no project-management jargon;
- no Ask-a-Pro discussion thread;
- no duplicate Client Requests system;
- clean handoff into Business Work → Requested.

---

## Governing Relationships

**Request Work = ask an authorized Business to do actual work.**  
**Requested = the Business Work intake stage.**  
**Resolution = any specific unresolved question, decision, approval, clarification, information request, or required outcome.**  
**Discover → Ask a Pro = future public professional Q&A.**  
**Calendar = agreed time.**  
**CAPTURE = actual work-session evidence.**  
**Mail = communication between people.**

---

## Governing Rule

**A Property Work Request exists only when actual work is being requested. Questions, approvals, selections, clarifications, and other required responses belong in Resolution; public Ask a Pro questions belong in Discover. A legitimate Work Request enters the shared Work architecture at Requested and remains one underlying Record through acceptance, assignment, scheduling, CAPTURE, completion, and verification.**

# Roundhouse Property Work Requests

## Purpose

**Request Work** is the homeowner / Property-side front door for asking an authorized Business for help at a Property.

Its home is:

**Property Entity → Work → Request Work**

It answers:

**Something at this Property needs attention. How do I ask the right Business for help without creating a separate request system?**

The legacy **Ask a Pro** concept is preserved here, but it is integrated into the governing Property Work / Business Work architecture rather than remaining a parallel questions application.

A request begins in the **Requested** stage. If it becomes actual work, the same underlying Record continues through the Work lifecycle.

**Request → Requested Work → Open / Accepted → Assigned → In Progress → Complete → Verified**

A request that is answered without requiring Work can close without forcing a fake job into the Work system.

---

# 1. Placement

Request Work is not another Property right-edge tab.

The permanent path is:

**Property Entity → Work → Request Work**

Property Work remains the governing place for requested, open, assigned, active, and recently completed work.

For an authorized Homeowner / Property authority, the Work screen can expose a clear **Request Work** action.

For Trade Professionals / Managers with creation authority, the existing **+ Create Work** action remains appropriate.

These actions can create the same underlying Work-family Record but represent different intent:

- **Request Work** = ask an authorized Business for help;
- **Create Work** = create operational Work directly when the acting person has authority to do so.

---

# 2. Governing Principle

Roundhouse should not maintain three competing concepts for the same real-world need:

- Ask a Pro;
- Client Request;
- Work Order.

The governing architecture is:

**A legitimate Property request enters the Work system at Requested.**

The request relationship and original question remain preserved even after the Business accepts the request and begins managing it as Work.

No duplicate Work Order is required.

---

# 3. Who Can Receive a Request

Request Work is normally sent to a Business that already has a legitimate relationship to the Property.

If only one appropriate Business is authorized / connected, Roundhouse should preselect it.

If multiple Businesses are legitimately connected, the requester chooses the intended Business.

Request Work should not quietly expose unrelated Businesses or create a new Property relationship merely because a Business exists in search.

Future Business discovery / Find architecture may help establish a new relationship, but discovery remains separate from the Property Work Request flow.

---

# 4. Request Work Flow

The creation flow should be lightweight.

Because the person is already inside the Property Entity, the Property is automatically known.

Useful fields include:

- **What do you need help with?**
- short description;
- area / room when useful;
- related Asset / Equipment when known;
- photos / files;
- urgency / priority when appropriate;
- preferred Business when more than one legitimate Business is available.

The requester should not need to understand Work categories, internal assignment, operational status taxonomy, or Business scheduling before submitting a legitimate request.

---

# 5. The Request Record

The request preserves useful source information such as:

- requester;
- Property;
- receiving Business;
- original question / description;
- submitted photos / files;
- area / Asset relationship;
- submission time;
- request source;
- current request / Work state;
- Business response;
- resulting Work, Calendar, Tasks / Lists, or Resolution relationships when applicable.

The original request should remain visible after acceptance so nobody has to reconstruct why the Work exists.

---

# 6. Business Work Intake

A submitted request appears to the authorized receiving Business in:

**Business Entity → Work → Requested**

It uses the same underlying Record visible in Property Work.

The Business Work card should make useful intake context obvious:

- request title / question;
- Property;
- requester;
- age of request;
- urgency when meaningful;
- photo / Asset cue when useful.

Example:

**Upstairs sink is leaking**  
Spring Lake Residence  
Requested by Sarah Miller  
12 min ago  
**Requested**

The Business should not need to open a separate Client Requests application to discover the request.

---

# 7. Business Response

An authorized Business participant can open the Requested item and choose an appropriate response.

The main outcomes are:

- **Accept as Work**;
- **Answer / Resolve**;
- **Schedule Visit**;
- **Need More Information**;
- **Decline / Close** when legitimate.

The UI should present only the actions relevant to the situation rather than a large decision matrix.

---

# 8. Accept as Work

When the Business accepts the request as actual Work, the same Record moves forward in the governing Work lifecycle.

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

# 9. Answer / Resolve Without Work

Some Ask-a-Pro-style requests are genuine questions that do not require a job.

Example:

**Is this sound from my water heater normal?**

A qualified Business participant may provide a concise response and resolve the request without creating unnecessary operational Work.

This preserves the useful legacy Ask-a-Pro behavior without forcing every question through assignment, CAPTURE, and verification.

The resolved request remains a legitimate Record according to retention and permissions.

---

# 10. What Next? — Preserving the Useful Ask-a-Pro Next Step

The legacy Ask-a-Pro flow allowed the requester to decide what should happen after receiving an answer.

Roundhouse preserves that useful idea, but maps it into the current architecture.

After an answer, the requester may see a simple **What next?** choice such as:

- **Schedule a Visit** → Calendar;
- **Add to Tasks / Lists** → Property Tasks / Lists;
- **Request the Work** → the same Request continues into operational Work;
- **No Action Needed** → close as answered / resolved.

This replaces the older internal concepts of `appointment`, `list`, and `curious` with clearer Roundhouse destinations while preserving their intent.

A simple informational question should be able to end cleanly without creating Work.

---

# 11. Need More Information

The Business may need a photo, measurement, model number, clarification, or other information before deciding what should happen.

The Requested item remains in the Requested stage while waiting for the requester.

The request can show a compact **Waiting on requester** condition.

If the missing information becomes a genuine unresolved dependency requiring structured follow-up, a Resolution may be linked according to Resolution architecture.

Do not invent a separate permanent "Waiting" Work lifecycle merely for request clarification.

---

# 12. Schedule Visit

A Business may need to inspect before accepting a full repair / project scope.

**Schedule Visit** creates or links the appropriate Calendar appointment.

The Request remains the source Record and should not disappear.

After the visit, the Business may:

- answer / resolve the request;
- accept it as Work;
- prepare an Estimate;
- create a Resolution if a real dependency exists.

Calendar governs time. The Request governs why the visit exists.

---

# 13. Decline / Close

A Business may legitimately decline a request when it cannot or should not perform the requested work.

Examples:

- outside scope / trade;
- Business no longer serves the Property;
- safety / licensing boundary;
- duplicate request;
- requester withdraws the request.

Decline / Close should preserve an appropriate reason when useful.

Closing a request does not erase the original request Record.

---

# 14. Requester View

The Homeowner / requester should see a simple status rather than the Business's internal operational complexity.

Useful requester-facing states may include:

- **Sent**;
- **Business Reviewing**;
- **More Information Needed**;
- **Accepted**;
- **Scheduled**;
- **In Progress**;
- **Completed**;
- **Answered / Resolved**;
- **Closed**.

These can map intelligently to the underlying Work lifecycle and relationships.

The requester does not need to see every internal distinction such as Open versus Assigned unless it materially helps them understand what is happening.

---

# 15. Responses, Comments, and Mail

A request may preserve a focused answer / response because the response belongs to the request Record itself.

Work-focused comments may continue once the request becomes operational Work.

Roundhouse Mail remains the communication system between people.

**Request response = answer attached to the request.**  
**Work comments = execution discussion attached to the job.**  
**Mail = broader communication between people.**

Do not recreate a separate chat product inside Requests.

---

# 16. Notifications

The legacy Ask-a-Pro system generated useful alerts when:

- a new question arrived;
- a response was provided;
- another person needed something.

That behavioral value should be preserved when the broader Roundhouse Notifications architecture is reconciled.

However:

- Request alerts are not Roundhouse Mail;
- Mail unread counts should not be reused as general notification counts;
- notification delivery should follow user notification preferences.

This document governs the Request / Work relationship, not the final global notification UI.

---

# 17. Reward / Points Separation

The legacy Ask-a-Pro implementation awarded provider points for answering and for confirmed-helpful answers.

That legacy behavior should not silently dictate Work architecture.

If Roundhouse later rewards helpful professional responses, the reward belongs to the person's Points / Status system and remains outside the Property / Business Entity top area.

A Request Record may serve as evidence for a reward event without making Points part of the Request screen itself.

---

# 18. Permissions and Privacy

Property Work Requests are permission-aware.

Examples:

- a Homeowner / authorized Property authority may request legitimate work;
- a Home Team Member may request work only when permitted;
- a Business receives only requests legitimately addressed to it through the Property relationship;
- Trade Team Members see Requests according to Business authority / assignment;
- outside Trade Partners see only Requests deliberately shared / assigned to them;
- Viewers remain view-only where request visibility is permitted.

Submitting a Request does not grant the receiving Business unrelated Property visibility.

Accepting a Request does not grant the requester unrelated Business visibility.

---

# 19. Property and Business Timelines

Meaningful Request events may appear in the relevant Property / Business Timeline according to permissions.

Examples:

- Work requested;
- request accepted;
- inspection scheduled;
- request answered / resolved;
- resulting Work completed.

Routine internal metadata edits should not flood the Timeline.

The same underlying Record should be surfaced rather than copied.

---

# 20. Visual Direction

Request Work should feel like asking a trusted service professional for help, not filling out a commercial work-order form.

Visual priorities:

- one clear **Request Work** action inside Property Work;
- Property already known;
- plain-language problem description;
- easy photo attachment;
- optional area / Asset selection;
- clear receiving Business;
- simple requester-facing status;
- no project-management jargon;
- no separate Ask-a-Pro dashboard;
- no duplicate Client Requests system;
- clean handoff into Business Work → Requested.

---

## Governing Relationships

**Request Work = the Property-side intake for asking an authorized Business for help.**  
**Requested = the Business Work intake stage.**  
**Work = operational responsibility and execution after acceptance.**  
**Calendar = agreed time.**  
**Tasks / Lists = lightweight follow-up.**  
**CAPTURE = actual work-session evidence.**  
**Mail = communication between people.**

---

## Governing Rule

**A Property Work Request is not a parallel request application. It enters the shared Work architecture at Requested, preserves the original requester and question, can be answered or resolved without unnecessary Work, and can continue as the same underlying Record through acceptance, assignment, scheduling, CAPTURE, completion, and verification when real work is required.**

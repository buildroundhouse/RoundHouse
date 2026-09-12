# Roundhouse Notifications

## Purpose

Roundhouse needs a centralized notification system without turning the product into notification **whack-a-mole**.

The Notification Center is a calm chronological history of meaningful updates across Roundhouse.

It answers:

**What changed that I may want to know about?**

It does not replace the systems that actually own the work, communication, responsibility, schedule, or participation relationship.

**Notifications = awareness.**  
**Mail = communication.**  
**Resolution = what I owe / what remains unresolved.**  
**Work = operational work.**  
**Calendar = time.**  
**Invitation Center = participation / access setup.**

---

# 1. Global Placement

A small **Notifications / bell icon** sits immediately beside the **Mail envelope** in the top utility area.

**Bell = what changed around Roundhouse.**  
**Envelope = what somebody said to me.**

The bell does not display a growing numeric badge. It uses a simple **dot** when the person has unseen notifications.

The Mail envelope may continue to show an unread-message count because that number has one clear meaning: unread Mail.

### Command Center

The Notifications icon is available beside Mail from the personal Command Center.

### Entity Screens

Where Property or Business screens expose the top Mail control, Notifications remain available beside it.

Notifications remain the person's broader Roundhouse history even while the person is operating inside an Entity.

---

# 2. Notification Center

Tapping the bell opens the **Notification Center**.

The screen is a chronological timeline / feed with newest events first. The person can continue scrolling backward through available history rather than having notifications disappear after acknowledgement.

Example entries:

**Mike sent you a message**  
110 Spring Lake · 10:42 AM

**Sarah answered your Resolution**  
Kitchen tile selection · 9:18 AM

**Appointment confirmed**  
HVAC service · Tomorrow at 8:00 AM

**JD Design Studios wants to add Carlos Hernandez**  
Spring Lake Residence · Approval needed

**JD Design Studios added Carlos Hernandez**  
Spring Lake Residence · Authorized through Manager authority

**You were invited as a Viewer**  
Canyon Ridge Facility · Monday

Each notification is a doorway to the thing that owns the event.

Tapping it deep-links to the relevant Mail conversation, Resolution, Work item, Calendar appointment, Invitation Center item, Estimate / Invoice, Property / Business Record, or other legitimate destination.

---

# 3. Seen Is Not Resolved

The notification dot represents **unseen updates**, not unfinished obligations.

Opening or viewing Notification Center may clear the unseen dot. That does not complete the underlying action.

Examples:

- Seeing a Resolution notification does not resolve it.
- Seeing a Mail notification does not automatically clear Mail's unread state.
- Seeing an appointment change does not confirm or decline it.
- Seeing a participant approval request does not approve the participant.

This prevents Notifications from becoming a second task-management system.

---

# 4. Invitation and Access Notifications

Invitation events are meaningful Notification Center events and are eligible for phone push.

Examples include:

- **Sarah Miller invited you to Spring Lake Residence as a Viewer.**
- **JD Design Studios invited you to join its Trade Team.**
- **JD Design Studios invited you to work with the Business as an Outside Trade Professional.**
- **JD Design Studios wants to add Carlos Hernandez to your Property.**
- **Carlos Hernandez accepted your Business invitation.**
- **Your request to join Canyon Ridge Facility was approved.**
- **Business-derived Property access ended because the governing Business relationship ended.**

Invitation notifications should deep-link into the **Invitation Center** or directly into the specific approval / participation item.

The governing invitation architecture is **`33_INVITATIONS.md`**.

---

# 5. Claimed Property Approval Notification

When a Trade Business proposes an accepted Business participant for a claimed Property and the Business does **not** have delegated participant-management authority, the Homeowner receives an actionable notification.

Example:

**JD Design Studios wants to add Carlos Hernandez to Spring Lake Residence.**  
Kitchen project · HVAC  
**Review**

Tapping **Review** opens the approval item showing:

- Business;
- participant;
- base Role / Business relationship;
- Property;
- Work context;
- requested permission scope;
- requester.

The actual Approve / Decline decision remains owned by the Invitation / participation system, not by the Notification row itself.

---

# 6. Delegated Manager Informational Notification

When the Homeowner has already delegated Manager authority that explicitly includes participant management, an authorized Manager may approve the Business participant on the Homeowner's behalf.

In that case the Homeowner should **not** receive another approval task.

They receive an informational notification instead:

**JD Design Studios added Carlos Hernandez to Spring Lake Residence.**  
**Authorized through JD's Manager authority.**

This notification deep-links to the participant / permission detail and preserves who exercised the delegated authority.

The notification should not imply the Homeowner personally performed the approval.

---

# 7. Viewer Notifications

Viewer is the neutral view-only Role and is always attached to a legitimate Residential Property or Commercial Facility.

A Viewer notification should therefore always name the Entity.

Good:

**Sarah Miller invited you to Spring Lake Residence as a Viewer.**

Not good:

**Sarah added you as a Viewer.**

The second version hides the only context that makes the Viewer relationship legitimate.

---

# 8. Push Notifications

Meaningful Roundhouse notifications should also be eligible for **push notification delivery to the person's phone**.

This includes:

- new Mail;
- Resolution attention / responses;
- new or changed Work relevant to the person;
- Calendar invitations, confirmations, changes, or cancellations;
- Estimate / Invoice actions requiring attention;
- Business / Property / Facility invitations;
- Property participant approval requests;
- delegated Manager participant additions;
- meaningful access changes;
- other events that genuinely warrant immediate awareness.

Roundhouse should not push every minor metadata edit or background system event.

**Push is for meaningful awareness, not noise.**

---

# 9. Push Deep Linking

A push notification should open the actual Roundhouse destination associated with the event whenever possible.

Examples:

**New message from Mike** → Mail conversation.  
**Sarah answered your Resolution** → Resolution.  
**Appointment confirmed** → Calendar appointment.  
**New Work Request** → Work item.  
**Business invitation** → Invitation Center item.  
**Property participant approval needed** → approval item.  
**Manager-added participant** → participant / permission detail.

The person should not be forced through Notification Center merely because the event generated a notification.

---

# 10. Message Push Notifications

Mail remains its own communication system, but new messages can generate both an in-app Notification event and a phone push.

The Mail envelope retains its own unread-message state.

Lock-screen previews should respect personal privacy settings. Roundhouse should be able to show a minimal **New Roundhouse message** when content previews are disabled.

---

# 11. Notification History

Notification Center behaves like a chronological activity history rather than a disposable alert tray.

Older notifications can help answer:

- When was I invited?
- Who requested this participant?
- When was Manager authority used?
- When did a Business-derived permission end?
- When did this appointment change?
- When did this person answer?
- When did this Work Request arrive?

Notification history is not the authoritative permanent Record. The linked Entity membership, permission, Work, Resolution, Mail, Calendar, or other Record remains authoritative.

If current access has ended, an old notification must not restore it.

---

# 12. Visual Behavior

Use:

- chronological grouping;
- compact entries;
- recognizable source icons / avatars where useful;
- clear Entity context;
- clear actor / authority context where important;
- date / time;
- subtle seen / unseen distinction;
- direct deep linking.

Avoid:

- red numeric badges throughout the product;
- gamified urgency;
- multiple competing alert colors;
- forcing manual clearing of every notification;
- treating Notifications as another inbox of obligations.

Strong urgency belongs to the system that understands the obligation.

---

# 13. Notification Preferences

Personal notification preferences can eventually include:

- Mail;
- Resolution;
- Work;
- Calendar;
- Estimates / Invoices;
- invitations / access events;
- lower-priority informational updates.

Disabling a phone-push category does not necessarily remove the corresponding event from the in-app Notification Center.

**Notification Center = history. Push = delivery channel.**

---

# 14. Relationship to Feature-Level Attention

Individual Roundhouse features should avoid duplicating Notification Center with large numeric counters everywhere.

A feature may use a subtle local state when necessary, especially when the person must act there.

Therefore:

**Notifications tell me something changed.**  
**Resolution tells me something is waiting on me.**  
**Mail tells me I have unread communication.**  
**Invitation Center tells me participation / access needs review or tracking.**

This keeps Roundhouse informative without becoming notification whack-a-mole.

---

## Governing Rule

**Roundhouse uses one centralized, scrollable Notification Center reached by a bell beside Mail. The bell shows a simple unseen dot rather than a numeric badge. Invitation, Viewer, Business-subcontractor, Property-approval, and delegated-Manager events participate in the same Notification and phone-push infrastructure. Approval-needed events deep-link to the Invitation Center; Manager-authorized additions generate informational notices instead of redundant approval tasks. Notifications provide awareness and history but never replace the underlying permission or Entity-participation record.**

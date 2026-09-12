# Roundhouse Notifications

## Purpose

Roundhouse needs a centralized notification system without turning the product into notification **whack-a-mole**.

The Notification Center is a calm chronological history of meaningful updates across Roundhouse.

It answers:

**What changed that I may want to know about?**

It does **not** replace the systems that actually own the work, communication, responsibility, or schedule.

**Notifications = awareness.**  
**Mail = communication.**  
**Resolution = what I owe / what remains unresolved.**  
**Work = operational work.**  
**Calendar = time.**

---

# 1. Global Placement

A small **Notifications / bell icon** sits immediately beside the **Mail envelope** in the top utility area.

The two controls remain visually compact and distinct:

**Bell = what changed around Roundhouse.**  
**Envelope = what somebody said to me.**

The bell should not display a growing numeric badge.

Instead it uses a simple **dot** when the person has unseen notifications.

This is deliberate. Roundhouse should not create a screen full of competing red counts that trains the user to chase badges all day.

The Mail envelope may continue to show an unread-message count because that number has one clear meaning: unread Mail.

### Command Center

The Notifications icon is available beside Mail from the personal Command Center.

This newer Notification architecture supersedes older Command Center wording that described Mail and notifications as one combined Inbox.

### Entity Screens

Where Property or Business screens expose the top Mail control, Notifications remain available beside it.

Mail opened from an Entity may be filtered to that Entity.

Notifications remain the person's broader Roundhouse notification history unless a future explicit filter is selected. Entering a Property or Business should not hide unrelated personal notifications.

---

# 2. Notification Center

Tapping the bell opens the **Notification Center**.

The screen uses a simple chronological timeline / feed with newest events first.

The person can continue scrolling backward through their available notification history rather than having notifications disappear after they are acknowledged.

Example entries:

**Mike sent you a message**  
110 Spring Lake · 10:42 AM

**Sarah answered your Resolution**  
Kitchen tile selection · 9:18 AM

**Appointment confirmed**  
HVAC service · Tomorrow at 8:00 AM

**New Work Request**  
Repair upstairs sink leak · Yesterday

**You were invited to a Property**  
Spring Lake Residence · Monday

Each notification is a doorway to the thing that actually owns the event.

Tapping it deep-links directly to the relevant:

- Mail conversation;
- Resolution;
- Work item;
- Calendar appointment;
- invitation / relationship flow;
- Estimate / Invoice;
- Property or Business Record;
- other legitimate Roundhouse destination.

The Notification Center should not recreate the full controls of those systems inside the notification itself.

---

# 3. Seen Is Not Resolved

The notification dot represents **unseen updates**, not unfinished obligations.

Opening or viewing the Notification Center may clear the unseen dot as those events become seen.

That does **not** mean the underlying item is complete.

Examples:

- Seeing a notification that a Resolution needs an answer does not resolve the Resolution.
- Seeing a notification about a new message does not necessarily mark that Mail conversation read unless the conversation itself is opened.
- Seeing an appointment change does not confirm or decline the appointment.
- Seeing a Work Request does not accept the Work.

This prevents Notifications from becoming a second task-management system.

---

# 4. Push Notifications

Meaningful Roundhouse notifications should also be eligible for **push notification delivery to the person's phone**.

This includes important events such as:

- new individual or group Mail;
- a Resolution requiring the person's attention;
- a response or meaningful state change on a Resolution;
- new Work assigned or requested;
- important Work status changes relevant to the person;
- Calendar invitations, confirmations, changes, or cancellations;
- Estimate / Invoice actions requiring attention;
- invitations into a Property, Business, Team, or other legitimate Entity relationship;
- other meaningful events that genuinely warrant immediate awareness.

Roundhouse should not push every minor metadata edit or background system event.

**Push is for meaningful awareness, not noise.**

---

# 5. Push Deep Linking

A push notification should open the actual Roundhouse destination associated with the event whenever possible.

Examples:

**New message from Mike** → opens that Mail conversation.  
**Sarah answered your Resolution** → opens that Resolution.  
**Appointment confirmed** → opens that Calendar appointment.  
**New Work Request** → opens that Work item.  
**Property invitation** → opens the invitation / acceptance flow.

The person should not be forced through the Notification Center merely because the notification originated there.

---

# 6. Message Push Notifications

Mail remains its own communication system, but new messages can generate both:

- an in-app notification event in Notification Center; and
- a phone push notification.

The Mail envelope retains its own unread-message state.

This does not merge Mail and Notifications.

It simply means the notification system can tell the person that new communication arrived.

Lock-screen message previews should respect the person's notification/privacy settings. Roundhouse should be able to show a minimal alert such as **New Roundhouse message** when message-content previews are disabled.

---

# 7. Notification History

The Notification Center behaves more like a traditional chronological activity history than a disposable alert tray.

The person can scroll backward through older notifications as far as their available notification history allows.

Older notifications remain useful because they can help answer questions such as:

- When was I invited?
- When did this appointment change?
- When did this person answer?
- When did this Work Request arrive?
- When was this Estimate approved?

Notification history does not become the authoritative permanent Record of the underlying event. The linked Work, Resolution, Mail, Calendar, Entity, or other Record remains authoritative.

If the person no longer has permission to open a linked private Record, an old notification must not restore access to it.

---

# 8. Visual Behavior

The Notification Center should be calm and highly scannable.

Use:

- chronological grouping;
- compact entries;
- recognizable source icons / avatars where useful;
- clear Entity or Property context;
- date / time;
- subtle distinction between seen and unseen entries;
- direct deep linking.

Avoid:

- red numeric badges throughout the product;
- gamified urgency;
- multiple competing alert colors;
- forcing the user to manually clear every notification;
- treating Notifications as another inbox of obligations.

Strong urgency states remain owned by the system that actually understands the obligation. For example, Resolution may use its own escalation mechanics when the person truly owes an answer.

---

# 9. Notification Preferences

Roundhouse should support personal notification preferences so a person can control push behavior without breaking the underlying in-app history.

Preferences can eventually include categories such as:

- Mail;
- Resolution;
- Work;
- Calendar;
- Estimates / Invoices;
- invitations / relationship events;
- lower-priority informational updates.

System-critical or security-related notices may follow separate product rules.

Disabling a phone push category does not necessarily remove the corresponding event from the in-app Notification Center.

The Notification Center is the history; push is the delivery channel.

---

# 10. Relationship to Feature-Level Attention

Individual Roundhouse features should avoid duplicating the Notification Center with large numeric counters everywhere.

A feature may use a subtle local state when necessary, especially when the person must act there.

The strongest attention signal belongs to a genuine obligation, not merely to the fact that something changed.

Therefore:

**Notifications tell me something changed.**  
**Resolution tells me something is waiting on me.**  
**Mail tells me I have unread communication.**

This keeps Roundhouse informative without becoming notification whack-a-mole.

---

## Governing Rule

**Roundhouse uses one centralized, scrollable Notification Center reached by a bell beside Mail. The bell shows a simple unseen dot rather than a numeric badge. Meaningful notifications—including new messages and important Work, Resolution, Calendar, Estimate / Invoice, and invitation events—can also generate push notifications on the person's phone and deep-link directly to the owning Roundhouse record. Notifications provide awareness and history; they do not replace Mail, Resolution, Work, Calendar, or any other system that owns the underlying action.**

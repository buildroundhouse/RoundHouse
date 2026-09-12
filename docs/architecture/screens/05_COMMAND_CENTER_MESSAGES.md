# ROUNDHOUSE — COMMAND CENTER MESSAGES

## Purpose

Roundhouse Mail is the single communication system for conversations between people. Conversations remain associated with the **Entity where the interaction is occurring**.

There is **no general Notifications section inside Mail**.

Mail and Notifications are separate systems that sit beside one another in the top utility area.

**Mail = what somebody said to me.**  
**Notifications = what changed around Roundhouse.**

The Notification Center and push behavior are governed by **`32_NOTIFICATIONS.md`**.

## 1. Mail — Command Center

Tapping the **envelope icon** at the top of the Command Center opens Mail.

A compact **Notifications / bell icon** sits immediately beside the envelope. The bell opens Notification Center; it does not open Mail.

At the top of Mail:

**← Command Center**  
**Mail**  
**Search Messages 🔍**

Search searches the actual contents of all messages available to the user. Searching **“cabinet”**, for example, returns messages/conversations containing “cabinet.”

Directly beneath Search is a discreet privacy statement:

> **Messages are private between participating individuals.**

Do not state that messages are encrypted until Roundhouse's technical implementation supports that claim.

### Mail Sections

Mail is separated into:

**Messages | Group Messages**

They are not mixed together.

The Mail icon can show the user's **unread-message count**. This count belongs only to Mail.

The Notifications bell does not use a competing numeric count. It uses a simple **dot** when there are unseen notification events.

## 2. Individual Message Preview

Each collapsed conversation shows:

**Entity Name**  
**Sender photo + Sender name**  
First portion of latest message…  
**Date / Time**

Example:

**110 Spring Lake**  
👤 Mike Rodriguez  
“I opened up the wall and found some…”  
10:42 AM

The **Entity Name comes first** so the user immediately understands where the conversation belongs.

Opening the conversation shows the full message chain.

## 3. Open Conversation

The top clearly displays:

**Entity Name**  
**Other participant's photo + name**

The conversation can continue for as long as necessary.

At the bottom:

**Reply**  
**Create Action ▾**

Create Action contains:

- **Create Resolution**
- **Schedule Appointment**
- **Add Note**

A separate Reminder is unnecessary because Resolutions provide the persistent follow-through function.

When **Create Action** is used, that interaction is closed. The conversation remains readable and connected to the resulting Record.

**Conversation → Action → Conversation Closed**

Additional communication begins as a **new conversation**.

## 4. Group Messages

Group Messages use the same structure but clearly show all participating people.

At the top:

**Entity Name**  
**Participant photos + names**

There are no invisible participants. Entity Owners or Managers do **not** automatically receive access to a group or individual conversation they did not participate in.

## 5. Other Ways Into Mail

There is still only **one Mail system**.

**Command Center → Envelope** opens all of the user's Mail.

**Entity → Envelope** opens the same Mail interface filtered to conversations associated with that Entity, including both individual and group conversations the user participated in.

**Outward-Facing Profile → Message** starts or opens communication with that person. The conversation retains the appropriate Entity context and subsequently appears in normal Mail.

## 6. Message Notifications and Phone Push

A new Mail message can generate three related but distinct states:

1. the Mail conversation becomes unread;
2. Notification Center receives a chronological notification event;
3. the person's phone can receive a push notification.

This does **not** merge Mail and Notifications.

The notification merely tells the person that communication arrived and links directly to the Mail conversation.

Examples:

**Mike sent you a message**  
110 Spring Lake

or, when lock-screen content previews are disabled:

**New Roundhouse message**

Push behavior follows the person's notification and privacy settings, but meaningful new Mail should be eligible for phone push by default when push permission is available.

Tapping the phone push opens the relevant Mail conversation directly whenever possible.

Viewing the notification event does not have to mark the underlying Mail read. Mail's unread state belongs to Mail and is cleared according to Mail behavior.

## 7. Relationship to Notification Center

Roundhouse maintains a centralized, scrollable Notification Center outside Mail.

Notification Center can contain events such as:

- new Mail;
- Work changes;
- Resolution activity;
- Calendar changes;
- Estimate / Invoice activity;
- invitations and relationship events.

The person can scroll backward through notification history rather than treating notifications as a disposable alert tray.

Notifications do not replace the underlying feature.

A notification about a Resolution opens the Resolution. A notification about a Calendar event opens Calendar. A notification about Mail opens Mail.

The **Green → Yellow → Red → 🔥** escalation belongs only to the Resolution system and is not a Mail or general notification mechanic.

## 8. Governing Rule

**Messages are private to their participants and occur within an Entity context. Mail and Notifications remain separate: Mail owns conversations and unread-message state; Notification Center provides chronological awareness, and meaningful new messages may also generate phone push notifications that deep-link back to Mail.**

Entity ownership or management does not automatically provide access to private conversations.

When **Create Action** converts part of a conversation into a Resolution, appointment, Note, or other Roundhouse Record, **the new Record follows its own Entity permissions without exposing the surrounding private conversation.**

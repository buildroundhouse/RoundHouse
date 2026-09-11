# ROUNDHOUSE — COMMAND CENTER MESSAGES

## Purpose

Roundhouse Mail is the single communication system for conversations between people. Conversations remain associated with the **Entity where the interaction is occurring**.

There is **no general Notifications section inside Mail**.

## 1. Mail — Command Center

Tapping the **envelope icon** at the top of the Command Center opens Mail.

At the top:

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

The Mail icon can show the user's **unread-message count**. This count belongs only to Mail; feature-level attention indicators elsewhere in Roundhouse are not Mail notifications.

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

## 6. Feature-Level Attention

Roundhouse does not maintain a general notification feed inside Mail.

Attention belongs to the feature that requires attention:

- Messages use their own unread count in Mail.
- Calendar can show its own attention indicator when something requires acknowledgment.
- Resolutions use their own attention and escalation mechanics within the Resolution system.
- Other features may use their own indicators where appropriate.

A user does not need to clear a separate notification about an item that already exists in the feature responsible for it.

The **Green → Yellow → Red → 🔥** escalation belongs only to the Resolution system and is not a Mail or general notification mechanic.

## 7. Governing Rule

**Messages are private to their participants and occur within an Entity context.**

Entity ownership or management does not automatically provide access to private conversations.

When **Create Action** converts part of a conversation into a Resolution, appointment, Note, or other Roundhouse Record, **the new Record follows its own Entity permissions without exposing the surrounding private conversation.**

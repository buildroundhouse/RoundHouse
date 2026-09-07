# Entity Model — Architecture Proposal

> Status: **Proposal for review.** No code changes have been made.
> Audience: the project owner. Read top-to-bottom, then react.
> The proposal is forward-looking. It does not catalogue or judge any in-flight task; the user is clearing those separately.

---

## 0. How to read this document

Sections 1–2 are background you already know — they're here so we have a single source of truth, in your own words, about what we're building toward. Skim or skip.

Sections 3–4 are the **actual proposal**. They describe the data model and the rules that fall out of your philosophy.

Sections 5–13 walk each behavior you specified (sign-in flow, clients-as-index, contractor-created properties, upload ownership, business-as-entity, search, the add-to-entity flow, account auto-provisioning, language change, kind-agnosticism audit) and translate it into a concrete shape — columns, routes, navigation, naming.

Section 14 is the friends/casual-chat fork — three options, no decision, you pick.

Sections 15–17 are the **rollout** — phases, risks, and the open questions still on the table.

If you only have time for one section, read **§3 (the model)** and **§9 (the add-to-entity flow)**. Those two together are the system.

---

## 1. Restated philosophy (verbatim)

This is reproduced from the directive you gave so we can confirm I heard you correctly. Every design decision below traces back to one of these statements.

### Core Behavior
The system has **People** and **Entities**.

**People**
- Real users with personal accounts
- They may have roles/avatars
- They act inside entities

**Entities**
- Residential properties
- Commercial properties / facilities
- Businesses / companies

Entities are the main containers. They hold timelines, messages, tasks, photos, notes, clients, participants, and history.

### Main Rule
People do not connect directly to people. People connect through entities.

All meaningful activity must belong to an entity:
- message
- photo
- task
- note
- estimate
- receipt
- timeline update
- approval
- calendar item

**Every activity record should include an `entityId` or `propertyId`.**

### Properties and Companies
A property and a company behave similarly. Both are entities.

A **company** has: team members, internal timeline, company calendar, internal notes/tasks, client/property list.

A **property** has: participants, job timeline, property notes/tasks/photos, client/contact info, history of work.

So: **Company = business workspace.** **Property = job/home/facility workspace.**

### User Flow
When a user signs in, they land in the last active entity, usually their company.

Example: Sign in → JD Design Studios. Inside that company, they see: company timeline, team activity, calendar, clients, properties/jobs.

Then they open a property: JD Design Studios → Sarah's Dallas Home. Now all work happens inside that property.

### Client List
Keep a Clients view because that matches how trade pros think. But internally, clients are not the source of truth. **Clients are an index into properties.**

Example: Client "Sarah Johnson" opens "Sarah's Dallas Home." The user can search by client name, see address, call/text, and navigate with GPS. But the actual record is still the property.

### Contractor-Created Properties
A trade pro can create a property even if the client is not on the app. During intake, ask: **"What is your relationship to this property?"** with options: Owner / Manager / Contractor·Provider.

If they choose Contractor·Provider, ask for: client name, client phone/email, property address. Then create:
- a property record
- a client contact attached to it
- a client list entry that opens that property

The trade pro controls the property record for now. Later, if the client joins, the property can be transferred to the client **while preserving the history**.

### Ownership Rule
A property always has a controller. That controller may be: homeowner, renter, facility manager, trade pro temporarily, or business/company. The controller can change later.

### Upload Ownership
The property is the place of record, but the creator owns their upload.

If a teammate uploads a photo to a client property, **one record** is created with: `propertyId`, `companyId`, `createdByUserId` / `createdByAvatarId`, `assetOwnerId`.

That photo appears in: property timeline, company timeline, personal/avatar timeline. But it is **stored once**. If the homeowner leaves or removes access, the creator should not lose their own photos or portfolio history.

### Search Behavior

**People Search** finds people and shows their roles/avatars as context. But users do not connect to avatars. Actions:
- Invite this person to an entity
- Request access to an entity they manage

**Entity Search** finds homes, facilities, and companies. Actions:
- Request access
- Enter, if already approved
- Invite entity to another entity, where applicable

A business can appear in search by itself. It does not need to be searched through its admin.

### Connection Language
**Remove:** "Connect to user", "Message avatar".
**Use:** "Invite to entity", "Request access", "Add participant", "Enter workspace/property".

### Agent Summary (your one-paragraph summary)
> Refactor the system so properties, facilities, and companies are all entities. People/avatars do not connect directly to each other. People join entities with roles and permissions. All messages, tasks, photos, notes, calendar items, and timeline activity happen inside an entity. Clients remain as a user-friendly view, but they map back to properties. Contractor-created properties are allowed and can later be transferred to the true owner without losing history.

### Direct user direction (constraints, not options)
1. Entity is the primary object. Three kinds: residential property, commercial property/facility, business/company. **Exactly three. No additional entity types.**
2. People (avatars) are identity only. They do not connect to people; they join entities.
3. Reuse `property_members` as the participant system, conceptually `entity_members`. No parallel tables.
4. Each participant record carries: `direction` (`invite`/`request`), `status` (`invited`/`requested`/`approved`/`declined`/`removed`), `role`, `permissions`.
5. All messages, tasks, photos, timelines, approvals, activity scoped to an `entityId`. Nothing user-content lives outside an entity.
6. No avatar-to-avatar connection or messaging logic anywhere. Avatar profiles must not have Connect or Message actions.
7. Two verbs at the avatar surface: "Invite to entity" and "Request access to entity."
8. Same model for homes, facilities, companies. No property-specific logic in the entity / participant layer; kind-specific behavior lives in a sidecar above.

### Direct user direction (subsequent round — these supersede earlier choices where they conflict)

These directives were given after an initial draft of this proposal. Where the rest of this document says anything contradictory, **these win**. The affected sections (§5 sign-in landing, §11 messaging, §14 friends fork, §17 open questions) have been rewritten below to incorporate these.

1. **No direct chat exists in the system.** Messaging only happens inside entities. If two users do not share an entity, they cannot communicate in the app and must use external contact methods. Any prior recommendation or schema for direct messaging — including the "pair entity" option C and the "Direct table" option B from §14 — is removed from the recommended path. (§14 still enumerates Options B and C with pros/cons because the task spec requires the design space to be spelled out, but they are only available if the user explicitly relaxes this directive.)
2. **Exactly three entity kinds.** Residential property, commercial property/facility, business/company. **Do not introduce any additional entity types.** No "pair," no "personal," no "friend." This forecloses Option C from §14 unless this directive is explicitly relaxed.
3. **Profile is a persistent, user-level workspace.** It is the default landing screen on sign-in and must always be accessible. It is **not** part of account switching and is **not** tied to avatars. Profile is tied to the *user*. Profile contains the personal timeline (the user's actions across all entities), private notes, and personal tasks/planning. Profile is **not an entity**, is **not shared**, and does **not** support interaction with other users. **Do not create a personal entity** to back Profile — it is a derived view plus user-scoped private tables.
4. **Reminders and tasks are user-level, not account-level.** They may optionally reference an entity. They appear globally inside Profile and notify the user regardless of which avatar/account is currently active. Tapping a reminder routes the user into the correct entity with the correct avatar context automatically. Reminders have a dedicated UI entry point separate from messaging.
5. **Notifications are user-level, accessed via a bell icon.** Labeled by **person name first**, with entity context second. Example: *"Sarah Johnson invited you to Dallas Home."* Notifications are separate from messages and reminders.
6. **Identity surfacing rule.** Across all global surfaces (Profile, notifications, search rows, the bell feed, reminder rows), the user's *primary name and profile photo* are the consistent identity. Avatar identity is **contextual**, used inside an entity to disambiguate which hat the person was wearing. Avatars are not the primary label in any global surface.
7. **Business-as-entity migration is mandatory and explicit.** For every existing trade pro / facilities `outward_accounts` row that represents a company, create an `entities` row with `kind='business'`, `name = companyName` (fallback to the avatar's display name when null), and `controller_outward_account_id = <the trade pro avatar>`. The avatar remains identity; the business entity becomes the workspace. (See §12 for the full migration shape.)

### Add-to-entity flow (verbatim)

> People search finds a person and shows their accounts (avatars) as context. Company/entity search finds businesses or properties directly. **Search does not create a connection. It starts an add-to-entity flow.**
>
> **Core Flow:** Select person → choose entity → choose how they participate → system completes invite.
>
> **Step-by-step:**
> 1. User searches and selects a person.
> 2. System asks: "Where are you adding them?" — choose a property, or choose a business.
> 3. System asks: "How are you adding them here?" — options depend on context. On a property: Hire through business (if they have one), Add as teammate, Add as collaborator.
> 4. If the person has a business, show their business as a separate option for "hire."
> 5. User selects the option.
>
> **Account handling.** If the person has the needed account: create the participant row, they're added. If not: send an account-setup request tied to the invite ("Sarah wants to add you as a teammate for Dallas Home. Set up this account to accept."). On accept, system creates the avatar and adds them.
>
> **Important rule.** Selecting a person does not define the relationship. The relationship is chosen explicitly in step 3. Prevents the "hired them as a pro when I meant family helper" mistake.
>
> **Entity participation** is stored as: `entityId`, `account (avatar)`, `status (invited, requested, approved, etc.)`, `permissions`.
>
> **Clients** are not a separate model. They are a view of properties filtered by the person attached.
>
> **Final rule.** Entities hold the work. Accounts (avatars) define the person. All connections are created by adding people to entities. If an account is missing, the system creates it during the invite.

---

## 2. Current architecture inventory (what exists today)

This is the ground truth I'm building the migration from. Each row names the table or route, its file, and a one-sentence purpose.

### 2.1 Identity layer

| Object | File | Purpose |
| --- | --- | --- |
| `users` | `lib/db/src/schema/users.ts` | Personal account. One per real human. Holds private fields (clerk id, email, phone) and a denormalized public profile (name, avatar, website, license, services, address). Owns subscriptions and push tokens. |
| `outward_accounts` ("skins") | `lib/db/src/schema/outward_accounts.ts` | Public-facing personas owned by a `users` row. Each has its own `kind` (`home`, `trade_pro`, `facilities`, teammate/collab variants), branding, and capability state. Today this is what shows up as a participant, a connection endpoint, and a sender on messages. |
| `user_modes` | `lib/db/src/schema/user_modes.ts` | Pre-skins legacy. Tracked which "mode" the user was in. Skins were seeded from these. Still referenced by `users.lastActiveModeId` and by `messages.createdInModeId`/`toModeId` for legacy reads. |

### 2.2 Connection layer (the part that's being rebuilt)

| Object | File | Purpose |
| --- | --- | --- |
| `user_connections` | `lib/db/src/schema/user_connections.ts` | The current avatar-to-avatar relationship. Row shape: `(fromOutwardAccountId, toOutwardAccountId, kind, status, classification, serviceTitle, onSiteIdentity, chip, …)`. Kind ∈ `client` / `core` / `collaborator`. Status ∈ `pending` / `accepted` / `declined` / `removed`. **This is the table the entity model retires.** |
| `app_invites` | `lib/db/src/schema/app_invites.ts` | Invite-by-phone for someone who isn't on the app. Sender outward account → recipient name+phone+kind, accepted via token. On accept, becomes a connection. |
| `business_invites` | `lib/db/src/schema/business_invites.ts` | Invite-by-email targeting a business email. Pattern is identical to `app_invites` but with email + business name. |
| `user_team_members` | `lib/db/src/schema/team_members.ts` | Older "I work for this lead" model — `(leadClerkId, memberClerkId, role, status, chip)`. Pre-dates skins. |
| `team_seats` | `lib/db/src/schema/team_seats.ts` | The current team model. A seat says "user X may act as company skin Y, with permissions Z." Includes role, isAdmin, granular permissions (`seeContacts`, `seeBilling`, `createOnProperties`, `manageTeam`), and a chip. |

### 2.3 Property workspace (today's only "entity")

| Object | File | Purpose |
| --- | --- | --- |
| `properties` | `lib/db/src/schema/properties.ts` | The home/facility record. `name`, `address`, `type`, `ownerClerkId`, `ownerOutwardAccountId`, cover, geo, `isPro`, mute window. |
| `property_members` | `lib/db/src/schema/property_members.ts` | **Already the closest thing we have to `entity_members`.** Row: `(propertyId, userClerkId, userOutwardAccountId, role, classification, connectionId, assignedByClerkId, invitedBy, tradeType, companyName, phone, licenseNumber, notes, notifyJobStarted, notifyJobCompleted, archivedAt, firstVisitedAt, welcomeDismissedAt)`. The participant migration target. |
| `property_member_events` | `lib/db/src/schema/property_member_events.ts` | Audit log for member changes (added/removed/role-changed). |
| `property_assets` | `lib/db/src/schema/property_assets.ts` | Inventory items inside a property (HVAC unit, water heater, etc.). |
| `property_notes` | `lib/db/src/schema/property_notes.ts` | Notes on a property; visibility `all` or `collaborator_private`. |
| `property_specs` | `lib/db/src/schema/property_specs.ts` | Key/value spec pairs (paint colors, model numbers). |
| `property_standards` | `lib/db/src/schema/property_standards.ts` | Recurring "this should be true" checks. |
| `recurring_tasks` | `lib/db/src/schema/recurring_tasks.ts` | Repeating job definitions for a property. |

### 2.4 Activity layer

| Object | File | Purpose / current scope |
| --- | --- | --- |
| `messages` | `lib/db/src/schema/messages.ts` | Direct messages between two outward accounts. Has optional `propertyId` already. Carries `actedByClerkId` for team-on-behalf. |
| `notifications` | `lib/db/src/schema/notifications.ts` | Per-user, per-skin notification feed. `relatedId` is a stringy pointer to whatever generated it. |
| `work_orders` | `lib/db/src/schema/work_orders.ts` | A scheduled job. Already keyed by `propertyId`. Carries creator/assignee outward accounts. |
| `work_order_comments` | `lib/db/src/schema/work_order_comments.ts` | Discussion thread on a WO. |
| `work_order_comment_reads` | `lib/db/src/schema/work_order_comment_reads.ts` | Read receipts. |
| `work_logs` | `lib/db/src/schema/work_logs.ts` | History entries on a property (real-time updates, completed work, photos). |
| `object_uploads` | `lib/db/src/schema/object_uploads.ts` | Uploader provenance for files in object storage. Already tracks `uploaderClerkId` and `uploaderOutwardAccountId`. |
| `points_ledger`, `point_settings` | `lib/db/src/schema/points_ledger.ts`, `point_settings.ts` | Game/score events. |
| `job_ratings` | `lib/db/src/schema/job_ratings.ts` | Ratings on completed work. |
| `reminders` | `lib/db/src/schema/reminders.ts` | User-facing reminders. |
| `concierge` | `lib/db/src/schema/concierge.ts` | AI concierge drafts/state. |
| `questions` | `lib/db/src/schema/questions.ts` | Q&A. |
| `company_notices` | `lib/db/src/schema/company_notices.ts` | Pinned company-wide announcements per skin. |
| `deals`, `brand_deal_offers` | `lib/db/src/schema/deals.ts`, `brand_deal_offers.ts` | Trade Pro promotional deals. |
| `swag_claims`, `prize_winners` | `lib/db/src/schema/swag_claims.ts`, `prize_winners.ts` | Rewards plumbing. |
| `subscriptions` | `lib/db/src/schema/subscriptions.ts` | Stripe-driven capability state. |

### 2.5 Routes

| Route file | What it serves |
| --- | --- |
| `users.ts` | Profile reads, search, "find people," bio updates. |
| `outward-accounts.ts` | List/create/switch skins. |
| `properties.ts` | Property CRUD, `/members`, `/assignments`, `/transfer-ownership`. |
| `work-orders.ts` | WO CRUD + comments + reads. |
| `messages.ts` | Inbox + threads + send. |
| `notifications.ts` | Feed + read state + prefs. |
| `invites.ts`, `app-invites.ts` | Invite-by-phone for app onboarding. |
| `team-seats.ts` | Company-skin team management. |
| `discovery.ts` | "Find people," public search. |
| `concierge.ts`, `assets.ts`, `storage.ts`, `standards.ts`, `reminders.ts`, `questions.ts`, `companyNotices.ts`, `rewards.ts`, `preset-chips.ts`, `game-room.ts`, `admin*.ts`, `billing.ts`, `health.ts`, `logs.ts` | Domain-specific. |

### 2.6 Mobile surfaces

| Path | What it is |
| --- | --- |
| `app/(tabs)/index.tsx` | Home tab — properties chip row, tools row, timeline. |
| `app/(tabs)/inbox.tsx` (and `app/inbox/`) | DMs + alerts. |
| `app/find.tsx` | Search. |
| `app/property/[id].tsx` | Property workspace. |
| `app/work-order/[id].tsx` | WO detail + comments. |
| `app/my-jobs.tsx` | Assignee-side WO list. |
| `components/PublicProfileModal.tsx` | The avatar profile sheet (today carries Connect/Message). |
| `components/PropertyProfileModal.tsx` | New: property profile sheet (parallel to PublicProfileModal). |
| `components/OutwardAccountForm.tsx`, `OutwardAccountSwitcher.tsx` | Skin management. |

This inventory is the "before" picture. The rest of this document is the "after."

---

## 3. The model (proposal)

### 3.1 What an Entity is

> **Entity:** a shared workspace where multiple people communicate, hold history, and do work together. The system has exactly three kinds of entity: **residential property**, **commercial property / facility**, **business / company**.

There is **one** entities table. Properties and businesses are not parallel structures — they're rows of the same table with a `kind` discriminator. This is the structural commitment that makes the rest of the model possible: the participant table, the activity tables, the routes, and the UI all key on `entityId` and never branch on kind for anything that isn't kind-specific.

```
entities
  id                   serial pk
  kind                 enum('residential_property','commercial_property','business')
  name                 text
  cover_color          text
  cover_photo_url      text
  controller_outward_account_id   integer  -- the current "owner/controller" avatar
  created_by_user_clerk_id        text
  created_at, updated_at, archived_at
```

Kind-specific fields (street/city/zip/lat/lng for properties, license/insurance for businesses) live in **sidecar tables** keyed by `entityId`:

```
entity_property_details(entityId pk, address, address_street, address_city, address_state, address_zip, place_id, latitude, longitude, type)
entity_business_details(entityId pk, slogan, license_state, license_number, insurance_carrier, services jsonb)
```

This keeps the entity layer kind-agnostic. Adding a fourth kind (e.g. "trade school," "HOA") later is a sidecar table and a `kind` value — no plumbing changes.

#### Migration path for existing data

The existing `properties` table is already the residential/commercial entity. Two viable shapes:

- **Option A — physical rename.** Rename `properties` → `entities`, add `kind`, copy in business rows from a new query against `outward_accounts WHERE kind IN ('trade_pro','facilities')`.
- **Option B — keep `properties` physically, add `entities` as the canonical table, dual-write.** During phase 1 every property has a matching `entities` row; reads switch over phase by phase; properties is dropped once the last reader is migrated.

**Recommendation: Option B.** The diff blast radius of renaming a 100-route table mid-flight is too high. We get a clean abstraction in place faster by adding alongside, then collapsing. The single moment of true rename happens at the end when everything reads `entities`.

### 3.2 What a Person is

> **Person:** a `users` row. One per real human. Holds the login (Clerk id), the private contact info, and the subscription. Has zero or more **avatars**.
>
> **Avatar:** what `outward_accounts` is today. A persona a person presents under (Trade Pro, Homeowner, Facility Manager, Collaborator). Identity only — never the holder of work or messages.

The `users` ↔ `outward_accounts` (avatar) relationship survives unchanged. What goes away is the *role* avatars currently play as conversation endpoints, connection endpoints, and search results.

### 3.3 What a Participant is

> **Participant:** a `(entity, avatar)` pair with a `direction`, `status`, `role`, and `permissions`. The only authorization primitive in the system.

This is `property_members` evolved. Renamed in concept to **`entity_members`**; physically we keep the table named `property_members` through the migration window (same diff-blast-radius reason as above) and rename in the cleanup phase. The `property_id` column becomes `entity_id` at that same final rename.

#### New columns on the participant row

| Column | Type | Meaning |
| --- | --- | --- |
| `direction` | enum(`invite`,`request`) | Did the entity reach out (invite) or did the person ask in (request)? |
| `status` | enum(`invited`,`requested`,`approved`,`declined`,`removed`) | Lifecycle. `archivedAt` keeps existing meaning ("removed"); the status enum is the canonical state going forward. |
| `permissions` | jsonb | Capability bag. See §3.4. |
| `requested_by_outward_account_id` | integer | The avatar that initiated. For an invite, the inviter's avatar. For a request, the requester's avatar. |
| `required_avatar_kind` | text | If the role chosen at add-time needs an avatar the target doesn't yet have, this names the kind (`trade_pro`, `facilities`, `home`, `collab`). Powers the auto-provisioning flow in §10. NULL if no setup is required. |
| `setup_request_sent_at` | timestamp | When the account-setup request went out. NULL if not applicable. |
| `setup_request_accepted_at` | timestamp | When the target accepted and the avatar was created. NULL until then. |
| `decided_at` | timestamp | When status moved to `approved`/`declined`. |

#### Existing columns and how they map

| Existing column | Future role |
| --- | --- |
| `propertyId` | Becomes `entityId` at the cleanup-phase rename. |
| `userClerkId` | Stays — the underlying person. |
| `userOutwardAccountId` | Stays — the avatar this participation belongs to. |
| `role` | Stays — but its **vocabulary becomes kind-aware** (see §3.4). |
| `classification` | Folded into `role` and `permissions`. (`worker` → role=`worker`; `outside_service_provider` → role=`outside_service_provider`; `collaborator` → role=`collaborator`.) |
| `connectionId` | Goes away — connections themselves go away. Filled with NULL on new rows. |
| `assignedByClerkId` | Stays — useful for audit. Renamed conceptually to "added_by." |
| `invitedBy` | Stays. |
| `tradeType`, `companyName`, `phone`, `licenseNumber`, `notes` | Stays as denormalized presentation data on the membership. |
| `notifyJobStarted`, `notifyJobCompleted` | Stays — per-membership notification prefs. |
| `archivedAt` | Stays — equivalent to `status='removed'`. Kept for query compatibility during migration. |
| `firstVisitedAt`, `welcomeDismissedAt` | Stays — per-membership UI state. |

#### What stays off this table

Per directive #8 ("same model for homes, facilities, companies"), nothing property-specific can live here. If a future column makes sense only for businesses (e.g. "is_admin_seat") or only for properties (e.g. "is_resident"), it goes in a kind-keyed sidecar (`entity_member_business_details`, `entity_member_property_details`), never on the participant row.

### 3.4 Roles and permissions, by entity kind

The role vocabulary is **per entity kind**, sourced from a single config file. The participant table stores the role as text; the config is the contract.

```
// lib/entity/roles.ts (proposed)
export const ROLES_BY_KIND = {
  residential_property: ['owner','resident','manager','teammate','collaborator','worker','outside_service_provider'],
  commercial_property:  ['controller','manager','teammate','collaborator','worker','outside_service_provider'],
  business:             ['owner','admin','employee','contractor','collaborator'],
} as const;

export const PERMISSION_PRESETS = {
  // For a property:
  'residential_property/owner':                { read: 'all', write: 'all', invite: true, transferControl: true },
  'residential_property/resident':             { read: 'all', write: 'most', invite: true },
  'residential_property/manager':              { read: 'all', write: 'all', invite: true },
  'residential_property/teammate':             { read: 'all', write: 'most' },
  'residential_property/collaborator':         { read: 'all', write: 'notes_only' },
  'residential_property/worker':               { read: 'all', write: 'work_only' },
  'residential_property/outside_service_provider': { read: 'own_work_only', write: 'own_work_only' },
  // For a business: see §8.
};
```

`permissions` jsonb on the participant row starts at the preset for `(entity_kind, role)` and is editable. This is the only place role semantics live — the API and UI ask "do they have permission X?" and never branch on role themselves. Adding a new role = one line in the config.

### 3.5 Activity records

Every activity-bearing table gains a required `entity_id` column.

| Table | Today's scope column | Proposed change |
| --- | --- | --- |
| `messages` | `propertyId` (nullable) + `(senderOutwardAccountId, recipientOutwardAccountId)` pair | Replace with `entity_id NOT NULL`. The avatar-pair becomes a non-canonical convenience. **Direct DM threads disappear** — every message is to an entity. (See §11 on messaging mechanics and §14 for the friends edge case.) |
| `notifications` | `outwardAccountId` (nullable), free-text `relatedId` | Add `entity_id`. The avatar still owns the inbox slot, but every notification names the entity it's about. |
| `work_orders` | `propertyId NOT NULL` | Renamed to `entity_id NOT NULL`. Already correct shape. |
| `work_order_comments` | scoped via `workOrderId` | Inherits via the WO. Add `entity_id` denormalized to avoid joins on every read. |
| `work_logs` | `propertyId NOT NULL` | Rename to `entity_id NOT NULL`. |
| `property_assets` | `propertyId NOT NULL` | Rename to `entity_id NOT NULL`. (Stays property-specific as a kind: business entities won't write here.) |
| `property_notes` | `propertyId NOT NULL` | Rename to `entity_id NOT NULL`. Notes work on businesses too — internal notes. |
| `property_specs` | `propertyId NOT NULL` | Rename. Specs are property-specific by nature; the table stays but its FK retargets `entities(id)` filtered by kind in app-layer guards. |
| `property_standards` | `propertyId NOT NULL` | Same as specs. |
| `recurring_tasks` | `propertyId NOT NULL` | Rename. Works for businesses too (recurring company tasks). |
| `points_ledger` | per-skin | Add `entity_id` to the events that have one (a job done at a property scores against an entity). |
| `job_ratings` | scoped via WO | Inherits. |
| `object_uploads` | uploader avatar only | Add `entity_id` (the workspace this upload was made for). NULL allowed for "uploaded outside any entity" (e.g. avatar header swap). |
| `company_notices` | per-skin | Becomes per-entity (entity_id of the business). |

#### What happens to legacy NULL `outward_account_id` rows

Existing migration code (`migrateOutwardAccounts.ts`) already backfills the seeded default outward account on null rows. The same pattern applies to the new `entity_id` backfill:

- **`messages`:** every message currently has at minimum a sender and a recipient (avatar pair) and may have a `propertyId`. Backfill rule: if `propertyId` is set, that's the entity; the row keeps `entity_id = propertyId`. If not (pure avatar↔avatar DM with no shared entity), the row is moved to a read-only `messages_legacy` archive and removed from `messages`, after which `messages.entity_id` flips to NOT NULL. This follows directive #1 in §1.5 (no direct chat). §14 enumerates two alternative shapes (Options B and C) for completeness, but they are not on the rollout path unless the user explicitly relaxes that directive. See §11.3 for migration mechanics.
- **`notifications`:** if `relatedId` resolves to a property/work-order/log, copy the entity. Otherwise mark `entity_id` NULL and treat as legacy/system notification (account events, billing, system).
- **`work_*` and `property_*`:** trivial — they all already have `propertyId`.
- **`object_uploads`:** NULL allowed, no backfill. Profile-edit uploads stay entity-less.

The migration script does the backfill in a transaction with verification queries before flipping the column to NOT NULL.

### 3.6 The whole model in one picture

```
                     ┌────────────────────┐
                     │      users         │  (Person — login + private)
                     └────────┬───────────┘
                              │ 1..N
                              ▼
                     ┌────────────────────┐
                     │  outward_accounts  │  (Avatar — public persona, identity only)
                     └────────┬───────────┘
                              │
                              │ N..M  (via entity_members)
                              ▼
                     ┌────────────────────┐
                     │      entities      │  kind ∈ {residential, commercial, business}
                     └────────┬───────────┘
                              │ 1..N
                              ▼
              ┌────────────────────────────────┐
              │  All activity (entity_id NOT NULL):
              │   messages, notifications,
              │   work_orders, work_order_comments,
              │   work_logs, property_assets,
              │   property_notes, property_specs,
              │   property_standards, recurring_tasks,
              │   points_ledger, job_ratings,
              │   object_uploads (nullable),
              │   company_notices
              └────────────────────────────────┘
```

The line that no longer exists in this picture: **outward_account ↔ outward_account.** The `user_connections` table is dropped. The only relationship between two avatars is "they share at least one entity_members row on the same entity."

---

## 4. Concept map (today → entity model)

| Today | Tomorrow |
| --- | --- |
| `users` (private profile) | Unchanged. Still the login row. |
| `outward_accounts` (skin) | **Avatar.** Identity only. No Connect/Message actions. |
| `user_modes` | Frozen legacy. Kept only because some `messages.createdInModeId` reads still join it. Migration-target: removed in cleanup phase. |
| `user_connections` | **Dropped.** Replaced by `entity_members` rows. The "do these two avatars know each other?" question is answered by "do they share an approved membership on any entity?" |
| `app_invites` | Repurposed: still invite-by-phone, but the invite carries an `entity_id` and a target role. On accept, creates a participant row, not a connection. |
| `business_invites` | Same pattern, by-email. |
| `user_team_members` (legacy) | Dropped — superseded by `team_seats`, which itself becomes `entity_members` rows on the business entity (see §8). |
| `team_seats` | Migrates to participant rows on a business entity, with role and permissions. The seat → entity_member mapping is mechanical. |
| `properties` | Becomes the residential/commercial rows of `entities`, with property-only fields in `entity_property_details`. |
| `property_members` | Becomes `entity_members` (rename in cleanup phase). New columns added in phase 1. |
| `property_member_events` | Stays as-is (audit log), retargeted to `entity_id`. |
| `property_assets`, `property_notes`, `property_specs`, `property_standards`, `recurring_tasks`, `work_logs`, `work_orders`, `work_order_comments`, `work_order_comment_reads` | All gain `entity_id`. The `property_*` tables that are genuinely property-only stay named that way; the WO/log tables get renamed. |
| `messages` (avatar-pair DM) | **Dropped as a primitive** per directive #1 in §1.5 — all conversations are entity-scoped, and existing DMs with no shared entity are moved to a read-only `messages_legacy` archive. §14 documents two alternative shapes (Options B and C) but they require explicitly relaxing the directive to be implementable. |
| `notifications` | Adds `entity_id`. The avatar slot still routes the inbox, but every notice points at an entity. |
| `object_uploads` | Adds optional `entity_id`. |
| `points_ledger`, `job_ratings`, `concierge`, `questions`, `reminders`, `subscriptions` | Stay; gain `entity_id` where there's an obvious one. |
| `deals`, `brand_deal_offers`, `swag_claims`, `prize_winners` | Domain features unrelated to participation. Untouched in phase 1. |
| `Public profile modal` (PublicProfileModal.tsx) | Becomes the **Avatar profile sheet.** Two CTAs only: "Invite to one of my entities" and "Request access to an entity they manage." No Connect, no Message. |
| `Property profile modal` (PropertyProfileModal.tsx) | Becomes the **Entity profile sheet** — same component generalized for residential/commercial/business. CTAs: Request access / Enter (if approved) / Invite this entity to one of mine (where applicable). |
| Find tab — per-skin search rows | Becomes per-person rows with avatar context, plus an Entity tab for entity search. |
| Inbox — DM threads + alert feed | Becomes Entity-feed (last activity per entity) + alert feed. (See §11.) |
| Account/skin switcher | Becomes "switch active avatar" — a header element inside the entity, not a top-level chrome. The thing you switch at the top of navigation is the **entity**, not the avatar. |
| Tabs (Home, Inbox, Find, Account) | Becomes (**Profile** = user-level workspace, **Entities** = list of entities the user participates on, Find, Account). Profile replaces Home as the default landing surface. (See §5.) |

Where the mapping isn't clean: **friends, casual chat, and any DM that has no shared entity.** Per directive #1 in §1.5 ("no direct chat exists in the system"), the canonical answer is to archive those conversations to a read-only `messages_legacy` table. **§14 documents three options (A/B/C) with pros and cons** as required by the task spec, but Options B and C require explicitly relaxing the directive to be implementable.

---

## 5. Sign-in landing flow + Profile (the user-level workspace)

> Per directive #3 in §1.5: **Profile is the default landing screen on sign-in and must always be accessible. It is not part of account switching and is not tied to avatars. Profile is tied to the user.**

**Conflict callout.** The original task brief (under "User Flow," restated verbatim in §1) said: *"When a user signs in, they land in the last active entity, usually their company."* Directive #3 in §1.5 was given after that and changes the landing surface to Profile. The two are not reconcilable as-is — Profile-first means **not** landing in the last active entity. This document follows the later directive (Profile-first), but the discrepancy is flagged here so the user can either:

- **Confirm the override** (Profile-first is the new direction; the original "last active entity" line in §1 is superseded), or
- **Revert** (restore "last active entity" landing; treat directive #3 as Profile being persistently *accessible* rather than the *default landing surface*; in that case, drop the Profile-first rendering described below and replace with: "sign in → last active entity workspace; Profile is always one tap away from any screen via a persistent home button").

Either way, the rest of §5 below describes the Profile-first variant per the latest directive. From Profile, the user navigates into an entity to do work.

### 5.1 Navigation shape

```
Sign in
  │
  ▼
PROFILE (always the landing surface)
  ├── Personal timeline   (derived view: this user's actions across every entity they participate on, plus private items)
  ├── Private notes       (user-scoped, never shared, never visible to anyone else)
  ├── Personal tasks      (user-scoped; reminders & to-dos; may optionally reference an entity)
  ├── Quick switcher      (list of entities the user participates on, with last-active marker)
  ├── Bell icon           (notifications — user-level; see §11B)
  └── Account settings    (avatars, contact info, billing, prefs)
        │
        ▼ (user picks an entity)
  ENTITY WORKSPACE (the chosen entity)
        ├── Timeline / activity (entity-scoped)
        ├── Calendar
        ├── Members (participants)
        ├── Sub-list (Properties for a business; Work history for a property)
        ├── Notes (entity_notes)
        ├── Tasks / Work orders
        └── Photos / Files
```

Profile is **always one tap away** from anywhere — represented as a persistent home button (or the leftmost tab).

### 5.2 Tabs

| Tab | Today | Tomorrow |
| --- | --- | --- |
| Home | Properties chip row + tools | **Profile** — the user-level workspace described above. The first thing you see on sign-in and the persistent home of the app. |
| Inbox | DMs + alerts | **Entities** — list of all entities the user participates on, grouped by kind, sorted by recent activity. Tap an entity to enter its workspace. (No DM list — DMs do not exist; see §11.) |
| Find | Search | **Find** — People + Entities tabs. (See §9.) |
| Account | Profile + skins | **Account** — collapsed into Profile's "Account settings" panel. May not need its own tab. |

The bell icon for notifications lives in the top-right of every screen, not in the tab bar. (See §11B.)

### 5.3 Profile is not an entity

This is the structural commitment that makes directive #3 from §1.5 honest:

- **No `entities` row** is created for a user's Profile. The Profile surface is rendered from:
  - A *derived query* over activity tables filtered by `created_by_user_clerk_id = :me` (across all entities — that's the personal timeline).
  - Two new user-scoped private tables: `user_private_notes(user_clerk_id, …)` and `user_personal_tasks(user_clerk_id, optional entity_id, …)`. (See §11A for the tasks table.)
- Profile rows are **never readable by another user**. There is no participant model for Profile; there is no sharing affordance.
- Profile does **not** get a `kind`, an `entity_id`, a participant list, or a controller. It's just the user's private space, surfaced as a screen.

### 5.4 Profile is not part of account switching

Avatar switching only makes sense **inside an entity** (because the avatar disambiguates which hat the person was wearing for a given action). Profile is user-level. The Profile screen always shows the user — not an avatar — as the identity (per directive #6, primary name + photo).

When a user navigates from Profile into an entity, the system selects the right avatar automatically (the avatar that's the participant on that entity). If the user has multiple avatars participating on the same entity, the entity workspace exposes a small "acting as ▾" chip; Profile never does.

### 5.5 Switching entities (the Entities tab and the in-Profile quick switcher)

There are two ways to enter an entity:

1. **Entities tab** — full list of all entities the current user participates on, grouped by kind (Residential / Commercial / Business), sorted by last activity, searchable.
2. **Profile quick switcher** — a compact horizontal chip row inside Profile showing the user's most-recently-active entities. One tap to enter.

There is no "current entity" stored in chrome; entity context exists only while the user is *inside* an entity workspace. Backing out to Profile clears it.

### 5.6 Switching avatars (only inside an entity)

Avatar switching is a sub-action inside an entity workspace. The system picks the correct avatar by reading the user's `entity_members` row on that entity (filtered by `status='approved'`). If the user has multiple approved memberships on the same entity (rare but possible — e.g., they joined as homeowner *and* as a contractor), an "acting as ▾" chip in the entity header lets them switch.

If the user has no approved membership on an entity, that entity is not in their Entities tab and not in their quick switcher — they're not allowed there.

### 5.7 What happens to today's Home tab

Today's Home tab (properties chip row + tools row + timeline) is **replaced** by Profile. The properties chip row becomes the Profile quick switcher. The timeline becomes the Profile personal timeline (derived from the user's own activity across entities, plus private items). The tools row is replaced by the per-entity tools shown only when the user is inside an entity.

---

## 6. Clients-as-index

> Clients are not a separate data model. They are a view of properties filtered by the person attached.

### Data shape

There is no `clients` table. There is no `client_id` column. The Clients view is a **derived projection over `entity_members`**:

```sql
-- Pseudo: "clients of business B" =
SELECT  participant_user.id AS client_user_id,
        participant_user.name,
        property_entity.id AS property_entity_id,
        property_entity.name AS property_name,
        ...
FROM    entity_members AS biz_member
JOIN    entities        AS biz       ON biz.id = biz_member.entity_id  AND biz.kind='business'
JOIN    entity_members  AS prop_member ON prop_member.user_outward_account_id IN (
            SELECT oa.id FROM outward_accounts oa WHERE oa.owner_clerk_id = biz_member.user_clerk_id
        )
JOIN    entities        AS property_entity ON property_entity.id = prop_member.entity_id
                                          AND property_entity.kind IN ('residential_property','commercial_property')
WHERE   biz_member.role IN ('owner','admin','employee','contractor')
  AND   prop_member.role IN ('owner','resident','manager')
```

In English: a "client of business B" is anybody who owns/resides in/manages a property entity that someone from business B has an active worker/teammate role on. The Clients tab in the Trade Pro UI is `SELECT DISTINCT person FROM that join, GROUP BY person, with property list`.

### What that means for trade-pro intake

When a Trade Pro creates a property and chooses Contractor·Provider (see §7), the system creates the property entity and adds the trade pro's avatar as a participant with role `worker` or `outside_service_provider`. It also captures the client's name + phone + email **as a participant row** with role `owner` and status `invited` (no avatar yet, or with auto-provisioning per §10). No separate "client record" is written. The Clients view picks them up automatically.

### What that means for "search Sheila → Sheila's property"

People-search returns Sheila with all of her avatars as context. The avatar profile sheet for any of Sheila's avatars shows the entities she participates on **filtered by the viewer's permissions** — i.e., the viewer only sees entities they themselves are also a participant on (or that are public). For a trade pro who has Sheila as a client, that means Sheila's home shows up. Tapping it opens the property entity. That is "search Sheila → Sheila's property."

Crucially: the trade pro is not opening "Sheila's profile" as a thing-with-a-conversation. They're opening her *avatar's identity card*, which links them to the *entity* they share with her.

---

## 7. Contractor-Created Properties

> A trade pro can create a property even if the client is not on the app. During intake, ask: "What is your relationship to this property?" with options: Owner / Manager / Contractor·Provider.

### Intake flow

```
Create property
  │
  ▼
"What is your relationship to this property?"
  ┌────────────┬────────────┬────────────────────────┐
  │ Owner      │ Manager    │ Contractor · Provider  │
  └─────┬──────┴─────┬──────┴────────────┬───────────┘
        │            │                   │
        │            │                   ▼
        │            │           "Who's the client?"
        │            │             - Client name
        │            │             - Client phone or email
        │            │             - Property address
        │            │                   │
        ▼            ▼                   ▼
   Property entity created with:
     - kind = residential_property (or commercial)
     - controller_outward_account_id = the creator's avatar
     - participant row: creator → role=owner|manager|worker
     - (contractor branch only) participant row: client → role=owner,
       status=invited, direction=invite, required_avatar_kind='home'
```

### The controller field

Every entity has a `controller_outward_account_id`. For Owner/Manager-created properties, that's the creator's avatar. For Contractor-created properties, it's the *trade pro's* avatar — temporarily. The contract is: **whoever the controller is can transfer control**, including to the client when they later sign up.

### Transfer flow (preserves history)

When a client accepts an invite to a property the trade pro controls, two things happen:

1. The client's `entity_members` row flips to `status='approved'`, `role='owner'`, with the avatar that was either pre-existing or just provisioned.
2. The entity's `controller_outward_account_id` is set to the client's avatar. The trade pro's row stays — they're still a `worker` participant.

What gets re-pointed:
- `entities.controller_outward_account_id` — yes.
- Activity records (`messages`, `work_orders`, `work_logs`, `notes`, `assets`, etc.) — **no**. They stay attached to the entity. The history is preserved because the *entity is the record*, not the controller.
- Photos uploaded by the trade pro — stay attached to the entity AND to the trade pro's portfolio (see §8 / Upload Ownership). Transferring control does not strip the trade pro's portfolio rights.

What stays:
- Every participant row stays.
- Every activity row stays.
- The property's address, asset inventory, notes — all stay.

The transfer is metadata-only. That is the whole point of separating "controller" from "place of record."

### The Clients view on the trade pro side

After transfer, Sheila's home still shows in the trade pro's Clients tab (because the trade pro is still a participant), but the controller pill on the property header now reads "Sheila Johnson."

---

## 8. Upload Ownership (the "one record, three timelines" rule)

> If a teammate uploads a photo to a client property, one record is created with `propertyId`, `companyId`, `createdByUserId`/`createdByAvatarId`, `assetOwnerId`. That photo appears in property timeline, company timeline, personal/avatar timeline. But it is stored once.

### Data shape

Generalized to entities, the columns on every uploaded asset row become:

| Column | Meaning |
| --- | --- |
| `entity_id` | The workspace this was uploaded into. (Today: `propertyId`.) |
| `via_business_entity_id` | Optional. If the uploader was acting on behalf of a business entity at upload time, this is that business's entity id. NULL when the uploader was acting as a personal avatar with no business affiliation. |
| `created_by_user_clerk_id` | The person who uploaded. |
| `created_by_outward_account_id` | The avatar they were wearing. |
| `asset_owner_outward_account_id` | The avatar that retains portfolio rights. Equal to `created_by_outward_account_id` by default. May differ if a teammate uploads on behalf of the company avatar (then it's the company's avatar). |
| `path`, `kind`, `name`, `size`, … | Existing storage metadata. |

This already largely matches the existing column set on `work_orders`, `work_order_comments`, `work_logs`, `property_assets`, `property_notes`, `property_specs`, and `object_uploads` — they all already carry author-clerk + author-outward-account. The two **new** columns are `entity_id` and `via_business_entity_id` and `asset_owner_outward_account_id`.

### How it appears in three timelines

There is no copying. The three timelines are three queries against the same row:

```sql
-- Property/entity timeline:
WHERE entity_id = :propertyEntityId

-- Company/business timeline:
WHERE via_business_entity_id = :businessEntityId

-- Personal/avatar portfolio:
WHERE asset_owner_outward_account_id = :myAvatarId
```

### What revoke-access does (and doesn't)

If the homeowner removes the trade pro from their property:
- The trade pro's `entity_members` row on that property entity flips to `status='removed'`.
- The trade pro **loses read access** to the property entity going forward. Their queries `WHERE entity_id = :propertyId` start returning nothing.
- The trade pro's portfolio query `WHERE asset_owner_outward_account_id = :myAvatarId` **still returns those rows.** The data isn't deleted; the read scope just changes.
- The photo no longer appears in the property timeline for the property's controller either (it disappears for nobody — but only the avatar that owns the asset can still see it from their portfolio query).

This is the "creator should not lose their own portfolio history" rule, expressed as two independent read scopes on the same row.

The exception we should call out: PII-bearing files (signed contracts, identity docs) probably shouldn't behave this way. Phase 1 treats every upload as portfolio-eligible; phase 2 might add a `portfolio_eligible` flag for sensitive doc kinds. **Open question — see §17.**

---

## 9. Search behavior + the add-to-entity flow

This is the section your latest direction crystallized. It's the system's only "connection" primitive.

### 9.1 People search

People search returns **one row per person**, not one row per avatar. The row shows:
- Name
- Avatar chips (small badges: "Trade Pro" / "Homeowner" / "Facility Manager") — context only
- Optional: a "you share X entities" hint if the viewer already participates with this person

There is **no** "Connect" button. There is **no** "Message" button. There is one CTA:

> **"Add this person to one of my entities…"**

Tapping it starts the four-step add-to-entity flow (§9.3).

If the viewer has no entities of their own, the CTA is disabled with copy "Create or join an entity first."

### 9.2 Entity search

Entity search returns rows of `entities` directly, regardless of kind. Each row shows:
- Name + cover
- Kind chip ("Home" / "Facility" / "Business")
- Address (for properties) or business chip (for businesses)
- A status badge: **Already a member** / **Request pending** / nothing

Actions on an entity row:
- **Enter** (if you're already an approved participant)
- **Request access** (otherwise — opens a sheet to pick which of *your* avatars makes the request and write a note)
- **Invite this entity to one of mine** (only when entity-to-entity makes sense — e.g. invite a business entity to be a worker on your property entity; invite a property entity to be a client of your business entity)

That third action is a parallel of the four-step flow but with an entity in the "person" slot. Same picker, different label. (See §9.4.)

### 9.3 Add-to-entity flow — step by step

This is the system's only connection primitive. Four steps. Always.

```
1. SELECT PERSON
   (from People search, or from a recent-people list inside an entity)
        │
        ▼
2. CHOOSE ENTITY  — "Where are you adding them?"
   List of MY entities, grouped by kind:
     ▸ Properties I own/manage
     ▸ Businesses I own/admin
   Filter: only entities where I have the 'invite' permission.
        │
        ▼
3. CHOOSE ROLE  — "How are you adding them here?"
   Role options come from PERMISSION_PRESETS[entity.kind] filtered by:
     - what THIS person is eligible for given the avatars they have
     - what THIS entity supports
   Example presets (residential_property):
     ▸ Hire through their business           ← appears only if the person has a business entity
     ▸ Add as teammate
     ▸ Add as collaborator
     ▸ Add as outside service provider
   Example presets (business):
     ▸ Add as employee
     ▸ Add as contractor
     ▸ Add as collaborator
        │
        ▼
4. SYSTEM WRITES THE PARTICIPANT ROW
   Two branches:
     A. Person already has the needed avatar
        → INSERT entity_members(entity_id, user_outward_account_id, role,
                                permissions=PRESET[kind/role],
                                direction='invite', status='invited',
                                requested_by_outward_account_id=:me)
        → Notification to the target's correct avatar inbox: "You've been invited to <entity> as <role>"
     B. Person needs an avatar they don't have yet
        → INSERT entity_members(... required_avatar_kind=<needed>,
                                status='invited',
                                setup_request_sent_at=now())
        → Notification: "<inviter> wants to add you as <role> for <entity>. Set up a <kind> account to accept."
        → On accept: atomically create outward_account, attach to participant row,
                      flip status='approved', set setup_request_accepted_at=now()
```

### 9.4 Why this kills the messaging-permissions chicken-and-egg

The historical bug was: "to message someone you need to be connected; to ask to be connected you need to message them." The entity model erases it.

- **You don't message a person — you message inside an entity.** (See §11.)
- **You can't message inside an entity until you have an approved participant row.**
- **The way you get an approved participant row is the four-step flow above** — initiated by the entity owner (invite) OR by the would-be participant (request).

There's no separate "team-up" or "connect" preamble that needs to happen before messaging. The participant row IS the permission. Either you have it (you can post in the entity) or you don't (you can request it). The request is a top-level system operation, not a chat.

### 9.5 Requesting access (the inverse direction)

The same four-step flow runs in reverse on entity search:

```
1. Find an entity (Entity search → row → "Request access")
2. CHOOSE MY AVATAR — "Who's asking?"
3. WRITE A NOTE — "Why?" (free text, optional)
4. SYSTEM WRITES:
     INSERT entity_members(entity_id, user_outward_account_id=:my_chosen_avatar,
                           role=NULL_pending_decision,
                           direction='request', status='requested',
                           requested_by_outward_account_id=:my_chosen_avatar,
                           personal_note=:note)
   → Notification to the entity's controller/admins: "X requests access to <entity>. Decide."
   → On approve: controller picks the role from the entity-kind preset, status='approved'.
   → On decline: status='declined'.
```

### 9.6 Important design rule (verbatim)

> Selecting a person does not define the relationship. The relationship is chosen explicitly during the add flow.

This is enforced structurally: there is no API endpoint that takes only `(personId)` and returns a relationship. Every endpoint that creates a participant row takes `(entityId, role)` as required parameters. UI cannot skip step 3.

---

## 10. Account auto-provisioning (the "Sarah needs a Trade Pro avatar" case)

This is the mechanism that makes the four-step flow work when the target doesn't yet have the right avatar.

### Trigger condition

At step 3, the inviter picks a role. The system computes `required_avatar_kind`:

| Role chosen | `required_avatar_kind` |
| --- | --- |
| `worker`, `outside_service_provider`, business `employee`, business `contractor` | `trade_pro` (or `facilities` if the entity-kind suggests it) |
| `owner`, `resident`, `manager` (on a residential entity) | `home` |
| `controller`, `manager` (on a commercial entity) | `facilities` |
| `collaborator` | `collab` |
| business `owner`, `admin` | `trade_pro` or `facilities` (the kind of the business entity) |

If the target person has any non-archived `outward_accounts` row of `required_avatar_kind`, no provisioning is needed — pick that avatar and create the participant row directly.

If they don't, the participant row is written with `status='invited'`, `required_avatar_kind=<kind>`, `setup_request_sent_at=now()`, and `user_outward_account_id` initially NULL (filled in at acceptance).

### Notification copy

> "Sarah Hill wants to add you as a Trade Pro teammate for **Sarah's Dallas Home**. Set up a Trade Pro account to accept."

### Accept handler (route shape)

```
POST /entity-members/:participantId/accept-setup
  body: { ...avatar_seed_fields }  // displayName, avatarUrl, kind-specific defaults
  effects (transaction):
    INSERT outward_accounts(owner_clerk_id=:me, kind=required_avatar_kind, ...)
    UPDATE entity_members
       SET user_outward_account_id = <new avatar id>,
           status = 'approved',
           setup_request_accepted_at = now(),
           required_avatar_kind = NULL
     WHERE id = :participantId
    INSERT notifications(...)  -- "You've joined <entity>"
```

The entire setup is atomic. If the target abandons the setup, the participant row stays at `status='invited'` and can be retried or cancelled.

### When the target already has the avatar

Step (b) is skipped. The participant row goes directly to `status='approved'` if the inviter has admin/auto-approve rights on the entity, or to `status='invited'` requiring the target to confirm. Default behavior:

- **Invite to a property as worker/teammate/collaborator:** status `invited`, target must accept.
- **Invite to a business as employee/contractor:** status `invited`, target must accept.
- **Owner-side invitation back to the controller's home for a known co-resident:** status `invited`, target must accept.

There's never a "silent add." Auto-provisioning the avatar is an explicit user action; auto-adding without consent is not.

---

## 11. Messaging mechanics under the entity model

> Per directive #1 in §1.5: **No direct chat exists in the system. Messaging only happens inside entities. If two users do not share an entity, they cannot communicate in the app and must use external contact methods.**

This section describes the messaging mechanics under that directive. §14 documents the alternative shapes (Options B and C) that would be required if the directive were explicitly relaxed; this section follows the directive as stated.

### 11.1 Schema after migration

```
messages
  id
  entity_id                  NOT NULL  -- ALWAYS. The thread identity.
  sender_outward_account_id  NOT NULL  -- the avatar that posted (contextual identity)
  sender_user_clerk_id       NOT NULL  -- the underlying person (used for global identity surfaces)
  acted_by_user_clerk_id              -- on-behalf-of, internal only (team-seat acting as company avatar)
  body
  source                              -- 'user' | 'concierge_draft' | 'system'
  created_at
message_reads
  (message_id, viewer_user_clerk_id)  -- per-viewer read receipts; user-level, not avatar-level
```

The `recipientOutwardAccountId` column goes away entirely. The "thread" is `(entity_id)`. Within an entity, every approved participant with read permission sees the message.

A one-on-one conversation between two people exists **only when they share an entity.** If they don't, they don't talk in the app.

### 11.2 The Entities tab (replaces the DM list)

The old Inbox-as-DM-thread-list is gone. The new Entities tab shows:

- One row per entity the user participates on.
- Sorted by last activity.
- Grouped by kind (Residential / Commercial / Business) under collapsible headers, or filterable by kind.
- Each row shows: entity name, last message snippet, last activity timestamp, unread count.
- Tap the row → the entity workspace opens at its activity/messages view, with the user's correct avatar auto-selected.

There is no "Messages with Sarah" row. There's "Sarah's Dallas Home" and "Sarah's Lake Cabin" — both rows the user participates on with Sarah, both with their own conversations.

### 11.3 Legacy DM migration

Existing `messages` rows fall into two buckets at migration time:

| Bucket | Rule | Backfill |
| --- | --- | --- |
| Has `propertyId` | The property is the entity. Backfill `entity_id` from the `entities` row created for that property in phase 1. | Mechanical. |
| No `propertyId` (pure avatar↔avatar DM) | **No target entity exists.** Per directive #1 in §1.5 (no direct chat), these rows are archived. | Rows are exported into a read-only `messages_legacy` table and removed from `messages`. The user is shown a one-time notice on first sign-in post-migration: "Direct messages with people you don't share a property or business with are no longer supported in-app. Your old messages are saved as a read-only archive at Profile → Settings → Archived conversations." (§14 documents the alternative shapes that would apply if the directive were explicitly relaxed.) |

This is a deliberate behavioral break — the price of a single, uncomplicated communication model called for by directive #1.

### 11.4 The "external contact" affordance

When the avatar profile sheet (formerly `PublicProfileModal`) is opened for a person the viewer does not share an entity with, the only actions are:

- **Add to one of my entities** (the four-step flow, §9.3) — the in-app path.
- **Show contact info** (if the target's avatar profile has elected to expose phone/email) — copies a phone number or opens the system mail composer. This is the "external contact" the directive sanctions.

There is no "Message" action. There is no "Connect" action. The two paths are: bring them into a workspace, or contact them outside the app.

---

## 11A. Reminders and personal tasks (user-level)

> Per directive: **Reminders and tasks are user-level, not account-level. They may optionally reference an entity. They appear globally inside Profile and notify the user regardless of which avatar/account is currently active. Tapping a reminder routes the user into the correct entity with the correct avatar context automatically. Reminders have a dedicated UI entry point separate from messaging.**

This re-scopes a piece of the system that is currently per-skin (today's `reminders` table is keyed by user but rendered per-avatar context).

### 11A.1 Schema

```
user_personal_tasks
  id
  user_clerk_id      NOT NULL   -- the owner. The ONLY field that decides who sees it.
  title              NOT NULL
  body
  due_at                        -- when the user wants to be reminded
  remind_at                     -- when notification fires (may differ from due_at; e.g. day-before)
  completed_at
  optional_entity_id            -- nullable. If set, this task is "about" an entity, and the
                                --   bell notification + tap-routing know where to send the user.
  optional_avatar_kind          -- nullable. Used at tap-time to pick the right avatar to enter
                                --   the entity as, when the user has multiple eligible avatars.
  source                        -- 'user' | 'system' | 'work_order' (e.g. WO due-date reminder
                                --   is auto-mirrored as a personal task so it shows in Profile)
  created_at
```

### 11A.2 Where they appear

- **Profile → Personal tasks** — the canonical surface. All user_personal_tasks rows for the signed-in user, regardless of which avatar is active.
- **Bell icon** — at `remind_at`, a notification fires. The bell badge increments. Tap routes per §11A.3.
- **Push notification** — same trigger; routed to the user's device regardless of currently-active avatar.

Reminders are **never gated by which avatar is currently active.** The user is the user — they see all their own reminders always.

### 11A.3 Tap-routing

Tapping a reminder does this:

1. If `optional_entity_id` is set:
    a. Resolve the entity.
    b. Pick the right avatar: the user's first approved `entity_members` row on that entity (preferring `optional_avatar_kind` if set and matching). If none, fall back to the user's primary avatar with a banner ("You no longer have access to this entity").
    c. Open the entity workspace with that avatar selected.
2. If `optional_entity_id` is not set:
    a. Open Profile → Personal tasks scrolled to that task.

### 11A.4 UI entry point

Per directive, reminders have **a dedicated UI entry point separate from messaging.** That is:

- Profile → Personal tasks (the primary surface).
- Bell icon (notifications, see §11B).
- A "+" affordance inside any entity workspace that creates a task with `optional_entity_id` pre-filled (so the user can quickly say "remind me to follow up on this" while inside the entity).

The Entities tab (which replaces the DM list, §11.2) does **not** show reminders. They live in Profile.

### 11A.5 Migration from today's per-avatar reminders

Today's `reminders` table is keyed by user but the UI scopes by the active avatar. Migration: copy each row into `user_personal_tasks` with `user_clerk_id` preserved, no `optional_entity_id` (legacy reminders weren't entity-bound), no `optional_avatar_kind`. Then drop the per-avatar scoping in the UI. Old `reminders` table is renamed to `reminders_legacy` and read-only after cutover.

---

## 11B. Notifications (user-level, bell icon)

> Per directive: **Notifications are user-level, accessed via a bell icon. Labeled by person name first, with entity context second. Example: "Sarah Johnson invited you to Dallas Home." Notifications are separate from messages and reminders.**

### 11B.1 Schema

```
notifications
  id
  user_clerk_id           NOT NULL   -- the recipient. Notifications are user-level — this is the only routing key.
  outward_account_id                -- nullable; preserved for backward-compat and per-avatar filtering INSIDE Profile
                                    --   if the user wants it. NOT used to gate visibility — the user always sees
                                    --   their own notifications regardless of currently-active avatar.
  entity_id                         -- nullable. The entity context, if any. Used for tap-routing.
  type                              -- 'invite' | 'request' | 'mention' | 'work_order_assigned' | 'message' | 'system' | …
  actor_user_clerk_id               -- nullable. The person who caused the notification — drives the "person name first" label.
  actor_outward_account_id          -- nullable. The avatar they were wearing. Used as secondary context, never as primary label.
  title
  body
  is_read                            -- per-(notification, user) read state
  created_at
```

### 11B.2 Labeling rule (verbatim from directive)

Every notification rendered in the bell feed follows this template:

```
[actor.users.name]  [verb]  [target_chip showing entity name + kind]
```

**The actor's primary user name is the headline.** The avatar they were wearing appears, if at all, as a small chip ("acting as JD Design Studios") below the line — never as the headline.

Examples:

> **Sarah Johnson** invited you to **Dallas Home**.
> *(below, smaller:)* acting as Sarah Johnson · Homeowner

> **Mike Reyes** requested access to **JD Design Studios**.

> **Sarah Johnson** mentioned you in a comment on **Dallas Home → Roof Replacement**.

This is enforced at the notification *renderer*, which always reads `actor.users.name` (joined from `actor_user_clerk_id`), never the actor's avatar `displayName`, for the headline. (See §11C.)

### 11B.3 Bell UI

- Bell icon: top-right corner of every screen, including inside entities.
- Badge: count of unread `notifications` rows for the signed-in user.
- Tap the bell → a sheet/screen with the feed.
- Tap a row → routes the user per `entity_id` (open entity workspace) or `type` (e.g. `invite` opens the invite-accept sheet).
- Unread/all toggle. Mark-all-as-read.

### 11B.4 Notifications are not messages and not reminders

Three distinct surfaces, three distinct sources, three distinct entry points:

| | Lives in | Triggered by | Entry point |
| --- | --- | --- | --- |
| **Messages** | `messages` (per entity) | A user posting in an entity | Entities tab → entity → messages |
| **Reminders / personal tasks** | `user_personal_tasks` | The user themselves (or system mirrors of WO due dates) | Profile → Personal tasks; bell at `remind_at`; push |
| **Notifications** | `notifications` | System events (invite, request, mention, assignment, etc.) | Bell icon |

A new entity message **does** generate a `notifications` row (with `type='message'`) so the bell shows it; tapping that bell row opens the entity at the message. But the message itself lives in `messages`, not in `notifications`.

---

## 11C. Identity surfacing (primary name + photo, globally)

> Per directive: **Across the system, always use the user's primary name and profile photo as the consistent identity. Avatar identity is contextual and must not be used as the primary label in global surfaces.**

This is a rule about how identity gets *rendered*. The data model already supports it (`users.name`, `users.avatarUrl` exist on every actor). What changes is the renderer.

### 11C.1 Rule

**Global surfaces use `users.name` and `users.avatarUrl` as the primary identity.** Global surfaces are: search rows (People search), notification rows (bell), reminder rows, the "added by" pill on history events, the actor on a Profile timeline entry.

**Entity-internal surfaces use the contextual avatar.** Entity-internal surfaces are: the chip next to a message inside an entity workspace, the "acting as" chip on a work order, the "uploaded by" line on an asset inside the entity timeline.

### 11C.2 Where the renderer changes

| Surface | Today | Tomorrow |
| --- | --- | --- |
| People search row | Per-skin row showing avatar's `displayName` and `avatarUrl` | One row per person showing `users.name` and `users.avatarUrl`. Avatars listed below as small kind chips. |
| Bell notification row | Avatar's display name as headline | `actor.users.name` as headline; avatar appears as small "acting as ▸" chip if present. |
| Reminder rows in Profile | N/A (today reminders are per-avatar) | User's own name implicit (it's their Profile); no actor needed. |
| Profile personal-timeline entries | N/A | User's own name implicit. The *entity* context appears prominently ("at Sarah's Dallas Home, you posted a work log"). |
| "Added by" / "Created by" pills inside an entity | Avatar display name | Inside an entity, the contextual avatar is fine. *But* the underlying user's name must also be available on hover/tap so the viewer knows who the human is. |
| Message bubbles inside an entity | Avatar display name | Acceptable to keep avatar display name as the primary chip *inside* the entity (this is the "contextual" surface). Adding the user's name as a tooltip/hover satisfies the rule. |
| Avatar profile sheet | Avatar display name as headline | **User's name as headline** with avatars listed as chips below. The sheet is a *person* sheet that happens to enumerate the person's avatars; not an "avatar sheet." |

### 11C.3 Implementation note

A small renderer helper, `formatGlobalIdentity(user, avatar?)`, returns `{ headline: user.name, photo: user.avatarUrl, contextChip: avatar ? `acting as ${avatar.displayName} · ${avatar.kindLabel}` : null }`. Every global surface uses it. Any direct render of `outward_account.displayName` outside an entity workspace is treated as a violation in code review.

---

## 12. Business-as-Entity

> A business has team members, internal timeline, company calendar, internal notes/tasks, client/property list. So: company = business workspace.

Today a business is encoded as an `outward_accounts` row of kind `trade_pro` or `facilities`, with `team_seats` rows attaching teammates to it. The business has no entity_id of its own — it's just a skin.

This proposal makes the business **an entity** in its own right.

### Migration

For every active `outward_accounts` row of kind `trade_pro` or `facilities` whose owner has at least one `team_seats` row OR has `companyName` set OR has any client connections, create:

```
INSERT entities(kind='business', name=companyName||displayName, controller_outward_account_id=<the skin>)
INSERT entity_business_details(entity_id=<new>, license_state=..., ...)
```

For every `team_seats` row, create:

```
INSERT entity_members(entity_id=<biz entity>, user_outward_account_id=<seat's avatar>,
                      role=team_seats.role, permissions=team_seats.permissions||preset,
                      direction='invite', status= seat.status==='accepted' ? 'approved' : 'invited',
                      requested_by_outward_account_id=<owner avatar>)
```

For solo trade pros (no team), the business entity still exists — they're its sole `owner` participant. This way a solo pro and a multi-person company use the exact same primitives.

### What the trade pro's *personal* identity is now

The trade pro is a **Person** (`users` row) with one or more **Avatars** (their Trade Pro avatar, maybe a Homeowner avatar). The business is a separate **Entity** that the Trade Pro avatar is a participant of (with role `owner`).

This decouples three things that today are conflated:
- The person (private profile).
- The avatar (what shows up in search and on a property).
- The business (what holds the team, the calendar, the client list).

In the entity model, killing the business entity doesn't kill the avatar; the avatar can join other businesses. The avatar is portable. The business is the workspace.

### Search consequence

A business now appears in **entity search** as a first-class result. You don't search "find me a Trade Pro" and get a person — you can do that *too* (people search returns the trade pro person), but you can also search "find me a plumbing company" and get the business entity directly.

### Messaging consequence

A message to "the company" goes to the business entity's thread. Anyone on the team sees it. Today this is approximated with team-on-behalf-of; in the entity model it's the natural shape.

### Client list consequence

The Clients tab on a Trade Pro UI is now scoped to the business entity, not the avatar. If the trade pro participates on two businesses, switching businesses (via the entity switcher) swaps the client list. Cleaner than today's per-skin filtering.

---

## 13. Connection language change (every string and symbol)

| Today | Tomorrow |
| --- | --- |
| "Connect" / "Connect with" | "Invite to one of my entities" |
| "Send connection request" | "Add to entity" |
| "Accept connection" | "Accept invitation to <entity>" |
| "Disconnect" | "Remove from <entity>" |
| "Message" (button on a profile) | (removed — only "Add to entity" remains) |
| "My connections" | "People I share entities with" (or just removed; the avatar profile's "shared entities" hint replaces it) |
| "Team up" | "Invite to my business" |
| "Pending team-up requests" | "Pending invitations" / "Pending requests" — split by direction |
| "Find people" | "Find people" (verb stays; behavior changes per §9) |
| Code: `userConnectionsTable`, `ConnectionKind`, `ConnectionStatus` | Removed. New: `entityMembersTable`, `MembershipDirection`, `MembershipStatus`. |
| Code: `teamUpRequests.ts` | Removed. Same effect achieved by entity-member rows on a business entity with `direction='invite'` and `required_avatar_kind` set. |
| Code: `app_invites`, `business_invites` | Kept; both gain `entity_id` and `target_role` columns. They're now invites *to a specific entity with a specific role*, not generic onboarding invites. |
| UI: PublicProfileModal's "Connect" / "Message" buttons | Removed. Replaced by "Invite to one of my entities…" CTA that opens the four-step flow. |
| UI: Inbox DM thread per recipient | Removed. Replaced by entity feed. |

The avatar profile sheet **must not carry Connect or Message actions**, full stop. This is directive #6. Phase 1 includes a lint rule (or a runtime assertion) preventing those strings from appearing on an avatar surface.

---

## 14. The friends / no-shared-entity case — three options, your call

This is the one fork in the proposal that I am **not** deciding for you. The task spec requires three options to be spelled out with pros and cons; below they are. I include a recommendation at the end, but the choice is yours to confirm or override.

**Important framing:** Directive #1 in §1.5 ("no direct chat exists in the system") and directive #2 ("exactly three entity kinds") **point to Option A as the only directive-compatible path.** Options B and C are documented because the spec requires the design space to be presented — but they are only available to you if you explicitly relax the relevant directive. The rest of the proposal (§3.5, §11, §11.3, §16) follows the directives and assumes Option A; if you pick B or C, swap in the deltas described in §14.3.

The case: two users who do not share any entity want to communicate in the app. Today this works through avatar↔avatar DMs in `messages` (with `propertyId` NULL). Under the entity model that path needs a deliberate answer.

### 14.0 The three options (with pros and cons)

**Option A — Drop direct chat entirely.**
- *Mechanism:* `messages.entity_id` is NOT NULL with no exceptions. If two users don't share an entity, they cannot message each other in the app. The avatar profile sheet exposes phone/email (when the target chooses to share them) for off-app contact, plus a button to bring the person into one of the viewer's entities via the four-step flow (§9.3).
- *Pros:* One model; no special cases anywhere. Every message has an entity context, so every notification, every read receipt, every mention, every push payload routes through the same primitive. The schema doesn't need a `recipient_outward_account_id` column. Privacy-by-default — when the property is removed, the messaging path collapses naturally. The app stays focused on workspace-bound work.
- *Cons:* A behavioral break for any user who currently uses avatar↔avatar DMs as light social chat. Existing DMs without a shared entity have nowhere to land in the new schema and have to be archived (see §11.3). The user has to leave the app to reach someone they have no work relationship with.

**Option B — One avatar-to-avatar exception.**
- *Mechanism:* Keep a thin `direct_messages` table (or a nullable `messages.entity_id` carve-out) for the single case of two avatars who have no shared entity. The avatar profile sheet keeps a "Message" button. Notifications for these messages route to the avatar inbox without an entity context.
- *Pros:* Preserves backward compatibility — existing DMs migrate cleanly, no archival. Users who think of the app as part-chat-part-workspace keep their casual conversations.
- *Cons:* Re-introduces the exact problem the entity model was built to eliminate. Every read scope has to branch ("is this entity-scoped or direct?"). Every notification has to handle the "no entity context" case. The avatar surface gains back a "Message" action — directly violating directive #6 ("avatar profiles must not have Connect or Message actions"). Permissions become two systems again (entity participation gates one path, mutual-friendship gates the other), which is what caused the messaging-permissions chicken-and-egg in the first place.

**Option C — Auto-create a "pair" entity.**
- *Mechanism:* When two users with no shared entity want to talk, the system silently creates an `entities` row with a fourth `kind='pair'` (or `'personal'`) and adds both as participants. From the schema's perspective, every message has an `entity_id` — the pair-entity is just invisible in the UI, with no controller, no calendar, no tabs.
- *Pros:* Schema purity preserved (`entity_id NOT NULL` everywhere). No `direct_messages` carve-out. Existing avatar↔avatar DMs migrate by minting a pair entity per pair.
- *Cons:* Introduces a fourth entity kind purely for back-compat, directly contradicting directive #2 in §1.5 ("exactly three entity kinds. No additional entity types."). The pair entity is a workspace pretending not to be a workspace — it has all the storage cost and routing cost of an entity but none of the user-visible structure. Settings, permissions, and the "Add member" flow all have to special-case kind='pair' to suppress UI. It's a hidden table with hidden semantics, which is the opposite of "every record explicitly belongs to a workspace."

### 14.1 How your directives constrain the choice

This is context for the recommendation, not a decision. These are tensions between the three options and earlier directives — read them, then decide whether the directives still hold or should be relaxed for this case.

- Directive #5 (§1) — "All messages, tasks, photos, timelines, approvals, and activity must be scoped to an `entityId`. Nothing carrying user content may exist outside an entity." → If kept literally, this is **in tension with Option B** (a `direct_messages` carve-out). Option B would only fit if you relax this rule for the friends case specifically.
- Directive #6 (§1) — "No avatar-to-avatar connection or messaging logic may exist anywhere in the system. Avatar profiles are for identity only — they must not have Connect or Message actions." → If kept literally, this is **in tension with Option B** at the UI layer (which would put a "Message" button back on the avatar sheet).
- Directive #2 in §1.5 — "Exactly three entity kinds. Residential property, commercial property/facility, business/company. Do not introduce any additional entity types. No 'pair,' no 'personal,' no 'friend.'" → If kept literally, this is **in tension with Option C** (which adds a fourth `kind='pair'`).
- Directive #1 in §1.5 — "No direct chat exists in the system. Messaging only happens inside entities. If two users do not share an entity, they cannot communicate in the app and must use external contact methods." → This **points toward Option A**.

Two of the three options sit in tension with directives you've already given. That's not me picking; that's me showing you where each option pulls. You may decide that the directives override the option, or that this particular case warrants relaxing one. Either way the choice is yours.

### 14.2 Recommendation (not a decision)

I recommend **Option A**. Reasons:

- It's the only option that requires no special cases anywhere in the schema or the renderer. Every read scope keeps a single shape (`WHERE entity_id = ?`), every notification has an entity context, every push payload routes the same way, and the messaging-permissions chicken-and-egg disappears for free.
- It aligns with the directives you've already issued (especially §1.5 #1).
- The behavioral break it creates — pre-migration DMs without a shared entity have nowhere to land — is bounded and survivable: the migration plan in §11.3 archives those rows to a read-only `messages_legacy` surface so users can still read their history, just not reply in-app.

But I want you to **explicitly confirm Option A** (or pick B or C) before phase 1 ships, because:

- The directives in §1.5 were given mid-draft of this proposal. You may want to revisit any of them.
- Option B (one carve-out) preserves backward compatibility for users who treat the app as part-chat-part-workspace. If you weight that highly, B may be worth its complexity cost.
- Option C (pair entity) is the only option that keeps schema purity (`entity_id NOT NULL`) AND preserves direct chat. If you find Option A's behavioral break unacceptable but want to keep the schema clean, C is the compromise.

This question is re-listed in §17 as an open item. Don't read past it as decided — phases 1 and 3 of the rollout depend on it, and the messaging schema in §11 reflects Option A only because that's my recommendation, not because it's locked.

### 14.3 What the rest of this document assumes (and what changes if you pick B or C)

The schemas and migration steps elsewhere in this proposal (especially §3.5, §11, §11.3, §13, §16) assume Option A. **If you pick B or C, the affected sections need this rewrite:**

- **Pick B:** Add a `direct_messages(id, from_outward_account_id, to_outward_account_id, body, created_at)` table; allow `messages.entity_id` to be NOT NULL but route DM-style messages to the new table; restore a "Message" CTA on the avatar sheet (relaxing directive #6). §11.3's "archive to messages_legacy" step becomes "leave in `direct_messages`."
- **Pick C:** Add a `kind='pair'` entry to the `entities` table enum (relaxing §1.5 directive #2); migration script auto-creates one pair entity per pre-existing avatar↔avatar DM pair and bulk-updates `messages.entity_id`. §11.3's "archive" step becomes "create pair entities and re-point." Avatar sheet gains a "Start chat" CTA that creates-or-finds the pair entity for (me, them).

I have not pre-built either branch. If you pick B or C, I'll come back with a delta proposal that swaps in those sections.

### 14.4 If you pick Option A — what that means structurally

- `messages.entity_id` is **NOT NULL, no exceptions.** No nullable carve-out, no second table.
- There is no `direct_messages` table. There is no `pair` entity kind. There are exactly three entity kinds (residential property, commercial property, business — directive #2, §1.5).
- Two users who do not share an entity cannot communicate inside the app.
- The avatar profile sheet **does not** offer a "Message" action. The two paths between strangers are: (a) bring them into a workspace via the four-step add-to-entity flow (§9.3), or (b) tap "Show contact info" to phone/email outside the app (§11.4).

### Migration consequence (already detailed in §11.3)

Existing avatar↔avatar DMs with no shared entity have nowhere to go in the new schema. They are exported into a read-only `messages_legacy` archive at cutover. The user gets a one-time post-migration notice telling them where to find the archive and explaining that direct messaging is no longer supported in-app.

### Why this works for the user

- **One model.** No special cases. Every message is inside an entity, every conversation is workspace-bound, every notification has an entity context.
- **No "friends" feature drift.** The app's purpose is workspace — homes, facilities, businesses. Social chat with no work context never has to grow features it shouldn't (group chats, polls, gifs, etc.).
- **Privacy-by-default.** Two people who briefly worked together on one property and have since had the property removed lose their messaging path with each other once the participant rows go to `removed`. They can re-establish if either invites the other to a new entity.

### What replaces "friends"

- **Avatars marked as collaborators on a property** (e.g. spouse, designer, neighbor) keep the messaging path on that property — it's an entity they share. This covers the common social-but-also-relevant cases (spouse, designer, parent helping out with a renovation).
- **External contact** (phone/email) covers anything the user wants to do socially with someone they have no work relationship with. The app does not pretend to be a chat app.

This is final. The proposal does not re-open this in any later phase.

---

## 15. Phased rollout (sketch — not a contract)

> **Section assumption:** phases below assume Option A from §14 pending user confirmation. If the user picks Option B or C, the affected migration steps in phases 1, 3, and 6 are swapped per §14.3 before phase 1 begins.

Each phase fits in one task. I'm sketching scope, not committing to wording.

### Phase 1 — Entities table + dual-write

- Create `entities`, `entity_property_details`, `entity_business_details` tables.
- Backfill: every `properties` row → an `entities` row. Every `outward_accounts` row of kind `trade_pro`/`facilities` with non-trivial team or client footprint → an `entities` row of kind `business`.
- Routes that write a property *also* write the matching entity row. Reads continue from `properties` for now.
- No user-visible changes.

### Phase 2 — Participant model on `property_members`

- Add `direction`, `status`, `permissions`, `requested_by_outward_account_id`, `required_avatar_kind`, `setup_request_sent_at`, `setup_request_accepted_at`, `decided_at` columns.
- Backfill existing rows to `direction='invite'`, `status= archivedAt? 'removed' : 'approved'`, `permissions = preset(kind, role)`.
- New endpoints: `POST /participants/invite`, `POST /participants/request`, `POST /participants/:id/accept`, `POST /participants/:id/decline`, `POST /participants/:id/remove`, `POST /participants/:id/accept-setup`.
- Old `user_connections` endpoints wrapped as deprecated, returning 410 Gone with copy pointing at the new endpoints.
- UI: PublicProfileModal CTA replaced by "Add to one of my entities…" launching the four-step flow.

### Phase 3 — Activity records get `entity_id`

- Add `entity_id NOT NULL` (after backfill) to: `messages`, `notifications`, `work_orders`, `work_order_comments`, `work_logs`, `property_assets`, `property_notes`, `property_specs`, `property_standards`, `recurring_tasks`, `points_ledger`, `job_ratings`, `company_notices`. Add nullable to `object_uploads`.
- Backfill from existing `propertyId` where present; resolve null cases per §3.5.
- All read scopes switch to `entity_id`.
- Inbox UI flips to entity-feed + alerts. DM thread UI removed.

### Phase 4 — Business-as-entity migration

- Create `entities` rows for every business skin (those that meet §12's threshold).
- Migrate `team_seats` → `entity_members` rows on the business entity.
- Routes for company management retarget at the business entity.
- The entity switcher includes businesses.
- The Clients view is retargeted to the business entity scope.

### Phase 5 — Cleanup renames

- Rename `properties` → `entities` finally (drop the dual-write).
- Rename `property_members` → `entity_members`.
- Rename `propertyId` → `entityId` everywhere.
- Drop `user_connections`, `user_team_members`, the `lib/teamUpRequests.ts` helper.
- Remove `user_modes` if nothing still reads it.
- Update all UI strings per §13.

### Phase 6 — Friends-case implementation

- Per directive #1 in §1.5, the canonical implementation is Option A (drop direct chat, archive legacy DMs to `messages_legacy`). This is folded into phases 1 and 3 above; this phase is a checkpoint for the post-migration archive-access UI (Profile → Settings → Archived conversations) and the one-time post-migration notice copy.
- §14 enumerates Options B and C with pros/cons per the task spec; if the user explicitly relaxes directive #1 or #2 before phase 1, swap in the corresponding shape from §14.3.

This isn't a ship-order contract. It's a sequencing sketch to surface dependencies. The user can renumber.

---

> **Section assumption:** the risks below assume Option A from §14 pending user confirmation. If the user picks Option B or C, the friends-DM row in this table is replaced by the corresponding migration path described in §14.3.

## 16. Migration risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Existing DMs with no `propertyId` and no obvious target entity. | High | Per directive #1 in §1.5, archive to a read-only `messages_legacy` table with a post-migration notice. §14 enumerates Options B (parallel `direct_messages` table) and C (auto-created `kind='pair'` entity) for completeness, but they are out of scope unless the user explicitly relaxes the directive before phase 1. |
| In-flight team-up / connection requests at migration cutover. | Medium | Snapshot all `pending` `user_connections` rows at cutover. Re-emit as `entity_members(direction='invite', status='invited')` on a sensible default entity (the inviter's first business; fallback: surface them in a "things to redo" list to the inviter). |
| Billing scope changes when business becomes an entity. | Medium | `subscriptions` and `outward_accounts.capabilityState` continue to key on the avatar, not the entity. Confirms during phase 4. |
| Push-notification routing during phase 3. | Medium | `notifications` keeps `user_clerk_id` + `outward_account_id` for routing. The new `entity_id` is purely contextual. Push payload unchanged in shape. |
| Search ranking shift when people search returns one row per person instead of per skin. | Low–Medium | Test plan: shadow the new ranking against the old for a week before flip. Keep a flag to revert if engagement craters. |
| Contractor-created properties whose client later signs up under a different identity. | Medium | The auto-provisioning row carries `recipient_phone` / `recipient_email` (inherited from `app_invites` / `business_invites`). A signed-up Clerk account whose contact info matches gets prompted: "Did Sarah Hill add you to Sarah's Dallas Home?" and accepting links the avatar to the participant row. |
| Legacy NULL `outward_account_id` rows on messages/notifications. | Low | The existing `migrateOutwardAccounts.ts` already handles this. Same script extended for `entity_id`. |
| The "removed but kept their portfolio" rule conflicts with sensitive PII docs (signed contracts). | Medium | Phase 1 treats every upload as portfolio-eligible. Add `portfolio_eligible` flag in a later phase when sensitive doc kinds are introduced. **Open question §17.** |
| Friction when a homeowner adds their spouse and the system auto-provisions a Homeowner avatar. | Low | The accept-setup flow is one screen and uses sensible defaults from the inviter's existing context (cover, name). |
| Apps that hard-code property-only paths (`/properties/:id/...`) need rewrites in phase 5. | Low | Rename happens with a mechanical codemod at phase 5 cutover. |

---

## 17. Open questions back to you

These all need answers before phase 1 ships. The first one (the friends fork) is the load-bearing one — phases 1 and 3 of the rollout depend on which way it goes.

1. **Friends / no-shared-entity case (the §14 fork).** Three options, your call. Summarized:
   - *Option A — drop direct chat.* `messages.entity_id` NOT NULL with no exceptions. Pre-migration DMs without a shared entity are archived to a read-only `messages_legacy` table. Avatar sheet has no Message button. ✅ One model, no special cases. ❌ A behavioral break for users who treat the app as part-chat-part-workspace.
   - *Option B — one avatar↔avatar carve-out.* Keep a thin `direct_messages` table for users with no shared entity; restore a Message button on the avatar sheet. ✅ Backward-compatible, no archival. ❌ Re-introduces two-system permissions and contradicts directives #5/#6 if those still hold.
   - *Option C — pair entity.* Auto-create a `kind='pair'` entity (a fourth kind) per pair of avatar↔avatar correspondents; route messages through it. ✅ Schema purity preserved. ❌ Adds a fourth entity kind, contradicting §1.5 #2 if that still holds; pair entities have to special-case nearly every UI affordance.
   - **My recommendation:** A. **Decision needed before phase 1 ships.**
2. **Portfolio-eligibility for sensitive doc kinds** — phase 1 ships "all uploads stay in your portfolio after revoke." Acceptable? Or block phase-3 cutover until a `portfolio_eligible` flag exists?
3. **Auto-approve threshold for invites** — when the inviter has admin rights on the target entity AND the target already has the right avatar, do we auto-approve, or does the target always have to confirm? My default: always confirm. Override?
4. **Entity switcher / Entities tab for users with many entities** — group by kind, by recency, both? Pin favorites?
5. **Avatar switching inside an entity** — should it be possible to act as a non-participant avatar inside an entity? My default: no, the avatar must be a participant. Confirm?
6. **Backfill cutover for in-flight `user_connections.pending` rows** — re-emit as invitations to the inviter's default business entity, OR show the inviter a "redo these" list at first login post-migration?
7. **Renaming `propertyId` → `entityId` in the public API** — break the contract in phase 5, or maintain `propertyId` as an alias forever?
8. **Trade-pro account that does NOT represent a company** — directive #7 in §1.5 covers trade pros that *do* represent a company (auto-create a `business` entity with the company name). For a solo trade pro who has no `companyName` and no team, do we still create a one-person `business` entity (with `name` = the avatar's display name) so they have a workspace, or do we skip and let them work only inside client properties? My default: create the one-person business entity so the workspace exists; they can rename later.
9. **Reminder fan-out across devices** — `user_personal_tasks` notifies the user's device(s) regardless of active avatar. Confirm: one push per user per `remind_at`, fanned to all of that user's registered devices? (vs. one per device per avatar.)

Answer however you want — short replies are fine. The proposal won't move into implementation until these are settled.

---

## Appendix A — Side-by-side: Property workspace vs Business workspace

To make §3.1's "symmetric workspaces" claim concrete:

| Surface | Residential property | Commercial property | Business |
| --- | --- | --- | --- |
| Header | Property name + address + cover | Facility name + address + cover | Business name + slogan + cover |
| Tabs | Timeline / Members / Calendar / Tasks / Notes / Photos / Specs / Standards | Same as residential | Timeline / Team (members) / Calendar / Tasks / Notes / Photos / **Clients** (sub-list) / **Properties** (sub-list of jobs) |
| "Add a member" | Four-step flow (§9.3), role options: owner/resident/manager/teammate/collaborator/worker/outside service | Same flow, role options: controller/manager/teammate/collaborator/worker/outside service | Same flow, role options: owner/admin/employee/contractor/collaborator |
| Activity feed source | All rows scoped `entity_id=this` | Same | Same |
| Calendar source | `recurring_tasks` + `work_orders` scoped here | Same | Internal company calendar — `recurring_tasks` + `work_orders` scoped to the business entity (training days, internal meetings, etc.) |
| Sub-list | "Work history" (work_orders + work_logs grouped) | Same | "Properties" (the entities the business's avatar participates on as worker) and "Clients" (the people who own those properties) |
| Notes | `property_notes` (renamed `entity_notes`) scoped here | Same | Same |
| Photos | All assets scoped here | Same | Same |
| Permissions screen | Manage participant rows | Same | Same |

The point: **the same component renders all three.** Kind-specific bits (the "Properties" sub-list on a business; the address pill on a property) are conditional renders driven by `entity.kind`, not separate page layouts.

---

## Appendix B — Kind-agnosticism audit (which `property_*` names should rename)

Per directive #8: anything that's actually entity-generic must be renamed. Anything genuinely property-specific stays.

| Today's name | Bucket | Decision |
| --- | --- | --- |
| `properties` table | (b) entity-generic | Rename → `entities` (phase 5). |
| `property_members` table | (b) entity-generic | Rename → `entity_members` (phase 5). |
| `property_member_events` table | (b) entity-generic | Rename → `entity_member_events`. |
| `property_assets` table | (a) property-specific | Stays — assets are physical inventory in a building. Businesses don't have property assets. (If a business wants to track its own equipment, that's a separate "business assets" table later.) |
| `property_notes` table | (b) entity-generic | Rename → `entity_notes`. Both businesses and properties want notes. |
| `property_specs` table | (a) property-specific | Stays — paint colors and model numbers don't apply to businesses. |
| `property_standards` table | (a) property-specific | Stays — recurring property checks. |
| `recurring_tasks` table | (b) entity-generic | Already entity-generic in name. Just retargets to `entity_id`. |
| `work_orders` table | (b) entity-generic | Rename `propertyId` → `entityId`. Works for businesses (internal jobs) and properties. |
| `work_order_comments`, `work_order_comment_reads` | (b) entity-generic | Add denormalized `entity_id`. |
| `work_logs` table | (b) entity-generic | Rename `propertyId` → `entityId`. |
| `properties.ts` route | (b) | Becomes `entities.ts` route in phase 5. |
| `property-knowledge.ts` route | (a) property-specific | Stays. |
| `PropertyProfileModal` component | (b) | Generalize to `EntityProfileModal`. Branches on kind for kind-specific affordances. |
| `PublicProfileModal` component | (b) (it's an avatar surface, not an entity surface) | Renamed in concept to `AvatarProfileModal`. Strictly identity-only after the change. |
| `find.tsx` (search screen) | (b) | Restructured into People + Entities tabs. |

Mandatory in phase 1: `properties`, `property_members`, all activity tables. Deferrable to a polish phase: the route file and component renames (they're cosmetic).

---

## Appendix C — Glossary

- **Person / User** — a `users` row. One per real human. Holds login + private profile + subscription. The user's `name` and `avatarUrl` are the **primary identity** on every global surface (per §11C).
- **Avatar** — an `outward_accounts` row. A persona a person presents under. Identity only. **Contextual** — used inside an entity to disambiguate which hat the person was wearing for an action. Never the primary label on a global surface.
- **Entity** — an `entities` row. A workspace where work and history live. Kind ∈ {residential property, commercial property/facility, business/company}. **Exactly three kinds. No additions.**
- **Participant / Membership** — an `entity_members` row. The `(entity, avatar)` pair, with direction, status, role, permissions.
- **Controller** — the avatar named in `entities.controller_outward_account_id`. The person who can transfer control of the entity.
- **Add-to-entity flow** — the four-step process (§9.3) that's the system's only connection primitive.
- **Auto-provisioning** — the case (§10) where the four-step flow targets a person who lacks the needed avatar, and the system creates that avatar atomically on the target's accept.
- **Profile** — the user-level workspace (§5, §5.3). The default landing screen on sign-in. Holds the user's personal timeline (derived view across all their entities), private notes, and personal tasks. **Not an entity, not shared, not switchable, not tied to avatars.** Backed by `user_private_notes` and `user_personal_tasks` plus derived queries — never an `entities` row.
- **Personal task / Reminder** — a `user_personal_tasks` row (§11A). User-level. May optionally reference an entity via `optional_entity_id`. Visible globally in Profile and notifies the user regardless of currently-active avatar. Tap routes the user into the referenced entity with the right avatar context.
- **Notification** — a `notifications` row (§11B). User-level, surfaced via the bell icon. Labeled by **person name first** (the actor's `users.name`), with entity context second. Distinct from messages (which live in `messages`) and reminders (which live in `user_personal_tasks`).
- **Bell** — the top-right icon on every screen that opens the notifications feed (§11B.3).
- **Identity surfacing rule** — global surfaces (search, bell, reminders, Profile timeline, avatar profile sheet headline) use `users.name` and `users.avatarUrl`; entity-internal surfaces (message bubble chips, "uploaded by" pills inside the entity) may use the contextual avatar. (§11C.)
- **Kind-agnostic** — code that operates on entities/participants without branching on `entity.kind`. The participant table, the activity tables, and most routes are kind-agnostic.
- **Kind-specific sidecar** — a table keyed by `entity_id` that holds kind-only fields (e.g. `entity_property_details` for address/lat/lng).
- **`messages_legacy`** — the read-only archive (§11.3) of pre-migration avatar↔avatar DMs that have no shared entity to migrate into. Surfaced in Profile → Settings → Archived conversations.

---

*End of proposal. Reply with answers to §17 (or any other reactions) and I'll turn the chosen direction into phase-1 tasks.*

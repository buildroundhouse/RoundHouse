# Roundhouse — Handoff Spec (verified against code)

**Status:** Frozen. This document describes what is **actually built** in the current shell, verified by against the source. Where intent and reality diverge, reality wins and the gap is called out. Do not assume anything in this doc that is not explicitly labeled "wired" or "persisted".

**Stack of the current shell:**
- Mobile / web client: Expo (React Native + Expo Router).
- API: Express, mounted at `artifacts/api-server`.
- DB: Postgres via Drizzle ORM, schema at `lib/db/src/schema/*`.
- Auth: Firebase Auth. Token is a Firebase ID token sent as `Bearer` to the API; the column name `clerkId` is **legacy and now stores the Firebase UID** — there is no Clerk in the system.
- File storage: Replit Object Storage (`@replit/object-storage`), private bucket gated by membership in a property that references the file path.
- Push: Expo Push (`expo-notifications`), with token round-tripped to the server.

**Convention used below:** **Wired** = end-to-end working (UI ↔ API ↔ DB). **Backend-only** = API + DB exist and respond, but no UI surface consumes it. **UI-only** = UI exists but is not connected to API/DB. **Local-only** = data is stored only in component state and is lost on reload.

---

## 1. User Flows (what really happens)

### 1.1 Sign in (Wired, with caveats)
- `app/index.tsx` reads Firebase auth + `useProfile()` and redirects:
  - Not signed in → `/(auth)/sign-in`.
  - Signed in but `identityCompletedAt` is null **or** `avatarUrl` is null → `/(onboarding)/identity`.
  - Signed in, identity done, no modes exist or no active mode → `/(onboarding)/mode-picker`.
  - Signed in, active mode exists but `intakeCompletedAt` is null → `/(onboarding)/intake`.
  - Otherwise → `/(tabs)`.
- The same gate is duplicated in `(tabs)/_layout.tsx`, so deep links to tabs also enforce onboarding.
- Sign-in screen supports email/password (Firebase) on every platform.
- Google SSO: **only works on web** (uses `signInWithPopup`). Both `sign-in.tsx` and `sign-up.tsx` explicitly return the error string *"Google sign-in on mobile native isn't wired yet — use email/password for now."* on native. The Google button still renders on native.
- After sign-in the root layout calls `startPushTokenAutoSync()` and `syncPushTokenWithServer()`, posting the Expo push token to `PUT /users/me/push-token`. On sign-out it calls `clearPushTokenOnServer()`.

### 1.2 Home (Wired)
- File: `app/(tabs)/index.tsx`.
- Top strip: overlapping people avatars (from `/users/me/relationships`), horizontally scrollable property chips (from `/properties`), three tools buttons.
- Edge-to-edge timeline pulled from `GET /logs/feed`.
- Empty state: a single "Log work" CTA button. **No "No ___ yet" copy on this screen.** That cleanup is Home-only — see §7 for the rest of the app where the copy still appears.
- Floating capture button: tap → opens log-work directly; long-press → chooser (photo / note / log). The empty-state CTA triggers it via a brittle module-level singleton (`openCaptureLog`) exported from `CaptureFAB.tsx`. Replace with a context/event bus in the rebuild.

### 1.3 Create Property Profile (Wired)
- Entry point: "+" on the Properties tab or a "Create" affordance in the property chips strip. Opens `AddPropertyModal`.
- Form fields collected: name, address, type. Submitted to `POST /properties`.
- Server inserts the property and inserts a `property_members` row with role `owner` for the creator. Persisted.

### 1.4 Add a photo or note (Wired)
- Triggered from the Home FAB or from inside a property.
- Photo / log capture: `LogWorkModal` → `POST /properties/:propertyId/logs`. Photos uploaded via `POST /storage/uploads/request-url` (presigned URL, then PUT to storage) and the resulting `objectPath` is attached.
- Note: `NoteEditorModal` → `POST /properties/:propertyId/notes`. Server enforces author = owner/admin (so a regular Member cannot add a property note today — confirmed in `property-knowledge.ts:68`).
- Both surface in the property timeline (`useListPropertyLogs`) and the global Home feed (`GET /logs/feed`).

### 1.5 Timeline behavior (Wired, mutable)
- Home timeline = cross-property feed, server-built from `work_logs` joined with author/property.
- Property timeline = `GET /properties/:id/logs`, single-property work logs.
- Items show author avatar/name, property chip, timestamp, body, and attachments.
- **Reality check:** logs are **mutable**. `PUT /logs/:logId/status` and `PUT /logs/:logId/assignee` exist; there is no append-only audit guarantee. The product brief implies an audit trail; today the data model does not enforce one.

### 1.6 Invite to Property (Wired)
- `PropertySettingsModal` → `AddProviderModal`.
- Calls `POST /properties/:propertyId/members`. Allowed only if caller is **owner** or **admin**.
- Body fields: email, role, optional trade-pro fields (`tradeType`, `companyName`, `phone`, `licenseNumber`).
- The new member row is created with role default `member` if no role passed. There is no email-based invite flow — the invitee must already exist as a user (looked up by email). No invite token, no pending state.

### 1.7 Roles and permissions
See §6 for the verified matrix from the routes.

### 1.8 Invoices, Estimates, Receipts (UI-only — placeholder)
- File: `app/(tabs)/invoices.tsx` (85 lines, fully self-contained).
- **No DB tables**, **no API routes**, **no client hooks**. Verified: zero matches for `invoice`/`estimate`/`receipt` in `lib/db/src/schema` or `artifacts/api-server/src/routes`.
- The screen is a segmented control with three tabs that always render a dashed empty box reading "No invoices yet" / "No estimates yet" / "No receipts yet".
- All state is component-local; nothing persists.

### 1.9 Goals (Not built)
- No DB tables. No API routes. No screens. No hooks. No mention in the codebase outside the brief.

### 1.10 People / Clients / Collaborators (Wired)
- Tab: `app/(tabs)/clients.tsx`. Pulls `GET /users/me/relationships` which returns `{ core, clients, collaborators }` arrays.
- Sectioned list with search. Tapping a person opens `PublicProfileModal`.
- Connecting: `UserSearchModal` → `POST /users/:userId/connect` with a `kind` (`client`, `core`, or `collaborator`). Disconnect is `DELETE /users/:userId/connect`.
- All persisted via `user_connections` table.

---

## 2. Screen Map (verified)

**Legend.** **Wired** = UI is connected to API and persists. **Partial** = UI exists, some flows wired, others local-only. **UI-only** = no API. **Backend-only** = API exists, no UI consumes it. **Not built** = nothing.

### Top-level (`artifacts/round-house/app`)
| Path | Purpose | State |
| --- | --- | --- |
| `index.tsx` | Auth + onboarding gate; redirect target. | Wired |
| `+not-found.tsx` | 404 fallback. | Wired |
| `my-jobs.tsx` | All work assigned to me across properties (logs + work orders + upcoming recurring). Pulls `useGetAssignedToMe`. | Wired |
| `(auth)/sign-in.tsx` | Email/password sign-in via Firebase; Google button works on web only. | Wired (web Google) / Partial (native Google: errors out) |
| `(auth)/sign-up.tsx` | Email/password account creation. Same Google caveat. | Wired (web Google) / Partial (native Google) |
| `(onboarding)/identity.tsx` | Pick username (live availability check) + upload avatar. Both required to proceed. | Wired |
| `(onboarding)/mode-picker.tsx` | Choose primary mode and create the user_mode row server-side. | Wired |
| `(onboarding)/intake.tsx` | Mode-specific intake form. Writes `intakeData` jsonb on the active user_mode and stamps `intakeCompletedAt`. For trade pros, also writes `companyName`, contact fields onto the user. | Wired |

### Tabs (`app/(tabs)`)
| Path | Purpose | State |
| --- | --- | --- |
| `index.tsx` (Home) | Top strip + cross-property timeline + FAB. | Wired |
| `clients.tsx` | Sectioned People directory: Clients / Team / Collaborators with search. | Wired |
| `properties.tsx` | List of properties you belong to with role badge and overdue counts. | Wired |
| `invoices.tsx` | Three-tab segmented placeholder (Invoices / Estimates / Receipts). | **UI-only** — nothing persists, no API. |
| `profile.tsx` | Profile card (with edit pencil), mode switcher, badge tier, properties/logs stats, people preview, analytics charts, sign out. | Wired |

### Property
| Path | Purpose | State |
| --- | --- | --- |
| `property/[id].tsx` | The "engine room": property timeline, members, work orders, specs, notes, standards, recurring tasks. ~2400 LOC. | Wired |
| `property/checkin/[id].tsx` | Shareable check-in agenda summarizing drift, open work orders, recent activity. | Wired |
| `work-order/[id].tsx` | Work-order detail with status transitions, attachments, comment thread (with read tracking). | Wired |

### Modal / sheet components (`artifacts/round-house/components`)
All of these exist and render. State labeled where it is not fully wired.

| Component | Purpose | State |
| --- | --- | --- |
| `AddPropertyModal` | Create a property profile. | Wired |
| `AddProviderModal` | Invite a user to a property as a member. | Wired (email must match an existing user) |
| `AssigneePicker` | Pick an assignee from property members. | Wired |
| `AttachmentList` | Render attachments with download/preview. | Wired |
| `BadgeTier` | Reads `score` from user logs to render a tier badge. | Wired (derived from feed) |
| `CaptureFAB` | Floating action button on tabs. Tap = log; long-press = chooser. Exposes module-level `openCaptureLog()` singleton. | Wired (singleton bridge is fragile) |
| `DateRangePickerModal` | From/to date picker for analytics. Native uses `@react-native-community/datetimepicker`; web uses `<input type="date">`. | Wired |
| `EditProfileModal` | Edit name, bio, avatar via `PUT /users/me`. | Wired |
| `EmptyState`, `ErrorBoundary`, `ErrorFallback`, `LoadingScreen`, `KeyboardAwareScrollViewCompat` | Utilities. | Wired |
| `FullProfileModal` | Larger view of a public profile, with social/contact rows. | Wired |
| `IntakeForm` | Renders the dynamic intake form schema. | Wired |
| `LogCard` | Timeline item renderer. | Wired |
| `LogWorkModal` | Capture log with photo/note/score/assignee. | Wired |
| `ModeSwitcher` | Lets a user switch active mode; calls `PUT /users/me/active-mode`. | Wired |
| `MyJobsView` | Lists jobs assigned to the user. Used by `/my-jobs` route. | Wired |
| `NoteEditorModal` | Create/edit a property note. | Wired (write requires owner/admin) |
| `PeopleModal`, `PeoplePreview` | Show / drill into your relationships. | Wired |
| `PerformanceModal` | Score breakdown driving the badge tier. | Wired (derived from feed) |
| `PhotoViewer` | Full-screen photo viewer. | Wired |
| `PropertyCard`, `PropertyOnboardingCard` | Property list entries. | Wired |
| `PropertySettingsModal` | Property settings, member management, transfer ownership entry point. | Wired |
| `ProviderProfileSheet` | Provider stats + their job history on a property. | Wired |
| `PublicProfileModal` | View another user; shows contact fields only if `isSelf` or you are connected. | Wired |
| `PushBanner` | In-app push notification banner (for foreground notifications). | Wired |
| `RatingPromptModal`, `RatingStars` | Owner/Admin rates a member's completed log. | Wired |
| `RecurringTaskEditorModal`, `RecurringTasksManagerModal` | CRUD for recurring tasks. Server-side `setInterval` generates work orders when `nextDueAt` elapses. | Wired |
| `ScoreRing` | Score ring for badge UI. | Wired |
| `SpecEditorModal` | Add/edit a property spec (paint colors, filters, etc.). | Wired (write requires owner/admin) |
| `StandardEditorModal`, `StandardEvidenceHistoryModal` | Manage maintenance standards and view past evidence. | Wired |
| `TransferOwnershipModal` | Owner transfers ownership to another member. | Wired |
| `UserSearchModal` | Find people to connect with. | Wired |
| `WorkOrderEditorModal` | Create/edit a work order. | Wired |

### What does **not** exist as a screen
- DM / inbox / thread screen (backend exists — see §4 messages).
- Notification center screen (backend exists — see §4 notifications).
- Invoice / estimate / receipt editor or detail.
- Goals (not built at any layer).
- Standalone Knowledge Base browser (knowledge lives only inside `property/[id]`).
- Settings screen (no app-wide settings; sign out is on the Profile tab).

---

## 3. Navigation Map (verified)

### Default landing
- Signed-out → `/(auth)/sign-in`.
- Signed-in, `identityCompletedAt == null || avatarUrl == null` → `/(onboarding)/identity`.
- Signed-in, no modes or no active mode → `/(onboarding)/mode-picker`.
- Signed-in, active mode but `intakeCompletedAt == null` → `/(onboarding)/intake`.
- Otherwise → `/(tabs)` (Home).

### Bottom nav
Single 5-tab set, identical across modes: **Home**, **Clients**, **Properties**, **Invoices**, **Profile**.
On iOS with liquid-glass support, uses `NativeTabs`; otherwise classic `Tabs` with iOS SF Symbols and Feather icons elsewhere. Order is fixed.

### What opens from what (verified)
- **Home top strip**: avatar bubble → `PublicProfileModal`; property chip → `property/[id]`; tools row buttons → mode-specific shortcuts (e.g. `/my-jobs`).
- **Home FAB**: tap → `LogWorkModal`; long-press → photo/note/log chooser sheet.
- **Home timeline item**: tap → routes to property or work-order detail; tap author → `PublicProfileModal`; tap property chip → `property/[id]`.
- **Properties**: card → `property/[id]`; "+" → `AddPropertyModal`.
- **Property `[id]`**: internal sections for Timeline, Members, Specs, Notes, Standards, Work Orders, Recurring Tasks, Settings; "Settings" → `PropertySettingsModal` → invite, transfer ownership, archive; work-order row → `work-order/[id]`; check-in button → `property/checkin/[id]`.
- **Clients**: row → `PublicProfileModal`; search → `UserSearchModal` → `POST /users/:userId/connect`.
- **Profile**: pencil/avatar → `EditProfileModal`; mode switcher → `PUT /users/me/active-mode` (or starts a new mode + intake); badge → `PerformanceModal`; people preview → `PeopleModal`; analytics range → `DateRangePickerModal`.
- **Push notification tap**: `RootLayoutNav` deep-links to `/work-order/:id` or `/property/:id` based on the push payload.

### Where each surface lives
- **Cross-property timeline**: Home tab.
- **Single-property timeline**: inside `property/[id]`.
- **People**: Clients tab; previews on Home and Profile.
- **Invoices / Estimates / Receipts**: Invoices tab — placeholder only.
- **Work orders**: inside a property + `/my-jobs` cross-property view.
- **Knowledge** (specs, notes, standards): inside `property/[id]` only.
- **Messages**: backend exists, **no screen**.
- **Notifications**: backend exists, **no in-app screen**; surfaced only via push + `PushBanner`.

---

## 4. Data Model (Postgres / Drizzle, verified columns)

> Every `clerkId`-named column stores a Firebase UID. Rename to `firebase_uid` in the rebuild.

### `users`
`id` serial PK · `clerkId` text unique · `email` · `name` · `username` text unique · `bio` · `avatarUrl` · `website` · `officePhone` · `cellPhone` · `instagram` · `identityCompletedAt` · `lastActiveModeId` int → `user_modes.id` · `expoPushToken` · `createdAt` · `updatedAt`.

**Reality:** `bio` is captured in `EditProfileModal` but **never displayed anywhere** in the current UI. Contact fields (`website`, `officePhone`, `cellPhone`, `instagram`) are written by the trade-pro intake and shown in `PublicProfileModal`/`FullProfileModal` (gated on `isSelf || connected`); they are **not editable from `EditProfileModal`** today, only at intake time.

### `user_modes`
`id` · `userClerkId` · `kind` (`home` | `trade_pro` | `facilities` | `trade_pro_collab` | `facilities_collab`) · `intakeData` jsonb · `intakeCompletedAt` · `activatedAt`.

### `user_connections`
`id` · `fromClerkId` · `toClerkId` · `kind` (`client` | `core` | `collaborator`) · `createdAt` · `archivedAt`.

### `properties`
`id` · `name` · `address` · `type` (default `home`, **not surfaced meaningfully in UI**) · `ownerClerkId` · `coverColor` · `isPro` boolean · `standardsMutedUntil` · `createdAt` · `updatedAt`.

### `property_members`
`id` · `propertyId` · `userClerkId` · `role` text default `member` · `invitedBy` · `tradeType` · `companyName` · `phone` · `licenseNumber` · `notes` · `firstVisitedAt` · `welcomeDismissedAt` · `archivedAt` · `createdAt`.

**Stored roles:** only `owner`, `admin`, `member` are ever inserted. The string `viewer` appears only as a **synthetic fallback** in route code (`properties.ts:117`, `:167`) when a caller has access to a property without a membership row — it is not a stored role today.

### `property_member_events`
Audit log: `id`, `propertyId`, `userClerkId`, `eventType`, `byClerkId`, `role`, `createdAt`. Written when ownership transfers and when roles change.

### `work_logs` (the timeline spine)
`id` · `propertyId` · `authorClerkId` · `assigneeClerkId` (nullable) · `status` · `note` · `photoUrl` · `attachments` jsonb (`{path, kind, size}[]`) · `isRealTime` boolean · `score` int · `viewCount` · `dueDate` · `completedAt` · `createdAt`.

**Reality:** rows are **mutable** via `PUT /logs/:logId/status` and `PUT /logs/:logId/assignee`. There is no edit history.

### `work_orders`
`id` · `propertyId` · `title` · `description` · `priority` (`low`/`normal`/`high`/`urgent`) · `dueDate` · `status` (`open`/`in_progress`/`complete`/`assigned`/etc.) · `assigneeClerkId` · `createdByClerkId` · `photoUrl` · `attachments` jsonb · `recurringTaskId` (nullable FK) · `startedAt` · `completedAt` · `verifiedAt` · `createdAt` · `updatedAt`.

### `work_order_comments` and `work_order_comment_reads`
Comments: `id`, `workOrderId`, `authorClerkId`, `body`, timestamps.
Reads: composite key (`userClerkId`, `workOrderId`), `lastReadAt`. Powers the unread badge.

### `recurring_tasks`
`id` · `propertyId` · `title` · `description` · `priority` · `cadence` (`weekly`/`monthly`/`custom`/etc.) · `cadenceValue` int · `assigneeClerkId` · `isActive` · `createdByClerkId` · `lastGeneratedAt` · `nextDueAt` · timestamps.

**Reality:** generation is triggered by a `setInterval(...)` inside the API process (`artifacts/api-server/src/index.ts`). Each tick scans active rows where `nextDueAt <= now`, inserts a `work_order`, sends a notification + push to the assignee, and advances `nextDueAt`. **This will double-fire under multi-instance deploys** — there is no leader election or DB-side locking guard beyond an in-process `isGenerating` flag.

### `job_ratings`
`id` · `workLogId` · `propertyId` · `memberClerkId` (rated person) · `ratedByClerkId` · `stars` · `comment` · `createdAt`.

### `property_notes`
`id` · `propertyId` · `authorClerkId` · `title` · `body` · `isPinned` · `attachments` jsonb · timestamps.

### `property_specs`
`id` · `propertyId` · `category` · `key` · `value` · `photoPath` · `authorClerkId` · timestamps.

### `property_standards` and `property_standard_evidence`
Standards: `id`, `propertyId`, `title`, `description`, `cadenceDays`, `evidenceType` (default `log`), `keyword`, `snoozeUntil`, `createdBy`, timestamps.
Evidence: `id`, `standardId`, `propertyId`, `createdBy`, `photoPath`, `note`, `metAt`, `createdAt`.

### `messages`
`id` · `senderClerkId` · `recipientClerkId` · `propertyId` (nullable context) · `content` · `isRead` · `createdAt`.

**Reality:** API endpoints exist (`GET /messages`, `GET /messages/:otherUserId`, `POST /messages/:otherUserId`, mark-read). **No mobile UI consumes any of them.** Messages can be created by another client (e.g. curl) and they will persist, but the user has no way to see or send them in the app.

### `notifications`
`id` · `userClerkId` · `type` · `title` · `body` · `isRead` · `relatedId` · `createdAt`.

**Reality:** API endpoints exist (`GET /notifications`, `POST /notifications/read-all`, `POST /notifications/:id/read`). **No mobile UI consumes them.** The user only sees notifications via Expo Push delivery + the in-app `PushBanner` on foreground arrival. Reading them in-app is impossible today.

### `object_uploads`
`objectPath` PK · `uploaderClerkId` · `createdAt`. Used to prevent reference-spoofing: only the original uploader of a path may attach it to a record.

### What is **not** in the schema
- No `invoices`, `invoice_line_items`, `estimates`, `receipts`, `goals`, or `threads` tables.

---

## 5. Relationships (verified)

- `users` ↔ `properties` is many-to-many through `property_members`. Each membership has a `role`.
- `properties` → `property_members` is one-to-many; **the owner is whichever membership row currently has `role = 'owner'`**, and `properties.ownerClerkId` mirrors it (kept in sync by the transfer-ownership route).
- `properties` → `work_logs` one-to-many (`work_logs.propertyId`).
- `work_logs` → `users` two FKs: `authorClerkId`, optional `assigneeClerkId`.
- `properties` → `work_orders` one-to-many; `work_orders.assigneeClerkId` optional FK to users.
- `work_orders` → `work_order_comments` one-to-many; `work_order_comment_reads` is a composite read marker per (user, work order).
- `recurring_tasks` → `work_orders` one-to-many via `work_orders.recurringTaskId`.
- `property_standards` → `property_standard_evidence` one-to-many.
- `properties` → `property_notes`, `property_specs` one-to-many each.
- `job_ratings` → `work_logs` and `users` (member + rater).
- `messages` → `users` (sender, recipient) + optional `propertyId`.
- `notifications` → `users` (recipient only).
- `user_connections` is a directional edge `fromClerkId → toClerkId` with a `kind`. The Clients tab filters/groups by `kind`.
- **Invoices/estimates/receipts/goals → property/user**: not modeled (does not exist).

---

## 6. Permissions (verified from route code)

### Roles actually stored
- `owner` — created the property or had it transferred. Exactly one per property; enforced by the transfer route demoting the previous owner to `admin`.
- `admin` — promoted by the owner.
- `member` — default role for an invited user.

### `viewer` is **not** a stored role
It only appears as a **runtime fallback string** when a caller hits a property route and has no `property_members` row — e.g. as a label returned by `GET /properties/:id` (`role: currentMember?.role || (property.ownerClerkId === currentUserId ? "owner" : "viewer")`). No insert/update writes `viewer` anywhere in the codebase.

### Access matrix (from the routes)

| Action | Owner | Admin | Member | Non-member |
| --- | :-: | :-: | :-: | :-: |
| Read property + timeline + work orders + notes + specs | ✓ | ✓ | ✓ | ✗ |
| `POST /properties/:id/logs` (log work / add photo / note attached to a log) | ✓ | ✓ | ✓ | ✗ |
| `POST /properties/:id/standards/:standardId/evidence` (record evidence) | ✓ | ✓ | ✓ | ✗ |
| `PUT /properties/:id` (edit property name/address) | ✓ | ✓ | ✗ | ✗ |
| Property knowledge writes — notes, specs, standards (POST/PUT/DELETE) | ✓ | ✓ | ✗ | ✗ |
| Recurring tasks CRUD | ✓ | ✓ | ✗ | ✗ |
| `POST /properties/:id/work-orders` (create) | ✓ | ✓ | ✗ | ✗ |
| `PUT /work-orders/:id` (full edit) | ✓ | ✓ | ✗ | ✗ |
| `POST /work-orders/:id/status` (status change) | Owner/Admin: any transition. Assignee (any role): may move to `in_progress` or `complete`. Author (any role): may also move to `complete`. | | | ✗ |
| `PUT /logs/:id/status` | Author / Assignee / Owner / Admin | ✗ |
| `PUT /logs/:id/assignee` | ✓ | ✓ | ✗ | ✗ |
| `POST /logs/:id/ratings` | ✓ | ✓ | ✗ | ✗ |
| `POST /properties/:id/members` (invite) | ✓ | ✓ | ✗ | ✗ |
| `PUT /properties/:id/members/:userId` (change role / metadata) | Owner/Admin (others); user themselves can edit their own non-role fields. | | | |
| `DELETE /properties/:id/members/:userId` | Owner/Admin (remove others); user themselves can leave. | | | |
| `POST /properties/:id/transfer-ownership` | ✓ | ✗ | ✗ | ✗ |
| `DELETE /properties/:id` | ✓ | ✗ | ✗ | ✗ |

### Cross-property / account
- Any signed-in user: `POST /properties` (becomes owner), `POST /users/:id/connect`, `POST /messages/:id` (no UI to call this from the app), `PUT /users/me`, `PUT /users/me/active-mode`.
- **Storage downloads** (`GET /storage/objects/*`): require auth **and** that the path is referenced by some record on a property the user is a member of — checked by `canUserAccessObjectPath`. **Caveat documented in code (`storage.ts:101–106`):** avatar paths are not protected through this mechanism, because allowing avatar URLs (a user-controlled string) to grant read access would let anyone bypass the membership check. A dedicated avatar-serving route is **not yet implemented**, so cross-property avatar fetching today depends on the upload bucket being world-readable / signed-URL behavior. Treat avatars as not-strongly-private.

### Auth coverage
Every API route file mounts `requireAuth` middleware on every endpoint, except:
- `health.ts` (health check, intentional).
- `index.ts` (router composition file, no endpoints of its own).
- `GET /storage/public-objects/*` (intentionally public).

---

## 7. Language and UI rules (verified state)

### Current canonical names (in code today)
- Tabs: **Home**, **Clients**, **Properties**, **Invoices**, **Profile**.
- Header texts seen: **Receipts** (sub-tab in Invoices), **Estimates**, **Invoices**.
- Action verbs in the UI: **Log work**, **Create Property Profile** (`AddPropertyModal`), **Invite to Property** (`AddProviderModal`), **Transfer Ownership** (`TransferOwnershipModal`).
- "Goals" appears nowhere in the UI.

### Removed / banned (status today)
- ❌ "Work" as a tab/top-level surface — confirmed removed.
- ❌ Slogan/tagline — none present.
- ❌ "No ___ yet" copy — **NOT removed app-wide.** Cleanup happened on Home only. The phrase still appears in:
  - `(tabs)/clients.tsx:128` — "No people yet"
  - `(tabs)/properties.tsx:122` — "No properties yet"
  - `(tabs)/invoices.tsx:9–11` — "No invoices/estimates/receipts yet"
  - `property/[id].tsx` — multiple: "No standards defined yet.", "No matching activity yet", "No work orders yet — add one or set up a recurring task.", "No specs yet — add paint colors, materials, appliance specs in Knowledge.", "No work logs yet.", "No providers on this roster yet.", "No ratings yet", "No specs recorded yet.", "No notes yet.", "No history events yet."
  - `work-order/[id].tsx:405,473` — "No attachments yet.", "No comments yet. Start the conversation."
  - `components/PeoplePreview.tsx`, `components/PeopleModal.tsx`, `components/ProviderProfileSheet.tsx`, `components/RecurringTasksManagerModal.tsx`, `components/PropertyOnboardingCard.tsx`, `components/StandardEvidenceHistoryModal.tsx`, `components/CaptureFAB.tsx`.
  Treat the "no yet" cleanup as **incomplete** — only Home is clean.

### Visual / interaction (current behavior)
- Timeline-centered Home: ✓.
- One primary action per screen: roughly enforced; `PropertySettingsModal` has multiple actions of similar weight.
- Plain neutral copy: mostly ✓.
- Color: Facebook-blue primary tokens are in `useColors`; light/dark mode supported.
- Logo: dedicated black logo asset is wired in `LoadingScreen` and the lockup is used in onboarding/identity.
- Typography: Inter (Regular / Medium / SemiBold / Bold) loaded in `_layout.tsx`.
- Tab bar: native liquid-glass tab bar on supported iOS, classic Tabs everywhere else (including blur on iOS, solid on web/Android).

---

## 8. Open Issues (rebuild-ready, honest)

### Hard product gaps (no DB, no API, no UI)
1. **Invoices / Estimates / Receipts** — only a placeholder screen with hardcoded "No ___ yet" copy.
2. **Goals** — nothing exists at any layer.

### Backend exists, no UI surface
3. **Direct messages** — full CRUD API (`GET/POST /messages…`), `messages` table persisted. Zero mobile screen consumes it. Decide if DMs ship; if yes, build inbox + thread + push hooks.
4. **In-app notification center** — full API (`GET /notifications`, mark-read, mark-all-read), `notifications` table persisted. Zero mobile screen consumes it. The user can only see notifications when push fires (foreground `PushBanner` or OS notification). No history.

### UI exists, partially wired or fragile
5. **Google sign-in on native** — button renders but explicitly errors out. Either remove the button on native or wire `expo-auth-session` Google flow.
6. **CaptureFAB cross-screen trigger** — uses a module-level singleton (`openCaptureLog`) for Home empty-state to open the FAB. Replace with React context or an event bus.
7. **EditProfileModal scope** — only edits name/bio/avatar. `users.bio` is **never displayed**. Contact fields (`website`, `officePhone`, `cellPhone`, `instagram`) can only be set during trade-pro intake; once you finish onboarding there is no UI to edit them. Either expose them in EditProfileModal or stop collecting them.
8. **"No ___ yet" copy** — still present on every screen except Home (full list in §7). Either complete the cleanup or formally retract that rule.

### Data-model debt
9. **`clerkId` legacy column name** — every user reference in the schema is named `clerkId` but stores a Firebase UID. Painful and confusing. Rename to `firebase_uid` (or `user_uid`) in the rebuild.
10. **Roles** — only `owner` / `admin` / `member` are actually stored; `viewer` is a synthetic fallback string. Pick one model and codify it.
11. **User-mode kinds** — five values (`home`, `trade_pro`, `facilities`, `trade_pro_collab`, `facilities_collab`); the `_collab` variants overlap with membership roles. Audit whether they earn their keep.
12. **`properties.type`** — column exists, defaults to `"home"`, has no real UI consumption. Either drive behavior off it or drop it.
13. **Audit trail** — `work_logs` are mutable. The product brief implies an audit trail. Decide: immutable? soft-edited with revision history? freely mutable? Today it is the last one.

### Operational risks
14. **Recurring task generator runs as `setInterval` in-process** with only an in-process `isGenerating` boolean to avoid double-firing. **Not safe under multi-instance deploys.** Move to a real scheduler (DB-side advisory lock, cron, or queue) before scaling out.
15. **Avatar privacy hole** — documented in `storage.ts:101–106`. Avatars stored in the private object bucket cannot be authorized through the membership-via-record check (because avatar URLs are user-controlled). There is no dedicated avatar-serving route. Today this means avatars effectively need to live in a public bucket or signed-URL flow; revisit before launch.
16. **Real-device validation gap** — most testing happens in the web preview. Push notifications, image-picker permission flows, haptics, deep links, safe-area behavior all need a real-device pass.
17. **Object storage migration** — current shell uses Replit Object Storage. If the rebuild changes hosts (e.g. Firebase Storage), every existing `attachments[].path`, `photoPath`, and `avatarUrl` is a migration concern.

### Confirmed product decisions (do not re-litigate)
- 5 tabs, identical across modes: Home / Clients / Properties / Invoices / Profile.
- Home is the default landing screen and shows the cross-property timeline.
- FAB tap = log work; long-press = chooser.
- Edit Profile lives behind a pencil on the Profile card and on the avatar.
- Empty-state direction is "single CTA, no 'No yet'" — but only Home enforces it today.

---

## Appendix A — Persistence summary at a glance

| Data | Persisted to | Auth required to read? | Auth required to write? |
| --- | --- | --- | --- |
| User profile, modes, connections, push token | Postgres | Yes | Yes |
| Properties, members, member events | Postgres | Yes (must be member) | Yes (role-gated) |
| Work logs, work orders, comments, recurring tasks, ratings | Postgres | Yes (must be member) | Yes (role-gated, see §6) |
| Notes, specs, standards, standard evidence | Postgres | Yes (must be member) | Owner/admin (or member for evidence) |
| Messages, notifications | Postgres | Yes | Yes |
| Object uploads + their attachments | Replit Object Storage + `object_uploads` audit row | Yes + path must be referenced by a record on a property you belong to | Authenticated; uploader recorded; only the uploader can attach a path to a property record |
| Avatars | Replit Object Storage; URL stored on `users.avatarUrl` | **Effectively unprotected** for cross-user reads (see §8 #15) | Self only |
| Invoices / Estimates / Receipts / Goals | Nothing — UI-only or absent | n/a | n/a |
| Analytics range, search filters, expanded sections, etc. | Component state only — **local-only**, lost on reload | n/a | n/a |

## Appendix B — Auth surfaces at a glance

- All `/api/*` routes require `Bearer <Firebase ID token>` except `health` and `GET /storage/public-objects/*`.
- The mobile client gets the token from Firebase Auth (`getIdToken()`) and the API client has a token getter set in `_layout.tsx` (`AuthTokenBridge`).
- Push token registration: `PUT /users/me/push-token` runs on sign-in via `startPushTokenAutoSync` and is cleared on sign-out.
- Sign-up is open to anyone; user-row creation happens on first authenticated request to `/users/me` (the `requireAuth` middleware upserts a user row from the Firebase token).

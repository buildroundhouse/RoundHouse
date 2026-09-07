# How Round House Was Built

A retrospective reconstructed from git history, the project task list, and `replit.md`. Each phase below corresponds to a real commit (or run of commits) you can find in `git log`. Where details aren't in a commit message, I've kept the description high-level and called it out.

---

## Phase 0 — Bootstrap (commits `2f4634c` → `f922316`)

The starting point: a pnpm-workspace monorepo template.

1. **Initial scaffold** (`2f4634c`) — pnpm workspace, TypeScript 5.9, Node 24, Express 5 for the API, Drizzle ORM for Postgres, Orval for OpenAPI codegen, Expo for the mobile app.
2. **Initial dependencies** (`685cf43`).
3. **Brand assets** (`da67534`, `f922316`) — installed the Round House line-art logo as the app icon, splash screen, and in-app header. Locked in the warm terracotta (`#C8693A`) / charcoal palette and the Inter font family.

At the end of this phase the project had three artifacts registered: the **API Server**, the **Round House** Expo mobile app, and the **Mockup Sandbox** (a Vite-based component preview surface used on the Replit canvas).

---

## Phase 1 — Product spec + first auth (commits `cf1ce42`, `b11d7cb`)

4. **Product requirements written down** (`cf1ce42`). Defined Round House as a multi-user mobile social platform for property work-logging, with role-based permissions, shared property timelines, direct messaging, push notifications, knowledge base, service-provider management, work orders, and analytics.
5. **Initial routing + Clerk auth** (`b11d7cb`). Set up the Expo router with two route groups:
   - `(auth)` — sign-in / sign-up screens, gated entry
   - `(tabs)` — Properties, Feed, Log, Messages, Profile

   Wired `@clerk/expo` on the mobile side and `@clerk/express` middleware on the API server. Every API route required a valid Clerk JWT.

---

## Phase 2 — Core product features (Tasks #1 → #4, commits `115f2e7` → `41a6d60`)

These were full features, each one delivered as a project task and merged as a single commit.

6. **Task #1 — Property Knowledge Base & Handoff** (`115f2e7`). Each property now has a knowledge tab (specs like paint colors, model numbers), a notes tab (free-form), and a handoff view that surfaces both for new members. New tables: `property_specs`, `property_notes`.
7. **Task #2 — Service Provider Roster & Delegation** (`8aa22c1`). Owners can invite providers (electricians, cleaners, etc.) as members of a property, assign work to them, and view their profile. New `property_members` table with role (`owner`, `member`, `provider`) and trade metadata.
8. **Task #3 — Work Orders & Recurring Task Scheduling** (`d1a21d3`). Added `work_orders` and `recurring_tasks` tables. Owners can create one-off work orders or recurring schedules; assignees see them in their queue.
9. **Task #4 — Standards, drift detection, check-in agendas, owner overview, analytics** (`41a6d60`). The biggest one:
   - `property_standards` table — per-property quality bars with a cadence (days), evidence type (log/photo/rating), and an optional keyword that matches against work-log notes to compute `lastMetAt`.
   - Standards tab on property detail with on-track / overdue pills.
   - Check-in mode (`/property/checkin/[id]`) — generates a structured agenda for a visit (drift alerts, open work orders, awaiting ratings, recent activity).
   - Owner overview endpoint feeding the Feed tab header.
   - Analytics (`/analytics/me`) — standards compliance %, logs per month, top properties by activity, rating trend (last 6 months). Pure React Native bar charts, no chart library dependency.

---

## Phase 3 — The Clerk auth saga (commits `eac35f8` → `c8b06d0`)

This is where things got messy. The Clerk integration had a long tail of fixes — almost every commit message starts with "Fix" or "Improve":

10. `eac35f8`, `6ac868c` — fixing the sign-in/sign-up flow.
11. `06ad979` → `8989176` — incremental polish: password visibility toggle, friendlier errors, Enter-to-submit, better loading states, removing brittle loading checks.
12. `7762e60` — adding space for the Clerk CAPTCHA widget.
13. `b2dea7a` → `c8b06d0` — chasing changes in Clerk's verification API (`prepareEmailAddressVerification` → `prepareVerification`, etc.) to fix incomplete signups.

The pattern: Clerk's hosted email verification step kept producing edge cases that were hard to surface cleanly in a mobile-first flow. Around 13 commits, no decisive resolution.

---

## Phase 4 — Auth migrated to Firebase (commits `578c638`, `52a5eb6`, `443abea`, this session)

14. **Switch to Firebase** (`578c638`). Replaced Clerk end-to-end:
    - **Mobile**: removed `@clerk/expo`, installed `firebase` JS SDK. New files: `lib/firebase.ts` (lazy init guarded by `isFirebaseConfigured`), `lib/auth.tsx` (`AuthProvider` + `useAuth/useUser` hooks that mirror Clerk's interface so the rest of the app barely had to change), `lib/firebaseErrors.ts` (friendly error mapping).
    - **API server**: removed `@clerk/express`, installed `jose`. New `requireAuth` middleware verifies Firebase ID tokens against Google's JWKS endpoint, with issuer + audience pinned to your `FIREBASE_PROJECT_ID`. Generic `401` to clients; full verification error logged server-side only.
    - **Database**: kept the existing column names (`clerkId`, `authorClerkId`, `userClerkId`) since they now just store a Firebase UID — no migration needed, no risk of touching 8+ schema files and every route.
    - **Env**: dropped `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` from the dev script.

15. **Polished the auth screens** (`52a5eb6`):
    - Email + password only on signup (Name field removed — auth is purely email/password)
    - 6-character password minimum (was 8)
    - Email validated as containing `@`
    - Email input: email keyboard, no autocaps, no autocorrect, email autofill
    - Password input: secure entry, no autocaps, current/new password autofill
    - Real Firebase error surfaced on screen (mapped to friendly text for known codes, raw message + code for unknown)
    - Post-auth profile writes removed from the signup path entirely so a successful signup can never visually look like a failure

16. **Web-only Google button** (`443abea`). Hid "Continue with Google" on iOS/Android since the popup-based flow is web-only; native would need `@react-native-google-signin` to wire properly.

This session also added `userId` to the auth context, fixed a tabs layout bug that briefly rendered before `isLoaded` resolved, and set the Firebase config env vars in Replit (`EXPO_PUBLIC_FIREBASE_*` + `FIREBASE_PROJECT_ID`).

---

## Phase 5 — Feature additions delivered alongside the auth work (Tasks #5, #6, #7)

17. **Task #5 — Attachments for property specs and notes** (`baa7f5b`). Provisioned Replit Object Storage. New endpoints:
    - `POST /api/storage/uploads/request-url` — returns a presigned PUT URL the client uploads directly to
    - `GET /api/storage/objects/:objectPath` — serves stored objects

    Schema additions: `photoPath` on `property_specs`, `attachments` (jsonb) on `property_notes`. New `expo-document-picker` dep, shared `lib/uploads.ts` helper, reusable `AttachmentList` and `PhotoPreview` components. Knowledge / Notes / Handoff tabs render uploaded photos and file chips inline. Verified end-to-end with a curl PUT to a presigned URL.

18. **Task #6 — Persist welcome-card dismissals per member per property** (`644dcaf`). Previously the "Welcome to this property" card came back on every cold start because dismissal was only an in-session flag.
    - New `welcome_dismissed_at` column on `property_members`
    - `GET /properties/:id/members/me` returns `welcomeDismissedAt`; `shouldShowOnboarding` is true only inside the new-member window AND if not yet dismissed
    - New idempotent `POST /properties/:id/members/me/dismiss-welcome`
    - The mobile app calls this fire-and-forget when the card is closed; the "Welcome guide" pill on the property header still re-opens it on demand

19. **Task #7 — Push notifications to providers** (in progress at the time of this writing). Notify providers on their phone, not just in-app.

There are also queued tasks not yet started: cleaning up storage when specs/notes are deleted (#17), restricting who can view uploaded files (#18), letting workers attach photos to work logs (#16), SMS backup notifications (#22), and a notification preferences screen (#23).

---

## Current architecture (at a glance)

| Layer | Tech |
|---|---|
| Monorepo | pnpm workspaces, TypeScript 5.9, Node 24 |
| Mobile | Expo + Expo Router, terracotta/charcoal design system |
| Auth | **Firebase** (email/password + Google on web) |
| API | Express 5, `jose` for Firebase ID-token verification |
| DB | Postgres + Drizzle ORM |
| Codegen | OpenAPI YAML → Orval → Zod schemas + React Query hooks |
| Storage | Replit Object Storage with presigned URLs |
| Build | esbuild |

Tables that exist today: `users`, `properties`, `property_members`, `property_specs`, `property_notes`, `property_standards`, `work_logs`, `work_orders`, `recurring_tasks`, `messages`, `conversations`, `notifications`.

---

## Things to know if you start over

A few non-obvious decisions worth preserving:

- **`clerkId` columns now hold Firebase UIDs.** Renaming would touch ~8 schema files and every route — not worth it. Just be aware.
- **OpenAPI title must stay `"Api"`** — Orval prefixes generated hook names with it. Changing it breaks every generated import.
- **`lib/api-zod/src/index.ts`** must only re-export from `./generated/api`, not also from `./generated/types`, or you get TS2308 duplicate-identifier errors.
- **Firebase JS SDK persists session in IndexedDB on web but only in-memory on React Native.** If you want native sessions to survive app restarts later, swap to `initializeAuth` with `getReactNativePersistence(AsyncStorage)`.
- **Google sign-in on native is not wired** — current path uses `signInWithPopup` which is web-only. Adding native requires `@react-native-google-signin/google-signin`.
- **No migration tooling beyond `drizzle-kit push`** — fine for dev, but production deploys will eventually want a proper migration workflow.

---

*Generated from git history through commit `443abea`. If you want this updated as the project grows, just ask.*

# Round House — Workspace

## Overview

pnpm workspace monorepo using TypeScript. Multi-user mobile social platform for property work-logging with Clerk auth, role-based permissions, shared property timelines, direct messaging, and push notifications.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec in `lib/api-spec/openapi.yaml`)
- **Build**: esbuild (CJS bundle for API server)
- **Auth**: Clerk (Express middleware on backend, `@clerk/expo` on mobile)

## Artifacts

- **Round House** (`artifacts/round-house`) — Expo mobile app + Progressive Web App
  - Terracotta (#C8693A) / charcoal palette, Inter font
  - Route groups: `(auth)` (sign-in/sign-up), `(tabs)` (Properties, Feed, Log, Messages, Profile)
  - Auth guard in `(tabs)/_layout.tsx`; `requireAuth` middleware on every API route
  - Generated hooks from Orval used in all screens
  - **Publish flow** (`scripts/build.js` + `server/serve.js`):
    - `buildWeb()` runs `expo export --platform web` into `static-build/web/` (the PWA browsers load — same code, compiled for the web). Runs first so it has its own Metro lifecycle and doesn't conflict with the long-lived Metro that bundles the iOS/Android Expo Go manifests after.
    - `injectPwaMetaTags()` post-processes `static-build/web/index.html` to add the `<link rel="manifest">`, `apple-touch-icon`, `apple-mobile-web-app-*`, `theme-color`, and Open Graph tags. Done as a post-build step (rather than via `app/+html.tsx`) because that file is only honored under static rendering — the app uses single-page web rendering so the +html shell is bypassed. Keep the tags in `injectPwaMetaTags` and `+html.tsx` in sync if you change either.
    - `public/` (project root) holds `manifest.webmanifest`, `apple-touch-icon.png` (180×180), `icon-192.png`, `icon-512.png`, `favicon.ico`, `favicon-16.png`, `favicon-32.png`. All sourced from `assets/images/icon.png` via `magick convert`. Expo copies the entire `public/` folder into the export root.
    - `server/serve.js` serves the web bundle at `/` for browsers (same SPA fallback for unknown routes so client-side routing works on refresh / deep links), and serves the iOS/Android Expo Go manifest only when the request includes the `expo-platform` header. Hashed `_expo/` assets get `cache-control: immutable`; HTML and manifest get `must-revalidate` so updates are picked up on next visit.
    - The legacy QR-code landing page (`server/templates/landing-page.html`) is no longer wired into `serve.js` — kept on disk for reference only.

- **API Server** (`artifacts/api-server`) — Express REST API
  - Clerk middleware validates JWT on every request
  - Routes: `/users/me`, `/properties`, `/logs`, `/feed`, `/messages`, `/conversations`, `/notifications`
  - Auto-creates DB user record on first `GET /users/me` using Clerk SDK
  - **Startup health endpoint** (`GET /api/health`, unauthenticated): reports the boot-time migration result for deploy tooling and uptime checks. Lives in `routes/health.ts` alongside the existing `/api/healthz` liveness probe but is intentionally NOT in the OpenAPI spec. Body shape: `{ status: "ok"|"starting"|"error", migrations: { state, durationMs?, completedAt?, unresolved?, error? } }`. Returns `200` once migrations finish cleanly (`state: "ok"`), `503` while migrations are still running (`state: "pending"`), and `500` if startup migrations failed (`state: "failed"`). The server refuses to start when `unresolved` is non-empty, so a reachable `/api/health` will always show `unresolved: []`.
  - **Probe wiring** (in `artifacts/api-server/.replit-artifact/artifact.toml` under `[services.production.health.*]`):
    - `startup` → `/api/health` — autoscale will not route traffic to a new revision until this returns `200`, so a failed migration (`500`) or stuck migration (`503`) blocks the deploy and surfaces in the Publish UI as a failed rollout.
    - `liveness` → `/api/healthz` — recurring cheap probe; if the process becomes unresponsive the platform recycles the instance, and repeated failures show up in the deployment logs / dashboard.
    - To wire an additional external uptime check (e.g. UptimeRobot, BetterStack, Pingdom), point it at `https://<deployed-domain>/api/health` and alert on any non-`200` response.

## Packages

- `lib/db` — Drizzle schema + client (users, properties, entities, entity_members, work_logs, messages, notifications, property_specs, property_notes, property_standards)

## Standards & Analytics (Task #4)

- **`property_standards`**: per-property quality bars with `cadenceDays`, `evidenceType` (log/photo/rating), optional `keyword` (matches against work-log notes to derive `lastMetAt`).
- **Standards UI**: new "Standards" tab on property detail with status pills (on track/overdue). Drift alert banner on Overview tab.
- **Check-in mode**: `/property/checkin/[id]` route generates a structured agenda (drift alerts, open work orders, awaiting ratings, recent activity). Optional provider focus. Share/copy as text.
- **Owner Overview**: `/overview` endpoint feeds the Feed tab header for owners — per-property cards with open work + overdue counts.
- **Analytics**: `/analytics/me` powers Profile charts: standards compliance %, logs per month, top properties by activity, rating trend (last 6 months). Pure RN bar charts, no chart lib dependency.
- `lib/api-spec` — OpenAPI YAML spec + Orval codegen config
- `lib/api-zod` — Generated Zod schemas + React Query hooks (from Orval)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run migrate` — bring an **existing** database up to the current schema (idempotent; safe one-shot after pulling schema changes — runs additive DDL + outward-account / team-seat backfills without truncating data). For a truly empty DB, run `pnpm --filter @workspace/db run push` first to create the base tables, then `migrate` to apply the additive deltas. Exits with code 2 if any required NOT NULL column was left nullable due to unresolved NULL rows. See `lib/db/scripts/migrate.ts`.
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only; **prefer `migrate`** — `push --force` will silently truncate tables when adding NOT NULL columns)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Connection paradigm — entity-only (READ FIRST before touching connections, messaging, or "people" UI)

Round House has formally moved from an avatar-to-avatar connection model to an **entity-only** model. This is the architectural ground truth for any work involving "connecting", "teaming up", "adding people", messaging, or anything that asks how two users relate to each other.

**The model in one paragraph.** People (avatars) are identity ONLY. Entities are the only things people connect through. The three entity kinds are: residential property, commercial property / facility, business / company. People do NOT connect to people — they put on an avatar and that avatar is added to (or invited to / requests access to) an entity. All meaningful activity (messages, photos, tasks, notes, timeline updates, approvals, calendar items) MUST be scoped to an `entityId`.

**What's already built (Phase 1).** Don't re-implement these — extend or wire into them.
- `lib/db/src/schema/entities.ts` — entities table (kind = `business` | `residential_property` | `commercial_property`)
- `lib/db/src/schema/entity_members.ts` — membership table with `direction` (invite/request), `status` (invited/requested/approved/declined/removed), `role`, `permissions`
- `lib/db/src/schema/entity_business_details.ts` — business sidecar
- `artifacts/api-server/src/routes/entities.ts` — `POST /entities`, `GET /entities/mine` (mounted at `routes/index.ts:57`)

**What's still legacy (avatar-to-avatar) and must NOT be extended.** These exist only to keep Phase 1 demos and inbox routing alive while the property-side entity migration follows.
- `lib/db/src/schema/user_connections.ts` (table) — has a paradigm-notice header at top
- `POST /users/:userId/connect` in `artifacts/api-server/src/routes/users.ts` — has a paradigm-notice block above the handler
- `artifacts/round-house/components/ConnectionKindChooser.tsx` — has a paradigm-notice header at top
- The Connect button **and** the header Message button on a stranger's avatar profile (PublicProfileModal) have been REMOVED. If you find another avatar surface offering Connect / Message, that's a paradigm violation — delete it or replace with "Add to one of my entities."

**Known remaining avatar-to-avatar surfaces (legacy debt to migrate, not extend).** Each writes to `user_connections` via `useConnectToUser` / `POST /users/:userId/connect`:
- `artifacts/round-house/components/UserSearchModal.tsx` — people-search results still offer "Invite" / connect via the old chooser. The eventual replacement is "search returns a person → choose which of MY entities to add them to → choose role inside that entity."
- `artifacts/round-house/app/inbox/[otherUserId].tsx` — the blocked-banner one-tap "Team up" still creates a `user_connections` row. The eventual replacement routes the conversation through a shared entity instead.
- `artifacts/round-house/components/PropertyProfileModal.tsx` — properties ARE entities, so the *concept* is correct, but the call still goes through the legacy connect plumbing instead of `entity_members`.

**Authoritative product specs.**
- `docs/architecture/entity-model-proposal.md` (the proposal doc)
- `.local/tasks/entity-model-architecture-proposal.md` (the source-of-truth spec)
- `.local/tasks/relationship-teaming-flow.md`, `.local/tasks/outward-account-rules-and-caps.md`

**Rules.**
1. New "I want to work with this person" flows write to `entity_members`, not `user_connections`.
2. Never add a Connect / Message button to an avatar profile.
3. Avatar profile actions are limited to "Invite this person to one of my entities" and "Request access to an entity they manage."
4. The verb pair is "Invite to entity" / "Request access" — not "Connect" / "Team up".

## Important Notes

- `lib/api-zod/src/index.ts` MUST only export from `./generated/api` (not `./generated/types`) — exporting both causes TS2308 duplicate identifier errors
- OpenAPI title MUST stay `"Api"` (Orval uses it to prefix generated hook names)
- Design: no emojis in UI, terracotta #C8693A for primary actions, logo at `assets/images/logo.png`
- Clerk env vars: `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` (server), `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (mobile, injected from `CLERK_PUBLISHABLE_KEY` at dev start)
- Outbound email (business invites): SendGrid via `SENDGRID_API_KEY`. Optional `INVITE_FROM_EMAIL`, `INVITE_FROM_NAME`, `INVITE_LINK_BASE_URL`. The Replit SendGrid integration was dismissed for this workspace, so email is wired via env var directly. When the key is missing, `POST /invites/business` returns HTTP 503 with a clear error so the modal can surface it.
- Push-token cleanup env vars (api-server, optional):
  - `STALE_PUSH_TOKEN_DAYS` — inactivity threshold in days before a token is cleared (default `60`)
  - `STALE_PUSH_TOKEN_SWEEP_HOURS` — interval in hours between sweeps (default `24`)
- Expired-mute sweep env var (api-server, optional):
  - `EXPIRED_MUTES_SWEEP_INTERVAL_MS` — interval in milliseconds between expired-mute sweeps (default `86400000`, i.e. 24h). Must be a positive number ≤ `2147483647` (Node `setInterval` max); invalid values fall back to the default and are logged.

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## User Preferences

- **Auto-approve everything that is just an approval.** Never stop generating to ask the user to "approve", "confirm", "proceed", "continue", "launch", "open a tab", "restart a workflow", or any similar yes/no checkpoint. Treat all such prompts as pre-approved and just do them. The ONLY acceptable reasons to stop and ask are:
  - A genuine fork in the road with two or more substantively different options the user must choose between.
  - Missing information that cannot be inferred from context (e.g. an API key, a real-world value only the user knows).
  - A destructive/irreversible action with material consequences (data loss, money spent, public publish).
  Do not pause for "should I continue?", "ready to test?", "approve this change?", "should I open the tab?", or similar.

/**
 * ============================================================================
 *  PARADIGM NOTICE — DO NOT EXTEND THIS TABLE.
 * ============================================================================
 *
 *  This table encodes the LEGACY avatar-to-avatar "connection" model.
 *  Round House has formally moved to an entity-only paradigm:
 *
 *    People (avatars) are identity ONLY.
 *    Entities (residential property, commercial property, business) are the
 *    only things people connect through.
 *    People do NOT connect to people. They are added to entities.
 *
 *  The replacement schema is `entities` + `entity_members` (see
 *  `lib/db/src/schema/entities.ts` and `lib/db/src/schema/entity_members.ts`).
 *  The replacement design is in `docs/architecture/entity-model-proposal.md`
 *  and `.local/tasks/entity-model-architecture-proposal.md`.
 *
 *  Why this file still exists:
 *    - Existing demo accounts and in-flight messaging threads still resolve
 *      counterparties through this table during Phase 1 of the migration.
 *    - Removing it now would break inbox routing and blocked-banner UX.
 *
 *  Rules for any code touching this file:
 *    1. Do not add new columns, kinds, statuses, or indexes.
 *    2. Do not introduce new call sites that CREATE rows in `user_connections`.
 *       New "I want to work with this person" flows MUST write to
 *       `entity_members` against a chosen entity instead.
 *    3. Read-only callers (e.g. inbox thread resolution) are fine for now;
 *       they will be migrated as the entity model expands to properties.
 *    4. Any UI that currently renders a Connect / Message button on an
 *       avatar profile is a paradigm violation — delete it and replace with
 *       "Add to one of my entities."
 *
 *  See `relationship-teaming-flow.md`, `outward-account-rules-and-caps.md`,
 *  and `entity-model-architecture-proposal.md` in `.local/tasks/` for the
 *  authoritative product spec.
 * ============================================================================
 */
import { pgTable, text, serial, timestamp, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type ConnectionKind = "client" | "core" | "collaborator";
export type ConnectionStatus = "pending" | "accepted" | "declined" | "removed";

/**
 * Task #502: Trade Pro classification picked by the homeowner / facility
 * manager when they connect. Drives the per-property permission scope
 * (Task C). Null on collaborator and home↔home connections.
 */
export type ConnectionClassification = "worker" | "outside_service_provider";

/**
 * Task #504 — hire-cadence sub-bucket for the hirer's view of a Trade
 * Pro / Outside Service connection. Defaults to "occasional" on first
 * connect; the hirer can promote to "recurring" from the connection
 * detail screen. Only meaningful on connections classified as a Trade
 * Pro relationship; ignored for plain home↔home / collaborator rows.
 */
export type ConnectionCadence = "occasional" | "recurring";

/**
 * Task #502: Trade Pro on-site identity chip — picked by the pro
 * themselves and shown directly under their service-title label
 * everywhere they appear for that client. "other" opens
 * `onSiteIdentityOther` for free text.
 */
export type ConnectionOnSiteIdentity =
  | "contractor"
  | "handyman"
  | "specialist"
  | "technician"
  | "vendor"
  | "other";

/**
 * Task #502: Collaborator chip — picked by the collaborator themselves.
 * "other" opens `chipOther` for free text. Boyfriend / Girlfriend
 * render with a small heart in the UI.
 */
export type ConnectionCollaboratorChip =
  | "mom"
  | "dad"
  | "spouse"
  | "sibling"
  | "boyfriend"
  | "girlfriend"
  | "old_friend"
  | "new_friend"
  | "friend"
  | "neighbor"
  | "designer"
  | "other";

/**
 * Outward-account-to-outward-account relationship. Two underlying people
 * can have multiple distinct connections through different pairs of skins
 * (e.g. Person A's Trade Pro skin ↔ Person B's Homeowner skin AND Person
 * A's Collaborator skin ↔ Person B's Trade Pro skin are two separate
 * rows). The canonical identity is the outward-account pair; the owning
 * clerk on each side is reachable by joining `outward_accounts`.
 */
export const userConnectionsTable = pgTable(
  "user_connections",
  {
    id: serial("id").primaryKey(),
    fromOutwardAccountId: integer("from_outward_account_id").notNull(),
    toOutwardAccountId: integer("to_outward_account_id").notNull(),
    kind: text("kind").notNull().$type<ConnectionKind>(),
    status: text("status").notNull().default("accepted").$type<ConnectionStatus>(),
    inviteMessage: text("invite_message"),
    personalNote: text("personal_note"),
    // #502 — tag fields. `classification` describes the Trade Pro on
    // this connection (set by the client side). `serviceTitle` and
    // `onSiteIdentity` describe how the Trade Pro presents themselves
    // to this client (set by the pro). `chip` is the collaborator's
    // own chip describing their relationship to the viewer (set by
    // the collaborator). All optional and editable later.
    classification: text("classification").$type<ConnectionClassification>(),
    // #504 — hire cadence chosen by the from-side (the hirer). Stored
    // even on non-pro connections so callers can read it without a
    // join, but the UI only surfaces it on rows where it's meaningful.
    cadence: text("cadence").$type<ConnectionCadence>().default("occasional"),
    serviceTitle: text("service_title"),
    onSiteIdentity: text("on_site_identity").$type<ConnectionOnSiteIdentity>(),
    onSiteIdentityOther: text("on_site_identity_other"),
    chip: text("chip").$type<ConnectionCollaboratorChip>(),
    chipOther: text("chip_other"),
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedByOutwardAccountId: integer("removed_by_outward_account_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    uniqueOutwardPair: uniqueIndex("user_connections_outward_pair_unique").on(
      t.fromOutwardAccountId,
      t.toOutwardAccountId,
    ),
    fromOutwardIdx: index("user_connections_from_outward_idx").on(t.fromOutwardAccountId),
    toOutwardIdx: index("user_connections_to_outward_idx").on(t.toOutwardAccountId),
  }),
);

export const insertUserConnectionSchema = createInsertSchema(userConnectionsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertUserConnection = z.infer<typeof insertUserConnectionSchema>;
export type UserConnection = typeof userConnectionsTable.$inferSelect;

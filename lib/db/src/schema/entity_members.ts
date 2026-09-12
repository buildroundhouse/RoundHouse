import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Membership of a user (via one of their acting identities) on an entity.
 * This is the unified participant model for businesses, residential
 * properties, and commercial properties / facilities.
 *
 * Product-facing role language is governed by
 * docs/architecture/ROUNDHOUSE_ROLES_AND_PERMISSIONS.md. `viewer` is the
 * neutral view-only role for residential/commercial entities.
 *
 * `collaborator` remains in this TypeScript union ONLY so old rows can be read
 * safely during migration. New writes must not create it and UI must never
 * render it as a current Roundhouse role.
 */
export type EntityMemberRole =
  | "owner"
  | "admin"
  | "manager"
  | "employee"
  | "worker"
  | "viewer"
  | "collaborator";

export type EntityMemberStatus =
  | "invited"
  | "requested"
  | "approved"
  | "declined"
  | "removed";

export type EntityMemberDirection = "invite" | "request";

export type RoundhouseBaseRole =
  | "homeowner"
  | "home_team_member"
  | "viewer"
  | "trade_professional"
  | "trade_team_member"
  | "commercial_management"
  | "commercial_team_member"
  | "supplier";

export type EntityRelationshipKind =
  | "internal_team"
  | "outside_trade"
  | "supplier"
  | "viewer";

export type EntityPermissionSource =
  | "owner_direct"
  | "manager_delegated"
  | "business_derived"
  | "commercial_management"
  | "viewer_invite"
  | "independent_property"
  | "legacy";

export type EntityMemberPermissions = {
  seeContacts?: boolean;
  seeBilling?: boolean;
  createOnProperties?: boolean;
  manageTeam?: boolean;

  /**
   * Explicit participant-management authority. This is deliberately
   * separate from the person's base role. A Property Owner may grant this
   * to a Manager so the Manager can approve appropriate Business participants
   * into the Property on the Owner's behalf.
   */
  manageParticipants?: boolean;

  /** Canonical product-facing base role for newer membership writes. */
  baseRole?: RoundhouseBaseRole | null;

  /**
   * Describes how the person participates with a Business or Entity without
   * turning authority labels into base roles.
   */
  relationshipKind?: EntityRelationshipKind | null;

  /** Why the current Entity permission exists. */
  permissionSource?: EntityPermissionSource | null;

  /**
   * Business source for Business-derived Property access. When the governing
   * Business relationship ends, only Property memberships still dependent on
   * this source should be removed.
   */
  sourceBusinessEntityId?: number | null;
  sourceBusinessMemberId?: number | null;

  /**
   * Membership row of the Property Manager whose delegated authority was used
   * to approve this participation, when applicable.
   */
  approvedUnderManagerMemberId?: number | null;

  /**
   * Optional human-readable / machine-readable permission scope. The exact
   * shape can grow without requiring a schema migration because permissions
   * are JSONB.
   */
  scope?: Record<string, boolean | string | number | null> | null;

  /**
   * Legacy per-property classification retained for old read paths while the
   * product moves fully to baseRole + relationshipKind + permissionSource.
   * Old values may include historical vocabulary and must not be surfaced as
   * current product language.
   */
  classification?: string | null;

  /** Legacy connection id retained only for migration/read compatibility. */
  legacyConnectionId?: number | null;

  /**
   * Property-membership extras preserved from the retired property-members
   * table so old read helpers can reconstruct historical response shapes.
   * Dates are ISO strings because JSON has no timestamp type.
   */
  assignedByClerkId?: string | null;
  invitedBy?: string | null;
  tradeType?: string | null;
  companyName?: string | null;
  phone?: string | null;
  licenseNumber?: string | null;
  notes?: string | null;
  notifyJobStarted?: boolean | null;
  notifyJobCompleted?: boolean | null;
  firstVisitedAt?: string | null;
  welcomeDismissedAt?: string | null;
  messagesLastReadAt?: string | null;
};

export const entityMembersTable = pgTable(
  "entity_members",
  {
    id: serial("id").primaryKey(),
    entityId: integer("entity_id").notNull(),
    userClerkId: text("user_clerk_id").notNull(),
    /** Which acting identity participates in this Entity. */
    userOutwardAccountId: integer("user_outward_account_id").notNull(),
    role: text("role").$type<EntityMemberRole>().notNull().default("employee"),
    status: text("status").$type<EntityMemberStatus>().notNull().default("approved"),
    direction: text("direction").$type<EntityMemberDirection>().notNull().default("invite"),
    permissions: jsonb("permissions")
      .$type<EntityMemberPermissions>()
      .notNull()
      .default({}),
    /** Acting identity that initiated the invitation / request. */
    requestedByOutwardAccountId: integer("requested_by_outward_account_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    entityIdx: index("entity_members_entity_idx").on(t.entityId),
    userClerkIdx: index("entity_members_user_clerk_idx").on(t.userClerkId),
    userAvatarIdx: index("entity_members_user_avatar_idx").on(t.userOutwardAccountId),
  }),
);

export const insertEntityMemberSchema = createInsertSchema(entityMembersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertEntityMember = z.infer<typeof insertEntityMemberSchema>;
export type EntityMember = typeof entityMembersTable.$inferSelect;

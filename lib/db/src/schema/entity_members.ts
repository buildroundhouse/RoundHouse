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
 * Membership of a user (via one of their avatars) on an entity. The unified
 * participant model — replaces both `team_seats` (business teammates) and the
 * legacy property-members table (retired in task #681). Now the sole source
 * of truth for membership across every entity kind: business, property,
 * facility (per docs/architecture/entity-model-proposal.md §3, §9, §12).
 */
export type EntityMemberRole =
  | "owner"
  | "admin"
  | "manager"
  | "employee"
  | "worker"
  | "collaborator";

export type EntityMemberStatus =
  | "invited"
  | "requested"
  | "approved"
  | "declined"
  | "removed";

export type EntityMemberDirection = "invite" | "request";

export type EntityMemberPermissions = {
  seeContacts?: boolean;
  seeBilling?: boolean;
  createOnProperties?: boolean;
  manageTeam?: boolean;
  /**
   * Per-property classification (worker / outside_service_provider /
   * collaborator) carried on property memberships. Lets the
   * entity-members read path reconstruct the
   * worker-vs-outside_service_provider distinction the
   * `effectiveRole()` matrix depends on. (#663 / T006)
   */
  classification?: string | null;
  /**
   * The legacy `connectionId` that pointed at the
   * `user_connections` row pairing the inviter with the target. The
   * underlying table is dead, but a few read paths (property card
   * tag rendering) still surface the id; preserving it on the
   * entity-members mirror keeps those reads stable. (#663 / T006)
   */
  legacyConnectionId?: number | null;
  /**
   * Property-membership extras that originally lived on the legacy
   * property-members table (retired in #681). These fields preserve
   * the rest of that row's shape so the read helpers can reconstruct
   * the same response payload directly from `entity_members`.
   *
   * Dates are stored as ISO strings because `permissions` is JSONB
   * and JSON has no native timestamp.
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
    /**
     * Which of the user's avatars (outward_accounts.id) participates here.
     * For a business entity this is typically the user's Trade Pro or
     * Facility avatar.
     */
    userOutwardAccountId: integer("user_outward_account_id").notNull(),
    role: text("role").$type<EntityMemberRole>().notNull().default("employee"),
    status: text("status").$type<EntityMemberStatus>().notNull().default("approved"),
    direction: text("direction").$type<EntityMemberDirection>().notNull().default("invite"),
    permissions: jsonb("permissions")
      .$type<EntityMemberPermissions>()
      .notNull()
      .default({}),
    /**
     * The avatar that issued the invitation or accepted the request. For a
     * member backfilled from the entity's controller (e.g. founder added
     * as owner of their own business) this equals userOutwardAccountId.
     */
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

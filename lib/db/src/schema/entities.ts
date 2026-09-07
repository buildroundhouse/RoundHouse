import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Entities are first-class workspaces: businesses, residential properties,
 * and commercial properties. They hold the team, the timeline, the messages,
 * and the assets. Avatars (outward_accounts) participate in entities — they
 * no longer ARE the workspace.
 *
 * See docs/architecture/entity-model-proposal.md §3 (entity vs avatar) and §12
 * (business-as-entity).
 *
 * Phase 1 scope: this table coexists with `properties` and `outward_accounts`.
 * Property rows are not migrated here yet (a later slice does that). Business
 * skins ARE migrated here (Phase 4 in the proposal, but pulled forward at the
 * user's request for DMT Design Build and JD Design Studio).
 */
export type EntityKind =
  | "business"
  | "residential_property"
  | "commercial_property";

export const entitiesTable = pgTable(
  "entities",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull().$type<EntityKind>(),
    name: text("name").notNull(),
    bio: text("bio"),
    logoUrl: text("logo_url"),
    coverPhotoUrl: text("cover_photo_url"),
    coverColor: text("cover_color"),
    /**
     * The avatar (outward_accounts.id) that currently controls this entity.
     * For a business: the founding/owning Trade Pro or Facility avatar.
     * For a property: the homeowner / facility-manager avatar.
     * Transferable — see §1 Ownership Rule. The entity row is stable; this
     * pointer is what changes when ownership transfers.
     */
    controllerOutwardAccountId: integer("controller_outward_account_id").notNull(),
    /**
     * Denormalized clerk_id of the controller's owning user. Indexed for the
     * common "show me entities I control" query without joining outward_accounts.
     * Updated whenever controllerOutwardAccountId is reassigned to an avatar
     * owned by a different user.
     */
    controllerUserClerkId: text("controller_user_clerk_id").notNull(),
    /**
     * The clerk_id of the user who originally created this entity. Stable —
     * never changes even if controller transfers.
     */
    createdByUserClerkId: text("created_by_user_clerk_id").notNull(),
    /**
     * Marks this entity as spawned by a demo avatar owned by an admin
     * (admin_demo_profiles.demoClerkId). Behavior and permissions are
     * identical to a real entity — UI surfaces just render a "DEMO"
     * badge so anyone can recognize it as test data before interacting.
     * Auto-flagged at create time when the caller's clerkId is found
     * in admin_demo_profiles. Never set manually.
     */
    isAdminDemo: boolean("is_admin_demo").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    kindIdx: index("entities_kind_idx").on(t.kind),
    controllerIdx: index("entities_controller_idx").on(t.controllerOutwardAccountId),
    controllerUserIdx: index("entities_controller_user_idx").on(t.controllerUserClerkId),
  }),
);

export const insertEntitySchema = createInsertSchema(entitiesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEntity = z.infer<typeof insertEntitySchema>;
export type Entity = typeof entitiesTable.$inferSelect;

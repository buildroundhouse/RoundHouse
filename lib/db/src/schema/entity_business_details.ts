import {
  pgTable,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Sidecar holding the business-only fields for an entity of kind='business'.
 * Kept off `entities` so the base table stays narrow and so non-business
 * entity kinds (residential_property, commercial_property) don't carry
 * irrelevant nullable columns.
 *
 * See docs/architecture/entity-model-proposal.md §12.
 */
export const entityBusinessDetailsTable = pgTable("entity_business_details", {
  /**
   * Sidecar — primary key IS the entities.id. One business-details row per
   * business entity. Created and deleted alongside the entity.
   */
  entityId: integer("entity_id").primaryKey(),
  /**
   * Legacy avatar (outward_accounts.id) this business was migrated from.
   * Lets later code resolve "which entity replaces this old skin?" without
   * a string match on names. Null for businesses created natively after
   * migration.
   */
  legacyOutwardAccountId: integer("legacy_outward_account_id"),
  /**
   * Tagline / "title" the business presents publicly. Pre-migration this
   * lived on outward_accounts.title.
   */
  tagline: text("tagline"),
  /**
   * Legal/operating company name. May equal entity.name; kept separate so
   * the entity name (workspace label) can be edited without affecting the
   * legal name.
   */
  companyName: text("company_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEntityBusinessDetailsSchema = createInsertSchema(
  entityBusinessDetailsTable,
).omit({ createdAt: true, updatedAt: true });
export type InsertEntityBusinessDetails = z.infer<
  typeof insertEntityBusinessDetailsSchema
>;
export type EntityBusinessDetails =
  typeof entityBusinessDetailsTable.$inferSelect;

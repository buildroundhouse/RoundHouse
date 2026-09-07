import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";

export const propertyAssetsTable = pgTable("property_assets", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull(),
  name: text("name").notNull(),
  assetTag: text("asset_tag"),
  category: text("category"),
  location: text("location"),
  photoUrl: text("photo_url"),
  installedAt: timestamp("installed_at", { withTimezone: true }),
  warrantyEndsAt: timestamp("warranty_ends_at", { withTimezone: true }),
  notes: text("notes").notNull().default(""),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdByClerkId: text("created_by_clerk_id").notNull(),
  // Outward account that created this asset.
  creatorOutwardAccountId: integer("creator_outward_account_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type PropertyAsset = typeof propertyAssetsTable.$inferSelect;

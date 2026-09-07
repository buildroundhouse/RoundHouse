import { pgTable, text, serial, timestamp, boolean, doublePrecision, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const propertiesTable = pgTable(
  "properties",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    address: text("address").notNull().default(""),
    type: text("type").notNull().default("home"),
    ownerClerkId: text("owner_clerk_id").notNull(),
    // Outward-facing account ("skin") that owns this property. Used to scope
    // the owner's property list to the active outward account — switching
    // accounts changes which of your own properties you see. Backfilled
    // from the owner's seeded default outward account by
    // `migrateOutwardAccounts`. NULL for legacy rows created before
    // outward accounts existed; those stay visible under any active skin
    // until the backfill catches up.
    ownerOutwardAccountId: integer("owner_outward_account_id"),
    coverColor: text("cover_color").notNull().default("#C8693A"),
    coverPhotoUrl: text("cover_photo_url"),
    placeId: text("place_id"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    isPro: boolean("is_pro").notNull().default(false),
    // Marks this row as spawned by a demo avatar owned by an admin
    // (admin_demo_profiles.demoClerkId). Behavior and permissions are
    // identical to a real property — UI surfaces just render a "DEMO"
    // badge so anyone can recognize it as test data before interacting.
    // Auto-flagged at create time when the caller's clerkId is found
    // in admin_demo_profiles. Never set manually.
    isAdminDemo: boolean("is_admin_demo").notNull().default(false),
    standardsMutedUntil: timestamp("standards_muted_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    ownerOutwardIdx: index("properties_owner_outward_idx").on(t.ownerOutwardAccountId),
  }),
);

export const insertPropertySchema = createInsertSchema(propertiesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProperty = z.infer<typeof insertPropertySchema>;
export type Property = typeof propertiesTable.$inferSelect;

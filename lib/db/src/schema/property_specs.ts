import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const propertySpecsTable = pgTable("property_specs", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull(),
  category: text("category").notNull().default("general"),
  key: text("key").notNull(),
  value: text("value").notNull().default(""),
  photoPath: text("photo_path"),
  authorClerkId: text("author_clerk_id").notNull(),
  // Outward account that authored this spec.
  authorOutwardAccountId: integer("author_outward_account_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPropertySpecSchema = createInsertSchema(propertySpecsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPropertySpec = z.infer<typeof insertPropertySpecSchema>;
export type PropertySpec = typeof propertySpecsTable.$inferSelect;

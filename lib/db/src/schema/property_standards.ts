import { pgTable, text, serial, timestamp, integer, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const propertyStandardsTable = pgTable("property_standards", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  cadenceDays: integer("cadence_days").notNull().default(7),
  evidenceType: text("evidence_type").notNull().default("log"),
  keyword: text("keyword"),
  quickPhrases: jsonb("quick_phrases").$type<string[]>().notNull().default([]),
  snoozeUntil: timestamp("snooze_until", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  // Outward account that created this standard.
  creatorOutwardAccountId: integer("creator_outward_account_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPropertyStandardSchema = createInsertSchema(propertyStandardsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPropertyStandard = z.infer<typeof insertPropertyStandardSchema>;
export type PropertyStandard = typeof propertyStandardsTable.$inferSelect;

export const propertyStandardEvidenceTable = pgTable(
  "property_standard_evidence",
  {
    id: serial("id").primaryKey(),
    standardId: integer("standard_id").notNull(),
    propertyId: integer("property_id").notNull(),
    createdBy: text("created_by").notNull(),
    // Outward account that captured this evidence.
    creatorOutwardAccountId: integer("creator_outward_account_id"),
    photoPath: text("photo_path"),
    note: text("note"),
    metAt: timestamp("met_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byStandardMetAt: index("psev_standard_met_at_idx").on(t.standardId, t.metAt),
    byPropertyId: index("psev_property_id_idx").on(t.propertyId),
  }),
);

export const insertPropertyStandardEvidenceSchema = createInsertSchema(propertyStandardEvidenceTable).omit({ id: true, createdAt: true });
export type InsertPropertyStandardEvidence = z.infer<typeof insertPropertyStandardEvidenceSchema>;
export type PropertyStandardEvidence = typeof propertyStandardEvidenceTable.$inferSelect;

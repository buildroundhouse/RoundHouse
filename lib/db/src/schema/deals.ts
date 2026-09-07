import { pgTable, text, serial, timestamp, integer, boolean, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dealsTable = pgTable(
  "deals",
  {
    id: serial("id").primaryKey(),
    proClerkId: text("pro_clerk_id").notNull(),
    headline: text("headline").notNull(),
    description: text("description").notNull().default(""),
    photoUrl: text("photo_url"),
    serviceTag: text("service_tag").notNull(),
    terms: text("terms").notNull().default(""),
    zips: text("zips").array().notNull().default(sql`ARRAY[]::text[]`),
    nationwide: boolean("nationwide").notNull().default(false),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }).notNull(),
    boostedUntil: timestamp("boosted_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byPro: index("deals_pro_idx").on(t.proClerkId),
    byEnd: index("deals_end_idx").on(t.endDate),
  }),
);

export const insertDealSchema = createInsertSchema(dealsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDeal = z.infer<typeof insertDealSchema>;
export type Deal = typeof dealsTable.$inferSelect;

import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pointsLedgerTable = pgTable(
  "points_ledger",
  {
    id: serial("id").primaryKey(),
    userClerkId: text("user_clerk_id").notNull(),
    eventType: text("event_type").notNull(),
    points: integer("points").notNull(),
    sourceRef: text("source_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser: index("points_ledger_user_idx").on(t.userClerkId),
    bySource: index("points_ledger_source_idx").on(t.userClerkId, t.eventType, t.sourceRef),
  }),
);

export const insertPointsLedgerSchema = createInsertSchema(pointsLedgerTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPointsLedger = z.infer<typeof insertPointsLedgerSchema>;
export type PointsLedger = typeof pointsLedgerTable.$inferSelect;

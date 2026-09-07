import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const propertyMemberEventsTable = pgTable("property_member_events", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull(),
  userClerkId: text("user_clerk_id").notNull(),
  // Outward account the event is about (the joined/left/removed member's
  // skin). Nullable for back-compat; migration backfills.
  subjectOutwardAccountId: integer("subject_outward_account_id"),
  eventType: text("event_type").notNull(),
  byClerkId: text("by_clerk_id"),
  // Outward account that performed the action.
  actorOutwardAccountId: integer("actor_outward_account_id"),
  role: text("role"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPropertyMemberEventSchema = createInsertSchema(propertyMemberEventsTable).omit({ id: true, createdAt: true });
export type InsertPropertyMemberEvent = z.infer<typeof insertPropertyMemberEventSchema>;
export type PropertyMemberEvent = typeof propertyMemberEventsTable.$inferSelect;

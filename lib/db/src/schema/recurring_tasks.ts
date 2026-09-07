import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const recurringTasksTable = pgTable("recurring_tasks", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  priority: text("priority").notNull().default("normal"),
  cadence: text("cadence").notNull().default("weekly"),
  cadenceValue: integer("cadence_value").notNull().default(1),
  assigneeClerkId: text("assignee_clerk_id"),
  // Outward account assigned to this recurring task.
  assigneeOutwardAccountId: integer("assignee_outward_account_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdByClerkId: text("created_by_clerk_id").notNull(),
  // Outward account that created this recurring task.
  creatorOutwardAccountId: integer("creator_outward_account_id"),
  lastGeneratedAt: timestamp("last_generated_at", { withTimezone: true }),
  nextDueAt: timestamp("next_due_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRecurringTaskSchema = createInsertSchema(recurringTasksTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastGeneratedAt: true,
});
export type InsertRecurringTask = z.infer<typeof insertRecurringTaskSchema>;
export type RecurringTask = typeof recurringTasksTable.$inferSelect;

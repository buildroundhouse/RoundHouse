import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import type { WorkOrderAttachment } from "./work_orders";

export const workOrderCommentsTable = pgTable("work_order_comments", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id").notNull(),
  authorClerkId: text("author_clerk_id").notNull(),
  // Outward account that authored this comment.
  authorOutwardAccountId: integer("author_outward_account_id"),
  body: text("body").notNull(),
  attachments: jsonb("attachments").$type<WorkOrderAttachment[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertWorkOrderCommentSchema = createInsertSchema(workOrderCommentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWorkOrderComment = z.infer<typeof insertWorkOrderCommentSchema>;
export type WorkOrderComment = typeof workOrderCommentsTable.$inferSelect;

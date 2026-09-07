import { pgTable, text, serial, timestamp, boolean, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type WorkLogAttachment = {
  path: string;
  kind: "image" | "file";
  name?: string;
  contentType?: string;
  size?: number;
  addedAt?: string;
  addedByClerkId?: string;
};

export const workLogsTable = pgTable("work_logs", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull(),
  authorClerkId: text("author_clerk_id").notNull(),
  // Outward account that authored this log.
  authorOutwardAccountId: integer("author_outward_account_id"),
  // When the author is a team member acting as a company skin, this is
  // the team member's personal-profile clerk id (#310). Internal-only:
  // public surfaces attribute the work to the skin (authorOutwardAccountId).
  // NULL when the author is the skin's owner acting directly.
  actedByClerkId: text("acted_by_clerk_id"),
  assigneeClerkId: text("assignee_clerk_id"),
  // Outward account assigned to this log.
  assigneeOutwardAccountId: integer("assignee_outward_account_id"),
  status: text("status").notNull().default("done"),
  note: text("note").notNull().default(""),
  photoUrl: text("photo_url"),
  attachments: jsonb("attachments").$type<WorkLogAttachment[]>().notNull().default([]),
  isRealTime: boolean("is_real_time").notNull().default(true),
  score: integer("score").notNull().default(10),
  viewCount: integer("view_count").notNull().default(0),
  dueDate: timestamp("due_date", { withTimezone: true }),
  dueDateRequestedDate: timestamp("due_date_requested_date", { withTimezone: true }),
  dueDateRequestedByClerkId: text("due_date_requested_by_clerk_id"),
  dueDateRequestedAt: timestamp("due_date_requested_at", { withTimezone: true }),
  dueDateRequestedReason: text("due_date_requested_reason"),
  dueDateResponseNote: text("due_date_response_note"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  workOrderId: integer("work_order_id"),
  createdInModeId: integer("created_in_mode_id"),
  // Outward account active when this log was created (per-skin firewall, the
  // outward-account analogue of `createdInModeId`).
  createdInOutwardAccountId: integer("created_in_outward_account_id"),
  isSuccessStory: boolean("is_success_story").notNull().default(false),
  successStoryAt: timestamp("success_story_at", { withTimezone: true }),
  successStoryHidden: boolean("success_story_hidden").notNull().default(false),
  successStoryBlurb: text("success_story_blurb"),
  successStoryServiceTag: text("success_story_service_tag"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWorkLogSchema = createInsertSchema(workLogsTable).omit({ id: true, createdAt: true, viewCount: true });
export type InsertWorkLog = z.infer<typeof insertWorkLogSchema>;
export type WorkLog = typeof workLogsTable.$inferSelect;

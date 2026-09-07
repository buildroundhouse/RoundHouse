import { pgTable, text, serial, timestamp, integer, jsonb, numeric, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type WorkOrderAttachment = {
  path: string;
  kind: "image" | "file";
  name?: string;
  contentType?: string;
  size?: number;
  phase?: "created" | "in_progress" | "complete";
  addedAt?: string;
  addedByClerkId?: string;
};

export const workOrdersTable = pgTable(
  "work_orders",
  {
    id: serial("id").primaryKey(),
    propertyId: integer("property_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    priority: text("priority").notNull().default("normal"),
    dueDate: timestamp("due_date", { withTimezone: true }),
    status: text("status").notNull().default("open"),
    category: text("category"),
    assetId: integer("asset_id"),
    approvalStatus: text("approval_status").notNull().default("none"),
    requestedByClerkId: text("requested_by_clerk_id"),
    approvedByClerkId: text("approved_by_clerk_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    poNumber: text("po_number"),
    costEstimate: numeric("cost_estimate", { precision: 12, scale: 2 }),
    costActual: numeric("cost_actual", { precision: 12, scale: 2 }),
    assigneeClerkId: text("assignee_clerk_id"),
    // Outward-facing account ("skin") that owns the assignee role on this
    // work order. When acting on behalf of one of their skins, that
    // person's responsibility for this WO is unambiguous. Backfilled by
    // `migrateOutwardAccounts` from the assignee's default outward
    // account; nullable because the WO itself can be unassigned.
    assigneeOutwardAccountId: integer("assignee_outward_account_id"),
    photoUrl: text("photo_url"),
    attachments: jsonb("attachments").$type<WorkOrderAttachment[]>().notNull().default([]),
    createdByClerkId: text("created_by_clerk_id").notNull(),
    // Outward-facing account the creator was acting as when the WO was
    // filed. Backfilled from the creator's default outward account by
    // `migrateOutwardAccounts`. Nullable during the transition window so
    // legacy rows + tests that pre-date the migration keep working.
    createdByOutwardAccountId: integer("created_by_outward_account_id"),
    recurringTaskId: integer("recurring_task_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    createdByOutwardIdx: index("work_orders_created_by_outward_idx").on(t.createdByOutwardAccountId),
    assigneeOutwardIdx: index("work_orders_assignee_outward_idx").on(t.assigneeOutwardAccountId),
  }),
);

export const insertWorkOrderSchema = createInsertSchema(workOrdersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertWorkOrder = z.infer<typeof insertWorkOrderSchema>;
export type WorkOrder = typeof workOrdersTable.$inferSelect;

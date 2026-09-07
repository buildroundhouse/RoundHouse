import { pgTable, text, timestamp, integer, primaryKey } from "drizzle-orm/pg-core";

export const workOrderCommentReadsTable = pgTable(
  "work_order_comment_reads",
  {
    userClerkId: text("user_clerk_id").notNull(),
    // Outward account whose read state this row represents. Per-skin: a
    // single underlying user can have separate read state for the same work
    // order under different outward accounts.
    outwardAccountId: integer("outward_account_id"),
    workOrderId: integer("work_order_id").notNull(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userClerkId, t.workOrderId] }),
  }),
);

export type WorkOrderCommentRead = typeof workOrderCommentReadsTable.$inferSelect;

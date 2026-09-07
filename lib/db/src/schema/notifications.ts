import { pgTable, text, serial, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * User notifications, scoped to the outward-facing account they belong
 * to. The personal `user_clerk_id` is kept for routing back to the
 * underlying person (push token, prefs), but reads filter on
 * `outward_account_id` so a notification raised against one outward
 * account never appears under another for the same user. Nullable
 * during the migration window — `migrateOutwardAccounts.ts` backfills
 * to each user's seeded default outward account.
 */
export const notificationsTable = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userClerkId: text("user_clerk_id").notNull(),
    outwardAccountId: integer("outward_account_id"),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    isRead: boolean("is_read").notNull().default(false),
    relatedId: text("related_id"),
    createdInModeId: integer("created_in_mode_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    outwardIdx: index("notifications_outward_account_idx").on(t.outwardAccountId),
    userOutwardIdx: index("notifications_user_outward_idx").on(t.userClerkId, t.outwardAccountId),
  }),
);

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({ id: true, createdAt: true, isRead: true });
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;

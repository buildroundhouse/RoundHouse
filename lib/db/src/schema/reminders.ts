import { pgTable, text, serial, timestamp, boolean, index, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Personal reminders attached to the signed-in user. Stored on the
 * server (rather than only on-device in AsyncStorage) so a user sees
 * the same reminders on every device they sign in to.
 */
export const remindersTable = pgTable(
  "reminders",
  {
    id: serial("id").primaryKey(),
    userClerkId: text("user_clerk_id").notNull(),
    title: text("title").notNull(),
    note: text("note"),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    done: boolean("done").notNull().default(false),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    notifyCount: integer("notify_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdx: index("reminders_user_idx").on(t.userClerkId),
  }),
);

export const insertReminderSchema = createInsertSchema(remindersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertReminder = z.infer<typeof insertReminderSchema>;
export type Reminder = typeof remindersTable.$inferSelect;

import { pgTable, text, serial, timestamp, boolean, uniqueIndex } from "drizzle-orm/pg-core";

export const userNotificationPrefsTable = pgTable(
  "user_notification_prefs",
  {
    id: serial("id").primaryKey(),
    userClerkId: text("user_clerk_id").notNull(),
    notificationType: text("notification_type").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    userTypeUnique: uniqueIndex("user_notif_prefs_user_type_unique").on(
      table.userClerkId,
      table.notificationType,
    ),
  }),
);

export type UserNotificationPref = typeof userNotificationPrefsTable.$inferSelect;

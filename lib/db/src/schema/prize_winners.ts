import { pgTable, text, serial, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Tracks Game Room prize fulfillment. One row per (user, prizeKey)
 * representing the lifecycle: eligible → selected → shipped.
 */
export const prizeWinnersTable = pgTable(
  "prize_winners",
  {
    id: serial("id").primaryKey(),
    userClerkId: text("user_clerk_id").notNull(),
    prizeKey: text("prize_key").notNull().default("monthly"),
    status: text("status").notNull().default("selected"),
    notes: text("notes"),
    selectedAt: timestamp("selected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byUser: index("prize_winners_user_idx").on(t.userClerkId),
  }),
);

export type PrizeWinner = typeof prizeWinnersTable.$inferSelect;

/**
 * Tracks the most recent daily-login award per user/local-date
 * to enforce one award per local calendar day. The `localDate`
 * is a YYYY-MM-DD string supplied by the client (the user's
 * local timezone) so the daily-bonus tier is consistent with
 * what the user sees on their phone clock.
 */
export const dailyLoginAwardsTable = pgTable(
  "daily_login_awards",
  {
    id: serial("id").primaryKey(),
    userClerkId: text("user_clerk_id").notNull(),
    localDate: text("local_date").notNull(),
    localHour: text("local_hour").notNull(),
    points: text("points").notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byUserDate: index("daily_login_user_date_idx").on(t.userClerkId, t.localDate),
  }),
);

export type DailyLoginAward = typeof dailyLoginAwardsTable.$inferSelect;

import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Runtime-configurable per-event point values for the rewards engine.
 * Seeded with defaults on first read; updated via the admin Game Room.
 */
export const pointSettingsTable = pgTable("point_settings", {
  eventType: text("event_type").primaryKey(),
  points: integer("points").notNull(),
  label: text("label").notNull().default(""),
  description: text("description").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type PointSetting = typeof pointSettingsTable.$inferSelect;

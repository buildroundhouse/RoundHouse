import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * Admin-editable preset chip/token sets used as profile chips and
 * labels across the app (home priorities, maintenance focus, trades,
 * service categories, work-order categories, work-order priorities).
 *
 * Stable `chip_id` is the value persisted onto profiles / work orders
 * so renames flow through without rewriting historical assignments.
 */
export const presetChipsTable = pgTable(
  "preset_chips",
  {
    id: serial("id").primaryKey(),
    setKey: text("set_key").notNull(),
    chipId: text("chip_id").notNull(),
    label: text("label").notNull(),
    sublabel: text("sublabel"),
    groupKey: text("group_key"),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    uniqueByChip: uniqueIndex("preset_chips_set_chip_unique").on(
      t.setKey,
      t.chipId,
    ),
    bySet: index("preset_chips_set_idx").on(t.setKey),
  }),
);

/**
 * Group rows for the service-categories set (and any other set that
 * later wants named groups). Keyed by `(set_key, group_key)`.
 */
export const presetGroupsTable = pgTable(
  "preset_groups",
  {
    id: serial("id").primaryKey(),
    setKey: text("set_key").notNull(),
    groupKey: text("group_key").notNull(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    uniqueByGroup: uniqueIndex("preset_groups_set_group_unique").on(
      t.setKey,
      t.groupKey,
    ),
  }),
);

export type PresetChip = typeof presetChipsTable.$inferSelect;
export type PresetGroup = typeof presetGroupsTable.$inferSelect;

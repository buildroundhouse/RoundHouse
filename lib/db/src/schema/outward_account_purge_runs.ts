import { pgTable, serial, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Audit log of every run of the outward-account hard-delete sweep
 * (#344 + #364). One row per invocation — startup boot, scheduled
 * interval, the on-demand operator script, or an operator API call —
 * regardless of whether anything was actually purged. Operators query
 * this instead of grepping logs across hosts to confirm the sweep is
 * keeping up or to audit why a particular row disappeared.
 */
export type OutwardAccountPurgeRunSource =
  | "startup"
  | "scheduled"
  | "script"
  | "api";

export const outwardAccountPurgeRunsTable = pgTable(
  "outward_account_purge_runs",
  {
    id: serial("id").primaryKey(),
    ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").notNull().$type<OutwardAccountPurgeRunSource>(),
    accountsRemoved: integer("accounts_removed").notNull().default(0),
    connectionsRemoved: integer("connections_removed").notNull().default(0),
    // Number of stale audit rows this same run trimmed from this table
    // (#394). Persisted per-run so the operator history view can show
    // the table is self-bounding without operators having to tail logs.
    runsTrimmed: integer("runs_trimmed").notNull().default(0),
    // Ids touched by this run, captured for audit so an operator can
    // answer "did the sweep delete account X?". Null when the run was a
    // no-op to keep the row small.
    accountIds: jsonb("account_ids").$type<number[]>(),
    connectionIds: jsonb("connection_ids").$type<number[]>(),
    durationMs: integer("duration_ms"),
  },
  (t) => ({
    ranAtIdx: index("outward_account_purge_runs_ran_at_idx").on(t.ranAt),
  }),
);

export const insertOutwardAccountPurgeRunSchema = createInsertSchema(
  outwardAccountPurgeRunsTable,
).omit({ id: true, ranAt: true });
export type InsertOutwardAccountPurgeRun = z.infer<
  typeof insertOutwardAccountPurgeRunSchema
>;
export type OutwardAccountPurgeRun =
  typeof outwardAccountPurgeRunsTable.$inferSelect;

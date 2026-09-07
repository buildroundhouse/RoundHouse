import { pgTable, text, serial, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type UserModeKind =
  | "trade_pro"
  | "home"
  | "facilities"
  | "trade_pro_teammate"
  | "facilities_teammate"
  | "home_teammate"
  | "trade_pro_collab"
  | "facilities_collab"
  | "collab";

// Kinds that are restricted to a single profile per user. Everything else
// supports multiple profiles per user (a Trade Pro running multiple
// businesses, a homeowner with several properties, a teammate at two firms).
//
// "collab" is the neutral collaborator skin (no trade-pro / facilities power
// position). The two legacy collab kinds (trade_pro_collab / facilities_collab)
// remain usable for accounts that already activated them, but new users go
// straight into the neutral kind via the mode picker.
export const SINGLE_PROFILE_KINDS: UserModeKind[] = [
  "trade_pro_collab",
  "facilities_collab",
  "collab",
];

export const userModesTable = pgTable(
  "user_modes",
  {
    id: serial("id").primaryKey(),
    userClerkId: text("user_clerk_id").notNull(),
    kind: text("kind").notNull().$type<UserModeKind>(),
    intakeData: jsonb("intake_data").$type<Record<string, unknown>>().notNull().default({}),
    intakeCompletedAt: timestamp("intake_completed_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Only enforce single-profile uniqueness for the collab kinds. Other kinds
    // can have multiple rows per user (one per business/property/teammate role).
    singleProfileKindUnique: uniqueIndex("user_modes_single_profile_kind_unique")
      .on(t.userClerkId, t.kind)
      .where(sql`kind in ('trade_pro_collab', 'facilities_collab', 'collab')`),
  }),
);

export const insertUserModeSchema = createInsertSchema(userModesTable).omit({ id: true, activatedAt: true });
export type InsertUserMode = z.infer<typeof insertUserModeSchema>;
export type UserMode = typeof userModesTable.$inferSelect;

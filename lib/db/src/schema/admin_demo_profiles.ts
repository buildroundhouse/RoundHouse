import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// Links an admin's personal profile (admin_clerk_id) to one of their
// "owned" demo accounts (demo_clerk_id). The previous "one row per
// admin per role kind" unique index was removed because admins kept
// hitting the per-kind cap and the wardrobe started rendering every
// chip as "used" with nothing pickable, soft-bricking the
// step-into-avatar flow. Multiple demos per kind are now allowed —
// each gets its own Firebase identity and its own walk through the
// regular onboarding gauntlet, which is the experience the admin is
// after when they "step in".
//
// The demo account itself is an ordinary `users` row with its own
// Firebase identity, so the rest of the app — search, messaging,
// points, the firewall — treats it like any other live user. The
// admin can "wear" the demo by swapping the active Firebase session.
//
// `role_kind` mirrors the user_modes.kind values we surface in the Hub:
//   trade_pro, home, facilities, trade_pro_teammate, facilities_teammate,
//   trade_pro_collab (or facilities_collab — collaborator is a single
//   slot in the Hub, both flavors share it).
export const adminDemoProfilesTable = pgTable(
  "admin_demo_profiles",
  {
    id: serial("id").primaryKey(),
    adminClerkId: text("admin_clerk_id").notNull(),
    demoClerkId: text("demo_clerk_id").notNull().unique(),
    roleKind: text("role_kind").notNull(),
    displayName: text("display_name").notNull(),
    // The Firebase password we provisioned this demo account with.
    // Stored so the admin Hub can re-recover an orphaned demo (a row
    // that exists in Firebase but was deleted from `admin_demo_profiles`)
    // by calling accounts:signInWithPassword instead of failing with
    // EMAIL_EXISTS. Nullable for legacy rows from before this column.
    demoPassword: text("demo_password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

export type AdminDemoProfile = typeof adminDemoProfilesTable.$inferSelect;
export type InsertAdminDemoProfile = typeof adminDemoProfilesTable.$inferInsert;

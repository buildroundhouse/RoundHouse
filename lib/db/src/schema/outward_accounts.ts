import { pgTable, text, serial, timestamp, integer, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import type { UserModeKind } from "./user_modes";

/**
 * Outward-facing accounts ("skins") owned by a personal-profile `users` row.
 * Each outward account carries its own public branding (title, display name,
 * avatar, banner, company name, bio) and is the unit that participates in
 * relationships, invites, and (in later tasks) properties/work orders. The
 * underlying personal profile (`users`) stays private and only holds login
 * + ownership.
 *
 * The `kind` mirrors the existing `user_modes.kind` taxonomy so existing
 * mode-aware UI keeps working during the migration.
 */
export const outwardAccountsTable = pgTable(
  "outward_accounts",
  {
    id: serial("id").primaryKey(),
    ownerClerkId: text("owner_clerk_id").notNull(),
    kind: text("kind").notNull().$type<UserModeKind>(),
    title: text("title"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    bannerUrl: text("banner_url"),
    companyName: text("company_name"),
    bio: text("bio"),
    // Capability state for billing (#309). `standard` is the free baseline
    // every skin gets at creation. `expanded` is unlocked when the owning
    // private account has an active subscription targeting this skin.
    // On lapse this flips back to `standard`; the skin and its data are
    // never touched.
    capabilityState: text("capability_state")
      .notNull()
      .default("standard")
      .$type<"standard" | "expanded">(),
    // #640 — When true, the owner's display name on this skin is shortened
    // to "First L." everywhere it surfaces (People search row, public
    // profile header, chat headers/threads, etc.). Lets owners keep an
    // outward face without leaking their full last name. Default false;
    // create paths apply per-kind defaults (teammate / collab kinds default
    // to true on creation — see {@link defaultLastInitialOnlyForKind}).
    lastInitialOnly: boolean("last_initial_only").notNull().default(false),
    // Pointer back to the legacy user_modes row this skin was seeded from
    // (nullable so future, post-cleanup outward accounts don't need one).
    sourceUserModeId: integer("source_user_mode_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    ownerIdx: index("outward_accounts_owner_idx").on(t.ownerClerkId),
    sourceModeIdx: index("outward_accounts_source_mode_idx").on(t.sourceUserModeId),
    // #572: enforce one permanent Collaborator / Friend baseline OA
    // per user at the DB level so concurrent first-login traffic
    // can't race two `collab` rows past the application-level guard.
    // The partial predicate keeps it scoped to the baseline kind so
    // teammate/collab variants (if ever stored) wouldn't conflict.
    collabBaselineUq: uniqueIndex("outward_accounts_collab_baseline_uq")
      .on(t.ownerClerkId)
      .where(sql`kind = 'collab' AND archived_at IS NULL`),
  }),
);

export const insertOutwardAccountSchema = createInsertSchema(outwardAccountsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertOutwardAccount = z.infer<typeof insertOutwardAccountSchema>;
export type OutwardAccount = typeof outwardAccountsTable.$inferSelect;

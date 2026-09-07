import { pgTable, text, serial, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { userModesTable } from "./user_modes";

export type ServiceEntry = { name: string; isCustom?: boolean };

export type ProfileVisibility = {
  address?: boolean;
  phone?: boolean;
  email?: boolean;
  instagram?: boolean;
  website?: boolean;
  license?: boolean;
  insurance?: boolean;
  services?: boolean;
  team?: boolean;
};

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  bio: text("bio"),
  avatarUrl: text("avatar_url").notNull().default(""),
  website: text("website"),
  officePhone: text("office_phone"),
  cellPhone: text("cell_phone"),
  phone: text("phone"),
  address: text("address"),
  instagram: text("instagram"),
  companyName: text("company_name"),
  slogan: text("slogan"),
  companyLogoUrl: text("company_logo_url"),
  headerImageUrl: text("header_image_url"),
  licenseState: text("license_state"),
  licenseType: text("license_type"),
  licenseNumber: text("license_number"),
  insuranceCarrier: text("insurance_carrier"),
  insurancePolicyNumber: text("insurance_policy_number"),
  services: jsonb("services").$type<ServiceEntry[]>().notNull().default([]),
  visibility: jsonb("visibility").$type<ProfileVisibility>().notNull().default({}),
  identityCompletedAt: timestamp("identity_completed_at", { withTimezone: true }),
  lastActiveModeId: integer("last_active_mode_id").references(() => userModesTable.id, {
    onDelete: "set null",
  }),
  // Active outward-facing account ("skin") for this personal profile.
  // Resolved by the auth middleware on every request and surfaced via
  // /users/me. NULL only briefly during signup, before the migration
  // backfills the seeded default account.
  activeOutwardAccountId: integer("active_outward_account_id"),
  // Stripe customer id for this payer (private profile). Captured the
  // first time the user opens the hosted Checkout setup flow and reused
  // for every subsequent operation so card-attach and subscription
  // creation always target the same customer.
  stripeCustomerId: text("stripe_customer_id"),
  expoPushToken: text("expo_push_token"),
  pushTokenUpdatedAt: timestamp("push_token_updated_at", { withTimezone: true }),
  notifyJobStarted: boolean("notify_job_started").notNull().default(true),
  notifyJobCompleted: boolean("notify_job_completed").notNull().default(true),
  addressZip: text("address_zip"),
  addressStreet: text("address_street"),
  addressCity: text("address_city"),
  addressState: text("address_state"),
  serviceZips: text("service_zips").array().notNull().default(sql`ARRAY[]::text[]`),
  sponsorBrandName: text("sponsor_brand_name"),
  // Personal-profile flag. Admins are NOT a skin — they're an ordinary
  // signed-in user whose post-login experience is the Admin Hub instead
  // of (tabs). The Hub lets them own up to 6 demo accounts (one per
  // role kind) and "wear" any of them so the rest of the app — search,
  // messaging, points, the firewall — treats those accounts as live
  // users. Default false; flipped manually by Replit-side admin tooling.
  isAdmin: boolean("is_admin").notNull().default(false),
  // Denormalized "this users row belongs to a Wardrobe demo persona"
  // flag. Mirrors the presence of an `admin_demo_profiles` row keyed on
  // this user's clerk id and is kept in sync by the SAME write path
  // that inserts/deletes admin_demo_profiles rows (see
  // `lib/adminDemo.ts` insert/delete helpers). Discovery endpoints
  // (`/area-feed`, `/deals/active`, `/users/search`, etc.) used to
  // gate the demo filter via a per-row `NOT EXISTS` subquery against
  // `admin_demo_profiles`; that turned every public list query into
  // an extra index lookup per candidate row, which got expensive as
  // demo usage grew. The filter now reads this boolean directly
  // (column predicate when users is already joined; small `NOT EXISTS`
  // against a partial index when the discovery query keys on a
  // foreign clerk id like `work_logs.assignee_clerk_id`). The flag is
  // covered by the partial index `users_is_demo_partial_idx` so the
  // foreign-id case stays cheap as the user table grows.
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

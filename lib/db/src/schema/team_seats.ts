import {
  pgTable,
  serial,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * Per-task #310: a team seat grants a personal-profile user the ability
 * to act as a company outward-facing skin. Seats are scoped to a single
 * `(company_outward_account_id, member_personal_profile_id)` pair.
 *
 * Permissions are fine-grained and enforced on top of the skin's normal
 * authorization. The skin's owner is the implicit super-admin and does
 * not need a seat row.
 */
export type TeamSeatRole = "owner" | "admin" | "manager" | "employee";
export type TeamSeatStatus = "pending" | "accepted";

export type TeamSeatPermissions = {
  /** Permission to view client contact details (phone/email/address) on the skin's contacts. */
  seeContacts?: boolean;
  /** Permission to view billing, payment method and subscription state for the skin. */
  seeBilling?: boolean;
  /** Permission to create work orders / properties / logs as the skin (vs respond-only). */
  createOnProperties?: boolean;
  /** Permission to invite or remove other team members. Admin-only by default. */
  manageTeam?: boolean;
};

export const teamSeatsTable = pgTable(
  "team_seats",
  {
    id: serial("id").primaryKey(),
    companyOutwardAccountId: integer("company_outward_account_id").notNull(),
    memberClerkId: text("member_clerk_id").notNull(),
    role: text("role").$type<TeamSeatRole>().notNull().default("employee"),
    isAdmin: boolean("is_admin").notNull().default(false),
    permissions: jsonb("permissions")
      .$type<TeamSeatPermissions>()
      .notNull()
      .default({}),
    // #502 — universal label + chip pattern. Teammate picks a chip
    // from a curated list specific to the company skin's kind
    // (Trade Pro vs Facility). "other" opens `chipOther` for free
    // text. The chip can be set at acceptance time or edited later
    // by the seat-holder.
    chip: text("chip"),
    chipOther: text("chip_other"),
    status: text("status").$type<TeamSeatStatus>().notNull().default("pending"),
    invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pairUnique: uniqueIndex("team_seats_skin_member_unique").on(
      t.companyOutwardAccountId,
      t.memberClerkId,
    ),
    skinIdx: index("team_seats_skin_idx").on(t.companyOutwardAccountId),
    memberIdx: index("team_seats_member_idx").on(t.memberClerkId),
  }),
);

export type TeamSeat = typeof teamSeatsTable.$inferSelect;
export type InsertTeamSeat = typeof teamSeatsTable.$inferInsert;

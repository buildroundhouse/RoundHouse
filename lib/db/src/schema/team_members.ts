import { pgTable, serial, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export type TeamRole = "employee" | "manager" | "partner";
export type TeamStatus = "pending" | "accepted";

export const userTeamMembersTable = pgTable(
  "user_team_members",
  {
    id: serial("id").primaryKey(),
    leadClerkId: text("lead_clerk_id").notNull(),
    memberClerkId: text("member_clerk_id").notNull(),
    role: text("role").$type<TeamRole>().notNull(),
    status: text("status").$type<TeamStatus>().notNull().default("pending"),
    invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    // #548 — admin-seeded teammate chip (Plumbing / Electrical / …
    // for Trade Pro skins; Maintenance / Housekeeping / … for
    // Facility skins). "other" opens chipOther for free text.
    chip: text("chip"),
    chipOther: text("chip_other"),
  },
  (t) => ({
    uniquePair: uniqueIndex("user_team_members_pair_unique").on(t.leadClerkId, t.memberClerkId),
    leadIdx: index("user_team_members_lead_idx").on(t.leadClerkId),
    memberIdx: index("user_team_members_member_idx").on(t.memberClerkId),
  }),
);

export type UserTeamMember = typeof userTeamMembersTable.$inferSelect;

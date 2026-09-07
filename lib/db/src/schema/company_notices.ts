import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Business-wide notices ("Company Reminders") that an admin of a
 * company outward account pushes to every member of that team. Surfaces
 * in the Reminders hub under the "Company Reminders" section.
 *
 * `companyOutwardAccountId` is the company skin the notice belongs to.
 * `senderClerkId` is the personal account of whoever wrote it (always
 * an owner or admin/manageTeam team-seat at write time).
 */
export const companyNoticesTable = pgTable(
  "company_notices",
  {
    id: serial("id").primaryKey(),
    companyOutwardAccountId: integer("company_outward_account_id").notNull(),
    senderClerkId: text("sender_clerk_id").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    skinIdx: index("company_notices_skin_idx").on(t.companyOutwardAccountId),
  }),
);

/**
 * Per-member acknowledgement / dismissal record. A row exists once a
 * recipient has tapped "Got it" on a notice. Notices that haven't been
 * acknowledged by the signed-in user are surfaced in the Company
 * Reminders feed; acknowledged notices are hidden.
 */
export const companyNoticeAcksTable = pgTable(
  "company_notice_acks",
  {
    id: serial("id").primaryKey(),
    noticeId: integer("notice_id").notNull(),
    memberClerkId: text("member_clerk_id").notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pairUnique: uniqueIndex("company_notice_acks_pair_unique").on(
      t.noticeId,
      t.memberClerkId,
    ),
    memberIdx: index("company_notice_acks_member_idx").on(t.memberClerkId),
  }),
);

export type CompanyNotice = typeof companyNoticesTable.$inferSelect;
export type InsertCompanyNotice = typeof companyNoticesTable.$inferInsert;
export type CompanyNoticeAck = typeof companyNoticeAcksTable.$inferSelect;

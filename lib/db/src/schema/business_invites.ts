import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type BusinessInviteStatus = "pending" | "sent" | "failed" | "accepted";

export const businessInvitesTable = pgTable(
  "business_invites",
  {
    id: serial("id").primaryKey(),
    // Outward account that sent the invite — the inviter's clerk id is
    // reachable via outward_accounts.owner_clerk_id. Accepted invites form
    // the collaborator connection from this skin.
    senderOutwardAccountId: integer("sender_outward_account_id").notNull(),
    // Outward account the recipient picked at acceptance time. Null
    // until the invite is accepted.
    recipientOutwardAccountId: integer("recipient_outward_account_id"),
    businessName: text("business_name"),
    email: text("email").notNull(),
    token: text("token").notNull().unique(),
    status: text("status").notNull().default("pending").$type<BusinessInviteStatus>(),
    sendError: text("send_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByClerkId: text("accepted_by_clerk_id"),
  },
  (t) => ({
    senderIdx: index("business_invites_sender_outward_idx").on(t.senderOutwardAccountId),
    emailIdx: index("business_invites_email_idx").on(t.email),
  }),
);

export const insertBusinessInviteSchema = createInsertSchema(businessInvitesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertBusinessInvite = z.infer<typeof insertBusinessInviteSchema>;
export type BusinessInvite = typeof businessInvitesTable.$inferSelect;

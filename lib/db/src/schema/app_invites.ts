import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type AppInviteStatus = "sent" | "signed_up" | "expired" | "cancelled";

export const appInvitesTable = pgTable(
  "app_invites",
  {
    id: serial("id").primaryKey(),
    // Outward account that sent the invite — the sender's clerk id is
    // reachable via outward_accounts.owner_clerk_id. Accepted invites form
    // the connection on this skin.
    senderOutwardAccountId: integer("sender_outward_account_id").notNull(),
    // Outward account the recipient chose at acceptance time — this is
    // the skin the connection forms on for the accepter. Null until
    // the invite is accepted.
    recipientOutwardAccountId: integer("recipient_outward_account_id"),
    recipientName: text("recipient_name").notNull(),
    recipientPhone: text("recipient_phone").notNull(),
    invitedKind: text("invited_kind").notNull(),
    /**
     * Task #663 — optional entity the inviter is bringing the new
     * user into. When set, the accept handler materializes an
     * `entity_members` row so the new user lands as a member of that
     * entity at signup time. Null for plain "join Round House" SMS
     * invites with no specific entity context.
     */
    entityId: integer("entity_id"),
    token: text("token").notNull().unique(),
    status: text("status").notNull().default("sent").$type<AppInviteStatus>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    signedUpAt: timestamp("signed_up_at", { withTimezone: true }),
    acceptedByClerkId: text("accepted_by_clerk_id"),
    acceptedKind: text("accepted_kind"),
  },
  (t) => ({
    senderIdx: index("app_invites_sender_outward_idx").on(t.senderOutwardAccountId),
    phoneIdx: index("app_invites_phone_idx").on(t.recipientPhone),
  }),
);

export const insertAppInviteSchema = createInsertSchema(appInvitesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAppInvite = z.infer<typeof insertAppInviteSchema>;
export type AppInvite = typeof appInvitesTable.$inferSelect;

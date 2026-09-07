import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * One concierge thread per (user, outwardAccount). The thread aggregates
 * all messages between the signed-in person (acting as a given outward
 * account skin) and the AI concierge assistant.
 */
export const conciergeConversationsTable = pgTable(
  "concierge_conversations",
  {
    id: serial("id").primaryKey(),
    userClerkId: text("user_clerk_id").notNull(),
    outwardAccountId: integer("outward_account_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    // One concierge thread per (user, outward account). Enforced as a
    // unique index so two simultaneous "open the sheet" requests can't
    // race and create duplicate threads — `getOrCreateConversation`
    // relies on `ON CONFLICT DO NOTHING` against this index.
    userAcctUnique: uniqueIndex("concierge_conversations_user_acct_unique").on(
      t.userClerkId,
      t.outwardAccountId,
    ),
  }),
);

/**
 * Append-only meter for concierge requests. Used to enforce a daily
 * rolling-window cap per user (and per outward account skin) so a
 * runaway client or abusive prompt loop can't burn through the
 * underlying AI quota.
 */
export const conciergeUsageEventsTable = pgTable(
  "concierge_usage_events",
  {
    id: serial("id").primaryKey(),
    userClerkId: text("user_clerk_id").notNull(),
    outwardAccountId: integer("outward_account_id").notNull(),
    /** "message" | "transcribe" — short discriminator for the meter view. */
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userKindCreatedIdx: index("concierge_usage_user_kind_created_idx").on(
      t.userClerkId,
      t.kind,
      t.createdAt,
    ),
  }),
);

export type ConciergeUsageEvent = typeof conciergeUsageEventsTable.$inferSelect;

/**
 * Each turn in a concierge conversation. `role` is one of
 * `user | assistant | system`. `proposedActions` carries the structured
 * set of actions the assistant suggested on this turn (typed as a free
 * jsonb array; client validates at render time).
 */
export const conciergeMessagesTable = pgTable(
  "concierge_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull().default(""),
    proposedActions: jsonb("proposed_actions").$type<unknown[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    convIdx: index("concierge_messages_conv_idx").on(t.conversationId, t.createdAt),
  }),
);

export const insertConciergeConversationSchema = createInsertSchema(
  conciergeConversationsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertConciergeConversation = z.infer<typeof insertConciergeConversationSchema>;
export type ConciergeConversation = typeof conciergeConversationsTable.$inferSelect;

export const insertConciergeMessageSchema = createInsertSchema(
  conciergeMessagesTable,
).omit({ id: true, createdAt: true });
export type InsertConciergeMessage = z.infer<typeof insertConciergeMessageSchema>;
export type ConciergeMessage = typeof conciergeMessagesTable.$inferSelect;

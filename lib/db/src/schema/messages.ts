import { pgTable, text, serial, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Direct messages between two outward-facing accounts. The legacy
 * `*_clerk_id` columns are retained so historical reads keep working,
 * but the canonical "thread" identity is the
 * (sender_outward_account_id, recipient_outward_account_id) pair. Two
 * underlying people can therefore hold multiple parallel message
 * threads through different pairs of skins.
 *
 * Outward-account columns are nullable during the migration window;
 * `migrateOutwardAccounts.ts` backfills them to the seeded default
 * account on each side and the per-account read scope tolerates NULLs
 * for legacy rows.
 */
export const messagesTable = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    senderClerkId: text("sender_clerk_id").notNull(),
    recipientClerkId: text("recipient_clerk_id"),
    senderOutwardAccountId: integer("sender_outward_account_id"),
    recipientOutwardAccountId: integer("recipient_outward_account_id"),
    // When the sender is a team member acting as a company skin, this is
    // the team member's personal-profile clerk id (#310). Internal-only:
    // every public surface attributes the action to the skin. NULL when
    // the sender is the skin's owner acting directly.
    actedByClerkId: text("acted_by_clerk_id"),
    propertyId: integer("property_id"),
    /**
     * Task #663: every entity-scoped message carries the entity it was
     * sent into. Nullable during the migration window for legacy DM
     * rows; new sends are gated by the application layer to require
     * an entityId.
     */
    entityId: integer("entity_id"),
    createdInModeId: integer("created_in_mode_id"),
    toModeId: integer("to_mode_id"),
    content: text("content").notNull(),
    // Provenance of the message. NULL / "user" means a regular DM the
    // sender typed themselves. "concierge_draft" marks a note the AI
    // concierge drafted that the sender confirmed and sent via
    // POST /concierge/send-draft (#585) — the inbox renders a small
    // "drafted with concierge" badge so the recipient knows the wording
    // came from the assistant.
    source: text("source"),
    isRead: boolean("is_read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    senderOutwardIdx: index("messages_sender_outward_idx").on(t.senderOutwardAccountId),
    recipientOutwardIdx: index("messages_recipient_outward_idx").on(t.recipientOutwardAccountId),
  }),
);

export const insertMessageSchema = createInsertSchema(messagesTable).omit({ id: true, createdAt: true, isRead: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;

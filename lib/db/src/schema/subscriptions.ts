import { pgTable, text, serial, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Subscriptions track per-skin paid capability bundles (#309). One row
 * per outward account ever billed; we update the same row across renew /
 * lapse / restore / cancel cycles so the billing screen has stable
 * history.
 *
 * `payerClerkId` is the personal profile that holds the payment method
 * — every subscription on every skin a user owns rolls up to a single
 * processor customer record on that personal profile.
 *
 * Status transitions mirror the processor:
 *   active        → payment current, capabilities expanded
 *   past_due      → payment failed, in processor grace period; we keep
 *                   capabilities expanded until the lapse webhook fires
 *   cancelled     → user cancelled; capabilities reverted to standard at
 *                   period end
 *   expired       → grace period exhausted or non-recoverable failure;
 *                   capabilities reverted to standard immediately
 */
export const subscriptionsTable = pgTable(
  "subscriptions",
  {
    id: serial("id").primaryKey(),
    outwardAccountId: integer("outward_account_id").notNull(),
    payerClerkId: text("payer_clerk_id").notNull(),
    status: text("status").notNull().$type<"active" | "past_due" | "cancelled" | "expired">(),
    processorCustomerId: text("processor_customer_id"),
    processorSubscriptionId: text("processor_subscription_id"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    // Pricing copy is intentionally placeholder (#309 leaves processor +
    // pricing out of scope). Stored in cents so the UI can format it
    // without rounding surprises.
    priceCents: integer("price_cents").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    outwardAccountIdx: uniqueIndex("subscriptions_outward_account_idx").on(t.outwardAccountId),
    payerIdx: index("subscriptions_payer_idx").on(t.payerClerkId),
  }),
);

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;

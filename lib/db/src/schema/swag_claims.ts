import { pgTable, text, serial, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Status: pending | shipped | delivered
export const swagClaimsTable = pgTable(
  "swag_claims",
  {
    id: serial("id").primaryKey(),
    userClerkId: text("user_clerk_id").notNull(),
    name: text("name").notNull(),
    street: text("street").notNull(),
    city: text("city").notNull(),
    state: text("state").notNull(),
    zip: text("zip").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => ({
    byUser: index("swag_claims_user_idx").on(t.userClerkId),
  }),
);

export const insertSwagClaimSchema = createInsertSchema(swagClaimsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSwagClaim = z.infer<typeof insertSwagClaimSchema>;
export type SwagClaim = typeof swagClaimsTable.$inferSelect;

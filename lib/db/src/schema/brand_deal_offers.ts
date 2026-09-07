import { pgTable, text, serial, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// status: pending | accepted | declined
export const brandDealOffersTable = pgTable(
  "brand_deal_offers",
  {
    id: serial("id").primaryKey(),
    userClerkId: text("user_clerk_id").notNull(),
    brandName: text("brand_name").notNull(),
    headline: text("headline").notNull(),
    description: text("description").notNull().default(""),
    rewardSummary: text("reward_summary").notNull().default(""),
    status: text("status").notNull().default("pending"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser: index("brand_deal_offers_user_idx").on(t.userClerkId),
  }),
);

export const insertBrandDealOfferSchema = createInsertSchema(brandDealOffersTable).omit({
  id: true,
  createdAt: true,
  respondedAt: true,
});
export type InsertBrandDealOffer = z.infer<typeof insertBrandDealOfferSchema>;
export type BrandDealOffer = typeof brandDealOffersTable.$inferSelect;

import { pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const jobRatingsTable = pgTable(
  "job_ratings",
  {
    id: serial("id").primaryKey(),
    workLogId: integer("work_log_id").notNull(),
    propertyId: integer("property_id").notNull(),
    memberClerkId: text("member_clerk_id").notNull(),
    // Outward account of the member being rated (the one whose work history
    // accumulates this rating).
    memberOutwardAccountId: integer("member_outward_account_id"),
    ratedByClerkId: text("rated_by_clerk_id").notNull(),
    // Outward account that gave the rating.
    ratedByOutwardAccountId: integer("rated_by_outward_account_id"),
    stars: integer("stars").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqRating: uniqueIndex("job_ratings_log_rater_unique").on(table.workLogId, table.ratedByClerkId),
  })
);

export const insertJobRatingSchema = createInsertSchema(jobRatingsTable).omit({ id: true, createdAt: true });
export type InsertJobRating = z.infer<typeof insertJobRatingSchema>;
export type JobRating = typeof jobRatingsTable.$inferSelect;

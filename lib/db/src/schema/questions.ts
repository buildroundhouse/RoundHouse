import { pgTable, text, serial, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Two-way Q&A items shown on the Reminders screen.
 *
 * `kind` distinguishes the two directions:
 *   - "ask_pro"  — the signed-in user (a client / homeowner) is asking a
 *                  provider a question. Gamified: provider earns 5 pts on
 *                  answer, +20 pts when the client confirms it answered
 *                  their question.
 *   - "request"  — a provider is asking the signed-in user (a client) for
 *                  something needed to move forward (approve, upload,
 *                  confirm, reply). No points awarded.
 *
 * `status` values:
 *   ask_pro:  open -> answered -> completed
 *   request:  waiting -> completed
 *
 * `userClerkId` is the owner of the row (the user this question
 * appears for in their Reminders feed). `counterpartyClerkId` is the
 * other party — the provider being asked (ask_pro) or the provider
 * doing the asking (request). Either may be null if not yet bound to a
 * specific user, in which case the question is shown free-form and no
 * server-side points are awarded.
 */
export const questionsTable = pgTable(
  "reminder_questions",
  {
    id: serial("id").primaryKey(),
    userClerkId: text("user_clerk_id").notNull(),
    counterpartyClerkId: text("counterparty_clerk_id"),
    counterpartyName: text("counterparty_name"),
    kind: text("kind").notNull(), // "ask_pro" | "request"
    status: text("status").notNull(), // "open" | "answered" | "waiting" | "completed"
    questionText: text("question_text").notNull(),
    requestedAction: text("requested_action"), // for "request": "reply" | "approve" | "upload" | "confirm"
    responseText: text("response_text"),
    nextStep: text("next_step"), // for "ask_pro" after confirmed: "appointment" | "list" | "curious"
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    userIdx: index("reminder_questions_user_idx").on(t.userClerkId),
    counterpartyIdx: index("reminder_questions_counterparty_idx").on(t.counterpartyClerkId),
  }),
);

export const insertQuestionSchema = createInsertSchema(questionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertQuestion = z.infer<typeof insertQuestionSchema>;
export type Question = typeof questionsTable.$inferSelect;

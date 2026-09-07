import { pgTable, text, serial, timestamp, boolean, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type NoteAttachment = {
  path: string;
  kind: "image" | "file";
  name?: string;
  contentType?: string;
  size?: number;
};

export const propertyNotesTable = pgTable("property_notes", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id").notNull(),
  authorClerkId: text("author_clerk_id").notNull(),
  // Outward account that authored this note.
  authorOutwardAccountId: integer("author_outward_account_id"),
  title: text("title").notNull().default(""),
  body: text("body").notNull().default(""),
  isPinned: boolean("is_pinned").notNull().default(false),
  // #503 — note visibility scope.
  //   "all"                  — visible to every property member (default)
  //   "collaborator_private" — visible only to the owner, owner's internal
  //                             teammates, and the note's author. Used by
  //                             collaborators (read-only members) to leave
  //                             private observations.
  visibility: text("visibility").$type<"all" | "collaborator_private">().notNull().default("all"),
  attachments: jsonb("attachments").$type<NoteAttachment[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPropertyNoteSchema = createInsertSchema(propertyNotesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPropertyNote = z.infer<typeof insertPropertyNoteSchema>;
export type PropertyNote = typeof propertyNotesTable.$inferSelect;

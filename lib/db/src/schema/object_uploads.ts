import { pgTable, text, timestamp, integer, index } from "drizzle-orm/pg-core";

/**
 * Tracks who uploaded each private object so we can prevent reference-spoofing.
 *
 * Without this table, a user could write someone else's "/objects/<id>" path
 * into one of their own property records (specs, notes, work orders, work logs,
 * standard evidence) and gain read access to a file they did not upload.
 *
 * Uploads are recorded when the server hands out a presigned upload URL via
 * POST /storage/uploads/request-url. Attachment-writing routes verify that the
 * caller is the recorded uploader before persisting the path.
 *
 * `uploaderOutwardAccountId` records the outward-facing account that was
 * active when the upload was requested. This is what scopes media to a skin:
 * the same person uploading the same photo under two different accounts gets
 * two independent records — no cross-account dedupe.
 */
export const objectUploadsTable = pgTable(
  "object_uploads",
  {
    objectPath: text("object_path").primaryKey(),
    uploaderClerkId: text("uploader_clerk_id").notNull(),
    uploaderOutwardAccountId: integer("uploader_outward_account_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUploader: index("object_uploads_uploader_idx").on(t.uploaderClerkId),
    byOutward: index("object_uploads_outward_idx").on(t.uploaderOutwardAccountId),
  }),
);

export type ObjectUpload = typeof objectUploadsTable.$inferSelect;

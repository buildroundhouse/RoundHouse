/**
 * Idempotent backfill for `work_order_comments.author_outward_account_id`.
 *
 * The per-client tag on discussion comments (#537) resolves the author's
 * skin via `work_order_comments.authorOutwardAccountId`. Comments
 * created before that column was wired up have it set to NULL, so the
 * server has to fall back to the author's *default* outward account at
 * read time. For authors with multiple skins (e.g. a Trade Pro skin in
 * addition to a personal one), that fallback can resolve against the
 * wrong skin and surface the wrong tag — or no tag at all.
 *
 * This script stamps the author's default outward account onto every
 * legacy NULL row, mirroring the same fallback the GET handler used to
 * apply on the fly. After this runs, the GET handler no longer needs
 * the per-author fallback branch.
 *
 * Resolution order for each NULL row:
 *   1. The author's earliest non-archived outward account (their
 *      "default" skin), matching `resolveDefaultOutwardAccountIdForUser`.
 *   2. If the author has no outward accounts at all, the row is left
 *      NULL — nothing sensible to point at.
 *
 * Safe to re-run: only touches rows that are still NULL.
 */
import { eq, and, isNull, asc, inArray } from "drizzle-orm";
import {
  db,
  pool,
  workOrderCommentsTable,
  outwardAccountsTable,
} from "../src";

export async function backfillCommentAuthorOutwardAccount(): Promise<{
  rowsScanned: number;
  rowsUpdated: number;
  authorsMissingAccount: number;
}> {
  const rows = await db
    .select({
      id: workOrderCommentsTable.id,
      authorClerkId: workOrderCommentsTable.authorClerkId,
    })
    .from(workOrderCommentsTable)
    .where(isNull(workOrderCommentsTable.authorOutwardAccountId));

  if (rows.length === 0) {
    return { rowsScanned: 0, rowsUpdated: 0, authorsMissingAccount: 0 };
  }

  const authorIds = [...new Set(rows.map((r) => r.authorClerkId))];

  // Resolve each author's default (earliest non-archived) outward
  // account in one query — same logic as
  // resolveDefaultOutwardAccountIdForUser, batched.
  const accounts = await db
    .select({
      id: outwardAccountsTable.id,
      ownerClerkId: outwardAccountsTable.ownerClerkId,
    })
    .from(outwardAccountsTable)
    .where(
      and(
        inArray(outwardAccountsTable.ownerClerkId, authorIds),
        isNull(outwardAccountsTable.archivedAt),
      ),
    )
    .orderBy(asc(outwardAccountsTable.id));

  const defaultByClerk = new Map<string, number>();
  for (const a of accounts) {
    if (!defaultByClerk.has(a.ownerClerkId)) {
      defaultByClerk.set(a.ownerClerkId, a.id);
    }
  }

  let rowsUpdated = 0;
  for (const r of rows) {
    const accountId = defaultByClerk.get(r.authorClerkId);
    if (accountId == null) continue;
    await db
      .update(workOrderCommentsTable)
      .set({ authorOutwardAccountId: accountId })
      .where(
        and(
          eq(workOrderCommentsTable.id, r.id),
          isNull(workOrderCommentsTable.authorOutwardAccountId),
        ),
      );
    rowsUpdated++;
  }

  const authorsMissingAccount = authorIds.filter(
    (cid) => !defaultByClerk.has(cid),
  ).length;

  return {
    rowsScanned: rows.length,
    rowsUpdated,
    authorsMissingAccount,
  };
}

const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  process.argv[1].endsWith("backfillCommentAuthorOutwardAccount.ts");

if (isDirectRun) {
  backfillCommentAuthorOutwardAccount()
    .then((stats) => {
      // eslint-disable-next-line no-console
      console.log("[backfillCommentAuthorOutwardAccount]", stats);
      return pool.end();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[backfillCommentAuthorOutwardAccount] failed", err);
      process.exit(1);
    });
}

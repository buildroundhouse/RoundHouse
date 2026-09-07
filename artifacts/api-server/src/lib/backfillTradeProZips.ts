import { sql } from "drizzle-orm";
import { db, userModesTable } from "@workspace/db";
import { logger } from "./logger";

const ZIP_RE = /\b\d{5}\b/;

/**
 * One-time backfill: for trade_pro modes lacking a structured `primaryZip`,
 * scrape the first 5-digit number out of the freeform `region` text and save it.
 * Idempotent — only touches rows that don't already have a primaryZip set.
 */
export async function backfillTradeProZips(): Promise<{ scanned: number; updated: number }> {
  const rows = await db
    .select({
      id: userModesTable.id,
      intakeData: userModesTable.intakeData,
    })
    .from(userModesTable)
    .where(
      sql`${userModesTable.kind} = 'trade_pro' AND (${userModesTable.intakeData} ->> 'primaryZip') IS NULL`,
    );

  let updated = 0;
  for (const row of rows) {
    const data = (row.intakeData ?? {}) as Record<string, unknown>;
    const region = typeof data.region === "string" ? data.region : "";
    const match = region.match(ZIP_RE);
    if (!match) continue;
    const zip = match[0];
    const next: Record<string, unknown> = { ...data, primaryZip: zip };
    if (!Array.isArray(next.additionalZips)) next.additionalZips = [];
    await db
      .update(userModesTable)
      .set({ intakeData: next })
      .where(sql`${userModesTable.id} = ${row.id}`);
    updated += 1;
  }

  if (updated > 0 || rows.length > 0) {
    logger.info({ scanned: rows.length, updated }, "Backfilled trade-pro primary ZIPs from service area text");
  }
  return { scanned: rows.length, updated };
}

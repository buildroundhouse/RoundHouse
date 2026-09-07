import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db, propertiesTable, propertyStandardsTable } from "@workspace/db";

/**
 * Clear expired `standards_muted_until` values on properties so stale
 * mutes do not leak into reads or notification fan-out. Pass property
 * ids to scope the update; omit to clear across all properties (used
 * by background sweeps).
 */
export async function clearExpiredPropertyMutes(propertyIds?: number[]): Promise<number> {
  if (propertyIds && propertyIds.length === 0) return 0;
  const conditions = [
    isNotNull(propertiesTable.standardsMutedUntil),
    lte(propertiesTable.standardsMutedUntil, sql`now()`),
  ];
  if (propertyIds && propertyIds.length > 0) {
    conditions.push(inArray(propertiesTable.id, propertyIds));
  }
  const result = await db
    .update(propertiesTable)
    .set({ standardsMutedUntil: null })
    .where(and(...conditions))
    .returning({ id: propertiesTable.id });
  return result.length;
}

/**
 * Clear expired `snooze_until` values on standards. Pass property ids
 * to scope the update; omit to clear across all properties.
 */
export async function clearExpiredStandardSnoozes(propertyIds?: number[]): Promise<number> {
  if (propertyIds && propertyIds.length === 0) return 0;
  const conditions = [
    isNotNull(propertyStandardsTable.snoozeUntil),
    lte(propertyStandardsTable.snoozeUntil, sql`now()`),
  ];
  if (propertyIds && propertyIds.length > 0) {
    conditions.push(inArray(propertyStandardsTable.propertyId, propertyIds));
  }
  const result = await db
    .update(propertyStandardsTable)
    .set({ snoozeUntil: null })
    .where(and(...conditions))
    .returning({ id: propertyStandardsTable.id });
  return result.length;
}

/**
 * Convenience helper that clears both expired property mutes and
 * standard snoozes for the given property scope in parallel.
 */
export async function clearExpiredMutesForProperties(
  propertyIds?: number[],
): Promise<{ properties: number; standards: number }> {
  const [properties, standards] = await Promise.all([
    clearExpiredPropertyMutes(propertyIds),
    clearExpiredStandardSnoozes(propertyIds),
  ]);
  return { properties, standards };
}

/**
 * Single-property variant for hot paths like notification fan-out.
 */
export async function clearExpiredMutesForProperty(
  propertyId: number,
): Promise<{ properties: number; standards: number }> {
  return clearExpiredMutesForProperties([propertyId]);
}

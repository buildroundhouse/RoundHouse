/**
 * Regression test for task #436.
 *
 * The original failure mode: a dev database that was missing newer
 * columns the Drizzle schema declared (e.g. `reminders.notify_count`,
 * the `*_outward_account_id` columns added later) caused POST
 * /api/reminders to return 500 and `property_standards` reads to
 * crash with `column "creator_outward_account_id" does not exist`.
 * The fix was to make `lib/db/scripts/migrate.ts` carry an idempotent
 * `ADD COLUMN IF NOT EXISTS` step for every such column, so any
 * environment booting the API server is brought back in sync
 * automatically.
 *
 * This test guards against the same regression by asserting that the
 * migrate runner registers a sync step for each column the bug
 * report flagged. If a future schema addition forgets the matching
 * migrate step, this test fails before that drift can ship.
 */
import { describe, it, expect } from "vitest";

const { SCHEMA_STEPS, migrate } = await import("@workspace/db/migrate");

interface Step {
  name: string;
  sql: string;
}

function hasAddColumn(table: string, column: string): boolean {
  const re = new RegExp(
    `ALTER\\s+TABLE\\s+${table}\\s+ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+${column}\\b`,
    "i",
  );
  return (SCHEMA_STEPS as Step[]).some((s) => re.test(s.sql));
}

describe("Schema-drift safety net (#436)", () => {
  it("migrate runner has an idempotent step for every column the bug report flagged", () => {
    // Reminders columns that the original 500 was traced to.
    expect(hasAddColumn("reminders", "notify_count")).toBe(true);
    expect(hasAddColumn("reminders", "notified_at")).toBe(true);

    // Outward-account columns whose absence was crashing
    // property_standards / property_standard_evidence /
    // recurring_tasks / property_assets reads on the same dev DB.
    expect(hasAddColumn("property_standards", "creator_outward_account_id")).toBe(true);
    expect(
      hasAddColumn("property_standard_evidence", "creator_outward_account_id"),
    ).toBe(true);
    expect(hasAddColumn("recurring_tasks", "assignee_outward_account_id")).toBe(true);
    expect(hasAddColumn("recurring_tasks", "creator_outward_account_id")).toBe(true);
    expect(hasAddColumn("property_assets", "creator_outward_account_id")).toBe(true);
  });

  it("migrate() runs to completion without unresolved NOT NULL warnings", async () => {
    // The API server boots by calling migrate() — if this throws or
    // leaves unresolved warnings, every request that touches a
    // drifted column will start failing. The reminders POST 500 in
    // the original bug report was downstream of exactly that.
    const result = await migrate();
    expect(result.unresolved).toEqual([]);
    expect(typeof result.completedAt).toBe("string");
  });
});

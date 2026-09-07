import type { MigrateResult } from "@workspace/db/migrate";

export type MigrationStatus =
  | { state: "pending" }
  | {
      state: "ok";
      durationMs: number;
      completedAt: string;
      unresolved: string[];
    }
  | {
      state: "warning";
      durationMs: number;
      completedAt: string;
      unresolved: string[];
    }
  | {
      state: "failed";
      completedAt: string;
      error: string;
    };

let current: MigrationStatus = { state: "pending" };

export function getMigrationStatus(): MigrationStatus {
  return current;
}

export function recordMigrationSuccess(result: MigrateResult): void {
  current = {
    state: result.unresolved.length > 0 ? "warning" : "ok",
    durationMs: result.durationMs,
    completedAt: result.completedAt,
    unresolved: result.unresolved,
  };
}

export function recordMigrationFailure(err: unknown): void {
  current = {
    state: "failed",
    completedAt: new Date().toISOString(),
    error: err instanceof Error ? err.message : String(err),
  };
}

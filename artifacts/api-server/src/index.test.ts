import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jobs = vi.hoisted(() => ({
  migrate: vi.fn(async () => ({ unresolved: [], durationMs: 1, completedAt: "now" })),
  stripe: vi.fn(async () => {}),
  recurring: vi.fn(async () => ({ created: 0 })),
  standards: vi.fn(async () => ({ notified: 0, properties: 0 })),
  reminders: vi.fn(async () => ({ notified: 0, retried: 0 })),
  tokens: vi.fn(async () => 0),
  mutes: vi.fn(async () => ({ properties: 0, standards: 0 })),
  zips: vi.fn(async () => {}),
  entities: vi.fn(async () => ({ entitiesCreated: 0, membersCreated: 0, membersUpdated: 0, legacyOrphanRows: 0 })),
  purge: vi.fn(async () => ({ accounts: 0, connections: 0, runsTrimmed: 0, runId: 1 })),
  purgeHealth: vi.fn(async () => ({ overdue: false })),
}));

vi.mock("@workspace/db/migrate", () => ({ migrate: jobs.migrate }));
vi.mock("./app", () => ({ default: { listen: (_port: number, ready: () => void) => ready() } }));
vi.mock("./lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() } }));
vi.mock("./lib/migrationStatus", () => ({ recordMigrationFailure: vi.fn(), recordMigrationSuccess: vi.fn() }));
vi.mock("./lib/initStripe", () => ({ initStripeIntegration: jobs.stripe }));
vi.mock("./routes/work-orders", () => ({ generateRecurringWorkOrders: jobs.recurring }));
vi.mock("./routes/standards", () => ({ notifyOverdueStandardsAll: jobs.standards }));
vi.mock("./routes/reminders", () => ({ notifyDueReminders: jobs.reminders }));
vi.mock("./lib/push", () => ({ clearStalePushTokens: jobs.tokens, STALE_PUSH_TOKEN_SWEEP_HOURS: 24 }));
vi.mock("./lib/expireMutes", () => ({ clearExpiredMutesForProperties: jobs.mutes }));
vi.mock("./lib/backfillTradeProZips", () => ({ backfillTradeProZips: jobs.zips }));
vi.mock("./lib/migratePropertyEntities", () => ({ migratePropertyEntities: jobs.entities }));
vi.mock("./lib/outwardAccounts", () => ({ purgeExpiredOutwardAccounts: jobs.purge, getOutwardAccountPurgeHealth: jobs.purgeHealth }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubEnv("PORT", "3001");
  vi.stubEnv("ROUNDHOUSE_DISABLE_BACKGROUND_JOBS", "false");
  vi.stubEnv("ROUNDHOUSE_DISABLE_ACCOUNT_PURGE", "false");
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("deployment startup controls", () => {
  it("validates the schema without sending notifications or running copied-data jobs", async () => {
    vi.stubEnv("ROUNDHOUSE_DISABLE_BACKGROUND_JOBS", "true");
    await import("./index");
    await vi.advanceTimersByTimeAsync(2 * 24 * 60 * 60 * 1000);
    expect(jobs.migrate).toHaveBeenCalledOnce();
    for (const [name, job] of Object.entries(jobs)) {
      if (name !== "migrate") expect(job).not.toHaveBeenCalled();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves archived accounts while keeping reminders and recurring work running", async () => {
    vi.stubEnv("ROUNDHOUSE_DISABLE_ACCOUNT_PURGE", "true");
    await import("./index");
    await vi.advanceTimersByTimeAsync(2 * 24 * 60 * 60 * 1000);
    expect(jobs.purge).not.toHaveBeenCalled();
    expect(jobs.purgeHealth).not.toHaveBeenCalled();
    expect(jobs.entities).toHaveBeenCalledOnce();
    expect(jobs.reminders.mock.calls.length).toBeGreaterThan(1);
    expect(jobs.recurring.mock.calls.length).toBeGreaterThan(1);
  });

  it("retains the existing cleanup behavior when preservation is not selected", async () => {
    await import("./index");
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(jobs.purge).toHaveBeenCalledWith({ source: "startup" });
    expect(jobs.purge).toHaveBeenCalledWith({ source: "scheduled" });
    expect(jobs.purgeHealth).toHaveBeenCalled();
  });
});

import { DatabaseSync } from "node:sqlite";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", async () => import("../../../../lib/db/src/schema/work_logs"));
import { personalTimelineWhere } from "./personalTimeline";

function history(user: string, account: number) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE work_logs (id INTEGER, author_clerk_id TEXT, acted_by_clerk_id TEXT, author_outward_account_id INTEGER, created_in_mode_id INTEGER);
    INSERT INTO work_logs VALUES
      (1, 'owner', NULL, 10, 1),
      (2, 'worker', NULL, 20, 2),
      (3, 'owner', 'worker', 10, 1),
      (4, 'owner', NULL, 30, 3),
      (5, 'owner', NULL, NULL, 1),
      (6, 'owner', NULL, NULL, 3);`);
  const query = new PgDialect().sqlToQuery(personalTimelineWhere(user, account, 1)!);
  const sql = query.sql.replace(/\$\d+/g, "?");
  const rows = db.prepare(`SELECT id FROM work_logs WHERE ${sql} ORDER BY id`).all(...query.params as (string | number)[]);
  db.close(); return rows.map(r => r.id);
}
describe("personal Timeline SQL against recorded attribution", () => {
  it("keeps the owner's work and matching legacy work, excluding teammates and another avatar", () => {
    expect(history("owner", 10)).toEqual([1, 5]);
  });
  it("attributes work performed through a company to the actual worker", () => {
    expect(history("worker", 10)).toEqual([3]);
  });
  it("does not need current Property membership to retain a person's own history", () => {
    expect(history("worker", 20)).toEqual([2]);
    expect(history("unrelated", 10)).toEqual([]);
  });
});

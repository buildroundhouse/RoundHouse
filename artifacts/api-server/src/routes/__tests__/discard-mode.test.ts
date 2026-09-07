/**
 * Task #625: DELETE /users/me/modes/:modeId discards an in-progress
 * avatar (intake not yet completed) so the user can return to the
 * picker and start over with a clean slate. Completed modes must not
 * be discardable through this endpoint — those are managed from
 * Profile.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = String(req.headers["x-test-user"] ?? "");
    if (!req.userId) {
      _res.status(401).json({ error: "missing x-test-user" });
      return;
    }
    next();
  },
}));

const { db, usersTable, userModesTable } = await import("@workspace/db");
const usersRouter = (await import("../users")).default;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", usersRouter);
  return app;
}

const tag = `t625-${Date.now()}`;
const ownerClerk = `${tag}-owner`;
const otherClerk = `${tag}-other`;

let app: Express;

beforeAll(async () => {
  app = makeApp();
  await db.insert(usersTable).values([
    { clerkId: ownerClerk, email: `${ownerClerk}@example.test`, name: "Owner", username: ownerClerk },
    { clerkId: otherClerk, email: `${otherClerk}@example.test`, name: "Other", username: otherClerk },
  ]);
});

afterAll(async () => {
  await db.delete(userModesTable).where(inArray(userModesTable.userClerkId, [ownerClerk, otherClerk]));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, [ownerClerk, otherClerk]));
});

async function freshIncompleteMode(clerkId: string): Promise<number> {
  const [row] = await db
    .insert(userModesTable)
    .values({ userClerkId: clerkId, kind: "trade_pro", intakeData: { foo: "draft" } })
    .returning({ id: userModesTable.id });
  return row.id;
}

describe("DELETE /users/me/modes/:modeId — discard in-progress avatar (#625)", () => {
  it("404s when the mode does not belong to the caller", async () => {
    const otherModeId = await freshIncompleteMode(otherClerk);
    const res = await request(app)
      .delete(`/api/users/me/modes/${otherModeId}`)
      .set("x-test-user", ownerClerk);
    expect(res.status).toBe(404);
    // Other user's mode should still exist.
    const rows = await db.select().from(userModesTable).where(eq(userModesTable.id, otherModeId));
    expect(rows.length).toBe(1);
    await db.delete(userModesTable).where(eq(userModesTable.id, otherModeId));
  });

  it("400s on a non-numeric mode id", async () => {
    const res = await request(app)
      .delete("/api/users/me/modes/not-a-number")
      .set("x-test-user", ownerClerk);
    expect(res.status).toBe(400);
  });

  it("discards an incomplete mode and clears users.lastActiveModeId when it pointed there", async () => {
    const modeId = await freshIncompleteMode(ownerClerk);
    await db.update(usersTable).set({ lastActiveModeId: modeId }).where(eq(usersTable.clerkId, ownerClerk));
    const res = await request(app)
      .delete(`/api/users/me/modes/${modeId}`)
      .set("x-test-user", ownerClerk);
    expect(res.status).toBe(204);
    const rows = await db.select().from(userModesTable).where(eq(userModesTable.id, modeId));
    expect(rows.length).toBe(0);
    const [me] = await db
      .select({ lastActiveModeId: usersTable.lastActiveModeId })
      .from(usersTable)
      .where(eq(usersTable.clerkId, ownerClerk));
    expect(me?.lastActiveModeId).toBeNull();
  });

  it("rejects discarding a mode whose intake is already completed", async () => {
    const [row] = await db
      .insert(userModesTable)
      .values({
        userClerkId: ownerClerk,
        kind: "home",
        intakeData: { placeName: "Done", matters: ["warmth"] },
        intakeCompletedAt: new Date(),
      })
      .returning({ id: userModesTable.id });
    const res = await request(app)
      .delete(`/api/users/me/modes/${row.id}`)
      .set("x-test-user", ownerClerk);
    expect(res.status).toBe(409);
    const rows = await db.select().from(userModesTable).where(eq(userModesTable.id, row.id));
    expect(rows.length).toBe(1);
    await db.delete(userModesTable).where(eq(userModesTable.id, row.id));
  });
});

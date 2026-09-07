/**
 * End-to-end test for the cross-device reminders sync (task #416).
 *
 * Reminders previously lived only in the device's AsyncStorage. This
 * test exercises the new server-backed CRUD endpoints and the key
 * isolation guarantee: reminders created by one signed-in user must
 * never appear under another user, on any device.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    const uid = req.headers["x-test-user"];
    if (!uid) {
      _res.status(401).json({ error: "missing x-test-user" });
      return;
    }
    req.userId = String(uid);
    next();
  },
}));

const { db, remindersTable } = await import("@workspace/db");
const remindersRouter = (await import("../reminders")).default;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", remindersRouter);
  return app;
}

const tag = `t416-${Date.now()}`;
const userA = `${tag}-a`;
const userB = `${tag}-b`;

let app: Express;

beforeAll(() => {
  app = makeApp();
});

afterAll(async () => {
  await db.delete(remindersTable).where(eq(remindersTable.userClerkId, userA));
  await db.delete(remindersTable).where(eq(remindersTable.userClerkId, userB));
});

describe("Reminders sync (#416)", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/api/reminders");
    expect(res.status).toBe(401);
  });

  it("a user sees the same reminders on every device they sign in to", async () => {
    const dueAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

    // Phone A creates a reminder
    const created = await request(app)
      .post("/api/reminders")
      .set("x-test-user", userA)
      .send({ title: "Replace HVAC filter", note: "Bedroom unit", dueAt });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      title: "Replace HVAC filter",
      note: "Bedroom unit",
      done: false,
    });
    expect(typeof created.body.id).toBe("number");

    // Phone B (same user, different device) lists and sees it
    const listFromOtherDevice = await request(app)
      .get("/api/reminders")
      .set("x-test-user", userA);
    expect(listFromOtherDevice.status).toBe(200);
    const titlesB = listFromOtherDevice.body.reminders.map((r: any) => r.title);
    expect(titlesB).toContain("Replace HVAC filter");
  });

  it("scopes reminders to the signed-in user", async () => {
    const dueAt = new Date(Date.now() + 3600 * 1000).toISOString();
    await request(app)
      .post("/api/reminders")
      .set("x-test-user", userA)
      .send({ title: "User A only", dueAt });

    const otherUser = await request(app)
      .get("/api/reminders")
      .set("x-test-user", userB);
    expect(otherUser.status).toBe(200);
    const titles = otherUser.body.reminders.map((r: any) => r.title);
    expect(titles).not.toContain("User A only");
    expect(titles).not.toContain("Replace HVAC filter");
  });

  it("supports done, snooze (dueAt), and delete", async () => {
    const dueAt = new Date(Date.now() + 3600 * 1000).toISOString();
    const created = await request(app)
      .post("/api/reminders")
      .set("x-test-user", userB)
      .send({ title: "Pay rent", dueAt });
    const id = created.body.id;

    // Mark done
    const doneRes = await request(app)
      .patch(`/api/reminders/${id}`)
      .set("x-test-user", userB)
      .send({ done: true });
    expect(doneRes.status).toBe(200);
    expect(doneRes.body.done).toBe(true);

    // Snooze (update dueAt and unset done)
    const snoozedAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const snoozeRes = await request(app)
      .patch(`/api/reminders/${id}`)
      .set("x-test-user", userB)
      .send({ dueAt: snoozedAt, done: false });
    expect(snoozeRes.status).toBe(200);
    expect(snoozeRes.body.done).toBe(false);
    expect(new Date(snoozeRes.body.dueAt).toISOString()).toBe(snoozedAt);

    // A different user cannot mutate it
    const forbidden = await request(app)
      .patch(`/api/reminders/${id}`)
      .set("x-test-user", userA)
      .send({ done: true });
    expect(forbidden.status).toBe(404);

    // Delete
    const del = await request(app)
      .delete(`/api/reminders/${id}`)
      .set("x-test-user", userB);
    expect(del.status).toBe(204);

    const list = await request(app)
      .get("/api/reminders")
      .set("x-test-user", userB);
    expect(list.body.reminders.find((r: any) => r.id === id)).toBeUndefined();
  });

  it("rejects invalid create bodies", async () => {
    const noTitle = await request(app)
      .post("/api/reminders")
      .set("x-test-user", userA)
      .send({ dueAt: new Date().toISOString() });
    expect(noTitle.status).toBe(400);

    const noDue = await request(app)
      .post("/api/reminders")
      .set("x-test-user", userA)
      .send({ title: "x" });
    expect(noDue.status).toBe(400);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
const state = vi.hoisted(() => ({ row: {} as any, updates: {} as any, locked: false, member: null as any, recipientAllowed: false }));
vi.mock("../../lib/entityAccess", () => ({ getApprovedMembership: async () => state.member, canParticipateInEntity: async () => state.recipientAllowed }));
vi.mock("../../middlewares/requireAuth", () => ({ requireAuth: (req: any, res: any, next: any) => {
  if (!req.headers["x-test-user"]) return res.sendStatus(401);
  req.userId = req.headers["x-test-user"]; next();
} }));
vi.mock("@workspace/db", () => {
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ for: async (lock: string) => { state.locked = lock === "update"; return [state.row]; } }) }) }),
    update: () => ({ set: (u: any) => ({ where: async () => { state.updates = u; state.row = { ...state.row, ...u }; } }) }),
  };
  return { questionsTable: { id: "id" }, usersTable: {}, db: { transaction: async (fn: any) => fn(tx) } };
});
const router = (await import("../resolutions")).default;
const app = express(); app.use(express.json()); app.use("/api", router);
beforeEach(() => { state.row = { id: 1, userClerkId: "creator", counterpartyClerkId: "recipient", status: "open", responseText: null, updatedAt: new Date("2026-09-01"), resolutionState: null }; state.updates = {}; state.locked = false; });
describe("Resolution action endpoints", () => {
  it("rejects unrelated recipients and read-only creators before creating a record", async () => {
    const body = { entityId: 1, recipientId: "recipient", question: "Can you verify this?" };
    await request(app).post("/api/resolutions").send(body).expect(401);
    state.member = { role: "owner" }; state.recipientAllowed = false;
    await request(app).post("/api/resolutions").set("x-test-user", "creator").send(body).expect(403);
    state.member = { role: "viewer" }; state.recipientAllowed = true;
    await request(app).post("/api/resolutions").set("x-test-user", "creator").send(body).expect(403);
    await request(app).post("/api/resolutions").set("x-test-user", "creator").send({ ...body, recipientId: "creator" }).expect(400);
  });
  it("requires authentication and checks both participants", async () => {
    await request(app).post("/api/resolutions/1/actions").send({ action: "read" }).expect(401);
    await request(app).post("/api/resolutions/1/actions").set("x-test-user", "outsider").send({ action: "read" }).expect(404);
    expect(state.updates).toEqual({});
  });
  it("locks the record and appends replies without closing the item", async () => {
    await request(app).post("/api/resolutions/1/actions").set("x-test-user", "recipient").send({ action: "reply", text: "Scheduled for Saturday" }).expect(204);
    expect(state.locked).toBe(true); expect(state.row.status).toBe("answered");
    expect(state.row.resolutionState.responsibleId).toBe("creator");
    expect(state.row.resolutionState.events[0].text).toBe("Scheduled for Saturday");
  });
  it("rejects recipient closeout and requires verified creator closeout", async () => {
    await request(app).post("/api/resolutions/1/actions").set("x-test-user", "recipient").send({ action: "resolve", text: "Done", verified: true }).expect(403);
    await request(app).post("/api/resolutions/1/actions").set("x-test-user", "creator").send({ action: "resolve", text: "Done" }).expect(400);
    await request(app).post("/api/resolutions/1/actions").set("x-test-user", "creator").send({ action: "resolve", text: "Verified appointment", verified: true }).expect(204);
    expect(state.row.status).toBe("completed"); expect(state.row.confirmedAt).toBeInstanceOf(Date);
  });
  it("marks read without changing the resolved record's chronological order", async () => {
    state.row.status = "completed"; const originalDate = state.row.updatedAt;
    await request(app).post("/api/resolutions/1/actions").set("x-test-user", "recipient").send({ action: "read" }).expect(204);
    expect(state.row.updatedAt).toEqual(originalDate); expect(state.row.resolutionState.readBy).toContain("recipient");
    await request(app).post("/api/resolutions/1/actions").set("x-test-user", "creator").send({ action: "reply", text: "Change history" }).expect(409);
  });
});
